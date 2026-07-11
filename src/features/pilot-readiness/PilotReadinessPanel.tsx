import { useEffect, useMemo, useState } from "react";
import packageJson from "../../../package.json";
import { db } from "../../db/tasviehyar-db";
import { formatInvoiceTimestamp } from "../../domain/invoices";
import { type BackupHistorySummary, type BackupPreview } from "../../domain/backup";
import { BackupService } from "../../services/backup-service";

export interface PilotReadinessService {
  getCurrentRecordCounts(): Promise<BackupPreview["recordCounts"]>;
  getHistorySummary(): BackupHistorySummary;
}

export interface PilotReadinessPanelProps {
  service?: PilotReadinessService;
}

const defaultService = new BackupService(db);

function formatCountsLine(result: BackupPreview["recordCounts"] | null | undefined): string {
  if (!result) {
    return "در حال خواندن داده‌ها...";
  }

  return [
    `طرف‌ها: ${result.parties.toLocaleString("fa-IR")}`,
    `فاکتورها: ${result.invoices.toLocaleString("fa-IR")}`,
    `پرداخت‌ها: ${result.payments.toLocaleString("fa-IR")}`,
    `تخصیص‌ها: ${result.paymentAllocations.toLocaleString("fa-IR")}`,
    `پشتیبان‌ها: ${result.auditEvents.toLocaleString("fa-IR")}`
  ].join(" · ");
}

export function PilotReadinessPanel({ service = defaultService }: PilotReadinessPanelProps) {
  const [currentCounts, setCurrentCounts] = useState<BackupPreview["recordCounts"] | null>(null);
  const [historySummary, setHistorySummary] = useState<BackupHistorySummary>(service.getHistorySummary());
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      const counts = await service.getCurrentRecordCounts();
      if (!mounted) {
        return;
      }

      setCurrentCounts(counts);
      setHistorySummary(service.getHistorySummary());
    }

    void refresh();

    function handleDataUpdated() {
      void refresh();
    }

    function handleOnline() {
      setOnline(true);
    }

    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("tasviehyar-data-updated", handleDataUpdated);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted = false;
      window.removeEventListener("tasviehyar-data-updated", handleDataUpdated);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [service]);

  const lastBackupTime = historySummary.lastBackup?.createdAt ?? null;
  const statusLabel = online ? "آنلاین" : "آفلاین";
  const statusClass = online ? "status-pill status-pill-online" : "status-pill status-pill-offline";
  const versionLabel = packageJson.version || "نامشخص";

  const totalRecords = useMemo(() => {
    if (!currentCounts) {
      return "در حال بارگذاری";
    }

    return [
      currentCounts.parties,
      currentCounts.destinationAccounts,
      currentCounts.invoices,
      currentCounts.paymentInstructions,
      currentCounts.payments
    ].reduce((sum, value) => sum + value, 0);
  }, [currentCounts]);

  return (
    <section className="pilot-panel" aria-labelledby="pilot-readiness-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">آمادگی پایلوت</p>
          <h2 id="pilot-readiness-title">وضعیت اجرای محلی</h2>
        </div>
        <span className={statusClass} aria-label="وضعیت اتصال">
          {statusLabel}
        </span>
      </div>

      <div className="summary-strip" aria-label="خلاصه پایلوت">
        <span>{formatCountsLine(currentCounts)}</span>
        <span>کل رکوردها: {typeof totalRecords === "number" ? totalRecords.toLocaleString("fa-IR") : totalRecords}</span>
        <span>نسخه برنامه: {versionLabel}</span>
      </div>

      <div className="pilot-grid">
        <article className="pilot-card">
          <strong>آخرین پشتیبان</strong>
          <p className="detail-copy">{lastBackupTime ? formatInvoiceTimestamp(lastBackupTime) : "هنوز پشتیبانی ثبت نشده است."}</p>
        </article>

        <article className="pilot-card">
          <strong>یادآوری پایلوت</strong>
          <p className="detail-copy">در طول پایلوت، دفتر کاغذی را در کنار برنامه نگه دارید و هر اختلاف را قبل از ادامه کار بررسی کنید.</p>
        </article>
      </div>
    </section>
  );
}
