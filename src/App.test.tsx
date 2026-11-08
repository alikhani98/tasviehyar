import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { db } from "./db/tasviehyar-db";
import { createInvoiceRepository } from "./services/invoice-repository";
import { createPartyRepository } from "./services/party-repository";

function navigation() {
  return within(screen.getByRole("navigation", { name: "پیمایش برنامه" }));
}

describe("App shell", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an RTL home and groups primary and secondary navigation", async () => {
    render(<App />);

    const main = screen.getByRole("main");
    expect(main.closest("[dir=rtl]")).toHaveAttribute("lang", "fa");
    expect(within(main).getByRole("heading", { name: "خانه", level: 1 })).toBeInTheDocument();
    expect(navigation().getByRole("link", { name: "خانه" })).toHaveAttribute("aria-current", "page");
    expect(navigation().getAllByRole("link").filter((link) => !link.classList.contains("nav-secondary")).map((link) => link.textContent))
      .toEqual(["خانه", "فاکتورها", "پرداخت‌ها", "بیشتر"]);
    expect(navigation().getByRole("link", { name: "تنظیمات" })).toHaveClass("nav-secondary");
    expect(screen.getByRole("link", { name: /^ثبت پرداخت/ })).toHaveAttribute("href", "#/payments");
    expect(await screen.findByText("آنلاین")).toBeVisible();
  });

  it("navigates through More and marks the destination and its mobile parent", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(navigation().getByRole("link", { name: "بیشتر" }));
    const menu = within(screen.getByRole("main"));

    expect(menu.getAllByRole("link")).toHaveLength(5);
    await user.click(menu.getByRole("link", { name: /^پشتیبان‌گیری/ }));

    expect(window.location.hash).toBe("#/backup");
    expect(menu.getByRole("heading", { name: "پشتیبان‌گیری", level: 1 })).toHaveFocus();
    expect(await menu.findByRole("heading", { name: "پشتیبان‌گیری و بازیابی" })).toBeVisible();
    expect(navigation().getByRole("link", { name: "پشتیبان‌گیری" })).toHaveAttribute("aria-current", "page");
    expect(navigation().getByRole("link", { name: "بیشتر" })).toHaveAttribute("aria-current", "location");
    expect(screen.queryByRole("heading", { name: "کارهای فوری" })).not.toBeInTheDocument();

    window.history.back();
    await waitFor(() => expect(navigation().getByRole("link", { name: "بیشتر" })).toHaveAttribute("aria-current", "page"));
  });

  it("keeps an invoice draft across section changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: /^ثبت فاکتور/ }));
    await screen.findByText("هنوز فاکتوری ثبت نشده است.");
    const reference = screen.getByRole("textbox", { name: "شماره یا عنوان فاکتور" });
    await user.type(reference, "پیش‌نویس");
    await user.click(navigation().getByRole("link", { name: "پرداخت‌ها" }));
    expect(screen.getByRole("heading", { name: "ثبت پرداخت" })).toBeVisible();
    expect(reference.closest(".shell-section")).not.toHaveClass("is-current");

    await user.click(navigation().getByRole("link", { name: "فاکتورها" }));
    expect(screen.getByRole("textbox", { name: "شماره یا عنوان فاکتور" })).toHaveValue("پیش‌نویس");
  });

  it("opens the requested invoice from an existing record event", async () => {
    const party = await createPartyRepository(db).createParty({
      displayName: "مشتری نمونه", aliases: [], roles: ["customer"]
    });
    const invoice = await createInvoiceRepository(db).createInvoice({
      customerPartyId: party.id, invoiceDate: "2026-07-10", totalAmount: 100_000, referenceNumber: "ف-۱۲۳"
    });

    try {
      window.history.replaceState(null, "", "#/reports");
      render(<App />);
      expect(screen.getByRole("heading", { name: "گزارش‌ها", level: 1 })).toBeVisible();

      act(() => {
        window.dispatchEvent(new CustomEvent("tasviehyar-open-record", { detail: { section: "invoices", recordId: invoice.id } }));
      });

      const details = await screen.findByRole("region", { name: "جزئیات فاکتور" });
      expect(within(details).getByText("ف-۱۲۳")).toBeVisible();
      expect(navigation().getByRole("link", { name: "فاکتورها" })).toHaveAttribute("aria-current", "page");
    } finally {
      cleanup();
      await db.delete();
      await db.open();
    }
  });

  it("persists appearance across mounts and responds to device changes in system mode", async () => {
    const user = userEvent.setup();
    const device = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal("matchMedia", vi.fn(() => device));
    window.history.replaceState(null, "", "#/settings");

    const { unmount } = render(<App />);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(screen.getByRole("radio", { name: "مطابق دستگاه" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("radio", { name: "روشن" }));
    expect(window.localStorage.getItem("tasviehyar-theme")).toBe("light");
    unmount();
    render(<App />);
    expect(screen.getByRole("radio", { name: "روشن" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    await user.click(screen.getByRole("radio", { name: "تیره" }));
    device.matches = false;
    device.dispatchEvent(new Event("change"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("radio", { name: "مطابق دستگاه" }));
    expect(window.localStorage.getItem("tasviehyar-theme")).toBe("system");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    device.matches = true;
    device.dispatchEvent(new Event("change"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("restores the section scroll position when returning with browser navigation", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240, writable: true });
    render(<App />);

    await user.click(navigation().getByRole("link", { name: "فاکتورها" }));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 680, writable: true });
    await user.click(navigation().getByRole("link", { name: "پرداخت‌ها" }));
    await user.click(navigation().getByRole("link", { name: "فاکتورها" }));

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 680, behavior: "auto" });
  });
});
