import type {
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentInstruction,
  PaymentVerificationStatus
} from "./schemas";
import { sumMoney } from "./money";
import { deriveDerivedSettlementState, deriveInstructionSettlementState } from "./validation";

export type DomainWarning =
  | { kind: "duplicate_tracking_reference"; trackingReference: string; paymentIds: string[] }
  | { kind: "instruction_total_exceeds_invoice_total"; invoiceId: string; instructionTotal: number; invoiceTotal: number }
  | { kind: "payment_overpayment"; recipientPartyId: string; instructionTotal: number; paymentTotal: number; overpaidAmount: number }
  | { kind: "unallocated_payment"; paymentId: string; amount: number }
  | { kind: "disputed_payment_requires_review"; paymentId: string; amount: number };

export type DomainError =
  | { kind: "allocation_exceeds_payment"; paymentId: string; allocatedAmount: number; paymentAmount: number }
  | { kind: "instruction_allocation_exceeds_remaining"; instructionId: string; allocatedAmount: number; instructionAmount: number };

export interface InstructionSettlement {
  instructionId: string;
  recipientPartyId: string;
  instructedAmount: number;
  confirmedAllocatedAmount: number;
  provisionalAllocatedAmount: number;
  confirmedRemainingAmount: number;
  provisionalRemainingAmount: number;
  overpaidAmount: number;
}

export interface InvoiceSettlementSummary {
  invoiceId: string;
  invoiceTotal: number;
  instructionTotal: number;
  unassignedInvoiceAmount: number;
  confirmedAllocatedAmount: number;
  provisionalAllocatedAmount: number;
  confirmedOutstandingAmount: number;
  provisionalOutstandingAmount: number;
  instructionSettlements: InstructionSettlement[];
  warnings: DomainWarning[];
  errors: DomainError[];
}

function isCountedForProvisional(status: PaymentVerificationStatus): boolean {
  return status === "confirmed" || status === "reported";
}

function isActivePayment(payment: Payment): boolean {
  return payment.lifecycleStatus === "active";
}

export function findDuplicateTrackingReferenceWarnings(payments: readonly Payment[]): DomainWarning[] {
  const grouped = new Map<string, string[]>();

  for (const payment of payments) {
    if (!payment.trackingReference) {
      continue;
    }

    const existing = grouped.get(payment.trackingReference) ?? [];
    existing.push(payment.id);
    grouped.set(payment.trackingReference, existing);
  }

  return Array.from(grouped.entries())
    .filter(([, paymentIds]) => paymentIds.length > 1)
    .map(([trackingReference, paymentIds]) => ({
      kind: "duplicate_tracking_reference" as const,
      trackingReference,
      paymentIds
    }));
}

export function validateInvoiceInstructionTotals(invoice: Invoice, instructions: readonly PaymentInstruction[]): DomainWarning[] {
  const instructionTotal = sumMoney(instructions.map((instruction) => instruction.instructedAmount));

  if (instructionTotal > invoice.totalAmount) {
    return [
      {
        kind: "instruction_total_exceeds_invoice_total",
        invoiceId: invoice.id,
        instructionTotal,
        invoiceTotal: invoice.totalAmount
      }
    ];
  }

  return [];
}

