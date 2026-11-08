import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "./schemas";
import { sumMoney } from "./money";
import {
  deriveInvoiceSettlementState,
  deriveInstructionSettlementStateFromSummary,
  findDuplicateTrackingReferenceWarnings,
  summarizeInvoiceSettlement
} from "./calculations";
import { findProbablePaymentDuplicateWarnings } from "./payments";
import { formatInvoiceAmount } from "./invoices";

type InvoiceSettlementBase = ReturnType<typeof summarizeInvoiceSettlement>;

export type SettlementSeverity = "low" | "medium" | "high";

export type SettlementMismatchType =
  | "unallocated_payment"
  | "disputed_payment"
  | "duplicate_tracking_reference"
  | "probable_duplicate_payment"
  | "instruction_overpayment"
  | "invoice_overpayment"
  | "cancelled_instruction_allocation"
  | "recipient_mismatch"
  | "destination_account_owner_mismatch"
  | "active_instruction_without_destination_account"
  | "reported_payment_awaiting_confirmation";

export type SettlementNavigationTarget =
  | { section: "invoices"; recordId: string }
  | { section: "payments"; recordId: string }
  | { section: "parties"; recordId: string }
  | { section: "reconciliation"; recordId?: string };

export interface SettlementReviewItem {
  id: string;
  mismatchType: SettlementMismatchType;
  severity: SettlementSeverity;
  title: string;
  explanation: string;
  relatedPartyId?: string;
  relatedPartyName?: string;
  invoiceId?: string;
  invoiceReference?: string;
  paymentId?: string;
  paymentTrackingReference?: string;
  instructionId?: string;
  instructionLabel?: string;
  destinationAccountId?: string;
  destinationAccountLabel?: string;
  navigation: SettlementNavigationTarget;
  searchText: string;
}

export interface InvoiceSettlementDetails extends InvoiceSettlementBase {
  activeInstructedTotal: number;
  reportedAllocatedAmount: number;
  overpaymentAmount: number;
  derivedSettlementLabel: ReturnType<typeof deriveInvoiceSettlementState>;
}

export interface InstructionSettlementDetails {
  instructionId: string;
  recipientPartyId: string;
  instructedAmount: number;
  confirmedReceived: number;
  reportedButUnconfirmedAmount: number;
  confirmedRemainingAmount: number;
  provisionalRemainingAmount: number;
  overpaymentAmount: number;
  derivedInstructionLabel: ReturnType<typeof deriveInstructionSettlementStateFromSummary>;
}

export interface CustomerSettlementSummary {
  customerPartyId: string;
  customerName: string;
  totalInvoiced: number;
  confirmedAllocated: number;
  reportedUnconfirmed: number;
  confirmedOutstanding: number;
  provisionalOutstanding: number;
  openInvoiceCount: number;
  invoiceCount: number;
  derivedSettlementLabel: ReturnType<typeof deriveInvoiceSettlementState>;
}

export interface RecipientSettlementSummary {
  recipientPartyId: string;
  recipientName: string;
  totalInstructed: number;
  confirmedReceived: number;
  reportedUnconfirmed: number;
  confirmedRemaining: number;
  provisionalRemaining: number;
  overpaymentTotal: number;
  instructionCount: number;
  derivedSettlementLabel: ReturnType<typeof deriveInstructionSettlementStateFromSummary>;
}

export interface SettlementHomeCard {
  id: string;
  label: string;
  value: string;
  detail: string;
  navigation: SettlementNavigationTarget;
}

