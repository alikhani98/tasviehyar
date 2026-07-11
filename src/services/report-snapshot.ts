import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "../domain";
import { formatInvoiceAmount } from "../domain/invoices";
import { partyRoleLabels } from "../domain/parties";
import {
  deriveSettlementReviewItems,
  summarizeCustomerSettlement,
  summarizeInstructionBalance,
  summarizeInvoiceBalance,
  summarizeRecipientSettlement
} from "../domain/settlement";
import {
  formatPaymentLifecycleLabel,
  formatPaymentMethodLabel,
  formatPaymentVerificationStatusLabel,
  summarizePaymentAllocationProgress
} from "../domain/payments";
import {
  buildOperationalReportWorkbook,
  type CustomerSummaryReportRow,
  type InvoiceReportRow,
  type OperationalReportWorkbookData,
  type PartyStatementInstructionRow,
  type PartyStatementInvoiceRow,
  type PartyStatementPaymentRow,
  type PartyStatementReport,
  type PaymentInstructionReportRow,
  type PaymentReportRow,
  type RecipientSummaryReportRow,
  type ReconciliationReportRow
} from "./report-export";

function toRowDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function formatPartyDisplayName(party: Party): string {
  return party.active ? party.displayName : `${party.displayName} (بایگانی)`;
}

function buildCustomerSummaryRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
}): CustomerSummaryReportRow[] {
  return args.parties
    .filter((party) => party.roles.includes("customer"))
    .flatMap((party) => {
      const partyInvoices = args.invoices.filter((invoice) => invoice.customerPartyId === party.id && invoice.lifecycleStatus === "active");
      if (partyInvoices.length === 0) {
        return [];
      }

      const summaries = partyInvoices.map((invoice) =>
        summarizeInvoiceBalance(
          invoice,
          args.instructions.filter((instruction) => instruction.invoiceId === invoice.id),
          args.payments,
          args.allocations
        )
      );

      return [
        {
          partyId: party.id,
          customerName: formatPartyDisplayName(party),
          totalInvoiced: partyInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
          confirmedAllocated: summaries.reduce((sum, summary) => sum + summary.confirmedAllocatedAmount, 0),
          reportedUnconfirmed: summaries.reduce((sum, summary) => sum + summary.reportedAllocatedAmount, 0),
          confirmedOutstanding: summaries.reduce((sum, summary) => sum + summary.confirmedOutstandingAmount, 0),
          provisionalOutstanding: summaries.reduce((sum, summary) => sum + summary.provisionalOutstandingAmount, 0),
          openInvoiceCount: partyInvoices.filter((invoice) => invoice.lifecycleStatus === "active").length,
          cancelledInvoiceCount: args.invoices.filter((invoice) => invoice.customerPartyId === party.id && invoice.lifecycleStatus === "cancelled").length,
          invoiceCount: args.invoices.filter((invoice) => invoice.customerPartyId === party.id).length,
          settlementState: summaries.some((summary) => summary.derivedSettlementLabel === "overpaid")
            ? "overpaid"
            : summaries.some((summary) => summary.derivedSettlementLabel === "needs_review")
              ? "needs_review"
              : summaries.some((summary) => summary.derivedSettlementLabel === "fully_settled")
                ? "fully_settled"
                : summaries.some((summary) => summary.derivedSettlementLabel === "provisionally_paid")
                  ? "provisionally_paid"
                  : "unpaid"
        } satisfies CustomerSummaryReportRow
      ];
    });
}

