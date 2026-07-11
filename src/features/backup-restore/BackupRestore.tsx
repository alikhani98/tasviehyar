import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../db/tasviehyar-db";
import { type BackupHistorySummary, type BackupPreview } from "../../domain/backup";
import { BackupService, type BackupExportResult, type BackupInspectionResult, type BackupRestoreResult } from "../../services/backup-service";

export interface BackupRestoreService {
  exportBackup(): Promise<BackupExportResult>;
  inspectBackupText(text: string): Promise<BackupInspectionResult>;
  restoreBackupText(text: string): Promise<BackupRestoreResult>;
  getHistorySummary(): BackupHistorySummary;
  getCurrentRecordCounts(): Promise<BackupPreview["recordCounts"]>;
}

export interface BackupRestoreProps {
  service?: BackupRestoreService;
}

const defaultService = new BackupService(db);

function formatCountsLine(result: BackupPreview["recordCounts"] | null | undefined): string {
  if (!result) {
    return "هنوز پشتیبانی ثبت نشده است.";
  }

  return [
    `طرف‌ها: ${result.parties.toLocaleString("fa-IR")}`,
    `حساب‌ها: ${result.destinationAccounts.toLocaleString("fa-IR")}`,
    `فاکتورها: ${result.invoices.toLocaleString("fa-IR")}`,
    `دستورها: ${result.paymentInstructions.toLocaleString("fa-IR")}`,
    `پرداخت‌ها: ${result.payments.toLocaleString("fa-IR")}`,
    `تخصیص‌ها: ${result.paymentAllocations.toLocaleString("fa-IR")}`,
    `تأییدها: ${result.paymentVerifications.toLocaleString("fa-IR")}`,
    `رویدادها: ${result.auditEvents.toLocaleString("fa-IR")}`
  ].join(" · ");
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("فایل پشتیبان خوانده نشد."));
    };

    reader.readAsText(file);
  });
}