export function summarizeInvoiceBalance(
  invoice: Invoice,
  instructions: readonly PaymentInstruction[],
  payments: readonly Payment[],
  allocations: readonly PaymentAllocation[]
): InvoiceSettlementDetails {
  const base = summarizeInvoiceSettlement(invoice, instructions, payments, allocations);
  const activeInstructions = instructions.filter((instruction) => instruction.lifecycleStatus === "active");
  const activeInstructedTotal = sumMoney(activeInstructions.map((instruction) => instruction.instructedAmount));
  const { confirmedAllocatedAmount, provisionalAllocatedAmount, confirmedOutstandingAmount, provisionalOutstandingAmount } = base;
  const reportedAllocatedAmount = provisionalAllocatedAmount - confirmedAllocatedAmount;
  const overpaymentAmount = Math.max(0, provisionalAllocatedAmount - invoice.totalAmount);

  return {
    ...base,
    instructionTotal: activeInstructedTotal,
    unassignedInvoiceAmount: Math.max(0, invoice.totalAmount - activeInstructedTotal),
    confirmedAllocatedAmount,
    provisionalAllocatedAmount,
    confirmedOutstandingAmount,
    provisionalOutstandingAmount,
    activeInstructedTotal,
    reportedAllocatedAmount,
    overpaymentAmount,
    derivedSettlementLabel: deriveInvoiceSettlementState(base)
  };
}

export function summarizeInstructionBalance(
  instruction: PaymentInstruction,
  payments: readonly Payment[],
  allocations: readonly PaymentAllocation[]
): InstructionSettlementDetails {
  const allocationsForInstruction = allocations.filter((allocation) => allocation.paymentInstructionId === instruction.id);
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment] as const));
  const confirmedReceived = sumMoney(
    allocationsForInstruction
      .filter((allocation) => {
        const payment = paymentsById.get(allocation.paymentId);
        return payment?.lifecycleStatus === "active" && payment.verificationStatus === "confirmed";
      })
      .map((allocation) => allocation.allocatedAmount)
  );
  const reportedButUnconfirmedAmount = sumMoney(
    allocationsForInstruction
      .filter((allocation) => {
        const payment = paymentsById.get(allocation.paymentId);
        return payment?.lifecycleStatus === "active" && payment.verificationStatus === "reported";
      })
      .map((allocation) => allocation.allocatedAmount)
  );
  const provisionalAllocatedAmount = confirmedReceived + reportedButUnconfirmedAmount;
  const confirmedRemainingAmount = Math.max(0, instruction.instructedAmount - confirmedReceived);
  const provisionalRemainingAmount = Math.max(0, instruction.instructedAmount - provisionalAllocatedAmount);
  const overpaymentAmount = Math.max(0, provisionalAllocatedAmount - instruction.instructedAmount);

  return {
    instructionId: instruction.id,
    recipientPartyId: instruction.recipientPartyId,
    instructedAmount: instruction.instructedAmount,
    confirmedReceived,
    reportedButUnconfirmedAmount,
    confirmedRemainingAmount,
    provisionalRemainingAmount,
    overpaymentAmount,
    derivedInstructionLabel: deriveInstructionSettlementStateFromSummary({
      confirmedRemainingAmount,
      provisionalRemainingAmount,
      overpaidAmount: overpaymentAmount
    })
  };
}

export function summarizeCustomerSettlement(
  customerPartyId: string,
  invoices: readonly Invoice[],
  instructions: readonly PaymentInstruction[],
  payments: readonly Payment[],
  allocations: readonly PaymentAllocation[],
  parties: readonly Party[] = []
): CustomerSettlementSummary {
  const activeInvoices = invoices.filter((invoice) => invoice.customerPartyId === customerPartyId && invoice.lifecycleStatus === "active");
  const customerName = parties.find((party) => party.id === customerPartyId)?.displayName ?? customerPartyId;
  const summaries = activeInvoices.map((invoice) =>
    summarizeInvoiceBalance(invoice, instructions.filter((instruction) => instruction.invoiceId === invoice.id), payments, allocations)
  );

  const totalInvoiced = sumMoney(activeInvoices.map((invoice) => invoice.totalAmount));
  const confirmedAllocated = sumMoney(summaries.map((summary) => summary.confirmedAllocatedAmount));
  const reportedUnconfirmed = sumMoney(summaries.map((summary) => summary.reportedAllocatedAmount));
  const confirmedOutstanding = sumMoney(summaries.map((summary) => summary.confirmedOutstandingAmount));
  const provisionalOutstanding = sumMoney(summaries.map((summary) => summary.provisionalOutstandingAmount));
  const openInvoiceCount = summaries.filter((summary) => summary.confirmedOutstandingAmount > 0).length;

  return {
    customerPartyId,
    customerName,
    totalInvoiced,
    confirmedAllocated,
    reportedUnconfirmed,
    confirmedOutstanding,
    provisionalOutstanding,
    openInvoiceCount,
    invoiceCount: activeInvoices.length,
    derivedSettlementLabel: deriveInvoiceSettlementState({
      confirmedOutstandingAmount: confirmedOutstanding,
      provisionalOutstandingAmount: provisionalOutstanding,
      confirmedAllocatedAmount: confirmedAllocated,
      provisionalAllocatedAmount: confirmedAllocated + reportedUnconfirmed,
      warnings: []
    })
  };
}

