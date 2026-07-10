import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the Persian RTL landing shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "تسویه‌یار" })).toBeInTheDocument();
    expect(screen.getByText("این نسخه فقط «حساب اشخاص» را فعال کرده است. حساب‌های مقصد داخل جزئیات هر طرف مدیریت می‌شوند.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ثبت فاکتور/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /ثبت پرداخت/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "حساب اشخاص فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /مغایرت‌ها/ })).toBeDisabled();
  });
});
