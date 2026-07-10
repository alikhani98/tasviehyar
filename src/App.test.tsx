import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("renders the Persian RTL landing shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "تسویه‌یار" })).toBeInTheDocument();
    expect(
      screen.getByText("این نسخه «ثبت فاکتور»، «ثبت پرداخت»، و «حساب اشخاص» را فعال کرده است. دستورهای پرداخت داخل جزئیات هر فاکتور و پرداخت‌های واقعی در بخش جداگانه مدیریت می‌شوند.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ثبت فاکتور فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ثبت پرداخت فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "حساب اشخاص فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /مغایرت‌ها/ })).toBeDisabled();
  });

  it("waits for the loaded stage sections to settle", async () => {
    render(<App />);

    expect(await screen.findByText("هنوز فاکتوری ثبت نشده است.")).toBeInTheDocument();
    expect(await screen.findAllByText("موردی پیدا نشد.")).toHaveLength(2);
  });
});
