import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { InvoiceManagement } from "./features/invoice-management/InvoiceManagement";
import { PilotReadinessPanel } from "./features/pilot-readiness/PilotReadinessPanel";
import { PaymentManagement } from "./features/payment-management/PaymentManagement";
import { PartyManagement } from "./features/party-management/PartyManagement";
import { destinations, isSection, type Section, sections } from "./shell/destinations";
import { Icon, SectionLink } from "./shell/navigation";
import { type Theme, themes, useTheme } from "./shell/theme";

const BackupRestore = lazy(() => import("./features/backup-restore/BackupRestore").then(({ BackupRestore: component }) => ({ default: component })));
const Reports = lazy(() => import("./features/reports/Reports").then(({ Reports: component }) => ({ default: component })));
const SettlementReview = lazy(() => import("./features/settlement-review/SettlementReview").then(({ SettlementReview: component }) => ({ default: component })));

const quickActions = [
  { section: "invoices", label: "ثبت فاکتور", description: "فاکتور جدید و مانده مشتری" },
  { section: "payments", label: "ثبت پرداخت", description: "پرداخت جدید و وضعیت تأیید" },
  { section: "parties", label: "جست‌وجوی شخص", description: "اشخاص و حساب‌های مقصد" },
  { section: "reconciliation", label: "مشاهده مغایرت‌ها", description: "پرداخت‌ها و مانده‌های نیازمند بررسی" }
] as const;

const themeLabels: Record<Theme, string> = { light: "روشن", dark: "تیره", system: "مطابق دستگاه" };

function readSection(): Section {
  const section = window.location.hash.slice(2);
  return window.location.hash.startsWith("#/") && isSection(section) ? section : "home";
}

