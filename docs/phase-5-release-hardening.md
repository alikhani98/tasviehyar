# فاز ۵ — سخت‌سازی انتشار

## دارایی‌های PWA

- `public/icon.svg` به‌عنوان منبع برند حفظ شده است.
- `public/icon-192.png` با ابعاد ۱۹۲×۱۹۲ تولید شده است.
- `public/icon-512.png` با ابعاد ۵۱۲×۵۱۲ تولید شده است.
- هر دو PNG مربع، بدون حاشیهٔ شفاف ناخواسته و با پس‌زمینهٔ سبز برند هستند.

## ماتریس آفلاین

| سناریو | انتظار | وضعیت بررسی کدی |
| --- | --- | --- |
| اولین بازدید آنلاین | shell و service worker نصب شوند | تأیید source و build |
| بازدید بعدی آفلاین | `/index.html` از cache باز شود | تأیید source |
| Reports که قبلاً آنلاین باز شده | chunk در runtime cache موجود باشد | تأیید رفتار cache-first |
| Backup که قبلاً آنلاین باز شده | chunk در runtime cache موجود باشد | تأیید رفتار cache-first |
| SettlementReview که قبلاً آنلاین باز شده | chunk در runtime cache موجود باشد | تأیید رفتار cache-first |
| lazy route بازنشده در حالت آفلاین | خطای کنترل‌شده داخل برنامه دیده شود | `RouteLoadErrorBoundary` و تست PWA |
| بازگشت اتصال | refresh یا navigation دوباره chunk را دریافت کند | نیازمند آزمون host واقعی |
| update از v3 به v4 | cache قدیمی پس از activate حذف شود | تأیید source و تست cache version |

chunk گزارش عمداً precache نشده است تا نصب اولیه و storage بی‌دلیل بزرگ نشود.

## بررسی دادهٔ محلی

قبل از update، در DevTools مقدارهای زیر را ثبت کنید:

1. نام database و schema version
2. تعداد رکوردهای `parties`, `invoices`, `payments`, `paymentAllocations` و `auditEvents`
3. یک backup با `backupFormatVersion: 1`

پس از update، همان شمارش و همان backup را با origin، host و scheme یکسان مقایسه کنید. هر اختلاف باید قبل از ادامهٔ استفاده بررسی شود.

## نصب روی دستگاه

### Android Chrome

1. برنامه را با HTTPS و origin نهایی باز کنید.
2. یک بار shell و مسیرهای اصلی را باز کنید.
3. از منوی Chrome گزینهٔ Install app یا Add to Home screen را انتخاب کنید.
4. بازشدن standalone، آیکون، theme color و بارگذاری offline را بررسی کنید.

### iPad Safari

1. برنامه را با HTTPS در Safari باز کنید.
2. Share و سپس Add to Home Screen را انتخاب کنید.
3. بازشدن standalone و نمایش آیکون را بررسی کنید.
4. بعد از یک بازدید آنلاین، حالت offline و دسترسی به دادهٔ IndexedDB را بررسی کنید.

## DirectAdmin

1. از همان origin قبلی backup عملیاتی و snapshot فایل‌های فعلی تهیه کنید.
2. محتوای `dist` را روی document root همان دامنهٔ HTTPS قرار دهید.
3. fallback navigation به `index.html` را فعال کنید.
4. `sw.js` و `manifest.webmanifest` را با cache طولانی سرو نکنید.
5. assetهای hash‌شدهٔ `dist/assets` را با cache طولانی سرو کنید.
6. HTTP smoke test را برای `/`, `/#/reports`, `/#/backup` و فایل‌های icon انجام دهید.
7. نسخهٔ service worker را `tasviehyar-shell-v4` بررسی کنید.
8. offline fallback و حفظ IndexedDB را بررسی کنید.

## Rollback

نسخهٔ قبلی `dist` و checksumهای آن را نگه دارید. در rollback کل artifact قبلی را روی همان origin برگردانید و service worker قبلی را با cache version متناظر فعال کنید. قبل از rollback database را حذف نکنید.
