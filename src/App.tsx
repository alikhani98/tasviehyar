import { useState } from "react";
import { InvoiceManagement } from "./features/invoice-management/InvoiceManagement";
import { BackupRestore } from "./features/backup-restore/BackupRestore";
import { PilotReadinessPanel } from "./features/pilot-readiness/PilotReadinessPanel";
import { PaymentManagement } from "./features/payment-management/PaymentManagement";
import { PartyManagement } from "./features/party-management/PartyManagement";
import { SettlementReview } from "./features/settlement-review/SettlementReview";

const entryPoints = [
  { label: "صفحه اصلی", section: "home" },
  { label: "اشخاص", section: "parties" },
  { label: "فاکتورها", section: "invoices" },
  { label: "ثبت پرداخت", section: "payments" },
  { label: "مغایرت‌ها", section: "reconciliation" },
  { label: "پشتیبان‌گیری و بازیابی", section: "backup" }
] as const;

const homeActions = [
  { label: "ثبت فاکتور", target: "invoices" },
  { label: "ثبت پرداخت", target: "payments" },
  { label: "جست‌وجوی شخص", target: "parties" },
  { label: "مشاهده مغایرت‌ها", target: "reconciliation" },
  { label: "آخرین پشتیبان", target: "backup" }
] as const;

export function App() {
  const [currentSection, setCurrentSection] = useState<"home" | "parties" | "invoices" | "payments" | "reconciliation" | "backup">("home");

  function scrollToHome() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToPartyManagement() {
    document.getElementById("party-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToInvoiceManagement() {
    document.getElementById("invoice-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToPaymentManagement() {
    document.getElementById("payment-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToSettlementReview() {
    document.getElementById("settlement-review")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToBackupRestore() {
    document.getElementById("backup-restore")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="app-shell" lang="fa" dir="rtl">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">مرحله ۸</p>
        <h1 id="app-title">تسویه‌یار</h1>
        <p className="hero-copy">
          ابزار محلی و فارسی برای ثبت اشخاص، حساب‌های مقصد، فاکتورهای تک‌مبلغی، دستورهای پرداخت، پرداخت‌های واقعیِ هر فاکتور، و پشتیبان‌گیری امن از داده‌ها، با ذخیره‌سازی آفلاین، دسترسی سریع و تاریخچه قابل پیگیری.
        </p>

        <div className="status-banner" role="note" aria-label="notice">
          این نسخه «صفحه اصلی»، «اشخاص»، «فاکتورها»، «ثبت پرداخت»، «مغایرت‌ها»، و «پشتیبان‌گیری و بازیابی» را فعال کرده است. دستورهای پرداخت داخل جزئیات هر فاکتور و پرداخت‌های واقعی در بخش جداگانه مدیریت می‌شوند.
        </div>
      </section>

      <nav className="app-navigation" aria-label="پیمایش برنامه">
        {entryPoints.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className={currentSection === entry.section ? "entry-card entry-card-active" : "entry-card"}
            aria-current={currentSection === entry.section ? "page" : undefined}
            onClick={() => {
              setCurrentSection(entry.section);
              if (entry.section === "home") {
                scrollToHome();
              } else if (entry.section === "invoices") {
                scrollToInvoiceManagement();
              } else if (entry.section === "payments") {
                scrollToPaymentManagement();
              } else if (entry.section === "parties") {
                scrollToPartyManagement();
              } else if (entry.section === "reconciliation") {
                scrollToSettlementReview();
              } else if (entry.section === "backup") {
                scrollToBackupRestore();
              }
            }}
          >
            <span className="entry-label">{entry.label}</span>
            <span className="entry-meta">فعال</span>
          </button>
        ))}
      </nav>

      <section id="home" className="home-panel" aria-labelledby="home-panel-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">صفحه اصلی</p>
            <h2 id="home-panel-title">کارهای فوری</h2>
          </div>
        </div>

        <div className="home-action-grid" aria-label="اقدام‌های فوری">
          {homeActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="home-action-card"
              onClick={() => {
                setCurrentSection(action.target);
                if (action.target === "invoices") {
                  scrollToInvoiceManagement();
                } else if (action.target === "payments") {
                  scrollToPaymentManagement();
                } else if (action.target === "parties") {
                  scrollToPartyManagement();
                } else if (action.target === "reconciliation") {
                  scrollToSettlementReview();
                } else if (action.target === "backup") {
                  scrollToBackupRestore();
                }
              }}
            >
              <span className="entry-label">{action.label}</span>
              <span className="entry-meta">باز کردن بخش</span>
            </button>
          ))}
        </div>

        <PilotReadinessPanel />
      </section>

      <section className="principles-card" aria-label="یادداشت مرحله">
        <h2>یادداشت پایلوت</h2>
        <ul>
          <li>داده‌ها محلی و آفلاین باقی می‌مانند.</li>
          <li>برای پایلوت، دفتر کاغذی و برنامه باید هم‌زمان بررسی شوند.</li>
          <li>اختلاف‌ها باید دیده شوند، نه پنهان.</li>
        </ul>
      </section>

      <SettlementReview />

      <BackupRestore />

      <InvoiceManagement onRequestPartyManagement={() => {
        setCurrentSection("parties");
        scrollToPartyManagement();
      }} />

      <PaymentManagement />

      <PartyManagement />
    </main>
  );
}
