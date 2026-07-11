import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentManagement } from "./PaymentManagement";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createPartyRepository } from "../../services/party-repository";
import { createInvoiceRepository } from "../../services/invoice-repository";
import { createDestinationAccountRepository } from "../../services/destination-account-repository";
import { createPaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository } from "../../services/payment-repository";
import { buildDestinationAccountRecord } from "../../domain/destination-accounts";

function createRepositories() {
  const database = new TasviehYarDatabase(`payment-ui-tests-${crypto.randomUUID()}`);
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

describe("payment management UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates a reported payment and prevents duplicate submission", async () => {
    const user = userEvent.setup();
    const { database, partyRepository, invoiceRepository, destinationAccountRepository, paymentInstructionRepository, paymentRepository } =
      createRepositories();

    try {
      const payer = await partyRepository.createParty({
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
        customerPartyId: payer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 100_000_000,
        referenceNumber: "ف-۱",
        note: "فاکتور نمونه"
      });
      const instruction = await paymentInstructionRepository.createInstruction({
        invoiceId: invoice.id,
        recipientPartyId: recipient.id,
        destinationAccountId: account.id,
        instructedAmount: 50_000_000,
        note: "دستور نمونه"
      });

      render(
        <PaymentManagement
          repository={paymentRepository}
          partyRepository={partyRepository}
          invoiceRepository={invoiceRepository}
          destinationAccountRepository={destinationAccountRepository}
          paymentInstructionRepository={paymentInstructionRepository}
        />
      );

      await screen.findAllByRole("option", { name: "زارع" });
      await user.selectOptions(screen.getByLabelText("پرداخت‌کننده"), payer.id);
      await user.selectOptions(screen.getByLabelText("گیرنده"), recipient.id);
      await user.selectOptions(screen.getByLabelText("حساب مقصد"), account.id);
      await user.type(screen.getByLabelText("مبلغ پرداخت"), "۵۰٬۰۰۰٬۰۰۰");
      await user.clear(screen.getByLabelText("تاریخ پرداخت"));
      await user.type(screen.getByLabelText("تاریخ پرداخت"), "2026-07-10");
      await user.selectOptions(screen.getByLabelText("روش پرداخت"), "bank_transfer");
      await user.selectOptions(screen.getByLabelText("وضعیت اولیه"), "reported");
      await user.type(screen.getByLabelText("شماره پیگیری"), "trk-1");
      await user.selectOptions(screen.getByLabelText("فاکتور مرتبط"), invoice.id);
      await user.selectOptions(screen.getByLabelText("دستور پرداخت مرتبط"), instruction.id);
      await user.type(screen.getByLabelText("مبلغ تخصیص اولیه"), "۲۵٬۰۰۰٬۰۰۰");
      await user.dblClick(screen.getByRole("button", { name: "ثبت پرداخت" }));

      expect(await screen.findByText("پرداخت جدید با موفقیت ثبت شد.")).toBeInTheDocument();
      expect(await database.payments.count()).toBe(1);
      expect(await database.paymentAllocations.count()).toBe(1);

      const paymentRow = await screen.findByRole("button", { name: /زارع/ });
      await user.click(paymentRow);
      expect(await screen.findByRole("heading", { name: /۵۰٬۰۰۰٬۰۰۰ تومان/ })).toBeInTheDocument();

      const allocationForm = screen.getByRole("form", { name: /فرم تخصیص پرداخت/ });
      await user.selectOptions(within(allocationForm).getByLabelText("فاکتور"), invoice.id);
      await user.type(within(allocationForm).getByLabelText("مبلغ تخصیص"), "۲۵٬۰۰۰٬۰۰۰");
      await user.click(within(allocationForm).getByRole("button", { name: "ثبت تخصیص" }));
      expect(await screen.findByText("تخصیص جدید پرداخت ثبت شد.")).toBeInTheDocument();
      expect(await database.paymentAllocations.count()).toBe(2);

      const verificationForm = screen.getByRole("form", { name: /فرم تأیید پرداخت/ });
      await user.selectOptions(within(verificationForm).getByLabelText("وضعیت"), "confirmed");
      await user.type(within(verificationForm).getByLabelText("توضیح تأییدکننده"), "Ahmadi");
      await user.click(within(verificationForm).getByRole("button", { name: "ثبت تأیید" }));
      expect(await screen.findByText("وضعیت تأیید پرداخت ثبت شد.")).toBeInTheDocument();
      expect(await database.paymentVerifications.count()).toBe(1);
    } finally {
      await database.delete();
    }
  }, 10000);
});