function buildRecipientSummaryRows(args: {
  parties: readonly Party[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
}): RecipientSummaryReportRow[] {
  return args.parties
    .flatMap((party) => {
      const partyInstructions = args.instructions.filter((instruction) => instruction.recipientPartyId === party.id && instruction.lifecycleStatus === "active");
      if (partyInstructions.length === 0) {
        return [];
      }

      const summaries = partyInstructions.map((instruction) => summarizeInstructionBalance(instruction, args.payments, args.allocations));
      return [
        {
          partyId: party.id,
          recipientName: formatPartyDisplayName(party),
          totalInstructed: partyInstructions.reduce((sum, instruction) => sum + instruction.instructedAmount, 0),
          confirmedReceived: summaries.reduce((sum, summary) => sum + summary.confirmedReceived, 0),
          reportedUnconfirmed: summaries.reduce((sum, summary) => sum + summary.reportedButUnconfirmedAmount, 0),
          confirmedRemaining: summaries.reduce((sum, summary) => sum + summary.confirmedRemainingAmount, 0),
          provisionalRemaining: summaries.reduce((sum, summary) => sum + summary.provisionalRemainingAmount, 0),
          overpaymentAmount: summaries.reduce((sum, summary) => sum + summary.overpaymentAmount, 0),
          activeInstructionCount: partyInstructions.length,
          instructionCount: args.instructions.filter((instruction) => instruction.recipientPartyId === party.id).length,
          settlementState: summaries.some((summary) => summary.derivedInstructionLabel === "overpaid")
            ? "overpaid"
            : summaries.some((summary) => summary.derivedInstructionLabel === "fully_settled")
              ? "fully_settled"
              : summaries.some((summary) => summary.derivedInstructionLabel === "provisionally_paid")
                ? "provisionally_paid"
                : "unpaid"
        } satisfies RecipientSummaryReportRow
      ];
    });
}

function buildInvoiceRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
}): InvoiceReportRow[] {
  const partiesById = new Map(args.parties.map((party) => [party.id, party] as const));
  return args.invoices.map((invoice) => {
    const summary = summarizeInvoiceBalance(
      invoice,
      args.instructions.filter((instruction) => instruction.invoiceId === invoice.id),
      args.payments,
      args.allocations
    );
    return {
      invoiceId: invoice.id,
      invoiceReference: invoice.referenceNumber ?? invoice.id,
      customerName: partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId,
      invoiceDate: invoice.invoiceDate,
      totalAmount: invoice.totalAmount,
      confirmedPayment: summary.confirmedAllocatedAmount,
      reportedPayment: summary.reportedAllocatedAmount,
      confirmedOutstanding: summary.confirmedOutstandingAmount,
      provisionalOutstanding: summary.provisionalOutstandingAmount,
      activeInstructedAmount: summary.activeInstructedTotal,
      unassignedAmount: summary.unassignedInvoiceAmount,
      settlementState: summary.derivedSettlementLabel,
      lifecycleState: invoice.lifecycleStatus
    } satisfies InvoiceReportRow;
  });
}

function buildInstructionRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
}): PaymentInstructionReportRow[] {
  const partiesById = new Map(args.parties.map((party) => [party.id, party] as const));
  const invoicesById = new Map(args.invoices.map((invoice) => [invoice.id, invoice] as const));
  const accountsById = new Map(args.destinationAccounts.map((account) => [account.id, account] as const));
  return args.instructions.map((instruction) => {
    const summary = summarizeInstructionBalance(instruction, args.payments, args.allocations);
    const invoice = invoicesById.get(instruction.invoiceId);
    return {
      instructionId: instruction.id,
      invoiceId: instruction.invoiceId,
      invoiceReference: invoice?.referenceNumber ?? invoice?.id ?? instruction.invoiceId,
      customerName: invoice ? partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId : instruction.invoiceId,
      recipientName: partiesById.get(instruction.recipientPartyId)?.displayName ?? instruction.recipientPartyId,
      destinationAccountLabel: instruction.destinationAccountId
        ? accountsById.get(instruction.destinationAccountId)?.accountLabel ?? "حساب تعیین نشده"
        : "حساب تعیین نشده",
      instructedAmount: instruction.instructedAmount,
      confirmedReceived: summary.confirmedReceived,
      reportedUnconfirmed: summary.reportedButUnconfirmedAmount,
      confirmedRemaining: summary.confirmedRemainingAmount,
      provisionalRemaining: summary.provisionalRemainingAmount,
      overpaymentAmount: summary.overpaymentAmount,
      lifecycleState: instruction.lifecycleStatus
    } satisfies PaymentInstructionReportRow;
  });
}

function buildPaymentRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
}): PaymentReportRow[] {
  const partiesById = new Map(args.parties.map((party) => [party.id, party] as const));
  const invoicesById = new Map(args.invoices.map((invoice) => [invoice.id, invoice] as const));
  const instructionsById = new Map(args.instructions.map((instruction) => [instruction.id, instruction] as const));
  return args.payments.map((payment) => {
    const paymentAllocations = args.allocations.filter((allocation) => allocation.paymentId === payment.id);
    const progress = summarizePaymentAllocationProgress(payment, paymentAllocations);
    const invoiceReferences = Array.from(
      new Set(
        paymentAllocations.map((allocation) => invoicesById.get(allocation.invoiceId)?.referenceNumber ?? allocation.invoiceId)
      )
    );
    const instructionReferences = Array.from(
      new Set(
        paymentAllocations.map((allocation) => {
          const instruction = allocation.paymentInstructionId ? instructionsById.get(allocation.paymentInstructionId) : undefined;
          return instruction?.id ?? "";
        })
      )
    );
    return {
      paymentId: payment.id,
      paymentDate: payment.paymentDate,
      payerName: partiesById.get(payment.payerPartyId)?.displayName ?? payment.payerPartyId,
      recipientName: partiesById.get(payment.recipientPartyId)?.displayName ?? payment.recipientPartyId,
      amount: payment.amount,
      method: formatPaymentMethodLabel(payment.paymentMethod),
      verificationState: formatPaymentVerificationStatusLabel(payment.verificationStatus),
      lifecycleState: formatPaymentLifecycleLabel(payment.lifecycleStatus),
      trackingReference: payment.trackingReference ?? "",
      allocatedAmount: progress.allocatedAmount,
      unallocatedAmount: progress.remainingAmount,
      invoiceReferences: invoiceReferences.join("، "),
      instructionReferences: instructionReferences.join("، ")
    } satisfies PaymentReportRow;
  });
}

function buildReconciliationRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
}): ReconciliationReportRow[] {
  const invoiceById = new Map(args.invoices.map((invoice) => [invoice.id, invoice] as const));
  const paymentById = new Map(args.payments.map((payment) => [payment.id, payment] as const));
  const instructionById = new Map(args.instructions.map((instruction) => [instruction.id, instruction] as const));
  const accountById = new Map(args.destinationAccounts.map((account) => [account.id, account] as const));
  const rows = deriveSettlementReviewItems(args)
    .map((item) => ({
      issueId: item.id,
      severity: item.severity,
      mismatchType: item.mismatchType,
      explanation: item.explanation,
      person: item.relatedPartyName ?? item.relatedPartyId ?? "—",
      reference: item.invoiceReference ?? item.paymentTrackingReference ?? item.instructionLabel ?? item.destinationAccountLabel ?? "—",
      relevantDate:
        (item.paymentId ? paymentById.get(item.paymentId)?.paymentDate : undefined) ??
        (item.invoiceId ? invoiceById.get(item.invoiceId)?.invoiceDate : undefined) ??
        (item.instructionId ? invoiceById.get(instructionById.get(item.instructionId)?.invoiceId ?? "")?.invoiceDate : undefined) ??
        (item.destinationAccountId ? toRowDate(accountById.get(item.destinationAccountId)?.updatedAt ?? "") : "") ??
        ""
    }))
    .filter((row) => row.reference !== "—" || row.relevantDate !== "");

  return rows as ReconciliationReportRow[];
}

