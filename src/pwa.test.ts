import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("uses a versioned cache, precaches the small app icons, and keeps an offline navigation fallback", () => {
    const serviceWorker = readText("public/sw.js");
    expect(serviceWorker).toContain('CACHE_NAME = "tasviehyar-shell-v4"');
    expect(serviceWorker).toContain('"/icon-192.png"');
    expect(serviceWorker).toContain('"/icon-512.png"');
    expect(serviceWorker).toContain('caches.match("/index.html")');
    expect(serviceWorker).toContain('keys.filter((key) => key !== CACHE_NAME)');
    expect(serviceWorker).not.toContain("Reports-");
  });

  it("contains exact 192px and 512px PNG assets", () => {
    expect(pngDimensions("public/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngDimensions("public/icon-512.png")).toEqual({ width: 512, height: 512 });
  });
});
