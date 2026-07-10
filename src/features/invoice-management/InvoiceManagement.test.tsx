import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceManagement } from "./InvoiceManagement";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createPartyRepository } from "../../services/party-repository";
import { createInvoiceRepository } from "../../services/invoice-repository";

function createRepositories() {
  const database = new TasviehYarDatabase(`invoice-ui-tests-${crypto.randomUUID()}`);
  const partyRepository = createPartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const invoiceRepository = createInvoiceRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  return { database, partyRepository, invoiceRepository };
}

describe("invoice management UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates and opens a Persian RTL invoice workflow", async () => {
    const user = userEvent.setup();
    const { database, partyRepository, invoiceRepository } = createRepositories();

    try {
      const party = await partyRepository.createParty({
        displayName: "احمدی",
        aliases: [],
        searchableDescription: undefined,
        roles: ["customer"],
        phoneNumber: undefined,
        notes: undefined
      });

      render(<InvoiceManagement partyRepository={partyRepository} repository={invoiceRepository} />);

      await screen.findByRole("option", { name: "احمدی" });
      await user.selectOptions(screen.getByLabelText("مشتری"), party.id);
      await user.type(screen.getByLabelText("تاریخ فاکتور"), "2026-07-10");
      await user.type(screen.getByLabelText("مبلغ کل فاکتور"), "۱۲۳٬۴۵۶");
      await user.type(screen.getByLabelText("شماره یا عنوان فاکتور"), "ف-۱");
      await user.type(screen.getByLabelText("توضیحات"), "فاکتور نمونه");
      await user.dblClick(screen.getByRole("button", { name: "ثبت فاکتور" }));

      expect(await screen.findByText("فاکتور جدید با موفقیت ثبت شد.")).toBeInTheDocument();
      const invoiceRow = await screen.findByRole("button", { name: /احمدی/ });
      await user.click(invoiceRow);
      expect(screen.getByRole("heading", { name: "احمدی" })).toBeInTheDocument();
      expect(await screen.findByText("فاکتور نمونه", { selector: "dd" })).toBeInTheDocument();
      expect(await database.invoices.count()).toBe(1);
    } finally {
      await database.delete();
    }
  });

  it("cancels invoices without hard deletion and prevents duplicate submission", async () => {
    const user = userEvent.setup();
    const { database, partyRepository, invoiceRepository } = createRepositories();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      const party = await partyRepository.createParty({
        displayName: "احمدی",
        aliases: [],
        searchableDescription: undefined,
        roles: ["customer"],
        phoneNumber: undefined,
        notes: undefined
      });

      render(<InvoiceManagement partyRepository={partyRepository} repository={invoiceRepository} />);

      await screen.findByRole("option", { name: "احمدی" });
      await user.selectOptions(screen.getByLabelText("مشتری"), party.id);
      await user.type(screen.getByLabelText("تاریخ فاکتور"), "2026-07-10");
      await user.type(screen.getByLabelText("مبلغ کل فاکتور"), "۱۲۳٬۴۵۶");
      await user.type(screen.getByLabelText("شماره یا عنوان فاکتور"), "ف-۱");
      await user.dblClick(screen.getByRole("button", { name: "ثبت فاکتور" }));

      const invoiceRow = await screen.findByRole("button", { name: /احمدی/ });
      await user.click(invoiceRow);
      await user.click(screen.getByRole("button", { name: "لغو فاکتور" }));

      expect(await screen.findByText("فاکتور لغو شد.")).toBeInTheDocument();
      expect(screen.getByText("این فاکتور لغوشده است و از مسیر معمول قابل ویرایش نیست.")).toBeInTheDocument();
      expect(await database.invoices.count()).toBe(1);
    } finally {
      confirmSpy.mockRestore();
      await database.delete();
    }
  });
});
