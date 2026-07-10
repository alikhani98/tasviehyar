import { useEffect, useState } from "react";
import { PartyManagement } from "./features/party-management/PartyManagement";

const entryPoints = [
  { label: "ثبت فاکتور", active: false },
  { label: "ثبت پرداخت", active: false },
  { label: "حساب اشخاص", active: true },
  { label: "مغایرت‌ها", active: false }
] as const;

export function App() {
  const [showPartyManagement, setShowPartyManagement] = useState(true);

  function scrollToPartyManagement() {
    document.getElementById("party-management")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      scrollToPartyManagement();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="app-shell" lang="fa" dir="rtl">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">مرحله ۱</p>
        <h1 id="app-title">تسویه‌یار</h1>
        <p className="hero-copy">
          ابزار محلی و فارسی برای ثبت و مدیریت اشخاص، با ذخیره‌سازی آفلاین و تاریخچه قابل پیگیری.
        </p>

        <div className="status-banner" role="note" aria-label="notice">
          این نسخه فقط «حساب اشخاص» را فعال کرده است. سایر بخش‌ها هنوز در مراحل بعدی باقی مانده‌اند.
        </div>
      </section>

      <section className="entry-grid" aria-label="نقاط ورود">
        {entryPoints.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className={entry.active ? "entry-card entry-card-active" : "entry-card"}
            disabled={!entry.active}
            aria-current={entry.active && showPartyManagement ? "page" : undefined}
            onClick={() => {
              if (entry.active) {
                setShowPartyManagement(true);
                scrollToPartyManagement();
              }
            }}
          >
            <span className="entry-label">{entry.label}</span>
            <span className="entry-meta">{entry.active ? "فعال" : "فعلا آماده نیست"}</span>
          </button>
        ))}
      </section>

      {showPartyManagement ? <PartyManagement /> : null}

      <section className="principles-card" aria-label="یادداشت مرحله">
        <h2>یادداشت اجرا</h2>
        <ul>
          <li>داده‌های اشخاص در دستگاه و داخل IndexedDB نگه‌داری می‌شوند.</li>
          <li>اشخاص می‌توانند چند نقش هم‌زمان داشته باشند.</li>
          <li>مشابهت‌های احتمالی باید دیده شوند، نه پنهان.</li>
        </ul>
      </section>
    </main>
  );
}
