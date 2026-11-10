import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function pngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

const origin = "https://example.test";
const shellCacheName = "tasviehyar-shell-v5";
type WorkerRequest = { url: string; method: string; mode: string; cache: string };
type WorkerEvent = {
  request?: WorkerRequest;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (lifetime: Promise<unknown>) => void;
};

function loadWorker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  function getStore(name: string) {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return store;
  }
  const cacheStorage = {
    open: vi.fn(async (name: string) => ({
      match: async (request: WorkerRequest | string) => getStore(name).get(key(request))?.clone(),
      put: async (request: WorkerRequest | string, response: Response) => { getStore(name).set(key(request), response); },
      addAll: async (paths: string[]) => {
        for (const path of paths) getStore(name).set(key(path), new Response("precached app"));
      }
    })),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name)
  };
  const network = vi.fn<() => Promise<Response>>();
  function key(request: WorkerRequest | string) {
    return new URL(typeof request === "string" ? request : request.url, origin).href;
  }
  runInNewContext(readText("public/sw.js"), {
    URL, Response, caches: cacheStorage, fetch: network,
    self: {
      location: { origin },
      addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined }
    }
  });
  return {
    network, cacheStorage, stores,
    seed: (name: string, path: string, body: string) => getStore(name).set(key(path), new Response(body)),
    dispatchFetch(path: string, overrides: Partial<WorkerRequest> = {}) {
      const respondWith = vi.fn<(response: Promise<Response>) => void>();
      handlers.get("fetch")!({
        request: { url: key(path), method: "GET", mode: "same-origin", cache: "default", ...overrides },
        respondWith
      });
      return respondWith.mock.calls[0]?.[0];
    },
    lifecycle(type: "install" | "activate") {
      const waitUntil = vi.fn<(lifetime: Promise<unknown>) => void>();
      handlers.get(type)!({ waitUntil });
      return waitUntil.mock.calls[0]![0];
    }
  };
}

describe("PWA release assets", () => {
  it("declares both raster install icons and preserves the RTL standalone metadata", () => {
    const manifest = JSON.parse(readText("public/manifest.webmanifest")) as {
      display: string;
      dir: string;
      lang: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("fa");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }),
      expect.objectContaining({ src: "/icon-192.png", sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ src: "/icon-512.png", sizes: "512x512", type: "image/png" })
    ]));
  });

  it("precaches the shell, caches static assets and serves the warmed app offline", async () => {
    const worker = loadWorker();
    await worker.lifecycle("install");
    const shell = worker.stores.get(shellCacheName)!;
    expect([...shell.keys()]).toEqual(["/", "/index.html", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"]
      .map((path) => origin + path));
    worker.network.mockResolvedValueOnce(new Response("updated app"));
    expect(await (await worker.dispatchFetch("/", { mode: "navigate" }))?.text()).toBe("updated app");
    worker.network.mockResolvedValueOnce(new Response("hashed JS"));
    expect(await (await worker.dispatchFetch("/assets/index-abc.js"))?.text()).toBe("hashed JS");
    worker.network.mockRejectedValue(new Error("offline"));
    expect(await (await worker.dispatchFetch("/assets/index-abc.js"))?.text()).toBe("hashed JS");
    expect(await (await worker.dispatchFetch("/", { mode: "navigate" }))?.text()).toBe("updated app");
  });

  it("contains exact 192px and 512px PNG assets", () => {
    expect(pngDimensions("public/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngDimensions("public/icon-512.png")).toEqual({ width: 512, height: 512 });
  });
});

describe("service worker private response isolation", () => {
  it("bypasses API requests before cache lookup, even with stale entries present", () => {
    const worker = loadWorker();
    for (const path of [
      "/api/backup-v1.json?action=list",
      "/api/backups/opaque-id",
      "/api%2fbackups/opaque-id",
      "/backup.php?action=download"
    ]) {
      worker.seed("tasviehyar-shell-v4", path, "old private response");
      worker.seed(shellCacheName, path, "stale private response");
      expect(worker.dispatchFetch(path)).toBeUndefined();
      expect(worker.dispatchFetch(path, { mode: "navigate" })).toBeUndefined();
      expect(worker.dispatchFetch(path, { method: "POST" })).toBeUndefined();
    }
    expect(worker.cacheStorage.open).not.toHaveBeenCalled();
    expect(worker.network).not.toHaveBeenCalled();
  });

  it("does not store or replay no-store responses outside the API namespace", async () => {
    const worker = loadWorker();
    const path = "/assets/private.bin";
    worker.network.mockImplementationOnce(async () =>
      new Response("do not keep", { headers: { "Cache-Control": "max-age=0, No-Store" } })
    );
    expect(await (await worker.dispatchFetch(path))?.text()).toBe("do not keep");
    expect(worker.stores.get(shellCacheName)?.has(origin + path)).toBeFalsy();
    worker.seed("tasviehyar-shell-v4", path, "old private response");
    worker.network.mockRejectedValue(new Error("offline"));
    await expect(worker.dispatchFetch(path)).rejects.toThrow("offline");
    expect(worker.dispatchFetch(path, { cache: "no-store" })).toBeUndefined();
  });

  it("does not replace the offline shell with a no-store or redirected navigation", async () => {
    const worker = loadWorker();
    await worker.lifecycle("install");
    const redirected = new Response("private redirected body");
    Object.defineProperties(redirected, {
      redirected: { value: true },
      url: { value: origin + "/api/backups" }
    });
    worker.network
      .mockResolvedValueOnce(new Response("no-store page", { headers: { "Cache-Control": "no-store" } }))
      .mockResolvedValueOnce(redirected)
      .mockRejectedValue(new Error("offline"));
    expect(await (await worker.dispatchFetch("/temporary", { mode: "navigate" }))?.text()).toBe("no-store page");
    expect(await (await worker.dispatchFetch("/redirect", { mode: "navigate" }))?.text()).toBe("private redirected body");
    expect(await (await worker.dispatchFetch("/", { mode: "navigate" }))?.text()).toBe("precached app");
  });

  it("retires the previous app cache while leaving unrelated cache names alone", async () => {
    const worker = loadWorker();
    worker.seed("tasviehyar-shell-v4", "/api/backups", "old private response");
    worker.seed("other-app-cache", "/", "unrelated");
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    expect([...worker.stores.keys()].sort()).toEqual(["other-app-cache", shellCacheName].sort());
  });
});
