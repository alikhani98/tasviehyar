import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceManagement } from "./InvoiceManagement";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createPartyRepository } from "../../services/party-repository";
import { createInvoiceRepository } from "../../services/invoice-repository";
import { createDestinationAccountRepository } from "../../services/destination-account-repository";
import { createPaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository } from "../../services/payment-repository";
import { buildDestinationAccountRecord } from "../../domain/destination-accounts";

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
  const destinationAccountRepository = createDestinationAccountRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const paymentInstructionRepository = createPaymentInstructionRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const paymentRepository = createPaymentRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  return { database, partyRepository, invoiceRepository, destinationAccountRepository, paymentInstructionRepository, paymentRepository };
}

describe("invoice management UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates and opens a Persian RTL invoice workflow", async () => {
    const user = userEvent.setup();
    const { database, partyRepository, invoiceRepository, paymentRepository } = createRepositories();

    try {
      const party = await partyRepository.createParty({
        displayName: "احمدی",
        aliases: [],
        searchableDescription: undefined,
        roles: ["customer"],
        phoneNumber: undefined,
        notes: undefined
      });

      render(<InvoiceManagement partyRepository={partyRepository} repository={invoiceRepository} paymentRepository={paymentRepository} />);

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

  it("creates, cancels, and restores payment instructions inside invoice details", async () => {
    const user = userEvent.setup();
    const { database, partyRepository, invoiceRepository, destinationAccountRepository, paymentInstructionRepository, paymentRepository } =
      createRepositories();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      const customer = await partyRepository.createParty({
        displayName: "زارع",
        aliases: [],
        searchableDescription: undefined,
        roles: ["customer"],
        phoneNumber: undefined,
        notes: undefined
      });
      const recipient = await partyRepository.createParty({
        displayName: "احمدی",
        aliases: [],
        searchableDescription: undefined,
        roles: ["farmer"],
        phoneNumber: undefined,
        notes: undefined
      });
      const account = buildDestinationAccountRecord(
        "acct_1",
        {
          ownerPartyId: recipient.id,
          accountLabel: "حساب اصلی",
          bankName: "بانک نمونه",
          cardNumber: "1234567890123456",
          iban: undefined,
          bankAccountNumber: undefined
        },
        { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
        true
      );
      await database.destinationAccounts.put(account);

      const invoice = await invoiceRepository.createInvoice({
        customerPartyId: customer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 300_000_000,
        referenceNumber: "ف-۱",
        note: "فاکتور نمونه"
      });

      await paymentRepository.createPayment(
        {
          payerPartyId: customer.id,
          recipientPartyId: recipient.id,
          destinationAccountId: account.id,
          amount: 100_000_000,
          paymentDate: "2026-07-10",
          paymentMethod: "bank_transfer",
          verificationStatus: "reported",
          trackingReference: "trk-1",
          note: "پرداخت نمونه"
        },
        {
          invoiceId: invoice.id,
          allocatedAmount: 100_000_000
        }
      );

      render(
        <InvoiceManagement
          partyRepository={partyRepository}
          repository={invoiceRepository}
          destinationAccountRepository={destinationAccountRepository}
          paymentInstructionRepository={paymentInstructionRepository}
          paymentRepository={paymentRepository}
        />
      );

      await screen.findByRole("button", { name: /زارع/ });
      await user.click(screen.getByRole("button", { name: /زارع/ }));

      expect(await screen.findByRole("heading", { name: "دستور پرداخت" })).toBeInTheDocument();

      const instructionForm = screen.getByRole("region", { name: "فرم دستور پرداخت" });
      await user.selectOptions(screen.getByLabelText("گیرنده"), recipient.id);
      await user.selectOptions(screen.getByLabelText("حساب مقصد"), account.id);
      await user.type(screen.getByLabelText("مبلغ دستور پرداخت"), "۱۰۰٬۰۰۰٬۰۰۰");
      await user.type(within(instructionForm).getByLabelText("توضیحات"), "دستور نمونه");
      await user.click(screen.getByRole("button", { name: "ثبت دستور پرداخت" }));

      expect(await screen.findByText("دستور پرداخت جدید با موفقیت ثبت شد.")).toBeInTheDocument();
      const instructionRow = await screen.findByRole("button", { name: /احمدی/ });
      await user.click(instructionRow);
      const instructionDetails = screen.getByRole("region", { name: "جزئیات دستور پرداخت" });
      expect(within(instructionDetails).getByRole("heading")).toBeInTheDocument();

      expect(await screen.findByText("تاریخچه پرداخت")).toBeInTheDocument();
      expect(screen.getByText(/تخصیص به این فاکتور/)).toBeInTheDocument();

      const instructionNoteField = within(instructionForm).getByLabelText("توضیحات");
      await user.click(screen.getByRole("button", { name: "لغو دستور" }));
      expect(await screen.findByText("دستور پرداخت لغو شد.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "بازیابی" }));
      expect(await screen.findByText("دستور پرداخت بازیابی شد.")).toBeInTheDocument();
      expect(instructionNoteField).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
      await database.delete();
    }
  });
});
