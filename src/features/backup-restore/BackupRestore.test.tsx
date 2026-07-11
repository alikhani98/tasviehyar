import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupHistorySummary, BackupPreview } from "../../domain/backup";
import type { BackupExportResult, BackupInspectionResult, BackupRestoreResult } from "../../services/backup-service";
import { BackupRestore } from "./BackupRestore";

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
      inspectBackupText: vi.fn(async (): Promise<BackupInspectionResult> => ({
        envelope: null,
        preview: makePreview()
      })),
      restoreBackupText: vi.fn(async (): Promise<BackupRestoreResult> => ({
        preview: makePreview(),
        restoredRecordCounts: makePreview().recordCounts!,
        restoredAt: "2026-07-10T10:05:00.000Z",
        sourceFileName: "tasviehyar-backup-2026-07-10-1000.json"
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
    expect(screen.getByRole("button", { name: "بازیابی از فایل" })).toBeEnabled();
  });

  it("shows a restore preview before confirmation and blocks duplicate submissions", async () => {
    const user = userEvent.setup();
    const restoreDeferred = createDeferred<BackupRestoreResult>();
    const service = {
      exportBackup: vi.fn(async (): Promise<BackupExportResult> => ({
        filename: "tasviehyar-backup-2026-07-10-1000.json",
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

    restoreDeferred.resolve({
      preview: makePreview(),
      restoredRecordCounts: makePreview().recordCounts!,
      restoredAt: "2026-07-10T10:05:00.000Z",
      sourceFileName: "tasviehyar-backup-2026-07-10-1000.json"
    });

    expect(await screen.findByText(/بازیابی با موفقیت انجام شد/)).toBeInTheDocument();
  });
});