export function BackupRestore({ service = defaultService }: BackupRestoreProps) {
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historySummary, setHistorySummary] = useState(service.getHistorySummary());
  const [currentCounts, setCurrentCounts] = useState<BackupPreview["recordCounts"] | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileText, setSelectedFileText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef(true);

  const refreshHistory = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    setHistorySummary(service.getHistorySummary());
    setLoadingHistory(false);
  }, [service]);

  const refreshCurrentCounts = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    const counts = await service.getCurrentRecordCounts();
    if (!isMountedRef.current) {
      return;
    }

    setCurrentCounts(counts);
  }, [service]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    refreshHistory();
    void refreshCurrentCounts();
  }, [refreshCurrentCounts, refreshHistory]);

  function clearPreview(message?: string) {
    setPreview(null);
    setSelectedFileName(null);
    setSelectedFileText(null);
    setNotice(message ?? null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleExportCurrentBackup() {
    setExporting(true);
    setNotice(null);
    setError(null);

    try {
      const result = await service.exportBackup();
      downloadTextFile(result.filename, result.text);
      setPreview(result.preview);
      setSelectedFileName(result.filename);
      setSelectedFileText(result.text);
      setNotice(`پشتیبان با نام «${result.filename}» آماده و دانلود شد.`);
      refreshHistory();
      void refreshCurrentCounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تهیه پشتیبان ناموفق بود.");
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      clearPreview();
      return;
    }

    setNotice(null);
    setError(null);

    try {
      const text = await readFileText(file);
      const inspection = await service.inspectBackupText(text);
      setPreview(inspection.preview);
      setSelectedFileName(file.name);
      setSelectedFileText(text);
    } catch (caught) {
      setPreview(null);
      setSelectedFileName(file.name);
      setSelectedFileText(null);
      setError(caught instanceof Error ? caught.message : "فایل پشتیبان قابل بررسی نیست.");
    }
  }

  async function handleRestore() {
    if (!selectedFileText || !preview?.compatible || restoring) {
      return;
    }

    if (
      !window.confirm(
        "این کار همه داده‌های محلی فعلی را با نسخه پشتیبان جایگزین می‌کند. قبل از ادامه، مطمئن شوید که یک پشتیبان تازه از داده‌های فعلی دریافت کرده‌اید."
      )
    ) {
      return;
    }

    setRestoring(true);
    setNotice(null);
    setError(null);

    try {
      const result: BackupRestoreResult = await service.restoreBackupText(selectedFileText);
      setPreview(result.preview);
      setNotice(
        `بازیابی با موفقیت انجام شد. ${result.restoredRecordCounts.parties.toLocaleString("fa-IR")} طرف و ${result.restoredRecordCounts.invoices.toLocaleString("fa-IR")} فاکتور دوباره بارگذاری شد.`
      );
      setSelectedFileName(result.sourceFileName);
      refreshHistory();
      void refreshCurrentCounts();
      window.dispatchEvent(new CustomEvent("tasviehyar-data-updated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "بازیابی ناموفق بود.");
    } finally {
      setRestoring(false);
    }
  }

  const lastBackup = historySummary.lastBackup;
  const lastRestore = historySummary.lastRestore;
  const canRestore = Boolean(selectedFileText && preview?.compatible && !restoring);
  const issues = preview?.issues ?? [];

  return (
    <section id="backup-restore" className="backup-restore" aria-labelledby="backup-restore-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۷</p>
          <h2 id="backup-restore-title">پشتیبان‌گیری و بازیابی</h2>
        </div>
      </div>

      <div className="summary-strip" aria-label="خلاصه پشتیبان">
        <span>آخرین پشتیبان: {lastBackup ? lastBackup.createdAt : "ثبت نشده"}</span>
        <span>آخرین بازیابی: {lastRestore ? lastRestore.createdAt : "ثبت نشده"}</span>
        <span>دفعات ثبت‌شده: {historySummary.entries.length.toLocaleString("fa-IR")}</span>
      </div>

      <div className="notice notice-warning" role="note">
        این فایل‌ها حاوی اطلاعات مالی و هویتی حساس هستند. پشتیبان‌ها را فقط در محل‌های امن نگه دارید و بهتر است بیش از یک نسخه در مکان‌های جداگانه داشته باشید.
      </div>

      {(notice || error) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice}
        </div>
      )}

      {loadingHistory ? (
        <div className="empty-state">
          <strong>در حال خواندن تاریخچه پشتیبان...</strong>
        </div>
      ) : null}

      <div className="summary-card">
        <strong>اطلاعات اصلی فعلی</strong>
        <p className="detail-copy">{formatCountsLine(currentCounts)}</p>
        {lastBackup ? <p className="detail-copy">آخرین فایل: {lastBackup.fileName}</p> : null}
      </div>

      <div className="form-actions">
        <button type="button" className="primary-button" onClick={() => void handleExportCurrentBackup()} disabled={exporting || restoring}>
          دریافت فایل پشتیبان
        </button>
        <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={exporting || restoring}>
          بازیابی از فایل
        </button>
        <input
          ref={fileInputRef}
          className="backup-file-input"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void handleFileSelection(event)}
          aria-label="انتخاب فایل پشتیبان"
        />
      </div>

      {preview ? (
        <section className="summary-card" aria-label="پیش‌نمایش بازیابی">
          <h3>پیش‌نمایش فایل پشتیبان</h3>
          <dl className="detail-grid">
            <div>
              <dt>نام فایل</dt>
              <dd>{selectedFileName ?? "نامشخص"}</dd>
            </div>
            <div>
              <dt>زمان ایجاد</dt>
              <dd>{preview.createdAt ?? "نامشخص"}</dd>
            </div>
            <div>
              <dt>نسخه قالب</dt>
              <dd>{preview.backupFormatVersion?.toLocaleString("fa-IR") ?? "نامشخص"}</dd>
            </div>
            <div>
              <dt>نسخه شِما</dt>
              <dd>{preview.databaseSchemaVersion?.toLocaleString("fa-IR") ?? "نامشخص"}</dd>
            </div>
            <div>
              <dt>سازگاری</dt>
              <dd>{preview.compatible ? "آماده بازیابی" : "نیازمند بررسی"}</dd>
            </div>
            <div>
              <dt>شناسه برنامه</dt>
              <dd>{preview.appIdentifier ?? "نامشخص"}</dd>
            </div>
          </dl>

          <p className="detail-copy">{formatCountsLine(preview.recordCounts)}</p>

          <div className="notice notice-warning" role="note">
            قبل از تأیید بازیابی، یک پشتیبان تازه از داده‌های فعلی دریافت کنید. بازیابی به‌صورت جایگزینی کامل انجام می‌شود و داده‌های محلی فعلی را بازنویسی می‌کند.
          </div>

          {issues.length > 0 ? (
            <div className="backup-issues" aria-label="هشدارها و خطاها">
              {issues.map((issue, index) => (
                <div key={`${issue.code}-${index}`} className={issue.severity === "error" ? "issue-item issue-error" : "issue-item issue-warning"}>
                  <strong>{issue.severity === "error" ? "خطا" : "هشدار"}</strong>
                  <p>{issue.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="detail-copy">هیچ هشدار یا خطای سازگاری پیدا نشد.</p>
          )}

          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => void handleExportCurrentBackup()} disabled={exporting || restoring}>
              دریافت پشتیبان فعلی
            </button>
            <button type="button" className="primary-button" onClick={() => void handleRestore()} disabled={!canRestore}>
              تأیید بازیابی
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