export function summarizeRecipientSettlement(
  recipientPartyId: string,
  instructions: readonly PaymentInstruction[],
  payments: readonly Payment[],
  allocations: readonly PaymentAllocation[],
  parties: readonly Party[] = []
): RecipientSettlementSummary {
  const activeInstructions = instructions.filter(
    (instruction) => instruction.recipientPartyId === recipientPartyId && instruction.lifecycleStatus === "active"
  );
  const recipientName = parties.find((party) => party.id === recipientPartyId)?.displayName ?? recipientPartyId;
  const summaries = activeInstructions.map((instruction) => summarizeInstructionBalance(instruction, payments, allocations));

  const totalInstructed = sumMoney(activeInstructions.map((instruction) => instruction.instructedAmount));
  const confirmedReceived = sumMoney(summaries.map((summary) => summary.confirmedReceived));
  const reportedUnconfirmed = sumMoney(summaries.map((summary) => summary.reportedButUnconfirmedAmount));
  const confirmedRemaining = sumMoney(summaries.map((summary) => summary.confirmedRemainingAmount));
  const provisionalRemaining = sumMoney(summaries.map((summary) => summary.provisionalRemainingAmount));
  const overpaymentTotal = sumMoney(summaries.map((summary) => summary.overpaymentAmount));

  return {
    recipientPartyId,
    recipientName,
    totalInstructed,
    confirmedReceived,
    reportedUnconfirmed,
    confirmedRemaining,
    provisionalRemaining,
    overpaymentTotal,
    instructionCount: activeInstructions.length,
    derivedSettlementLabel: deriveInstructionSettlementStateFromSummary({
      confirmedRemainingAmount: confirmedRemaining,
      provisionalRemainingAmount: provisionalRemaining,
      overpaidAmount: overpaymentTotal
    })
  };
}

function severityRank(severity: SettlementSeverity): number {
  return severity === "high" ? 0 : severity === "medium" ? 1 : 2;
}