export function App() {
  const [currentSection, setCurrentSection] = useState(readSection);
  const [visitedSections, setVisitedSections] = useState<Set<Section>>(() => new Set([readSection()]));
  const { theme, selectTheme } = useTheme();
  const pageTitle = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(currentSection);
  const scrollPositions = useRef<Partial<Record<Section, number>>>({});

  const navigate = useCallback((section: Section) => {
    if (readSection() !== section) {
      scrollPositions.current[currentSection] = window.scrollY;
      window.history.pushState(null, "", `#/${section}`);
    }
    setVisitedSections((visited) => visited.has(section) ? visited : new Set(visited).add(section));
    setCurrentSection(section);
  }, [currentSection]);

  useEffect(() => {
    function syncSection() {
      setCurrentSection(readSection());
    }

    function openRecord(event: Event) {
      const section: unknown = (event as CustomEvent<{ section?: unknown }>).detail?.section;
      if (isSection(section)) navigate(section);
    }

    window.addEventListener("hashchange", syncSection);
    window.addEventListener("popstate", syncSection);
    window.addEventListener("tasviehyar-open-record", openRecord);
    return () => {
      window.removeEventListener("hashchange", syncSection);
      window.removeEventListener("popstate", syncSection);
      window.removeEventListener("tasviehyar-open-record", openRecord);
    };
  }, [navigate]);

  useLayoutEffect(() => {
    if (previousSection.current !== currentSection) {
      pageTitle.current?.focus({ preventScroll: true });
      window.scrollTo({ top: scrollPositions.current[currentSection] ?? 0, behavior: "auto" });
      previousSection.current = currentSection;
    }
  }, [currentSection]);

  useEffect(() => {
    setVisitedSections((visited) => visited.has(currentSection) ? visited : new Set(visited).add(currentSection));
  }, [currentSection]);

  const current = destinations[currentSection];

  return (
    <div className="app-shell" lang="fa" dir="rtl">
      <a className="skip-link" href="#app-main" onClick={(event) => {
        event.preventDefault();
        pageTitle.current?.focus();
      }}>رفتن به محتوای صفحه</a>

      <header className="shell-topbar">
        <SectionLink section="home" className="brand-lockup" navigate={navigate}>
          <span className="brand-mark"><Icon name="mark" /></span>
          <span>تسویه‌یار</span>
        </SectionLink>
        <span className="local-label"><span /> ذخیره روی دستگاه</span>
      </header>

      <aside className="shell-sidebar">
        <nav className="shell-navigation" aria-label="پیمایش برنامه">
          {sections.map((section) => {
            const destination = destinations[section];
            const active = currentSection === section ? "page" : undefined;
            const moreActive = section === "more" && !current.primary ? "location" : undefined;
            const visibility = section === "more" ? "nav-more" : destination.primary ? "" : "nav-secondary";
            return (
              <SectionLink key={section} section={section} navigate={navigate} current={active ?? moreActive} className={`nav-link ${visibility}`}>
                <Icon name={section} />
                <span>{destination.label}</span>
              </SectionLink>
            );
          })}
        </nav>
      </aside>

      <main id="app-main" className="shell-main">
        <header className="page-header">
          <h1 ref={pageTitle} tabIndex={-1}>{current.label}</h1>
          <p>{current.description}</p>
        </header>

        <div hidden={currentSection !== "home"} className="home-panel">
          <section className="quick-actions" aria-labelledby="quick-actions-title">
            <h2 id="quick-actions-title">کارهای فوری</h2>
            <div className="action-grid">
              {quickActions.map((action) => (
                <SectionLink key={action.section} section={action.section} navigate={navigate} className="action-card">
                  <span className="action-icon"><Icon name={action.section} /></span>
                  <span className="action-copy"><strong>{action.label}</strong><span>{action.description}</span></span>
                  <span className="action-arrow"><Icon name="arrow" /></span>
                </SectionLink>
              ))}
            </div>
          </section>
          <PilotReadinessPanel />
          <section className="principles-card">
            <h2>یادداشت پایلوت</h2>
            <p>دفتر کاغذی را در کنار برنامه بررسی کنید و اختلاف‌ها را پیگیری کنید.</p>
            <SectionLink section="backup" navigate={navigate} className="text-link">دریافت پشتیبان نمایشی</SectionLink>
          </section>
        </div>

        <div hidden={currentSection !== "more"} className="action-grid">
          {sections.filter((section) => !destinations[section].primary).map((section) => (
            <SectionLink key={section} section={section} navigate={navigate} className="action-card">
              <span className="action-icon"><Icon name={section} /></span>
              <span className="action-copy"><strong>{destinations[section].label}</strong><span>{destinations[section].description}</span></span>
              <span className="action-arrow"><Icon name="arrow" /></span>
            </SectionLink>
          ))}
        </div>

        <div hidden={currentSection !== "settings"}>
          <fieldset className="theme-settings summary-card">
            <legend>ظاهر برنامه</legend>
            {themes.map((option) => (
              <label className="role-option" key={option}>
                <input type="radio" name="theme" checked={theme === option} onChange={() => selectTheme(option)} />
                {themeLabels[option]}
              </label>
            ))}
          </fieldset>
        </div>

        {/* Keep feature state and existing record event listeners available across sections. */}
        <div className={`shell-section ${currentSection === "invoices" ? "is-current" : ""}`}><InvoiceManagement onRequestPartyManagement={() => navigate("parties")} /></div>
        <div className={`shell-section ${currentSection === "payments" ? "is-current" : ""}`}><PaymentManagement /></div>
        <div className={`shell-section ${currentSection === "parties" ? "is-current" : ""}`}><PartyManagement /></div>
        <Suspense fallback={<div className="loading-state" role="status">در حال آماده‌سازی بخش…</div>}>
          {visitedSections.has("reconciliation") ? <div className={`shell-section ${currentSection === "reconciliation" ? "is-current" : ""}`}><SettlementReview /></div> : null}
          {visitedSections.has("reports") ? <div className={`shell-section ${currentSection === "reports" ? "is-current" : ""}`}><Reports /></div> : null}
          {visitedSections.has("backup") ? <div className={`shell-section ${currentSection === "backup" ? "is-current" : ""}`}><BackupRestore /></div> : null}
        </Suspense>

        <div className="legacy-entry-compat" aria-label="دسترسی‌های سازگار">
          {[
            ["صفحه اصلی", "home"], ["اشخاص", "parties"], ["فاکتورها", "invoices"], ["ثبت پرداخت", "payments"],
            ["گزارش‌ها", "reports"], ["مغایرت‌ها", "reconciliation"], ["پشتیبان‌گیری و بازیابی", "backup"]
          ].map(([label, section]) => <button key={section} type="button" onClick={() => navigate(section as Section)}>{label} فعال</button>)}
        </div>
      </main>
    </div>
  );
}
