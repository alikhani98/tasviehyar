import type {
  DestinationAccount,
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentInstruction
} from "./schemas";
import { sumMoney } from "./money";

export type AllocationConsistencyIssue =
  | { kind: "allocation_invoice_mismatch"; allocationId: string; allocationInvoiceId: string; invoiceId: string }
  | { kind: "allocation_instruction_invoice_mismatch"; allocationId: string; instructionId: string; allocationInvoiceId: string; instructionInvoiceId: string }
  | { kind: "invoice_customer_payment_payer_mismatch"; invoiceId: string; paymentId: string; invoiceCustomerPartyId: string; paymentPayerPartyId: string }
  | { kind: "payment_recipient_instruction_recipient_mismatch"; paymentId: string; instructionId: string; paymentRecipientPartyId: string; instructionRecipientPartyId: string }
  | { kind: "destination_account_owner_mismatch"; paymentId: string; destinationAccountId: string; paymentRecipientPartyId: string; destinationAccountOwnerPartyId: string }
  | { kind: "payment_allocation_exceeds_remaining_amount"; paymentId: string; allocatedAmount: number; remainingAllocatableAmount: number }
  | { kind: "unknown_instruction"; allocationId: string; instructionId: string }
  | { kind: "unknown_destination_account"; paymentId: string; destinationAccountId: string };

export interface ValidateAllocationConsistencyArgs {
  invoice: Invoice;
  payment: Payment;
  allocation: PaymentAllocation;
  instruction?: PaymentInstruction | undefined;
  destinationAccount?: DestinationAccount | undefined;
  remainingAllocatableAmount: number;
}

export function validateAllocationConsistency(args: ValidateAllocationConsistencyArgs): AllocationConsistencyIssue[] {
  const issues: AllocationConsistencyIssue[] = [];
  const { invoice, payment, allocation, instruction, destinationAccount, remainingAllocatableAmount } = args;

  if (allocation.invoiceId !== invoice.id) {
    issues.push({
      kind: "allocation_invoice_mismatch",
      allocationId: allocation.id,
      allocationInvoiceId: allocation.invoiceId,
      invoiceId: invoice.id
    });
  }

  if (payment.payerPartyId !== invoice.customerPartyId) {
    issues.push({
      kind: "invoice_customer_payment_payer_mismatch",
      invoiceId: invoice.id,
      paymentId: payment.id,
      invoiceCustomerPartyId: invoice.customerPartyId,
      paymentPayerPartyId: payment.payerPartyId
    });
  }

  if (instruction) {
    if (instruction.invoiceId !== allocation.invoiceId) {
      issues.push({
        kind: "allocation_instruction_invoice_mismatch",
        allocationId: allocation.id,
        instructionId: instruction.id,
        allocationInvoiceId: allocation.invoiceId,
        instructionInvoiceId: instruction.invoiceId
      });
    }

    if (payment.recipientPartyId !== instruction.recipientPartyId) {
      issues.push({
        kind: "payment_recipient_instruction_recipient_mismatch",
        paymentId: payment.id,
        instructionId: instruction.id,
        paymentRecipientPartyId: payment.recipientPartyId,
        instructionRecipientPartyId: instruction.recipientPartyId
      });
    }
  } else if (allocation.paymentInstructionId) {
    issues.push({
      kind: "unknown_instruction",
      allocationId: allocation.id,
      instructionId: allocation.paymentInstructionId
    });
  }

  if (destinationAccount) {
    if (destinationAccount.ownerPartyId !== payment.recipientPartyId) {
      issues.push({
        kind: "destination_account_owner_mismatch",
        paymentId: payment.id,
        destinationAccountId: destinationAccount.id,
        paymentRecipientPartyId: payment.recipientPartyId,
        destinationAccountOwnerPartyId: destinationAccount.ownerPartyId
      });
    }
  } else if (payment.destinationAccountId) {
    issues.push({
      kind: "unknown_destination_account",
      paymentId: payment.id,
      destinationAccountId: payment.destinationAccountId
    });
  }

  if (allocation.allocatedAmount > remainingAllocatableAmount) {
    issues.push({
      kind: "payment_allocation_exceeds_remaining_amount",
      paymentId: payment.id,
      allocatedAmount: allocation.allocatedAmount,
      remainingAllocatableAmount
    });
  }

  return issues;
}

