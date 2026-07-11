import { describe, expect, it } from "vitest";
import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "../schemas";
import {
  buildSettlementHomeCards,
  deriveSettlementReviewItems,
  summarizeCustomerSettlement,
  summarizeInvoiceBalance,
  summarizeInstructionBalance,
  summarizeRecipientSettlement
} from "../settlement";
import { day, iso } from "../../test/helpers";

function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: "party_zare",
    displayName: "زارع",
    aliases: [],
    searchableDescription: undefined,
    roles: ["customer"],
    phoneNumber: undefined,
    notes: undefined,
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    customerPartyId: "party_zare",
    invoiceDate: day("2026-07-10"),
    totalAmount: 1_500_000_000,
    lifecycleStatus: "active",
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeInstruction(overrides: Partial<PaymentInstruction> = {}): PaymentInstruction {
  return {
    id: "inst_1",
    invoiceId: "inv_1",
    recipientPartyId: "party_ahmadi",
    instructedAmount: 200_000_000,
    lifecycleStatus: "active",
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay_1",
    payerPartyId: "party_zare",
    recipientPartyId: "party_ahmadi",
    amount: 50_000_000,
    paymentDate: day("2026-07-10"),
    paymentMethod: "bank_transfer",
    lifecycleStatus: "active",
    verificationStatus: "confirmed",
    trackingReference: "trk-1",
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: "alloc_1",
    paymentId: "pay_1",
    invoiceId: "inv_1",
    paymentInstructionId: "inst_1",
    allocatedAmount: 50_000_000,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeAccount(overrides: Partial<DestinationAccount> = {}): DestinationAccount {
  return {
    id: "acct_1",
    ownerPartyId: "party_ahmadi",
    accountLabel: "حساب اصلی",
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

describe("settlement summaries", () => {
  it("covers the 1,500,000,000 تومان reference scenario and derived aggregates", () => {
    const invoice = makeInvoice();
    const instructions = [
      makeInstruction({ id: "inst_confirmed", instructedAmount: 200_000_000, recipientPartyId: "party_ahmadi", destinationAccountId: "acct_1" }),
      makeInstruction({ id: "inst_reported", instructedAmount: 300_000_000, recipientPartyId: "party_ahmadi", destinationAccountId: "acct_1" }),
      makeInstruction({ id: "inst_business", instructedAmount: 500_000_000, recipientPartyId: "party_business", destinationAccountId: "acct_2" })
    ];
    const payments = [
      makePayment({ id: "pay_confirmed", amount: 50_000_000, verificationStatus: "confirmed", trackingReference: "trk-1" }),
      makePayment({ id: "pay_reported", amount: 30_000_000, verificationStatus: "reported", trackingReference: "trk-2" }),
      makePayment({ id: "pay_extra", amount: 100_000_000, verificationStatus: "confirmed", trackingReference: "trk-3" }),
      makePayment({ id: "pay_over", amount: 20_000_000, verificationStatus: "confirmed", trackingReference: "trk-4" })
    ];
    const allocations = [
      makeAllocation({ id: "alloc_confirmed", paymentId: "pay_confirmed", paymentInstructionId: "inst_confirmed", allocatedAmount: 50_000_000 }),
      makeAllocation({ id: "alloc_reported", paymentId: "pay_reported", paymentInstructionId: "inst_confirmed", allocatedAmount: 30_000_000 }),
      makeAllocation({ id: "alloc_extra", paymentId: "pay_extra", paymentInstructionId: "inst_confirmed", allocatedAmount: 100_000_000 }),
      makeAllocation({ id: "alloc_over", paymentId: "pay_over", paymentInstructionId: "inst_confirmed", allocatedAmount: 20_000_000 })
    ];

    const invoiceSummary = summarizeInvoiceBalance(invoice, instructions, payments, allocations);
    expect(invoiceSummary.invoiceTotal).toBe(1_500_000_000);
    expect(invoiceSummary.confirmedAllocatedAmount).toBe(170_000_000);
    expect(invoiceSummary.reportedAllocatedAmount).toBe(30_000_000);
    expect(invoiceSummary.confirmedOutstandingAmount).toBe(1_330_000_000);
    expect(invoiceSummary.provisionalOutstandingAmount).toBe(1_300_000_000);
    expect(invoiceSummary.activeInstructedTotal).toBe(1_000_000_000);
    expect(invoiceSummary.unassignedInvoiceAmount).toBe(500_000_000);
    expect(invoiceSummary.overpaymentAmount).toBe(0);
    expect(invoiceSummary.derivedSettlementLabel).toBe("provisionally_paid");

    const customerSummary = summarizeCustomerSettlement("party_zare", [invoice], instructions, payments, allocations, [makeParty()]);
    expect(customerSummary.totalInvoiced).toBe(1_500_000_000);
    expect(customerSummary.confirmedAllocated).toBe(170_000_000);
    expect(customerSummary.reportedUnconfirmed).toBe(30_000_000);
    expect(customerSummary.confirmedOutstanding).toBe(1_330_000_000);
    expect(customerSummary.provisionalOutstanding).toBe(1_300_000_000);
    expect(customerSummary.openInvoiceCount).toBe(1);

    const recipientSummary = summarizeRecipientSettlement("party_ahmadi", instructions, payments, allocations, [makeParty({ id: "party_ahmadi", displayName: "احمدی", roles: ["farmer"] })]);
    expect(recipientSummary.totalInstructed).toBe(500_000_000);
    expect(recipientSummary.confirmedReceived).toBe(170_000_000);
    expect(recipientSummary.reportedUnconfirmed).toBe(30_000_000);
    expect(recipientSummary.confirmedRemaining).toBe(330_000_000);
    expect(recipientSummary.provisionalRemaining).toBe(300_000_000);

    const instructionSummary = summarizeInstructionBalance(instructions[0]!, payments, allocations);
    expect(instructionSummary.confirmedReceived).toBe(170_000_000);
    expect(instructionSummary.reportedButUnconfirmedAmount).toBe(30_000_000);
    expect(instructionSummary.confirmedRemainingAmount).toBe(30_000_000);
    expect(instructionSummary.provisionalRemainingAmount).toBe(0);
  });

  it("derives review items for overpayments, mismatches, and unresolved payments", () => {
    const parties = [
      makeParty(),
      makeParty({ id: "party_ahmadi", displayName: "احمدی", roles: ["farmer"] }),
      makeParty({ id: "party_dual", displayName: "کرباسیان", roles: ["customer", "farmer"] })
    ];
    const invoices = [makeInvoice({ customerPartyId: "party_dual", id: "inv_2", totalAmount: 50_000_000 })];
    const instructions = [
      makeInstruction({ id: "inst_2", invoiceId: "inv_2", recipientPartyId: "party_ahmadi", instructedAmount: 40_000_000 }),
      makeInstruction({ id: "inst_3", invoiceId: "inv_2", recipientPartyId: "party_ahmadi", instructedAmount: 20_000_000, destinationAccountId: undefined })
    ];
    const payments = [
      makePayment({ id: "pay_unallocated", recipientPartyId: "party_ahmadi", verificationStatus: "reported", amount: 10_000_000, trackingReference: "dup" }),
      makePayment({ id: "pay_dup", recipientPartyId: "party_ahmadi", verificationStatus: "reported", amount: 10_000_000, trackingReference: "dup" }),
      makePayment({ id: "pay_disputed", recipientPartyId: "party_ahmadi", verificationStatus: "disputed", amount: 10_000_000, trackingReference: "trk-9" }),
      makePayment({ id: "pay_over", recipientPartyId: "party_ahmadi", verificationStatus: "confirmed", amount: 100_000_000, trackingReference: "trk-10" })
    ];
    const allocations = [
      makeAllocation({ id: "alloc_over", paymentId: "pay_over", invoiceId: "inv_2", paymentInstructionId: "inst_2", allocatedAmount: 100_000_000 }),
      makeAllocation({ id: "alloc_wrong", paymentId: "pay_over", invoiceId: "inv_2", paymentInstructionId: "inst_2", allocatedAmount: 0 })
    ];
    const destinationAccounts = [makeAccount({ id: "acct_2", ownerPartyId: "party_dual" })];

    const items = deriveSettlementReviewItems({
      parties,
      invoices,
      instructions,
      payments,
      allocations,
      destinationAccounts
    });

    expect(items.map((item) => item.mismatchType)).toEqual(
      expect.arrayContaining([
        "unallocated_payment",
        "disputed_payment",
        "duplicate_tracking_reference",
        "probable_duplicate_payment",
        "instruction_overpayment",
        "invoice_overpayment",
        "active_instruction_without_destination_account"
      ])
    );
    expect(buildSettlementHomeCards({ parties, invoices, instructions, payments, allocations, destinationAccounts })).toHaveLength(4);
  });
});
