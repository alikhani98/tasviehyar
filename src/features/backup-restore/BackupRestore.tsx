import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../db/tasviehyar-db";
import { type BackupHistorySummary, type BackupPreview } from "../../domain/backup";
import { formatInvoiceTimestamp } from "../../domain/invoices";
import { BackupService, type BackupExportResult, type BackupInspectionResult, type BackupRestoreResult } from "../../services/backup-service";
import { decryptBackupText, encryptBackupText, generateRecoveryKey, parseRecoveryKey, type RecoveryKey } from "../../services/encrypted-backup-service";

export interface BackupRestoreService {
  exportBackup(): Promise<BackupExportResult>;
  exportDemoBackup?: () => Promise<BackupExportResult>;
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
  const [encryptedExportOpen, setEncryptedExportOpen] = useState(false);
  const [recoveryKeyValue, setRecoveryKeyValue] = useState("");
  const [recoveryKeyConfirmed, setRecoveryKeyConfirmed] = useState(false);
  const [encryptedExporting, setEncryptedExporting] = useState(false);
  const [encryptedNotice, setEncryptedNotice] = useState<string | null>(null);
  const [encryptedError, setEncryptedError] = useState<string | null>(null);
  const [encryptedInspectOpen, setEncryptedInspectOpen] = useState(false);
  const [encryptedFileText, setEncryptedFileText] = useState<string | null>(null);
  const [encryptedFileName, setEncryptedFileName] = useState<string | null>(null);
  const [encryptedInspection, setEncryptedInspection] = useState<BackupPreview | null>(null);
  const [encryptedDecryptedText, setEncryptedDecryptedText] = useState<string | null>(null);
  const [encryptedInspecting, setEncryptedInspecting] = useState(false);
  const [encryptedRestoring, setEncryptedRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const encryptedFileInputRef = useRef<HTMLInputElement | null>(null);
  const isMountedRef = useRef(true);
  const encryptedOperationRef = useRef(0);

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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      setRecoveryKeyValue("");
      setEncryptedFileText(null);
      setEncryptedDecryptedText(null);
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

  async function handleExportDemoBackup() {
    if (!service.exportDemoBackup) {
      setError("پشتیبان نمایشی در این نسخه در دسترس نیست.");
      return;
    }

    setExporting(true);
    setNotice(null);
    setError(null);

    try {
      const result = await service.exportDemoBackup();
      downloadTextFile(result.filename, result.text);
      setPreview(result.preview);
      setSelectedFileName(result.filename);
      setSelectedFileText(result.text);
      setNotice(`پشتیبان نمایشی با نام «${result.filename}» آماده و دانلود شد.`);
      refreshHistory();
      void refreshCurrentCounts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تهیه پشتیبان نمایشی ناموفق بود.");
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

    let result: BackupRestoreResult;
    try {
      result = await service.restoreBackupText(selectedFileText);
    } catch (caught) {
      const detail = caught instanceof Error ? ` ${caught.message}` : "";
      setError(`بازیابی پیش از ذخیره ناموفق بود.${detail}`);
      return;
    } finally {
      setRestoring(false);
    }

    setPreview(result.preview);
    setSelectedFileName(result.sourceFileName);
    const success = `بازیابی با موفقیت انجام شد. ${result.restoredRecordCounts.parties.toLocaleString("fa-IR")} طرف و ${result.restoredRecordCounts.invoices.toLocaleString("fa-IR")} فاکتور دوباره بارگذاری شد.`;
    setNotice(result.historyStatus === "failed" ? `${success} ثبت در تاریخچهٔ پشتیبان‌گیری ناموفق بود.` : success);
    window.dispatchEvent(new CustomEvent("tasviehyar-data-updated"));
    refreshHistory();
    void refreshCurrentCounts();
  }

  function closeEncryptedExport() {
    setEncryptedExportOpen(false);
    setRecoveryKeyValue("");
    setRecoveryKeyConfirmed(false);
    setEncryptedNotice(null);
    setEncryptedError(null);
  }

  function openEncryptedExport() {
    setEncryptedExportOpen(true);
    setRecoveryKeyValue("");
    setRecoveryKeyConfirmed(false);
    setEncryptedNotice(null);
    setEncryptedError(null);
  }

  function handleGenerateRecoveryKey() {
    const generated: RecoveryKey = generateRecoveryKey();
    setRecoveryKeyValue(generated.value);
    setRecoveryKeyConfirmed(false);
    setEncryptedError(null);
    setEncryptedNotice("کلید جدید ساخته شد. آن را جدا از فایل پشتیبان ذخیره کنید.");
  }

  function validRecoveryKey(value: string): boolean {
    try {
      parseRecoveryKey(value);
      return true;
    } catch {
      return false;
    }
  }

  async function handleCopyRecoveryKey() {
    if (!validRecoveryKey(recoveryKeyValue)) {
      setEncryptedError("ابتدا یک کلید بازیابی معتبر تولید یا وارد کنید.");
      return;
    }
    try {
      await navigator.clipboard.writeText(recoveryKeyValue);
      setEncryptedNotice("کلید بازیابی با اقدام صریح شما کپی شد.");
    } catch {
      setEncryptedError("کپی کلید بازیابی در این مرورگر در دسترس نیست. آن را به‌صورت دستی ذخیره کنید.");
    }
  }

  function handleDownloadRecoveryKey() {
    if (!validRecoveryKey(recoveryKeyValue)) {
      setEncryptedError("ابتدا یک کلید بازیابی معتبر تولید یا وارد کنید.");
      return;
    }
    const keyId = parseRecoveryKey(recoveryKeyValue).keyId;
    downloadTextFile(`tasviehyar-recovery-key-${keyId}.txt`, `${recoveryKeyValue}\n`);
    setEncryptedNotice("فایل کلید بازیابی دانلود شد. آن را جدا از پشتیبان رمزنگاری‌شده نگه دارید.");
  }

  async function handleEncryptedExport() {
    if (!validRecoveryKey(recoveryKeyValue)) {
      setEncryptedError("کلید بازیابی معتبر نیست.");
      return;
    }
    if (!recoveryKeyConfirmed) {
      setEncryptedError("برای ادامه تأیید کنید که کلید را مستقل و جدا از فایل پشتیبان ذخیره کرده‌اید.");
      return;
    }
    setEncryptedExporting(true);
    setEncryptedError(null);
    setEncryptedNotice(null);
    try {
      const result = await service.exportBackup();
      const encrypted = await encryptBackupText(result.text, recoveryKeyValue);
      downloadTextFile(`tasviehyar-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`, encrypted);
      setEncryptedNotice("پشتیبان رمزنگاری‌شده آماده و دانلود شد. کلید بازیابی را جداگانه نگه دارید.");
    } catch {
      setEncryptedError("تهیه پشتیبان رمزنگاری‌شده ناموفق بود. داده‌ای به سرور ارسال نشد.");
    } finally {
      setEncryptedExporting(false);
    }
  }

  function closeEncryptedInspection() {
    encryptedOperationRef.current += 1;
    setEncryptedInspectOpen(false);
    setRecoveryKeyValue("");
    setEncryptedFileText(null);
    setEncryptedFileName(null);
    setEncryptedInspection(null);
    setEncryptedDecryptedText(null);
    setEncryptedNotice(null);
    setEncryptedError(null);
    if (encryptedFileInputRef.current) encryptedFileInputRef.current.value = "";
  }

  function openEncryptedInspection() {
    encryptedOperationRef.current += 1;
    setEncryptedInspectOpen(true);
    setRecoveryKeyValue("");
    setEncryptedFileText(null);
    setEncryptedFileName(null);
    setEncryptedInspection(null);
    setEncryptedDecryptedText(null);
    setEncryptedNotice(null);
    setEncryptedError(null);
  }

  async function handleEncryptedFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    encryptedOperationRef.current += 1;
    setEncryptedFileName(file.name);
    setEncryptedFileText(await readFileText(file));
    setEncryptedInspection(null);
    setEncryptedDecryptedText(null);
    setEncryptedError(null);
    setEncryptedNotice("فایل انتخاب شد. برای بررسی، کلید بازیابی را وارد کنید.");
  }

  async function handleEncryptedInspection() {
    if (!encryptedFileText || !validRecoveryKey(recoveryKeyValue)) {
      setEncryptedError("فایل و کلید بازیابی معتبر لازم است.");
      return;
    }
    const operation = ++encryptedOperationRef.current;
    setEncryptedInspecting(true);
    setEncryptedError(null);
    try {
      const envelope = await decryptBackupText(encryptedFileText, recoveryKeyValue);
      if (operation !== encryptedOperationRef.current || !isMountedRef.current) return;
      setEncryptedInspection({
        compatible: true,
        appIdentifier: envelope.appIdentifier,
        backupFormatVersion: envelope.backupFormatVersion,
        databaseSchemaVersion: envelope.databaseSchemaVersion,
        createdAt: envelope.createdAt,
        checksum: envelope.checksum.value,
        recordCounts: {
          parties: envelope.parties.length,
          destinationAccounts: envelope.destinationAccounts.length,
          invoices: envelope.invoices.length,
          paymentInstructions: envelope.paymentInstructions.length,
          payments: envelope.payments.length,
          paymentAllocations: envelope.paymentAllocations.length,
          paymentVerifications: envelope.paymentVerifications.length,
          auditEvents: envelope.auditEvents.length
        },
        issues: [],
        ...(envelope.applicationVersion ? { applicationVersion: envelope.applicationVersion } : {})
      });
      setEncryptedDecryptedText(JSON.stringify(envelope));
      setEncryptedNotice("فایل رمزگشایی و اعتبارسنجی شد؛ هیچ داده‌ای در IndexedDB نوشته نشد.");
    } catch {
      setEncryptedInspection(null);
      setEncryptedError("فایل یا کلید بازیابی معتبر نیست؛ داده‌ای تغییر نکرد.");
    } finally {
      setEncryptedInspecting(false);
    }
  }

  async function handleEncryptedRestore() {
    if (!encryptedDecryptedText || encryptedRestoring) return;
    if (!window.confirm("این کار همه داده‌های محلی فعلی را با نسخه پشتیبان رمزگشایی‌شده جایگزین می‌کند. قبل از ادامه، یک پشتیبان تازه از داده‌های فعلی دریافت کنید.")) return;
    setEncryptedRestoring(true);
    setEncryptedError(null);
    setEncryptedNotice(null);
    try {
      const result = await service.restoreBackupText(encryptedDecryptedText);
      const success = `بازیابی رمزنگاری‌شده با موفقیت انجام شد. ${result.restoredRecordCounts.parties.toLocaleString("fa-IR")} طرف و ${result.restoredRecordCounts.invoices.toLocaleString("fa-IR")} فاکتور دوباره بارگذاری شد.`;
      setEncryptedNotice(result.historyStatus === "failed" ? `${success} ثبت در تاریخچهٔ پشتیبان‌گیری ناموفق بود.` : success);
      window.dispatchEvent(new CustomEvent("tasviehyar-data-updated"));
      refreshHistory();
      void refreshCurrentCounts();
    } catch (caught) {
      const detail = caught instanceof Error ? ` ${caught.message}` : "";
      setEncryptedError(`بازیابی رمزنگاری‌شده پیش از ذخیره ناموفق بود.${detail}`);
    } finally {
      setEncryptedRestoring(false);
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
        <span>آخرین پشتیبان: {lastBackup ? formatInvoiceTimestamp(lastBackup.createdAt) : "ثبت نشده"}</span>
        <span>آخرین بازیابی: {lastRestore ? formatInvoiceTimestamp(lastRestore.createdAt) : "ثبت نشده"}</span>
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
        <button type="button" className="secondary-button" onClick={() => void handleExportDemoBackup()} disabled={exporting || restoring}>
          دریافت پشتیبان نمایشی
        </button>
        <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={exporting || restoring}>
          بازیابی از فایل
        </button>
        <button type="button" className="secondary-button" onClick={openEncryptedExport} disabled={exporting || restoring}>
          پشتیبان‌گیری رمزنگاری‌شده
        </button>
        <button type="button" className="secondary-button" onClick={openEncryptedInspection} disabled={exporting || restoring}>
          بررسی پشتیبان رمزنگاری‌شده
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

      {encryptedExportOpen ? (
        <section className="summary-card" aria-label="پشتیبان‌گیری رمزنگاری‌شده">
          <h3>پشتیبان‌گیری رمزنگاری‌شده</h3>
          <p className="detail-copy">کلید بازیابی مستقل است. اگر آن را گم کنید، این پشتیبان قابل بازیابی نخواهد بود.</p>
          {recoveryKeyValue ? <code dir="ltr" className="detail-copy" aria-label="کلید بازیابی">{recoveryKeyValue}</code> : null}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={handleGenerateRecoveryKey}>تولید کلید بازیابی</button>
            <button type="button" className="secondary-button" onClick={handleCopyRecoveryKey} disabled={!recoveryKeyValue}>کپی کلید بازیابی</button>
            <button type="button" className="secondary-button" onClick={handleDownloadRecoveryKey} disabled={!recoveryKeyValue}>دانلود فایل کلید بازیابی</button>
          </div>
          <label className="detail-copy"><input type="checkbox" checked={recoveryKeyConfirmed} onChange={(event) => setRecoveryKeyConfirmed(event.target.checked)} /> کلید را خارج از برنامه و جدا از فایل پشتیبان ذخیره کرده‌ام.</label>
          {encryptedError ? <div className="notice notice-error" role="alert">{encryptedError}</div> : null}
          {encryptedNotice ? <div className="notice notice-success" role="status">{encryptedNotice}</div> : null}
          <div className="form-actions">
            <button type="button" className="primary-button" onClick={() => void handleEncryptedExport()} disabled={encryptedExporting || !recoveryKeyValue}>دریافت پشتیبان رمزنگاری‌شده</button>
            <button type="button" className="secondary-button" onClick={closeEncryptedExport}>بستن</button>
          </div>
        </section>
      ) : null}

      {encryptedInspectOpen ? (
        <section className="summary-card" aria-label="بررسی پشتیبان رمزنگاری‌شده">
          <h3>بررسی پشتیبان رمزنگاری‌شده</h3>
          <p className="detail-copy">این مرحله فقط فایل را بررسی می‌کند و هیچ تغییری در داده‌های محلی ایجاد نمی‌کند.</p>
          <button type="button" className="secondary-button" onClick={() => encryptedFileInputRef.current?.click()}>انتخاب فایل رمزنگاری‌شده</button>
          <input ref={encryptedFileInputRef} className="backup-file-input" type="file" accept=".json,application/json" onChange={(event) => void handleEncryptedFileSelection(event)} aria-label="انتخاب فایل رمزنگاری‌شده" />
          {encryptedFileName ? <p className="detail-copy">فایل انتخاب‌شده: {encryptedFileName}</p> : null}
          <label className="detail-copy" htmlFor="encrypted-recovery-key">کلید بازیابی فایل</label>
          <input id="encrypted-recovery-key" dir="ltr" type="password" value={recoveryKeyValue} onChange={(event) => { encryptedOperationRef.current += 1; setRecoveryKeyValue(event.target.value); setEncryptedInspection(null); setEncryptedDecryptedText(null); }} autoComplete="off" />
          {encryptedError ? <div className="notice notice-error" role="alert">{encryptedError}</div> : null}
          {encryptedNotice ? <div className="notice notice-success" role="status">{encryptedNotice}</div> : null}
          <div className="form-actions">
            <button type="button" className="primary-button" onClick={() => void handleEncryptedInspection()} disabled={encryptedInspecting || encryptedRestoring || !encryptedFileText}>بررسی و رمزگشایی</button>
            <button type="button" className="primary-button" onClick={() => void handleEncryptedRestore()} disabled={!encryptedDecryptedText || encryptedInspecting || encryptedRestoring}>تأیید بازیابی رمزنگاری‌شده</button>
            <button type="button" className="secondary-button" onClick={closeEncryptedInspection}>بستن</button>
          </div>
          {encryptedInspection ? <div className="notice notice-success" role="status">اعتبارسنجی موفق است. نسخه قالب {encryptedInspection.backupFormatVersion}، شِمای {encryptedInspection.databaseSchemaVersion}، {formatCountsLine(encryptedInspection.recordCounts)}. این بررسی بدون نوشتن در IndexedDB انجام شد.</div> : null}
        </section>
      ) : null}
    </section>
  );
}
