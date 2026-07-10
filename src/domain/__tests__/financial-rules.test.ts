import { describe, expect, it } from "vitest";
import type {
  AuditEvent,
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentVerification,
  PaymentInstruction
} from "../schemas";
import {
  deriveInvoiceSettlementState,
  deriveInstructionSettlementStateFromSummary,
  findDuplicateTrackingReferenceWarnings,
  summarizeInvoiceSettlement,
  validateAllocationsAgainstPayments,
  validateInvoiceInstructionTotals
} from "../index";
import { appendAuditEvent, appendPaymentVerificationRecord } from "../audit";
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

describe("financial rules", () => {
  it("summarizes the required settlement scenario", () => {
    const invoice = makeInvoice();
    const instructions = [
      makeInstruction({ id: "inst_ahmadi", instructedAmount: 200_000_000, recipientPartyId: "party_ahmadi" }),
      makeInstruction({ id: "inst_rezaei", instructedAmount: 300_000_000, recipientPartyId: "party_rezaei" }),
      makeInstruction({ id: "inst_business", instructedAmount: 500_000_000, recipientPartyId: "party_business" })
    ];
    const payments = [
      makePayment({ id: "pay_50", amount: 50_000_000, verificationStatus: "confirmed", trackingReference: "trk-1" }),
      makePayment({
        id: "pay_30",
        amount: 30_000_000,
        verificationStatus: "reported",
        trackingReference: "trk-2"
      }),
      makePayment({ id: "pay_100", amount: 100_000_000, verificationStatus: "confirmed", trackingReference: "trk-3" }),
      makePayment({ id: "pay_20", amount: 20_000_000, verificationStatus: "confirmed", trackingReference: "trk-4" })
    ];
    const allocations = [
      makeAllocation({ id: "alloc_50", paymentId: "pay_50", paymentInstructionId: "inst_ahmadi", allocatedAmount: 50_000_000 }),
      makeAllocation({ id: "alloc_30", paymentId: "pay_30", paymentInstructionId: "inst_ahmadi", allocatedAmount: 30_000_000 }),
      makeAllocation({ id: "alloc_100", paymentId: "pay_100", paymentInstructionId: "inst_ahmadi", allocatedAmount: 100_000_000 }),
      makeAllocation({ id: "alloc_20", paymentId: "pay_20", paymentInstructionId: "inst_ahmadi", allocatedAmount: 20_000_000 })
    ];

    const summary = summarizeInvoiceSettlement(invoice, instructions, payments, allocations);
    const ahmadi = summary.instructionSettlements.find((instruction) => instruction.instructionId === "inst_ahmadi");
    expect(ahmadi).toBeDefined();

    expect(ahmadi).toMatchObject({
      confirmedAllocatedAmount: 170_000_000,
      provisionalAllocatedAmount: 200_000_000,
      confirmedRemainingAmount: 30_000_000,
      provisionalRemainingAmount: 0,
      overpaidAmount: 0
    });
    expect(summary.confirmedOutstandingAmount).toBe(1_330_000_000);
    expect(summary.provisionalOutstandingAmount).toBe(1_300_000_000);
    expect(summary.unassignedInvoiceAmount).toBe(500_000_000);
    expect(summary.warnings).toEqual([]);
    expect(summary.errors).toEqual([]);
    expect(deriveInvoiceSettlementState(summary)).toBe("provisionally_paid");
    expect(
      deriveInstructionSettlementStateFromSummary(ahmadi as {
        confirmedRemainingAmount: number;
        provisionalRemainingAmount: number;
        overpaidAmount: number;
      })
    ).toBe("provisionally_paid");
  });

  it("applies explicit payment-state semantics to balance calculations", () => {
    const invoice = makeInvoice({ totalAmount: 300_000_000 });
    const instruction = makeInstruction({ id: "inst_semantics", instructedAmount: 300_000_000, recipientPartyId: "party_ahmadi" });
    const payments = [
      makePayment({ id: "pay_confirmed", amount: 50_000_000, lifecycleStatus: "active", verificationStatus: "confirmed" }),
      makePayment({ id: "pay_reported", amount: 30_000_000, lifecycleStatus: "active", verificationStatus: "reported" }),
      makePayment({ id: "pay_rejected", amount: 40_000_000, lifecycleStatus: "active", verificationStatus: "rejected" }),
      makePayment({ id: "pay_disputed", amount: 20_000_000, lifecycleStatus: "active", verificationStatus: "disputed" }),
      makePayment({ id: "pay_cancelled", amount: 60_000_000, lifecycleStatus: "cancelled", verificationStatus: "confirmed" }),
      makePayment({ id: "pay_reversed", amount: 70_000_000, lifecycleStatus: "reversed", verificationStatus: "confirmed" })
    ];
    const allocations = [
      makeAllocation({ id: "alloc_confirmed", paymentId: "pay_confirmed", paymentInstructionId: "inst_semantics", allocatedAmount: 50_000_000 }),
      makeAllocation({ id: "alloc_reported", paymentId: "pay_reported", paymentInstructionId: "inst_semantics", allocatedAmount: 30_000_000 }),
      makeAllocation({ id: "alloc_rejected", paymentId: "pay_rejected", paymentInstructionId: "inst_semantics", allocatedAmount: 40_000_000 }),
      makeAllocation({ id: "alloc_disputed", paymentId: "pay_disputed", paymentInstructionId: "inst_semantics", allocatedAmount: 20_000_000 }),
      makeAllocation({ id: "alloc_cancelled", paymentId: "pay_cancelled", paymentInstructionId: "inst_semantics", allocatedAmount: 60_000_000 }),
      makeAllocation({ id: "alloc_reversed", paymentId: "pay_reversed", paymentInstructionId: "inst_semantics", allocatedAmount: 70_000_000 })
    ];

    const summary = summarizeInvoiceSettlement(invoice, [instruction], payments, allocations);

    expect(summary.confirmedAllocatedAmount).toBe(50_000_000);
    expect(summary.provisionalAllocatedAmount).toBe(80_000_000);
    expect(summary.confirmedOutstandingAmount).toBe(250_000_000);
    expect(summary.provisionalOutstandingAmount).toBe(220_000_000);
    expect(summary.warnings).toContainEqual({
      kind: "disputed_payment_requires_review",
      paymentId: "pay_disputed",
      amount: 20_000_000
    });
    expect(summary.warnings.find((warning) => "paymentId" in warning && warning.paymentId === "pay_cancelled")).toBeUndefined();
  });

  it("warns on duplicate tracking references", () => {
    const warnings = findDuplicateTrackingReferenceWarnings([
      makePayment({ id: "pay_a", trackingReference: "dup" }),
      makePayment({ id: "pay_b", trackingReference: "dup" })
    ]);

    expect(warnings).toEqual([
      {
        kind: "duplicate_tracking_reference",
        trackingReference: "dup",
        paymentIds: ["pay_a", "pay_b"]
      }
    ]);
  });

  it("flags allocations that exceed a payment amount", () => {
    const payment = makePayment({ id: "pay_over", amount: 100_000_000 });
    const allocations = [makeAllocation({ id: "alloc_over", paymentId: "pay_over", allocatedAmount: 120_000_000 })];

    expect(validateAllocationsAgainstPayments([payment], allocations)).toEqual([
      {
        kind: "allocation_exceeds_payment",
        paymentId: "pay_over",
        allocatedAmount: 120_000_000,
        paymentAmount: 100_000_000
      }
    ]);
  });

  it("flags instruction totals that exceed the invoice total", () => {
    const invoice = makeInvoice({ totalAmount: 100_000_000 });
    const instructions = [
      makeInstruction({ instructedAmount: 60_000_000 }),
      makeInstruction({ id: "inst_2", instructedAmount: 50_000_000 })
    ];

    expect(validateInvoiceInstructionTotals(invoice, instructions)).toEqual([
      {
        kind: "instruction_total_exceeds_invoice_total",
        invoiceId: "inv_1",
        instructionTotal: 110_000_000,
        invoiceTotal: 100_000_000
      }
    ]);
  });

  it("keeps overpayments visible for a recipient", () => {
    const invoice = makeInvoice();
    const instructions = [makeInstruction({ instructedAmount: 200_000_000, recipientPartyId: "party_ahmadi" })];
    const payments = [
      makePayment({ id: "pay_big", amount: 250_000_000, verificationStatus: "confirmed" })
    ];
    const allocations = [
      makeAllocation({ id: "alloc_big", paymentId: "pay_big", allocatedAmount: 250_000_000 })
    ];

    const summary = summarizeInvoiceSettlement(invoice, instructions, payments, allocations);

    expect(summary.warnings).toContainEqual({
      kind: "payment_overpayment",
      recipientPartyId: "party_ahmadi",
      instructionTotal: 200_000_000,
      paymentTotal: 250_000_000,
      overpaidAmount: 50_000_000
    });
  });

  it("warns on payments without allocations", () => {
    const invoice = makeInvoice();
    const instructions = [makeInstruction()];
    const payments = [makePayment({ id: "pay_lonely", amount: 10_000_000 })];

    const summary = summarizeInvoiceSettlement(invoice, instructions, payments, []);

    expect(summary.warnings).toContainEqual({
      kind: "unallocated_payment",
      paymentId: "pay_lonely",
      amount: 10_000_000
    });
  });

  it("preserves audit history for cancellation events", () => {
    const createdEvent: AuditEvent = {
      id: "audit_1",
      entityType: "payment",
      entityId: "pay_1",
      action: "created",
      description: "Payment recorded.",
      createdAt: iso("2026-07-10T08:00:00.000Z")
    };
    const cancelledEvent: AuditEvent = {
      id: "audit_2",
      entityType: "payment",
      entityId: "pay_1",
      action: "cancelled",
      description: "Payment cancelled while preserving the record.",
      previousStatus: "reported",
      nextStatus: "cancelled",
      createdAt: iso("2026-07-10T09:00:00.000Z")
    };

    const history = appendAuditEvent([createdEvent], cancelledEvent);

    expect(history).toHaveLength(2);
    expect(history[1]).toEqual(cancelledEvent);
  });

  it("keeps payment verification history append-only", () => {
    const verification: PaymentVerification = {
      id: "verify_1",
      paymentId: "pay_1",
      verificationResult: "confirmed",
      verifierDescriptionOrPartyRef: "Ahmadi",
      verificationMethod: "recipient_phone_confirmation",
      note: "Confirmed by phone",
      verifiedAt: iso("2026-07-10T09:00:00.000Z"),
      createdAt: iso("2026-07-10T09:00:00.000Z")
    };

    const history = appendPaymentVerificationRecord([], verification);

    expect(history).toEqual([verification]);
  });
});
