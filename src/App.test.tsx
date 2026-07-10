import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the Persian RTL landing shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "تسویه‌یار" })).toBeInTheDocument();
    expect(screen.getByText("این نسخه یک شِل توسعه است. فرم‌های اصلی، گزارش‌های کامل و جریان‌های عملیاتی هنوز در مراحل بعدی ساخته می‌شوند.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ثبت فاکتور/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /ثبت پرداخت/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /حساب اشخاص/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /مغایرت‌ها/ })).toBeDisabled();
  });
});