export function summarizeInvoiceSettlement(
  invoice: Invoice,
  instructions: readonly PaymentInstruction[],
  payments: readonly Payment[],
  allocations: readonly PaymentAllocation[]
): InvoiceSettlementSummary {
  const warnings: DomainWarning[] = [];
  const errors: DomainError[] = [];
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment] as const));
  const invoiceAllocations = allocations.filter((allocation) => allocation.invoiceId === invoice.id);
  const instructionWarnings = validateInvoiceInstructionTotals(invoice, instructions);
  warnings.push(...instructionWarnings);
  warnings.push(...findDuplicateTrackingReferenceWarnings(payments));

  const allocationsByPayment = new Map<string, PaymentAllocation[]>();
  for (const allocation of invoiceAllocations) {
    const existing = allocationsByPayment.get(allocation.paymentId) ?? [];
    existing.push(allocation);
    allocationsByPayment.set(allocation.paymentId, existing);
  }

  const allocationsByInstruction = new Map<string, PaymentAllocation[]>();
  for (const allocation of invoiceAllocations) {
    if (!allocation.paymentInstructionId) {
      continue;
    }
    const existing = allocationsByInstruction.get(allocation.paymentInstructionId) ?? [];
    existing.push(allocation);
    allocationsByInstruction.set(allocation.paymentInstructionId, existing);
  }

  for (const payment of payments) {
    if (!isActivePayment(payment)) {
      continue;
    }

    const paymentAllocations = allocationsByPayment.get(payment.id) ?? [];
    const allocatedAmount = sumMoney(paymentAllocations.map((allocation) => allocation.allocatedAmount));
    if (allocatedAmount > payment.amount) {
      errors.push({
        kind: "allocation_exceeds_payment",
        paymentId: payment.id,
        allocatedAmount,
        paymentAmount: payment.amount
      });
    }

    if (paymentAllocations.length === 0 && payment.amount > 0) {
      warnings.push({
        kind: "unallocated_payment",
        paymentId: payment.id,
        amount: payment.amount
      });
    }

    if (payment.verificationStatus === "disputed") {
      warnings.push({
        kind: "disputed_payment_requires_review",
        paymentId: payment.id,
        amount: payment.amount
      });
    }
  }

  const instructionSettlements = instructions.map((instruction) => {
    const instructionAllocations = allocationsByInstruction.get(instruction.id) ?? [];
    const confirmedAllocatedAmount = sumMoney(
      instructionAllocations
        .filter((allocation) => {
          const payment = paymentsById.get(allocation.paymentId);
          return payment?.lifecycleStatus === "active" && payment.verificationStatus === "confirmed";
        })
        .map((allocation) => allocation.allocatedAmount)
    );

    const provisionalAllocatedAmount = sumMoney(
      instructionAllocations
        .filter((allocation) => {
          const payment = paymentsById.get(allocation.paymentId);
          return payment ? isActivePayment(payment) && isCountedForProvisional(payment.verificationStatus) : false;
        })
        .map((allocation) => allocation.allocatedAmount)
    );

    const confirmedRemainingAmount = Math.max(0, instruction.instructedAmount - confirmedAllocatedAmount);
    const provisionalRemainingAmount = Math.max(0, instruction.instructedAmount - provisionalAllocatedAmount);
    const overpaidAmount = Math.max(0, provisionalAllocatedAmount - instruction.instructedAmount);

    if (provisionalAllocatedAmount > instruction.instructedAmount) {
      warnings.push({
        kind: "payment_overpayment",
        recipientPartyId: instruction.recipientPartyId,
        instructionTotal: instruction.instructedAmount,
        paymentTotal: provisionalAllocatedAmount,
        overpaidAmount
      });
    }

    return {
      instructionId: instruction.id,
      recipientPartyId: instruction.recipientPartyId,
      instructedAmount: instruction.instructedAmount,
      confirmedAllocatedAmount,
      provisionalAllocatedAmount,
      confirmedRemainingAmount,
      provisionalRemainingAmount,
      overpaidAmount
    } satisfies InstructionSettlement;
  });

  const confirmedAllocatedAmount = sumMoney(
    invoiceAllocations
      .filter((allocation) => {
        const payment = paymentsById.get(allocation.paymentId);
        return payment ? isActivePayment(payment) && payment.verificationStatus === "confirmed" : false;
      })
      .map((allocation) => allocation.allocatedAmount)
  );

  const provisionalAllocatedAmount = sumMoney(
    invoiceAllocations
      .filter((allocation) => {
        const payment = paymentsById.get(allocation.paymentId);
        return payment ? isActivePayment(payment) && isCountedForProvisional(payment.verificationStatus) : false;
      })
      .map((allocation) => allocation.allocatedAmount)
  );

  const confirmedOutstandingAmount = Math.max(0, invoice.totalAmount - confirmedAllocatedAmount);
  const provisionalOutstandingAmount = Math.max(0, invoice.totalAmount - provisionalAllocatedAmount);
  const instructionTotal = sumMoney(instructions.map((instruction) => instruction.instructedAmount));
  const unassignedInvoiceAmount = Math.max(0, invoice.totalAmount - instructionTotal);

  const paymentTotalsByRecipient = new Map<string, number>();
  for (const payment of payments) {
    if (!isActivePayment(payment) || !isCountedForProvisional(payment.verificationStatus)) {
      continue;
    }

    const existing = paymentTotalsByRecipient.get(payment.recipientPartyId) ?? 0;
    paymentTotalsByRecipient.set(payment.recipientPartyId, existing + payment.amount);
  }

  for (const [recipientPartyId, paymentTotal] of paymentTotalsByRecipient.entries()) {
    const instructionTotalForRecipient = sumMoney(
      instructions
        .filter((instruction) => instruction.recipientPartyId === recipientPartyId)
        .map((instruction) => instruction.instructedAmount)
    );

    if (paymentTotal > instructionTotalForRecipient) {
      warnings.push({
        kind: "payment_overpayment",
        recipientPartyId,
        instructionTotal: instructionTotalForRecipient,
        paymentTotal,
        overpaidAmount: paymentTotal - instructionTotalForRecipient
      });
    }
  }

  return {
    invoiceId: invoice.id,
    invoiceTotal: invoice.totalAmount,
    instructionTotal,
    unassignedInvoiceAmount,
    confirmedAllocatedAmount,
    provisionalAllocatedAmount,
    confirmedOutstandingAmount,
    provisionalOutstandingAmount,
    instructionSettlements,
    warnings,
    errors
  };
}

export type SettlementState = ReturnType<typeof deriveDerivedSettlementState>;

export function deriveInvoiceSettlementState(summary: Pick<
  InvoiceSettlementSummary,
  "confirmedOutstandingAmount" | "provisionalOutstandingAmount" | "confirmedAllocatedAmount" | "provisionalAllocatedAmount" | "warnings"
>): SettlementState {
  return deriveDerivedSettlementState(summary);
}

export function deriveInstructionSettlementStateFromSummary(summary: Pick<
  InstructionSettlement,
  "confirmedRemainingAmount" | "provisionalRemainingAmount" | "overpaidAmount"
>): ReturnType<typeof deriveInstructionSettlementState> {
  return deriveInstructionSettlementState(summary);
}

export function validateAllocationsAgainstPayments(payments: readonly Payment[], allocations: readonly PaymentAllocation[]): DomainError[] {
  const errors: DomainError[] = [];
  const allocationsByPayment = new Map<string, number>();

  for (const allocation of allocations) {
    allocationsByPayment.set(allocation.paymentId, (allocationsByPayment.get(allocation.paymentId) ?? 0) + allocation.allocatedAmount);
  }

  for (const payment of payments) {
    const allocatedAmount = allocationsByPayment.get(payment.id) ?? 0;
    if (allocatedAmount > payment.amount) {
      errors.push({
        kind: "allocation_exceeds_payment",
        paymentId: payment.id,
        allocatedAmount,
        paymentAmount: payment.amount
      });
    }
  }

  return errors;
}
