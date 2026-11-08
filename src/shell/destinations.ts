export const destinations = {
  home: { label: "خانه", description: "دسترسی سریع به کارهای روزانه", primary: true },
  invoices: { label: "فاکتورها", description: "ثبت فاکتور و پیگیری مانده", primary: true },
  payments: { label: "پرداخت‌ها", description: "ثبت و تأیید پرداخت", primary: true },
  parties: { label: "اشخاص", description: "اشخاص و حساب‌های مقصد", primary: false },
  reconciliation: { label: "مغایرت‌ها", description: "بررسی موارد نیازمند پیگیری", primary: false },
  reports: { label: "گزارش‌ها", description: "مشاهده گزارش‌های تسویه", primary: false },
  backup: { label: "پشتیبان‌گیری", description: "دریافت نسخه پشتیبان و بازیابی", primary: false },
  settings: { label: "تنظیمات", description: "انتخاب ظاهر برنامه", primary: false },
  more: { label: "بیشتر", description: "دسترسی به دیگر بخش‌های برنامه", primary: true }
} as const;

export type Section = keyof typeof destinations;

export const sections = Object.keys(destinations) as Section[];

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && Object.hasOwn(destinations, value);
}