function buildPartyStatement(args: {
  party: Party;
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
}): PartyStatementReport | null {
  const invoiceRows: PartyStatementInvoiceRow[] = [];
  const paymentRows: PartyStatementPaymentRow[] = [];
  const instructionRows: PartyStatementInstructionRow[] = [];
  const accountsById = new Map(args.destinationAccounts.map((account) => [account.id, account] as const));

  let customerSection: PartyStatementReport["customerSection"];
  if (args.party.roles.includes("customer")) {
    const summary = summarizeCustomerSettlement(args.party.id, args.invoices, args.instructions, args.payments, args.allocations, [args.party]);
    const relatedInvoices = args.invoices.filter((invoice) => invoice.customerPartyId === args.party.id && invoice.lifecycleStatus === "active");

    for (const invoice of relatedInvoices) {
      const invoiceSummary = summarizeInvoiceBalance(
        invoice,
        args.instructions.filter((instruction) => instruction.invoiceId === invoice.id),
        args.payments,
        args.allocations
      );
      invoiceRows.push({
        invoiceReference: invoice.referenceNumber ?? invoice.id,
        invoiceDate: invoice.invoiceDate,
        totalAmount: invoice.totalAmount,
        confirmedAllocated: invoiceSummary.confirmedAllocatedAmount,
        reportedUnconfirmed: invoiceSummary.reportedAllocatedAmount,
        confirmedOutstanding: invoiceSummary.confirmedOutstandingAmount,
        provisionalOutstanding: invoiceSummary.provisionalOutstandingAmount,
        activeInstructedAmount: invoiceSummary.activeInstructedTotal,
        unassignedAmount: invoiceSummary.unassignedInvoiceAmount,
        settlementState: invoiceSummary.derivedSettlementLabel,
        lifecycleState: invoice.lifecycleStatus
      });
    }

    for (const payment of args.payments.filter((payment) => payment.payerPartyId === args.party.id)) {
      const paymentAllocations = args.allocations.filter((allocation) => allocation.paymentId === payment.id);
      const progress = summarizePaymentAllocationProgress(payment, paymentAllocations);
      paymentRows.push({
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        verificationState: formatPaymentVerificationStatusLabel(payment.verificationStatus),
        lifecycleState: formatPaymentLifecycleLabel(payment.lifecycleStatus),
        trackingReference: payment.trackingReference ?? "",
        allocatedAmount: progress.allocatedAmount,
        unallocatedAmount: progress.remainingAmount,
        invoiceReferences: Array.from(
          new Set(
            paymentAllocations.map((allocation) =>
              args.invoices.find((invoice) => invoice.id === allocation.invoiceId)?.referenceNumber ?? allocation.invoiceId
            )
          )
        ).join("، "),
        instructionReferences: Array.from(
          new Set(
            paymentAllocations.map((allocation) => {
              const instruction = allocation.paymentInstructionId
                ? args.instructions.find((entry) => entry.id === allocation.paymentInstructionId)
                : undefined;
              return instruction?.id ?? "";
            })
          )
        ).join("، ")
      });
    }

    customerSection = {
      title: "خلاصه حساب مشتری",
      summary: `کل فاکتور ${formatInvoiceAmount(summary.totalInvoiced)} · مانده قطعی ${formatInvoiceAmount(summary.confirmedOutstanding)} · مانده پیش‌بینی ${formatInvoiceAmount(summary.provisionalOutstanding)}`,
      invoiceRows,
      paymentRows
    };
  }

  let recipientSection: PartyStatementReport["recipientSection"];
  if (args.party.roles.includes("farmer") || args.party.roles.includes("broker") || args.party.roles.includes("destination_account_owner")) {
    const summary = summarizeRecipientSettlement(args.party.id, args.instructions, args.payments, args.allocations, [args.party]);
    for (const instruction of args.instructions.filter((instruction) => instruction.recipientPartyId === args.party.id)) {
      const instructionSummary = summarizeInstructionBalance(instruction, args.payments, args.allocations);
      const invoice = args.invoices.find((entry) => entry.id === instruction.invoiceId);
      instructionRows.push({
        invoiceId: instruction.invoiceId,
        invoiceReference: invoice?.referenceNumber ?? invoice?.id ?? instruction.invoiceId,
        recipientName: args.party.displayName,
        destinationAccountLabel: instruction.destinationAccountId
          ? accountsById.get(instruction.destinationAccountId)?.accountLabel ?? "حساب تعیین نشده"
          : "حساب تعیین نشده",
        instructedAmount: instruction.instructedAmount,
        confirmedReceived: instructionSummary.confirmedReceived,
        reportedUnconfirmed: instructionSummary.reportedButUnconfirmedAmount,
        confirmedRemaining: instructionSummary.confirmedRemainingAmount,
        provisionalRemaining: instructionSummary.provisionalRemainingAmount,
        overpaymentAmount: instructionSummary.overpaymentAmount,
        lifecycleState: instruction.lifecycleStatus
      });
    }

    recipientSection = {
      title: "خلاصه حساب گیرنده",
      summary: `کل دستور ${formatInvoiceAmount(summary.totalInstructed)} · مانده قطعی ${formatInvoiceAmount(summary.confirmedRemaining)} · مانده پیش‌بینی ${formatInvoiceAmount(summary.provisionalRemaining)}`,
      instructionRows
    };
  }

  if (!customerSection && !recipientSection) {
    return null;
  }

  return {
    partyId: args.party.id,
    partyName: args.party.displayName,
    roles: args.party.roles.map((role) => partyRoleLabels[role]),
    ...(customerSection ? { customerSection } : {}),
    ...(recipientSection ? { recipientSection } : {})
  };
}

export function buildDemoOperationalReportWorkbookData(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  generatedAt: string;
  applicationVersion?: string;
  statementPartyId?: string;
}): OperationalReportWorkbookData {
  const metadata = {
    generatedAt: args.generatedAt,
    ...(args.applicationVersion ? { applicationVersion: args.applicationVersion } : {}),
    filterSummary: "همه رکوردهای نمایشی"
  };
  const party = args.statementPartyId ? args.parties.find((entry) => entry.id === args.statementPartyId) : undefined;

  return {
    metadata,
    customerSummaries: buildCustomerSummaryRows(args),
    recipientSummaries: buildRecipientSummaryRows(args),
    invoices: buildInvoiceRows(args),
    paymentInstructions: buildInstructionRows(args),
    payments: buildPaymentRows(args),
    reconciliationItems: buildReconciliationRows(args),
    partyStatement: party
      ? buildPartyStatement({
          party,
          invoices: args.invoices,
          instructions: args.instructions,
          payments: args.payments,
          allocations: args.allocations,
          destinationAccounts: args.destinationAccounts
        }) ?? undefined
      : undefined
  };
}

export async function buildDemoWorkbook(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  generatedAt: string;
  applicationVersion?: string;
  statementPartyId?: string;
}) {
  return buildOperationalReportWorkbook(buildDemoOperationalReportWorkbookData(args));
}
