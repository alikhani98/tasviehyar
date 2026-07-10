import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { PartyManagement } from "./PartyManagement";
import { PartyRepository } from "../../services/party-repository";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository } from "../../services/destination-account-repository";

function createRepository() {
  const database = new TasviehYarDatabase(`party-ui-tests-${crypto.randomUUID()}`);
  const repository = new PartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const destinationAccountRepository = createDestinationAccountRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  return { database, repository, destinationAccountRepository };
}

describe("party management UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps only the party entry point enabled in the shell", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "حساب اشخاص فعال" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ثبت فاکتور فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ثبت پرداخت فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "مغایرت‌ها فعلا آماده نیست" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "حساب اشخاص" })).toBeInTheDocument();
  });

  it("creates and archives a party from the accessible RTL form", async () => {
    const user = userEvent.setup();
    const { database, repository, destinationAccountRepository } = createRepository();

    try {
      render(<PartyManagement repository={repository} destinationAccountRepository={destinationAccountRepository} />);

      await user.type(screen.getByLabelText("نام نمایشی"), "احمدی");
      await user.type(screen.getByLabelText("شماره تماس"), "09120000000");
      await user.type(screen.getByLabelText("نام‌های دیگر"), "آقای احمدی");
      await user.type(screen.getByLabelText("توضیح جست‌وجو"), "کشاورز");
      await user.type(screen.getByLabelText("یادداشت"), "طرف نمونه");
      await user.click(screen.getByRole("button", { name: "ثبت طرف" }));

      const createdCard = await screen.findByRole("button", { name: /احمدی/ });
      expect(createdCard).toBeInTheDocument();
      expect(within(createdCard).getByText("فعال")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /احمدی/ }));
      expect(screen.getByRole("heading", { name: "احمدی" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "بایگانی" }));
      expect(await screen.findByText("طرف بایگانی شد.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "بازیابی" })).toBeInTheDocument();
    } finally {
      await database.delete();
    }
  });

  it("manages destination accounts inside the selected party details view", async () => {
    const user = userEvent.setup();
    const { database, repository, destinationAccountRepository } = createRepository();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText }
    });

    try {
      render(<PartyManagement repository={repository} destinationAccountRepository={destinationAccountRepository} />);

      await user.type(screen.getByLabelText("نام نمایشی"), "احمدی");
      await user.click(screen.getByRole("button", { name: "ثبت طرف" }));

      const partyButton = await screen.findByRole("button", { name: /احمدی/ });
      await user.click(partyButton);
      expect(screen.getByRole("heading", { name: "حساب‌های مقصد" })).toBeInTheDocument();

      await user.type(screen.getByLabelText("عنوان حساب"), "حساب اصلی");
      await user.type(screen.getByLabelText("نام بانک"), "بانک نمونه");
      await user.type(screen.getByLabelText("شماره کارت"), "۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶");
      await user.click(screen.getByRole("button", { name: "ثبت حساب مقصد" }));

      const accountButton = await screen.findByRole("button", { name: /حساب اصلی/ });
      await user.click(accountButton);

      expect(screen.getByRole("heading", { name: "حساب اصلی" })).toBeInTheDocument();
      const revealButtons = screen.getAllByRole("button", { name: "نمایش" });
      expect(revealButtons[0]).toBeDefined();
      await user.click(revealButtons[0]!);
      expect(screen.getByText("1234567890123456")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "کپی" }));
      expect(await screen.findByText("شماره کارت کپی شد.")).toBeInTheDocument();
      expect(clipboardWriteText).toHaveBeenCalledWith("1234567890123456");

      const archiveButtons = screen.getAllByRole("button", { name: "بایگانی" });
      expect(archiveButtons[1]).toBeDefined();
      await user.click(archiveButtons[1]!);
      expect(await screen.findByText("حساب مقصد بایگانی شد.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "بازیابی" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "بازیابی" }));
      expect(await screen.findByText("حساب مقصد بازیابی شد.")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard?.value
      });
      await database.delete();
    }
  });
});