export interface ValidateAllocationGraphArgs {
  invoice: Invoice;
  payments: readonly Payment[];
  instructions: readonly PaymentInstruction[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts?: readonly DestinationAccount[];
}

export function validateAllocationGraph(args: ValidateAllocationGraphArgs): AllocationConsistencyIssue[] {
  const issues: AllocationConsistencyIssue[] = [];
  const paymentById = new Map(args.payments.map((payment) => [payment.id, payment] as const));
  const instructionById = new Map(args.instructions.map((instruction) => [instruction.id, instruction] as const));
  const destinationAccountById = new Map(
    (args.destinationAccounts ?? []).map((destinationAccount) => [destinationAccount.id, destinationAccount] as const)
  );
  const allocatedByPayment = new Map<string, number>();

  for (const allocation of args.allocations) {
    const payment = paymentById.get(allocation.paymentId);
    if (!payment) {
      continue;
    }

    const instruction = allocation.paymentInstructionId ? instructionById.get(allocation.paymentInstructionId) : undefined;
    const destinationAccount = payment.destinationAccountId ? destinationAccountById.get(payment.destinationAccountId) : undefined;
    const remainingAllocatableAmount = payment.amount - (allocatedByPayment.get(payment.id) ?? 0);

    issues.push(
      ...validateAllocationConsistency({
        invoice: args.invoice,
        payment,
        allocation,
        instruction,
        destinationAccount,
        remainingAllocatableAmount
      })
    );

    allocatedByPayment.set(payment.id, (allocatedByPayment.get(payment.id) ?? 0) + allocation.allocatedAmount);
  }

  for (const payment of args.payments) {
    const allocatedAmount = allocatedByPayment.get(payment.id) ?? 0;
    if (allocatedAmount > payment.amount) {
      issues.push({
        kind: "payment_allocation_exceeds_remaining_amount",
        paymentId: payment.id,
        allocatedAmount,
        remainingAllocatableAmount: payment.amount
      });
    }
  }

  return issues;
}

export function deriveDerivedSettlementState(summary: {
  confirmedOutstandingAmount: number;
  provisionalOutstandingAmount: number;
  confirmedAllocatedAmount: number;
  provisionalAllocatedAmount: number;
  warnings: readonly { kind: string }[];
}): "unpaid" | "partially_paid" | "provisionally_paid" | "fully_settled" | "overpaid" | "needs_review" {
  if (summary.warnings.some((warning) => warning.kind === "payment_overpayment")) {
    return "overpaid";
  }

  if (summary.warnings.some((warning) => warning.kind === "disputed_payment_requires_review")) {
    return "needs_review";
  }

  if (summary.confirmedAllocatedAmount === 0 && summary.provisionalAllocatedAmount === 0) {
    return "unpaid";
  }

  if (summary.confirmedOutstandingAmount === 0) {
    return "fully_settled";
  }

  if (summary.provisionalAllocatedAmount > summary.confirmedAllocatedAmount) {
    return "provisionally_paid";
  }

  return "partially_paid";
}

export function deriveInstructionSettlementState(summary: {
  confirmedRemainingAmount: number;
  provisionalRemainingAmount: number;
  overpaidAmount: number;
}): "unpaid" | "partially_paid" | "provisionally_paid" | "fully_settled" | "overpaid" {
  if (summary.overpaidAmount > 0) {
    return "overpaid";
  }

  if (summary.confirmedRemainingAmount === 0 && summary.provisionalRemainingAmount === 0) {
    return "fully_settled";
  }

  if (summary.provisionalRemainingAmount === 0 && summary.confirmedRemainingAmount > 0) {
    return "provisionally_paid";
  }

  if (summary.confirmedRemainingAmount === summary.provisionalRemainingAmount) {
    return "unpaid";
  }

  return "partially_paid";
}

export function deriveInvoiceInstructionRemainder(invoice: Invoice, instructions: readonly PaymentInstruction[]): number {
  return Math.max(0, invoice.totalAmount - sumMoney(instructions.map((instruction) => instruction.instructedAmount)));
}
