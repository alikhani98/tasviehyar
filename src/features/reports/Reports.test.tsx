import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reports } from "./Reports";
import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "../../domain";
import type { PartyRepository } from "../../services/party-repository";
import type { InvoiceRepository } from "../../services/invoice-repository";
import type { PaymentRepository } from "../../services/payment-repository";
import type { PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import type { DestinationAccountRepository } from "../../services/destination-account-repository";

function createRepositories() {
  const party: Party = {
    id: "party-1",
    displayName: "احمدی",
    aliases: ["آقای احمدی"],
    searchableDescription: "کشاورز",
    roles: ["customer", "destination_account_owner"],
    phoneNumber: "09120000000",
    notes: "نمونه",
    active: true,
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z"
  };
  const invoice: Invoice = {
    id: "invoice-1",
    customerPartyId: party.id,
    invoiceDate: "2026-07-01",
    referenceNumber: "F-1001",
    totalAmount: 125000,
    lifecycleStatus: "active",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z"
  };
  const payment: Payment = {
    id: "payment-1",
    payerPartyId: party.id,
    recipientPartyId: party.id,
    amount: 75000,
    paymentDate: "2026-07-03",
    paymentMethod: "bank_transfer",
    lifecycleStatus: "active",
    verificationStatus: "reported",
    trackingReference: "TR-1",
    createdAt: "2026-07-03T08:00:00.000Z",
    updatedAt: "2026-07-03T08:00:00.000Z"
  };
  const allocation: PaymentAllocation = {
    id: "allocation-1",
    paymentId: payment.id,
    invoiceId: invoice.id,
    allocatedAmount: 75000,
    createdAt: "2026-07-03T08:00:00.000Z"
  };
  const instruction: PaymentInstruction = {
    id: "instruction-1",
    invoiceId: invoice.id,
    recipientPartyId: party.id,
    destinationAccountId: "account-1",
    instructedAmount: 50000,
    lifecycleStatus: "active",
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z"
  };
  const account: DestinationAccount = {
    id: "account-1",
    ownerPartyId: party.id,
    accountLabel: "حساب اصلی",
    bankName: "بانک نمونه",
    cardNumber: "1234567812345678",
    active: true,
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-02T08:00:00.000Z"
  };

  return {
    party,
    repositories: {
      partyRepository: {
        listParties: async () => [party]
      } as unknown as PartyRepository,
      invoiceRepository: {
        listInvoices: async () => [invoice]
      } as unknown as InvoiceRepository,
      paymentRepository: {
        listPayments: async () => [payment],
        listAllocations: async () => [allocation]
      } as unknown as PaymentRepository,
      paymentInstructionRepository: {
        listInstructions: async () => [instruction]
      } as unknown as PaymentInstructionRepository,
      destinationAccountRepository: {
        listAccounts: async () => [account]
      } as unknown as DestinationAccountRepository
    }
  };
}

describe("reports", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the report shell and responds to party-statement navigation", async () => {
    const { party, repositories } = createRepositories();
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const user = userEvent.setup();

    render(<Reports {...repositories} />);

    expect(await screen.findByRole("heading", { name: "گزارش‌ها" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "CSV" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "گردش یک شخص خلاصه حساب" })).toBeInTheDocument();
    const previewStrip = screen.getByLabelText("پیش‌نمایش گزارش");
    expect(within(previewStrip).getByText(/ردیف‌ها:/)).toHaveTextContent("۱");
    expect(screen.getAllByText("۱۲۵٬۰۰۰ تومان").length).toBeGreaterThan(0);

    window.dispatchEvent(new CustomEvent("tasviehyar-open-record", { detail: { section: "reports", recordId: party.id } }));

    expect(await screen.findByText("گردش حساب: احمدی")).toBeInTheDocument();
    expect(screen.getByLabelText("شخص")).toHaveValue(party.id);

    await user.click(screen.getByRole("tab", { name: "دستورهای پرداخت دستور و مانده" }));
    const invoiceButton = screen.getByRole("button", { name: "F-1001" });
    await user.click(invoiceButton);
    expect(dispatchSpy).toHaveBeenCalled();
    expect((dispatchSpy.mock.calls.at(-1)?.[0] as CustomEvent<{ section?: string; recordId?: string }>).detail).toEqual({
      section: "invoices",
      recordId: "invoice-1"
    });
  });
});
