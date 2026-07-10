import { useEffect, useState } from "react";
import { InvoiceManagement } from "./features/invoice-management/InvoiceManagement";
import { PaymentManagement } from "./features/payment-management/PaymentManagement";
import { PartyManagement } from "./features/party-management/PartyManagement";

const entryPoints = [
  { label: "ثبت فاکتور", active: true },
  { label: "ثبت پرداخت", active: true },
  { label: "حساب اشخاص", active: true },
  { label: "مغایرت‌ها", active: false }
] as const;

export function App() {
  const [currentSection, setCurrentSection] = useState<"parties" | "invoices" | "payments">("payments");

  function scrollToPartyManagement() {
    document.getElementById("party-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToInvoiceManagement() {
    document.getElementById("invoice-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function scrollToPaymentManagement() {
    document.getElementById("payment-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      scrollToPaymentManagement();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="app-shell" lang="fa" dir="rtl">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">مرحله ۵</p>
        <h1 id="app-title">تسویه‌یار</h1>
        <p className="hero-copy">
          ابزار محلی و فارسی برای ثبت اشخاص، حساب‌های مقصد، فاکتورهای تک‌مبلغی، دستورهای پرداخت، و پرداخت‌های واقعیِ هر فاکتور، با ذخیره‌سازی آفلاین و تاریخچه قابل پیگیری.
        </p>

        <div className="status-banner" role="note" aria-label="notice">
          این نسخه «ثبت فاکتور»، «ثبت پرداخت»، و «حساب اشخاص» را فعال کرده است. دستورهای پرداخت داخل جزئیات هر فاکتور و پرداخت‌های واقعی در بخش جداگانه مدیریت می‌شوند.
        </div>
      </section>

      <section className="entry-grid" aria-label="نقاط ورود">
        {entryPoints.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className={entry.active ? "entry-card entry-card-active" : "entry-card"}
            disabled={!entry.active}
            aria-current={
              entry.active &&
              ((entry.label === "حساب اشخاص" && currentSection === "parties") ||
                (entry.label === "ثبت فاکتور" && currentSection === "invoices") ||
                (entry.label === "ثبت پرداخت" && currentSection === "payments"))
                ? "page"
                : undefined
            }
            onClick={() => {
              if (entry.active) {
                if (entry.label === "ثبت فاکتور") {
                  setCurrentSection("invoices");
                  scrollToInvoiceManagement();
                } else if (entry.label === "ثبت پرداخت") {
                  setCurrentSection("payments");
                  scrollToPaymentManagement();
                } else if (entry.label === "حساب اشخاص") {
                  setCurrentSection("parties");
                  scrollToPartyManagement();
                }
              }
            }}
          >
            <span className="entry-label">{entry.label}</span>
            <span className="entry-meta">{entry.active ? "فعال" : "فعلا آماده نیست"}</span>
          </button>
        ))}
      </section>

      <section className="principles-card" aria-label="یادداشت مرحله">
        <h2>یادداشت اجرا</h2>
        <ul>
          <li>داده‌های اشخاص در دستگاه و داخل IndexedDB نگه‌داری می‌شوند.</li>
          <li>اشخاص می‌توانند چند نقش هم‌زمان داشته باشند.</li>
          <li>مشابهت‌های احتمالی باید دیده شوند، نه پنهان.</li>
        </ul>
      </section>

      <InvoiceManagement onRequestPartyManagement={() => {
        setCurrentSection("parties");
        scrollToPartyManagement();
      }} />

      <PaymentManagement />

      <PartyManagement />
    </main>
  );
}