export function deriveSettlementReviewItems(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
}): SettlementReviewItem[] {
  const partyNames = new Map(args.parties.map((party) => [party.id, party.displayName] as const));
  const accountLabels = new Map(args.destinationAccounts.map((account) => [account.id, account.accountLabel] as const));
  const items: SettlementReviewItem[] = [];

  for (const warning of findDuplicateTrackingReferenceWarnings(args.payments)) {
    if (warning.kind !== "duplicate_tracking_reference") {
      continue;
    }

    if (!warning.paymentIds[0]) {
      continue;
    }

    items.push({
      id: `duplicate_tracking_reference:${warning.trackingReference}`,
      mismatchType: "duplicate_tracking_reference",
      severity: "medium",
      title: `شماره پیگیری تکراری «${warning.trackingReference}»`,
      explanation: `شماره پیگیری بین پرداخت‌های ${warning.paymentIds.join("، ")} تکرار شده است.`,
      paymentId: warning.paymentIds[0],
      paymentTrackingReference: warning.trackingReference,
      navigation: { section: "payments", recordId: warning.paymentIds[0] },
      searchText: [warning.trackingReference, ...warning.paymentIds].join(" ")
    });
  }

  for (const warning of findProbablePaymentDuplicateWarnings(args.payments, args.parties, args.destinationAccounts)) {
    const firstPaymentId = warning.matchedPaymentIds[0];
    if (!firstPaymentId) {
      continue;
    }

    const relatedPartyName = partyNames.get(warning.payerPartyId);
    items.push({
      id: `probable_duplicate_payment:${warning.payerPartyId}:${warning.recipientPartyId}:${warning.paymentDate}:${warning.amount}`,
      mismatchType: "probable_duplicate_payment",
      severity: "medium",
      title: "پرداخت مشابه احتمالی",
      explanation: warning.matchedPaymentSummaries.join("؛ "),
      relatedPartyId: warning.payerPartyId,
      ...(relatedPartyName ? { relatedPartyName } : {}),
      paymentId: firstPaymentId,
      ...(warning.trackingReference ? { paymentTrackingReference: warning.trackingReference } : {}),
      navigation: { section: "payments", recordId: firstPaymentId },
      searchText: [warning.matchedPaymentSummaries.join(" "), warning.trackingReference ?? ""].join(" ")
    });
  }

  for (const payment of args.payments) {
    const paymentAllocations = args.allocations.filter((allocation) => allocation.paymentId === payment.id);
    if (payment.lifecycleStatus === "active" && payment.verificationStatus === "reported") {
      const relatedPartyName = partyNames.get(payment.recipientPartyId);
      items.push({
        id: `reported_payment_awaiting_confirmation:${payment.id}`,
        mismatchType: "reported_payment_awaiting_confirmation",
        severity: "low",
        title: "پرداخت اعلام‌شده در انتظار تأیید",
        explanation: `پرداخت ${payment.id} با مبلغ ${formatInvoiceAmount(payment.amount)} هنوز تأیید نشده است.`,
        relatedPartyId: payment.recipientPartyId,
        ...(relatedPartyName ? { relatedPartyName } : {}),
        paymentId: payment.id,
        ...(payment.trackingReference ? { paymentTrackingReference: payment.trackingReference } : {}),
        navigation: { section: "payments", recordId: payment.id },
        searchText: [payment.id, payment.trackingReference ?? "", relatedPartyName ?? ""].join(" ")
      });
    }

    if (payment.lifecycleStatus === "active" && payment.verificationStatus === "disputed") {
      const relatedPartyName = partyNames.get(payment.recipientPartyId);
      items.push({
        id: `disputed_payment:${payment.id}`,
        mismatchType: "disputed_payment",
        severity: "high",
        title: "پرداخت مورد اختلاف",
        explanation: `پرداخت ${payment.id} در وضعیت مورد اختلاف است و باید بررسی شود.`,
        relatedPartyId: payment.recipientPartyId,
        ...(relatedPartyName ? { relatedPartyName } : {}),
        paymentId: payment.id,
        ...(payment.trackingReference ? { paymentTrackingReference: payment.trackingReference } : {}),
        navigation: { section: "payments", recordId: payment.id },
        searchText: [payment.id, payment.trackingReference ?? "", relatedPartyName ?? ""].join(" ")
      });
    }

    if (payment.lifecycleStatus === "active" && paymentAllocations.length === 0) {
      const relatedPartyName = partyNames.get(payment.recipientPartyId);
      items.push({
        id: `unallocated_payment:${payment.id}`,
        mismatchType: "unallocated_payment",
        severity: "medium",
        title: "پرداخت بدون تخصیص",
        explanation: `پرداخت ${payment.id} هنوز به هیچ فاکتور یا دستور پرداختی تخصیص نیافته است.`,
        relatedPartyId: payment.recipientPartyId,
        ...(relatedPartyName ? { relatedPartyName } : {}),
        paymentId: payment.id,
        ...(payment.trackingReference ? { paymentTrackingReference: payment.trackingReference } : {}),
        navigation: { section: "payments", recordId: payment.id },
        searchText: [payment.id, payment.trackingReference ?? "", relatedPartyName ?? ""].join(" ")
      });
    }
  }

  for (const invoice of args.invoices) {
    const summary = summarizeInvoiceBalance(
      invoice,
      args.instructions.filter((instruction) => instruction.invoiceId === invoice.id),
      args.payments,
      args.allocations
    );

    if (summary.overpaymentAmount > 0) {
      items.push({
        id: `invoice_overpayment:${invoice.id}`,
        mismatchType: "invoice_overpayment",
        severity: "high",
        title: "فاکتور دارای پرداخت اضافی",
        explanation: `فاکتور ${invoice.id} بیش از مبلغ خود، ${formatInvoiceAmount(summary.overpaymentAmount)} دریافت کرده است.`,
        invoiceId: invoice.id,
        invoiceReference: invoice.referenceNumber ?? invoice.id,
        navigation: { section: "invoices", recordId: invoice.id },
        searchText: [invoice.id, invoice.referenceNumber ?? "", summary.overpaymentAmount.toString()].join(" ")
      });
    }
  }

  for (const instruction of args.instructions) {
    const summary = summarizeInstructionBalance(instruction, args.payments, args.allocations);

    if (summary.overpaymentAmount > 0) {
      items.push({
        id: `instruction_overpayment:${instruction.id}`,
        mismatchType: "instruction_overpayment",
        severity: "high",
        title: "دستور پرداخت بیش‌ازحد تکمیل شده است",
        explanation: `دستور ${instruction.id} بیش از مبلغ مورد انتظار خود دریافت کرده است.`,
        instructionId: instruction.id,
        ...(instruction.note ? { instructionLabel: instruction.note } : {}),
        navigation: { section: "invoices", recordId: instruction.invoiceId },
        searchText: [instruction.id, instruction.note ?? "", summary.overpaymentAmount.toString()].join(" ")
      });
    }

    if (instruction.lifecycleStatus === "active" && !instruction.destinationAccountId) {
      items.push({
        id: `active_instruction_without_destination_account:${instruction.id}`,
        mismatchType: "active_instruction_without_destination_account",
        severity: "medium",
        title: "دستور فعال بدون حساب مقصد",
        explanation: `دستور ${instruction.id} هنوز حساب مقصد ندارد.`,
        instructionId: instruction.id,
        ...(instruction.note ? { instructionLabel: instruction.note } : {}),
        navigation: { section: "invoices", recordId: instruction.invoiceId },
        searchText: [instruction.id, instruction.note ?? ""].join(" ")
      });
    }
  }

  for (const instruction of args.instructions.filter((entry) => entry.lifecycleStatus === "cancelled")) {
    const retainedAllocations = args.allocations.filter((allocation) => allocation.paymentInstructionId === instruction.id);
    if (retainedAllocations.length === 0) {
      continue;
    }

    const invoice = args.invoices.find((entry) => entry.id === instruction.invoiceId);
    items.push({
      id: `cancelled_instruction_allocation:${instruction.id}`,
      mismatchType: "cancelled_instruction_allocation",
      severity: "high",
      title: "تخصیص به دستور لغوشده",
      explanation: `تخصیص‌های ثبت‌شده برای دستور لغوشده «${instruction.id}» همچنان به فاکتور ${invoice?.referenceNumber ?? instruction.invoiceId} وابسته‌اند و نیاز به بررسی دارند.`,
      invoiceId: instruction.invoiceId,
      invoiceReference: invoice?.referenceNumber ?? instruction.invoiceId,
      instructionId: instruction.id,
      ...(instruction.note ? { instructionLabel: instruction.note } : {}),
      navigation: { section: "invoices", recordId: instruction.invoiceId },
      searchText: [instruction.id, instruction.invoiceId, invoice?.referenceNumber ?? ""].join(" ")
    });
  }

  for (const payment of args.payments) {
    for (const allocation of args.allocations.filter((entry) => entry.paymentId === payment.id)) {
      const instruction = allocation.paymentInstructionId
        ? args.instructions.find((entry) => entry.id === allocation.paymentInstructionId)
        : undefined;
      const destinationAccount = payment.destinationAccountId
        ? args.destinationAccounts.find((entry) => entry.id === payment.destinationAccountId)
        : undefined;

      if (instruction && payment.recipientPartyId !== instruction.recipientPartyId) {
        const relatedPartyName = partyNames.get(payment.recipientPartyId);
        items.push({
          id: `recipient_mismatch:${payment.id}:${instruction.id}`,
          mismatchType: "recipient_mismatch",
          severity: "high",
          title: "ناهمخوانی گیرنده در داده‌های قدیمی",
          explanation: `گیرنده پرداخت ${payment.id} با گیرنده دستور ${instruction.id} یکسان نیست.`,
          paymentId: payment.id,
          instructionId: instruction.id,
          relatedPartyId: payment.recipientPartyId,
          ...(relatedPartyName ? { relatedPartyName } : {}),
          navigation: { section: "payments", recordId: payment.id },
          searchText: [payment.id, instruction.id, payment.recipientPartyId, instruction.recipientPartyId].join(" ")
        });
      }

      if (destinationAccount && destinationAccount.ownerPartyId !== payment.recipientPartyId) {
        const destinationAccountLabel = accountLabels.get(destinationAccount.id);
        items.push({
          id: `destination_account_owner_mismatch:${payment.id}:${destinationAccount.id}`,
          mismatchType: "destination_account_owner_mismatch",
          severity: "high",
          title: "ناهمخوانی مالک حساب مقصد",
          explanation: `حساب مقصد ${destinationAccount.id} متعلق به گیرنده پرداخت ${payment.id} نیست.`,
          paymentId: payment.id,
          destinationAccountId: destinationAccount.id,
          ...(destinationAccountLabel ? { destinationAccountLabel } : {}),
          navigation: { section: "payments", recordId: payment.id },
          searchText: [payment.id, destinationAccount.id, destinationAccountLabel ?? ""].join(" ")
        });
      }
    }
  }

  return items.sort((left, right) => {
    if (severityRank(left.severity) !== severityRank(right.severity)) {
      return severityRank(left.severity) - severityRank(right.severity);
    }

    return left.id.localeCompare(right.id, "fa");
  });
}

