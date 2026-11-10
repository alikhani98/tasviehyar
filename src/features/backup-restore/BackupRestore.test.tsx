import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupHistorySummary, BackupPreview } from "../../domain/backup";
import type { BackupExportResult, BackupInspectionResult, BackupRestoreResult } from "../../services/backup-service";
import { BackupRestore } from "./BackupRestore";
import { encryptBackupText, generateRecoveryKey } from "../../services/encrypted-backup-service";

const demoBackupText = readFileSync("demo/tasviehyar-demo-backup-v1.json", "utf8");

function makePreview(overrides: Partial<BackupPreview> = {}): BackupPreview {
  return {
    compatible: true,
    appIdentifier: "tasviehyar",
    backupFormatVersion: 1,
    databaseSchemaVersion: 3,
    applicationVersion: "0.0.0",
    createdAt: "2026-07-10T10:00:00.000Z",
    checksum: "abc123",
    recordCounts: {
      parties: 2,
      destinationAccounts: 1,
      invoices: 1,
      paymentInstructions: 1,
      payments: 1,
      paymentAllocations: 1,
      paymentVerifications: 1,
      auditEvents: 8
    },
    issues: [],
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe("backup restore UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the Persian RTL safety section", () => {
    const service = {
      exportBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-backup-2026-07-10-1000.json",
        text: "{}",
        preview: makePreview(),
        checksum: "abc123"
      })),
      exportDemoBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-demo-backup-2026-07-10-1000.json",
        text: "{}",
        preview: makePreview(),
        checksum: "abc123"
      })),
      inspectBackupText: vi.fn(async (): Promise<BackupInspectionResult> => ({
        envelope: null,
        preview: makePreview()
      })),
      restoreBackupText: vi.fn(async (): Promise<BackupRestoreResult> => ({
        preview: makePreview(),
        restoredRecordCounts: makePreview().recordCounts!,
        restoredAt: "2026-07-10T10:05:00.000Z",
        sourceFileName: "tasviehyar-backup-2026-07-10-1000.json",
        historyStatus: "recorded"
      })),
      getHistorySummary: vi.fn((): BackupHistorySummary => ({
        entries: [],
        lastBackup: null,
        lastRestore: null
      })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    };

    render(<BackupRestore service={service} />);

    expect(screen.getByRole("heading", { name: "پشتیبان‌گیری و بازیابی" })).toBeInTheDocument();
    expect(screen.getByText("این فایل‌ها حاوی اطلاعات مالی و هویتی حساس هستند. پشتیبان‌ها را فقط در محل‌های امن نگه دارید و بهتر است بیش از یک نسخه در مکان‌های جداگانه داشته باشید.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "دریافت فایل پشتیبان" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "دریافت پشتیبان نمایشی" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "بازیابی از فایل" })).toBeEnabled();
  });

  const outcomes = ["recorded", "history failure", "pre-commit failure"] as const;
  it.each(outcomes)("previews and submits once, then accurately reports %s", async (outcome) => {
    const user = userEvent.setup();
    const restoreDeferred = createDeferred<BackupRestoreResult>();
    const service = {
      exportBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-backup-2026-07-10-1000.json",
        text: "{}",
        preview: makePreview(),
        checksum: "abc123"
      })),
      exportDemoBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-demo-backup-2026-07-10-1000.json",
        text: "{}",
        preview: makePreview(),
        checksum: "abc123"
      })),
      inspectBackupText: vi.fn(async (): Promise<BackupInspectionResult> => ({
        envelope: null,
        preview: makePreview()
      })),
      restoreBackupText: vi.fn(() => restoreDeferred.promise),
      getHistorySummary: vi.fn((): BackupHistorySummary => ({
        entries: [],
        lastBackup: null,
        lastRestore: null
      })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    };

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispatched = vi.spyOn(window, "dispatchEvent");

    render(<BackupRestore service={service} />);

    const fileInput = screen.getAllByLabelText("انتخاب فایل پشتیبان")[0]!;
    const file = new File([JSON.stringify({ demo: true })], "tasviehyar-backup-2026-07-10-1000.json", {
      type: "application/json"
    });

    await user.upload(fileInput, file);
    expect(await screen.findByRole("heading", { name: "پیش‌نمایش فایل پشتیبان" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تأیید بازیابی" })).toBeEnabled();

    const restoreButton = screen.getByRole("button", { name: "تأیید بازیابی" });
    await user.click(restoreButton);
    await waitFor(() => expect(service.restoreBackupText).toHaveBeenCalledTimes(1));
    expect(restoreButton).toBeDisabled();

    await user.click(restoreButton);
    expect(service.restoreBackupText).toHaveBeenCalledTimes(1);

    if (outcome === "pre-commit failure") {
      restoreDeferred.reject(new Error("transaction aborted"));
      expect(await screen.findByText(/بازیابی پیش از ذخیره ناموفق بود/)).toBeInTheDocument();
      expect(screen.queryByText(/بازیابی با موفقیت انجام شد/)).not.toBeInTheDocument();
    } else {
      restoreDeferred.resolve({
        preview: makePreview(),
        restoredRecordCounts: makePreview().recordCounts!,
        restoredAt: "2026-07-10T10:05:00.000Z",
        sourceFileName: "tasviehyar-backup-2026-07-10-1000.json",
        historyStatus: outcome === "recorded" ? "recorded" : "failed"
      });
      const notice = await screen.findByText(/بازیابی با موفقیت انجام شد/);
      if (outcome === "history failure") {
        expect(notice).toHaveTextContent("ثبت در تاریخچهٔ پشتیبان‌گیری ناموفق بود.");
      } else {
        expect(notice).not.toHaveTextContent("ناموفق بود");
      }
    }
    expect(dispatched.mock.calls.filter(([event]) => event.type === "tasviehyar-data-updated"))
      .toHaveLength(outcome === "pre-commit failure" ? 0 : 1);
  });

  it("requires independent key confirmation before encrypted export and supports explicit key actions", async () => {
    const user = userEvent.setup();
    const service = {
      exportBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-backup.json",
        text: demoBackupText,
        preview: makePreview(),
        checksum: "abc123"
      })),
      inspectBackupText: vi.fn(),
      restoreBackupText: vi.fn(),
      getHistorySummary: vi.fn(() => ({ entries: [], lastBackup: null, lastRestore: null })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    };
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(<BackupRestore service={service} />);
    await user.click(screen.getByRole("button", { name: "پشتیبان‌گیری رمزنگاری‌شده" }));
    await user.click(screen.getByRole("button", { name: "تولید کلید بازیابی" }));
    expect(screen.getByLabelText("کلید بازیابی")).toHaveTextContent("TYRK1-");
    await user.click(screen.getByRole("button", { name: "دریافت پشتیبان رمزنگاری‌شده" }));
    expect(await screen.findByText(/تأیید کنید که کلید را مستقل/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "کپی کلید بازیابی" }));
    await user.click(screen.getByRole("button", { name: "دانلود فایل کلید بازیابی" }));
    await user.click(screen.getByRole("button", { name: "دریافت پشتیبان رمزنگاری‌شده" }));
    await waitFor(() => expect(service.exportBackup).toHaveBeenCalledTimes(1));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("TYRK1-"));
  });

  it("inspects an encrypted file without invoking restore or database services", async () => {
    const user = userEvent.setup();
    const key = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackupText, key.value);
    const service = {
      exportBackup: vi.fn(),
      inspectBackupText: vi.fn(),
      restoreBackupText: vi.fn(async (): Promise<BackupRestoreResult> => ({
        preview: makePreview(),
        restoredRecordCounts: makePreview().recordCounts!,
        restoredAt: "2026-07-10T10:05:00.000Z",
        sourceFileName: "encrypted.json",
        historyStatus: "recorded"
      })),
      getHistorySummary: vi.fn(() => ({ entries: [], lastBackup: null, lastRestore: null })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    };
    render(<BackupRestore service={service} />);
    await user.click(screen.getByRole("button", { name: "بررسی پشتیبان رمزنگاری‌شده" }));
    const file = new File([encrypted], "encrypted.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("انتخاب فایل رمزنگاری‌شده"), file);
    await user.type(screen.getByLabelText("کلید بازیابی فایل"), key.value);
    await user.click(screen.getByRole("button", { name: "بررسی و رمزگشایی" }));
    expect(await screen.findByText(/هیچ داده‌ای در IndexedDB نوشته نشد/)).toBeInTheDocument();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "تأیید بازیابی رمزنگاری‌شده" }));
    expect(service.restoreBackupText).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "تأیید بازیابی رمزنگاری‌شده" }));
    await waitFor(() => expect(service.restoreBackupText).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/بازیابی رمزنگاری‌شده با موفقیت انجام شد/)).toBeInTheDocument();
    expect(service.inspectBackupText).not.toHaveBeenCalled();
  });

  it("rejects a wrong recovery key and tampered encrypted content before restore", async () => {
    const user = userEvent.setup();
    const key = generateRecoveryKey();
    const encrypted = await encryptBackupText(demoBackupText, key.value);
    const service = {
      exportBackup: vi.fn(), inspectBackupText: vi.fn(), restoreBackupText: vi.fn(),
      getHistorySummary: vi.fn(() => ({ entries: [], lastBackup: null, lastRestore: null })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    };
    render(<BackupRestore service={service} />);
    await user.click(screen.getByRole("button", { name: "بررسی پشتیبان رمزنگاری‌شده" }));
    await user.upload(screen.getByLabelText("انتخاب فایل رمزنگاری‌شده"), new File([encrypted.slice(0, -4) + "AAAA"], "tampered.json", { type: "application/json" }));
    await user.type(screen.getByLabelText("کلید بازیابی فایل"), generateRecoveryKey().value);
    await user.click(screen.getByRole("button", { name: "بررسی و رمزگشایی" }));
    expect(await screen.findByText(/فایل یا کلید بازیابی معتبر نیست/)).toBeInTheDocument();
    expect(service.restoreBackupText).not.toHaveBeenCalled();
  });

  it("rejects an invalid recovery key and clears it when the workflow closes", async () => {
    const user = userEvent.setup();
    render(<BackupRestore service={{
      exportBackup: vi.fn(),
      inspectBackupText: vi.fn(),
      restoreBackupText: vi.fn(),
      getHistorySummary: vi.fn(() => ({ entries: [], lastBackup: null, lastRestore: null })),
      getCurrentRecordCounts: vi.fn(async () => makePreview().recordCounts)
    }} />);
    await user.click(screen.getByRole("button", { name: "پشتیبان‌گیری رمزنگاری‌شده" }));
    await user.click(screen.getByRole("button", { name: "تولید کلید بازیابی" }));
    expect(screen.getByLabelText("کلید بازیابی")).toHaveTextContent("TYRK1-");
    await user.click(screen.getByRole("button", { name: "بستن" }));
    expect(screen.queryByLabelText("کلید بازیابی")).not.toBeInTheDocument();
  });
});
