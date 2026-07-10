import { describe, expect, it } from "vitest";
import type {
  DestinationAccount,
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentInstruction
} from "../schemas";
import { validateAllocationGraph, validateAllocationsAgainstPayments } from "../index";
import { day, iso } from "../../test/helpers";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv_1",
    customerPartyId: "party_zare",
    invoiceDate: day("2026-07-10"),
    totalAmount: 1_500_000_000,
    lifecycleStatus: "open",
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
    amount: 100_000_000,
    paymentDate: day("2026-07-10"),
    paymentMethod: "bank_transfer",
    lifecycleStatus: "active",
    verificationStatus: "confirmed",
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
    instructedAmount: 100_000_000,
    lifecycleStatus: "active",
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
    allocatedAmount: 100_000_000,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeDestinationAccount(overrides: Partial<DestinationAccount> = {}): DestinationAccount {
  return {
    id: "acct_1",
    ownerPartyId: "party_ahmadi",
    accountLabel: "Ahmadi main account",
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

describe("cross-entity allocation validation", () => {
  it("accepts a valid multi-invoice allocation spread while keeping the payment total within bounds", () => {
    const payment = makePayment({ amount: 150_000_000 });
    const allocations = [
      makeAllocation({ id: "alloc_a", paymentId: "pay_1", invoiceId: "inv_1", paymentInstructionId: "inst_a", allocatedAmount: 80_000_000 }),
      makeAllocation({ id: "alloc_b", paymentId: "pay_1", invoiceId: "inv_2", paymentInstructionId: "inst_b", allocatedAmount: 70_000_000 })
    ];

    expect(validateAllocationsAgainstPayments([payment], allocations)).toEqual([]);
  });

  it("flags allocation and entity mismatches across payment, instruction, and destination account references", () => {
    const invoice = makeInvoice({ customerPartyId: "party_zare" });
    const payment = makePayment({
      payerPartyId: "party_other",
      recipientPartyId: "party_other_recipient",
      destinationAccountId: "acct_1"
    });
    const instruction = makeInstruction({
      id: "inst_other",
      invoiceId: "inv_other",
      recipientPartyId: "party_ahmadi"
    });
    const allocation = makeAllocation({
      id: "alloc_bad",
      paymentId: "pay_1",
      invoiceId: "inv_1",
      paymentInstructionId: "inst_other",
      allocatedAmount: 200_000_000
    });
    const destinationAccount = makeDestinationAccount({ ownerPartyId: "party_ahmadi" });

    const issues = validateAllocationGraph({
      invoice,
      payments: [payment],
      instructions: [instruction],
      allocations: [allocation],
      destinationAccounts: [destinationAccount]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "invoice_customer_payment_payer_mismatch" }),
        expect.objectContaining({ kind: "allocation_instruction_invoice_mismatch" }),
        expect.objectContaining({ kind: "payment_allocation_exceeds_remaining_amount" })
      ])
    );
  });

  it("flags recipient and destination-account mismatches", () => {
    const invoice = makeInvoice();
    const payment = makePayment({
      recipientPartyId: "party_other_recipient",
      destinationAccountId: "acct_1"
    });
    const instruction = makeInstruction({ recipientPartyId: "party_ahmadi" });
    const allocation = makeAllocation({ paymentInstructionId: "inst_1" });
    const destinationAccount = makeDestinationAccount({ ownerPartyId: "party_ahmadi" });

    const issues = validateAllocationGraph({
      invoice,
      payments: [payment],
      instructions: [instruction],
      allocations: [allocation],
      destinationAccounts: [destinationAccount]
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "payment_recipient_instruction_recipient_mismatch" }),
        expect.objectContaining({ kind: "destination_account_owner_mismatch" })
      ])
    );
  });
});
