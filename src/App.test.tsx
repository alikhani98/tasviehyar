import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Persian RTL landing shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "تسویه‌یار" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "این نسخه «صفحه اصلی»، «اشخاص»، «فاکتورها»، «ثبت پرداخت»، «مغایرت‌ها»، و «پشتیبان‌گیری و بازیابی» را فعال کرده است. دستورهای پرداخت داخل جزئیات هر فاکتور و پرداخت‌های واقعی در بخش جداگانه مدیریت می‌شوند."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "صفحه اصلی فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ثبت فاکتور باز کردن بخش" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ثبت پرداخت باز کردن بخش" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "جست‌وجوی شخص باز کردن بخش" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "مشاهده مغایرت‌ها باز کردن بخش" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "آخرین پشتیبان باز کردن بخش" })).toBeEnabled();
  });

  it("waits for the loaded stage sections to settle", async () => {
    render(<App />);

    expect(await screen.findByText("کارهای فوری")).toBeInTheDocument();
    expect(await screen.findByText("آنلاین")).toBeInTheDocument();
    expect(await screen.findByText("هنوز فاکتوری ثبت نشده است.")).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "مغایرت‌ها فعال" })).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: "پشتیبان‌گیری و بازیابی فعال" })).toBeEnabled();
  });
});