export function buildSettlementHomeCards(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
}): SettlementHomeCard[] {
  const customerSummaries = args.parties
    .filter((party) => party.roles.includes("customer"))
    .map((party) => summarizeCustomerSettlement(party.id, args.invoices, args.instructions, args.payments, args.allocations, args.parties))
    .filter((summary) => summary.invoiceCount > 0);
  const instructionSummaries = args.instructions
    .filter((instruction) => instruction.lifecycleStatus === "active")
    .map((instruction) => summarizeInstructionBalance(instruction, args.payments, args.allocations));
  const reviewItems = deriveSettlementReviewItems(args);

  return [
    {
      id: "customer-outstanding",
      label: "کل طلب قطعی از مشتریان",
      value: formatInvoiceAmount(sumMoney(customerSummaries.map((summary) => summary.confirmedOutstanding))),
      detail: `${customerSummaries.length.toLocaleString("fa-IR")} مشتری فعال`,
      navigation: { section: "invoices", recordId: args.invoices.find((invoice) => invoice.lifecycleStatus === "active")?.id ?? "" }
    },
    {
      id: "reported-payments",
      label: "پرداخت‌های در انتظار تأیید",
      value: args.payments.filter((payment) => payment.lifecycleStatus === "active" && payment.verificationStatus === "reported").length.toLocaleString("fa-IR"),
      detail: formatInvoiceAmount(
        sumMoney(
          args.payments
            .filter((payment) => payment.lifecycleStatus === "active" && payment.verificationStatus === "reported")
            .map((payment) => payment.amount)
        )
      ),
      navigation: { section: "payments", recordId: args.payments.find((payment) => payment.lifecycleStatus === "active" && payment.verificationStatus === "reported")?.id ?? "" }
    },
    {
      id: "unfinished-instructions",
      label: "دستورهای تکمیل‌نشده",
      value: instructionSummaries.filter((summary) => summary.provisionalRemainingAmount > 0).length.toLocaleString("fa-IR"),
      detail: formatInvoiceAmount(
        sumMoney(instructionSummaries.filter((summary) => summary.provisionalRemainingAmount > 0).map((summary) => summary.provisionalRemainingAmount))
      ),
      navigation: { section: "invoices", recordId: args.instructions.find((instruction) => instruction.lifecycleStatus === "active")?.invoiceId ?? "" }
    },
    {
      id: "needs-review",
      label: "موارد نیازمند بررسی",
      value: reviewItems.length.toLocaleString("fa-IR"),
      detail: `${reviewItems.filter((item) => item.severity === "high").length.toLocaleString("fa-IR")} مورد با اولویت بالا`,
      navigation: { section: "reconciliation" }
    }
  ];
}
