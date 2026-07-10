const entryPoints = [
  "ثبت فاکتور",
  "ثبت پرداخت",
  "حساب اشخاص",
  "مغایرت‌ها"
] as const;

export function App() {
  return (
    <main className="app-shell" lang="fa" dir="rtl">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">پیش‌نمایش مرحله ۰</p>
        <h1 id="app-title">تسویه‌یار</h1>
        <p className="hero-copy">
          ابزار محلی و فارسی برای ثبت تسویه‌ها، پیگیری مغایرت‌ها و نگه‌داری تاریخچه مالی بدون وابستگی به سرویس بیرونی.
        </p>

        <div className="status-banner" role="note" aria-label="notice">
          این نسخه یک شِل توسعه است. فرم‌های اصلی، گزارش‌های کامل و جریان‌های عملیاتی هنوز در مراحل بعدی ساخته می‌شوند.
        </div>
      </section>

      <section className="entry-grid" aria-label="نقاط ورود">
        {entryPoints.map((label) => (
          <button key={label} type="button" className="entry-card" disabled>
            <span className="entry-label">{label}</span>
            <span className="entry-meta">فعلا آماده نیست</span>
          </button>
        ))}
      </section>

      <section className="principles-card" aria-label="یادداشت مرحله">
        <h2>یادداشت اجرا</h2>
        <ul>
          <li>همه داده‌های مالی در دستگاه و داخل IndexedDB نگه‌داری می‌شوند.</li>
          <li>مبالغ فقط به تومان صحیح و بدون ممیز ذخیره می‌شوند.</li>
          <li>تعارض‌ها و مغایرت‌ها باید دیده شوند، نه پنهان.</li>
        </ul>
      </section>
    </main>
  );
}
