import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DestinationAccount, Invoice, Payment, PaymentAllocation, PaymentInstruction, Party } from "../../domain";
import { formatInvoiceAmount, formatInvoiceDate } from "../../domain/invoices";
import { normalizePartyText, partyRoleLabels } from "../../domain/parties";
import {
  deriveSettlementReviewItems,
  summarizeCustomerSettlement,
  summarizeInstructionBalance,
  summarizeInvoiceBalance,
  summarizeRecipientSettlement
} from "../../domain/settlement";
import { summarizePaymentAllocationProgress, formatPaymentLifecycleLabel, formatPaymentMethodLabel, formatPaymentVerificationStatusLabel, filterPayments } from "../../domain/payments";
import { filterInvoices, formatInvoiceTimestamp } from "../../domain/invoices";
import { filterPaymentInstructions } from "../../domain/payment-instructions";
import { db } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository, type DestinationAccountRepository } from "../../services/destination-account-repository";
import { createInvoiceRepository, type InvoiceRepository } from "../../services/invoice-repository";
import { createPartyRepository, type PartyRepository } from "../../services/party-repository";
import { createPaymentInstructionRepository, type PaymentInstructionRepository } from "../../services/payment-instruction-repository";
import { createPaymentRepository, type PaymentRepository } from "../../services/payment-repository";
import {
  buildOperationalReportWorkbook,
  createPartyStatementFileName,
  createReportFileName,
  customerSummaryColumns,
  invoiceColumns,
  paymentColumns,
  paymentInstructionColumns,
  partyStatementInstructionColumns,
  partyStatementInvoiceColumns,
  partyStatementPaymentColumns,
  recipientSummaryColumns,
  reconciliationColumns,
  serializeRowsToCsv,
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
} from "../../services/report-export";
import packageJson from "../../../package.json";

type ReportTab = "customer-summary" | "recipient-summary" | "invoices" | "payment-instructions" | "payments" | "reconciliation" | "party-statement";
type LifecycleFilter = "all" | "active" | "cancelled";
type PaymentLifecycleFilter = "all" | "active" | "cancelled" | "reversed";
type SettlementFilter = "all" | "unpaid" | "partially_paid" | "provisionally_paid" | "fully_settled" | "overpaid" | "needs_review";
type ReconciliationSeverityFilter = "all" | "high" | "medium" | "low";
type ReconciliationTypeFilter = "all" | "unallocated_payment" | "disputed_payment" | "duplicate_tracking_reference" | "probable_duplicate_payment" | "instruction_overpayment" | "invoice_overpayment" | "cancelled_instruction_allocation" | "recipient_mismatch" | "destination_account_owner_mismatch" | "active_instruction_without_destination_account" | "reported_payment_awaiting_confirmation";
type AllocationStateFilter = "all" | "allocated" | "unallocated";

type ReportFilters = {
  dateFrom: string;
  dateTo: string;
  customerQuery: string;
  customerLifecycle: LifecycleFilter;
  recipientQuery: string;
  recipientLifecycle: LifecycleFilter;
  invoiceCustomerId: string;
  invoiceQuery: string;
  invoiceLifecycle: LifecycleFilter;
  invoiceSettlement: SettlementFilter;
  instructionRecipientId: string;
  instructionQuery: string;
  instructionLifecycle: LifecycleFilter;
  paymentPayerId: string;
  paymentRecipientId: string;
  paymentQuery: string;
  paymentLifecycle: PaymentLifecycleFilter;
  paymentVerificationStatus: "all" | "reported" | "confirmed" | "rejected" | "disputed";
  paymentMethod: "all" | Payment["paymentMethod"];
  paymentAllocationState: AllocationStateFilter;
  reconciliationSeverity: ReconciliationSeverityFilter;
  reconciliationType: ReconciliationTypeFilter;
  reconciliationQuery: string;
  statementPartyId: string;
};

function openReportRecord(section: "parties" | "payments", recordId: string): void {
  window.dispatchEvent(new CustomEvent("tasviehyar-open-record", { detail: { section, recordId } }));
}

function MobileReportCard({
  title,
  status,
  emphasis,
  children,
  action
}: {
  title: string;
  status?: string;
  emphasis?: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <article className="mobile-report-card">
      <div className="mobile-report-card-header">
        <strong>{title}</strong>
        {status ? <span className="status-pill status-active">{status}</span> : null}
      </div>
      {emphasis ? <p className="mobile-report-emphasis">{emphasis}</p> : null}
      <div className="mobile-report-details">{children}</div>
      {action ? <button type="button" className="tertiary-button" onClick={action.onClick}>{action.label}</button> : null}
    </article>
  );
}

const defaultFilters: ReportFilters = {
  dateFrom: "",
  dateTo: "",
  customerQuery: "",
  customerLifecycle: "all",
  recipientQuery: "",
  recipientLifecycle: "all",
  invoiceCustomerId: "",
  invoiceQuery: "",
  invoiceLifecycle: "all",
  invoiceSettlement: "all",
  instructionRecipientId: "",
  instructionQuery: "",
  instructionLifecycle: "all",
  paymentPayerId: "",
  paymentRecipientId: "",
  paymentQuery: "",
  paymentLifecycle: "all",
  paymentVerificationStatus: "all",
  paymentMethod: "all",
  paymentAllocationState: "all",
  reconciliationSeverity: "all",
  reconciliationType: "all",
  reconciliationQuery: "",
  statementPartyId: ""
};

const reportTabs: Array<{ id: ReportTab; label: string; description: string }> = [
  { id: "customer-summary", label: "خلاصه مشتریان", description: "فاکتور و مانده" },
  { id: "recipient-summary", label: "خلاصه گیرندگان", description: "دستور و دریافت" },
  { id: "invoices", label: "فاکتورها", description: "وضعیت تسویه" },
  { id: "payment-instructions", label: "دستورهای پرداخت", description: "دستور و مانده" },
  { id: "payments", label: "پرداخت‌ها", description: "تأیید و تخصیص" },
  { id: "reconciliation", label: "مغایرت‌ها", description: "موارد نیازمند بررسی" },
  { id: "party-statement", label: "گردش یک شخص", description: "خلاصه حساب" }
];

const defaultPartyRepository = createPartyRepository(db);
const defaultInvoiceRepository = createInvoiceRepository(db);
const defaultPaymentRepository = createPaymentRepository(db);
const defaultPaymentInstructionRepository = createPaymentInstructionRepository(db);
const defaultDestinationAccountRepository = createDestinationAccountRepository(db);

function normalizeQuery(value: string): string {
  return normalizePartyText(value);
}

function matchesQuery(target: string, query: string): boolean {
  if (!query) {
    return true;
  }

  return normalizeQuery(target).includes(normalizeQuery(query));
}

function matchesDateRange(date: string, from: string, to: string): boolean {
  if (from && date < from) {
    return false;
  }

  if (to && date > to) {
    return false;
  }

  return true;
}

function toRowDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function formatMoney(value: number): number {
  return value;
}

function partyName(party: Party | undefined, fallback: string): string {
  return party?.displayName ?? fallback;
}

function partySearchTarget(party: Party): string {
  return [
    party.displayName,
    party.aliases.join(" "),
    party.searchableDescription ?? "",
    party.phoneNumber ?? "",
    party.notes ?? ""
  ].join(" ");
}

function formatPartyDisplayName(party: Party): string {
  return party.active ? party.displayName : `${party.displayName} (بایگانی)`;
}

function settlementLabelText(label: InvoiceReportRow["settlementState"] | RecipientSummaryReportRow["settlementState"]): string {
  switch (label) {
    case "unpaid":
      return "پرداخت نشده";
    case "partially_paid":
      return "پرداخت جزئی";
    case "provisionally_paid":
      return "پرداخت پیش‌بینی‌شده";
    case "fully_settled":
      return "تسویه‌شده";
    case "overpaid":
      return "بیش‌پرداخت";
    case "needs_review":
      return "نیازمند بررسی";
    default:
      return label;
  }
}

function partyRoleText(roles: readonly Party["roles"][number][]): string {
  return roles.map((role) => partyRoleLabels[role]).join("، ");
}

function buildCustomerSummaryRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "customerQuery" | "customerLifecycle">;
}): CustomerSummaryReportRow[] {
  const { parties, invoices, instructions, payments, allocations, filters } = args;
  return parties
    .filter((party) => party.roles.includes("customer"))
    .filter((party) => matchesQuery(partySearchTarget(party), filters.customerQuery))
    .flatMap((party) => {
      const partyInvoices = invoices.filter(
        (invoice) =>
          invoice.customerPartyId === party.id &&
          (filters.customerLifecycle === "all" || invoice.lifecycleStatus === filters.customerLifecycle) &&
          matchesDateRange(invoice.invoiceDate, filters.dateFrom, filters.dateTo)
      );
      if (partyInvoices.length === 0) {
        return [];
      }

      const summaries = partyInvoices.map((invoice) =>
        summarizeInvoiceBalance(
          invoice,
          instructions.filter((instruction) => instruction.invoiceId === invoice.id),
          payments,
          allocations
        )
      );

      const row = {
        partyId: party.id,
        customerName: formatPartyDisplayName(party),
        totalInvoiced: formatMoney(partyInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)),
        confirmedAllocated: formatMoney(summaries.reduce((sum, summary) => sum + summary.confirmedAllocatedAmount, 0)),
        reportedUnconfirmed: formatMoney(summaries.reduce((sum, summary) => sum + summary.reportedAllocatedAmount, 0)),
        confirmedOutstanding: formatMoney(summaries.reduce((sum, summary) => sum + summary.confirmedOutstandingAmount, 0)),
        provisionalOutstanding: formatMoney(summaries.reduce((sum, summary) => sum + summary.provisionalOutstandingAmount, 0)),
        openInvoiceCount: partyInvoices.filter((invoice) => invoice.lifecycleStatus === "active").length,
        cancelledInvoiceCount: partyInvoices.filter((invoice) => invoice.lifecycleStatus === "cancelled").length,
        invoiceCount: partyInvoices.length,
        settlementState: settlementLabelText(
          partyInvoices.reduce((state, invoice) => {
            const summary = summarizeInvoiceBalance(
              invoice,
              instructions.filter((instruction) => instruction.invoiceId === invoice.id),
              payments,
              allocations
            );
            if (summary.derivedSettlementLabel === "overpaid") {
              return "overpaid";
            }
            if (summary.derivedSettlementLabel === "needs_review") {
              return "needs_review";
            }
            if (summary.derivedSettlementLabel === "fully_settled") {
              return "fully_settled";
            }
            if (summary.derivedSettlementLabel === "provisionally_paid") {
              return "provisionally_paid";
            }
            if (state === "all") {
              return summary.derivedSettlementLabel;
            }
            return state;
          }, "unpaid" as InvoiceReportRow["settlementState"])
        )
      } satisfies CustomerSummaryReportRow;
      return [row];
    })
    .sort((left, right) => {
      if (right.confirmedOutstanding !== left.confirmedOutstanding) {
        return right.confirmedOutstanding - left.confirmedOutstanding;
      }

      return left.customerName.localeCompare(right.customerName, "fa");
    });
}

function buildRecipientSummaryRows(args: {
  parties: readonly Party[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "recipientQuery" | "recipientLifecycle">;
}): RecipientSummaryReportRow[] {
  const { parties, instructions, payments, allocations, filters } = args;
  return parties
    .filter((party) => matchesQuery(partySearchTarget(party), filters.recipientQuery))
    .flatMap((party) => {
      const partyInstructions = instructions.filter(
        (instruction) =>
          instruction.recipientPartyId === party.id &&
          (filters.recipientLifecycle === "all" || instruction.lifecycleStatus === filters.recipientLifecycle) &&
          matchesDateRange(toRowDate(instruction.createdAt), filters.dateFrom, filters.dateTo)
      );
      if (partyInstructions.length === 0) {
        return [];
      }

      const summaries = partyInstructions.map((instruction) => summarizeInstructionBalance(instruction, payments, allocations));

      const row = {
        partyId: party.id,
        recipientName: formatPartyDisplayName(party),
        totalInstructed: formatMoney(partyInstructions.reduce((sum, instruction) => sum + instruction.instructedAmount, 0)),
        confirmedReceived: formatMoney(summaries.reduce((sum, summary) => sum + summary.confirmedReceived, 0)),
        reportedUnconfirmed: formatMoney(summaries.reduce((sum, summary) => sum + summary.reportedButUnconfirmedAmount, 0)),
        confirmedRemaining: formatMoney(summaries.reduce((sum, summary) => sum + summary.confirmedRemainingAmount, 0)),
        provisionalRemaining: formatMoney(summaries.reduce((sum, summary) => sum + summary.provisionalRemainingAmount, 0)),
        overpaymentAmount: formatMoney(summaries.reduce((sum, summary) => sum + summary.overpaymentAmount, 0)),
        activeInstructionCount: partyInstructions.filter((instruction) => instruction.lifecycleStatus === "active").length,
        instructionCount: partyInstructions.length,
        settlementState: settlementLabelText(
          partyInstructions.reduce((state, instruction) => {
            const summary = summarizeInstructionBalance(instruction, payments, allocations);
            if (summary.derivedInstructionLabel === "overpaid") {
              return "overpaid";
            }
            if (summary.derivedInstructionLabel === "fully_settled") {
              return "fully_settled";
            }
            if (summary.derivedInstructionLabel === "provisionally_paid") {
              return "provisionally_paid";
            }
            if (state === "all") {
              return summary.derivedInstructionLabel;
            }
            return state;
          }, "unpaid" as RecipientSummaryReportRow["settlementState"])
        )
      } satisfies RecipientSummaryReportRow;
      return [row];
    })
    .sort((left, right) => {
      if (right.provisionalRemaining !== left.provisionalRemaining) {
        return right.provisionalRemaining - left.provisionalRemaining;
      }

      return left.recipientName.localeCompare(right.recipientName, "fa");
    });
}

function buildInvoiceReportRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "invoiceCustomerId" | "invoiceQuery" | "invoiceLifecycle" | "invoiceSettlement">;
}): InvoiceReportRow[] {
  const { parties, invoices, instructions, payments, allocations, filters } = args;
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  return filterInvoices(invoices, parties, { query: filters.invoiceQuery, status: filters.invoiceLifecycle })
    .filter((invoice) => !filters.invoiceCustomerId || invoice.customerPartyId === filters.invoiceCustomerId)
    .filter((invoice) => matchesDateRange(invoice.invoiceDate, filters.dateFrom, filters.dateTo))
    .flatMap((invoice) => {
      const summary = summarizeInvoiceBalance(
        invoice,
        instructions.filter((instruction) => instruction.invoiceId === invoice.id),
        payments,
        allocations
      );
      if (filters.invoiceSettlement !== "all" && summary.derivedSettlementLabel !== filters.invoiceSettlement) {
        return [];
      }

      const row = {
        invoiceId: invoice.id,
        invoiceReference: invoice.referenceNumber ?? invoice.id,
        customerName: partyName(partiesById.get(invoice.customerPartyId), invoice.customerPartyId),
        invoiceDate: invoice.invoiceDate,
        totalAmount: formatMoney(invoice.totalAmount),
        confirmedPayment: formatMoney(summary.confirmedAllocatedAmount),
        reportedPayment: formatMoney(summary.reportedAllocatedAmount),
        confirmedOutstanding: formatMoney(summary.confirmedOutstandingAmount),
        provisionalOutstanding: formatMoney(summary.provisionalOutstandingAmount),
        activeInstructedAmount: formatMoney(summary.activeInstructedTotal),
        unassignedAmount: formatMoney(summary.unassignedInvoiceAmount),
        settlementState: summary.derivedSettlementLabel,
        lifecycleState: invoice.lifecycleStatus
      } satisfies InvoiceReportRow;
      return [row];
    })
    .sort((left, right) => {
      if (left.invoiceDate !== right.invoiceDate) {
        return left.invoiceDate > right.invoiceDate ? -1 : 1;
      }

      return right.invoiceId.localeCompare(left.invoiceId, "fa");
    });
}

function buildInstructionReportRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "instructionRecipientId" | "instructionQuery" | "instructionLifecycle">;
}): PaymentInstructionReportRow[] {
  const { parties, invoices, instructions, payments, allocations, destinationAccounts, filters } = args;
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice] as const));
  return filterPaymentInstructions(instructions, parties, destinationAccounts, { query: filters.instructionQuery, status: filters.instructionLifecycle })
    .filter((instruction) => !filters.instructionRecipientId || instruction.recipientPartyId === filters.instructionRecipientId)
    .filter((instruction) => {
      const invoice = invoicesById.get(instruction.invoiceId);
      return matchesDateRange(invoice?.invoiceDate ?? toRowDate(instruction.createdAt), filters.dateFrom, filters.dateTo);
    })
    .flatMap((instruction) => {
      const summary = summarizeInstructionBalance(instruction, payments, allocations);
      const invoice = invoicesById.get(instruction.invoiceId);
      const row = {
        instructionId: instruction.id,
        invoiceId: instruction.invoiceId,
        invoiceReference: invoice?.referenceNumber ?? invoice?.id ?? instruction.invoiceId,
        customerName: partyName(invoice ? partiesById.get(invoice.customerPartyId) : undefined, invoice?.customerPartyId ?? instruction.invoiceId),
        recipientName: partyName(partiesById.get(instruction.recipientPartyId), instruction.recipientPartyId),
        destinationAccountLabel: instruction.destinationAccountId ? destinationAccounts.find((account) => account.id === instruction.destinationAccountId)?.accountLabel ?? "حساب تعیین نشده" : "حساب تعیین نشده",
        instructedAmount: formatMoney(instruction.instructedAmount),
        confirmedReceived: formatMoney(summary.confirmedReceived),
        reportedUnconfirmed: formatMoney(summary.reportedButUnconfirmedAmount),
        confirmedRemaining: formatMoney(summary.confirmedRemainingAmount),
        provisionalRemaining: formatMoney(summary.provisionalRemainingAmount),
        overpaymentAmount: formatMoney(summary.overpaymentAmount),
        lifecycleState: instruction.lifecycleStatus
      } satisfies PaymentInstructionReportRow;
      return [row];
    })
    .sort((left, right) => {
      if (left.invoiceReference !== right.invoiceReference) {
        return left.invoiceReference.localeCompare(right.invoiceReference, "fa");
      }

      return right.instructionId.localeCompare(left.instructionId, "fa");
    });
}

function buildPaymentReportRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  filters: Pick<
    ReportFilters,
    | "dateFrom"
    | "dateTo"
    | "paymentPayerId"
    | "paymentRecipientId"
    | "paymentQuery"
    | "paymentLifecycle"
    | "paymentVerificationStatus"
    | "paymentMethod"
    | "paymentAllocationState"
  >;
}): PaymentReportRow[] {
  const { parties, invoices, instructions, payments, allocations, destinationAccounts, filters } = args;
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice] as const));
  const instructionsById = new Map(instructions.map((instruction) => [instruction.id, instruction] as const));
  const allocationsByPayment = new Map<string, PaymentAllocation[]>();
  for (const allocation of allocations) {
    const existing = allocationsByPayment.get(allocation.paymentId) ?? [];
    existing.push(allocation);
    allocationsByPayment.set(allocation.paymentId, existing);
  }

  return filterPayments(payments, parties, destinationAccounts, invoices, instructions, allocations, {
    query: filters.paymentQuery,
    lifecycleStatus: filters.paymentLifecycle,
    verificationStatus: filters.paymentVerificationStatus
  })
    .filter((payment) => !filters.paymentPayerId || payment.payerPartyId === filters.paymentPayerId)
    .filter((payment) => !filters.paymentRecipientId || payment.recipientPartyId === filters.paymentRecipientId)
    .filter((payment) => !filters.paymentMethod || filters.paymentMethod === "all" || payment.paymentMethod === filters.paymentMethod)
    .filter((payment) => matchesDateRange(payment.paymentDate, filters.dateFrom, filters.dateTo))
    .flatMap((payment) => {
      const progress = summarizePaymentAllocationProgress(payment, allocationsByPayment.get(payment.id) ?? []);
      if (filters.paymentAllocationState === "allocated" && progress.isUnallocated) {
        return [];
      }
      if (filters.paymentAllocationState === "unallocated" && !progress.isUnallocated) {
        return [];
      }

      const paymentAllocations = allocationsByPayment.get(payment.id) ?? [];
      const invoiceReferences = Array.from(
        new Set(paymentAllocations.map((allocation) => invoicesById.get(allocation.invoiceId)?.referenceNumber ?? allocation.invoiceId))
      ).join("، ");
      const instructionReferences = Array.from(
        new Set(
          paymentAllocations.map((allocation) => {
            const instruction = allocation.paymentInstructionId ? instructionsById.get(allocation.paymentInstructionId) : undefined;
            return instruction ? instruction.id : allocation.paymentInstructionId ?? "";
          })
        )
      ).join("، ");

      const row = {
        paymentId: payment.id,
        paymentDate: payment.paymentDate,
        payerName: partyName(partiesById.get(payment.payerPartyId), payment.payerPartyId),
        recipientName: partyName(partiesById.get(payment.recipientPartyId), payment.recipientPartyId),
        amount: formatMoney(payment.amount),
        method: formatPaymentMethodLabel(payment.paymentMethod),
        verificationState: formatPaymentVerificationStatusLabel(payment.verificationStatus),
        lifecycleState: formatPaymentLifecycleLabel(payment.lifecycleStatus),
        trackingReference: payment.trackingReference ?? "",
        allocatedAmount: formatMoney(progress.allocatedAmount),
        unallocatedAmount: formatMoney(progress.remainingAmount),
        invoiceReferences,
        instructionReferences
      } satisfies PaymentReportRow;
      return [row];
    })
    .sort((left, right) => {
      if (left.paymentDate !== right.paymentDate) {
        return left.paymentDate > right.paymentDate ? -1 : 1;
      }

      return right.paymentId.localeCompare(left.paymentId, "fa");
    });
}

function buildReconciliationReportRows(args: {
  parties: readonly Party[];
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo" | "reconciliationSeverity" | "reconciliationType" | "reconciliationQuery">;
}): ReconciliationReportRow[] {
  const { parties, invoices, instructions, payments, allocations, destinationAccounts, filters } = args;
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice] as const));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment] as const));
  const instructionById = new Map(instructions.map((instruction) => [instruction.id, instruction] as const));
  const accountById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  return deriveSettlementReviewItems({ parties, invoices, instructions, payments, allocations, destinationAccounts })
    .filter((item) => filters.reconciliationSeverity === "all" || item.severity === filters.reconciliationSeverity)
    .filter((item) => filters.reconciliationType === "all" || item.mismatchType === filters.reconciliationType)
    .filter((item) => {
      const relevantDate =
        (item.paymentId ? paymentById.get(item.paymentId)?.paymentDate : undefined) ??
        (item.invoiceId ? invoiceById.get(item.invoiceId)?.invoiceDate : undefined) ??
        (item.instructionId ? invoiceById.get(instructionById.get(item.instructionId)?.invoiceId ?? "")?.invoiceDate : undefined) ??
        "";
      return !relevantDate || matchesDateRange(relevantDate, filters.dateFrom, filters.dateTo);
    })
    .filter((item) => matchesQuery([item.title, item.explanation, item.searchText, item.relatedPartyName ?? ""].join(" "), filters.reconciliationQuery))
    .flatMap((item) => {
      const row = {
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
      } satisfies ReconciliationReportRow;
      return [row];
    })
    .sort((left, right) => {
      const severityOrder = { high: 0, medium: 1, low: 2 } as const;
      if (severityOrder[left.severity as "high" | "medium" | "low"] !== severityOrder[right.severity as "high" | "medium" | "low"]) {
        return severityOrder[left.severity as "high" | "medium" | "low"] - severityOrder[right.severity as "high" | "medium" | "low"];
      }

      return left.issueId.localeCompare(right.issueId, "fa");
    });
}

function buildPartyStatement(args: {
  party: Party;
  invoices: readonly Invoice[];
  instructions: readonly PaymentInstruction[];
  payments: readonly Payment[];
  allocations: readonly PaymentAllocation[];
  destinationAccounts: readonly DestinationAccount[];
  filters: Pick<ReportFilters, "dateFrom" | "dateTo">;
}): PartyStatementReport | null {
  const { party, invoices, instructions, payments, allocations, destinationAccounts, filters } = args;
  const invoiceRows: PartyStatementInvoiceRow[] = [];
  const paymentRows: PartyStatementPaymentRow[] = [];
  const instructionRows: PartyStatementInstructionRow[] = [];
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const partiesRoleLabels = party.roles.map((role) => partyRoleLabels[role]);

  let customerSection: PartyStatementReport["customerSection"];
  if (party.roles.includes("customer")) {
    const summary = summarizeCustomerSettlement(party.id, invoices, instructions, payments, allocations, [party]);
    const relatedInvoices = invoices
      .filter((invoice) => invoice.customerPartyId === party.id)
      .filter((invoice) => matchesDateRange(invoice.invoiceDate, filters.dateFrom, filters.dateTo));

    for (const invoice of relatedInvoices) {
      const invoiceSummary = summarizeInvoiceBalance(
        invoice,
        instructions.filter((instruction) => instruction.invoiceId === invoice.id),
        payments,
        allocations
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

    for (const payment of payments.filter((payment) => payment.payerPartyId === party.id && matchesDateRange(payment.paymentDate, filters.dateFrom, filters.dateTo))) {
      const paymentAllocations = allocations.filter((allocation) => allocation.paymentId === payment.id);
      const progress = summarizePaymentAllocationProgress(payment, paymentAllocations);
      paymentRows.push({
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        verificationState: formatPaymentVerificationStatusLabel(payment.verificationStatus),
        lifecycleState: formatPaymentLifecycleLabel(payment.lifecycleStatus),
        trackingReference: payment.trackingReference ?? "",
        allocatedAmount: progress.allocatedAmount,
        unallocatedAmount: progress.remainingAmount,
        invoiceReferences: Array.from(new Set(paymentAllocations.map((allocation) => invoices.find((invoice) => invoice.id === allocation.invoiceId)?.referenceNumber ?? allocation.invoiceId))).join("، "),
        instructionReferences: Array.from(
          new Set(
            paymentAllocations.map((allocation) => {
              const instruction = allocation.paymentInstructionId ? instructions.find((entry) => entry.id === allocation.paymentInstructionId) : undefined;
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
  const recipientSummary = summarizeRecipientSettlement(party.id, instructions, payments, allocations, [party]);
  const relatedInstructions = instructions.filter((instruction) => instruction.recipientPartyId === party.id).filter((instruction) => matchesDateRange(invoices.find((invoice) => invoice.id === instruction.invoiceId)?.invoiceDate ?? toRowDate(instruction.createdAt), filters.dateFrom, filters.dateTo));

  for (const instruction of relatedInstructions) {
    const instructionSummary = summarizeInstructionBalance(instruction, payments, allocations);
    const invoice = invoices.find((entry) => entry.id === instruction.invoiceId);
    instructionRows.push({
      invoiceId: instruction.invoiceId,
      invoiceReference: invoice?.referenceNumber ?? invoice?.id ?? instruction.invoiceId,
      recipientName: party.displayName,
      destinationAccountLabel: instruction.destinationAccountId ? accountsById.get(instruction.destinationAccountId)?.accountLabel ?? "حساب تعیین نشده" : "حساب تعیین نشده",
      instructedAmount: instruction.instructedAmount,
      confirmedReceived: instructionSummary.confirmedReceived,
      reportedUnconfirmed: instructionSummary.reportedButUnconfirmedAmount,
      confirmedRemaining: instructionSummary.confirmedRemainingAmount,
      provisionalRemaining: instructionSummary.provisionalRemainingAmount,
      overpaymentAmount: instructionSummary.overpaymentAmount,
      lifecycleState: instruction.lifecycleStatus
    });
  }

  if (party.roles.length > 0 || instructionRows.length > 0) {
    recipientSection = {
      title: "خلاصه حساب گیرنده",
      summary: `کل دستور ${formatInvoiceAmount(recipientSummary.totalInstructed)} · مانده قطعی ${formatInvoiceAmount(recipientSummary.confirmedRemaining)} · مانده پیش‌بینی ${formatInvoiceAmount(recipientSummary.provisionalRemaining)}`,
      instructionRows
    };
  }

  if (!customerSection && !recipientSection) {
    return null;
  }

  return {
    partyId: party.id,
    partyName: party.displayName,
    roles: partiesRoleLabels,
    ...(customerSection ? { customerSection } : {}),
    ...(recipientSection ? { recipientSection } : {})
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportTitle(tab: ReportTab): string {
  return reportTabs.find((entry) => entry.id === tab)?.label ?? "گزارش";
}

export interface ReportsProps {
  partyRepository?: PartyRepository;
  invoiceRepository?: InvoiceRepository;
  paymentRepository?: PaymentRepository;
  paymentInstructionRepository?: PaymentInstructionRepository;
  destinationAccountRepository?: DestinationAccountRepository;
}

export function Reports({
  partyRepository = defaultPartyRepository,
  invoiceRepository = defaultInvoiceRepository,
  paymentRepository = defaultPaymentRepository,
  paymentInstructionRepository = defaultPaymentInstructionRepository,
  destinationAccountRepository = defaultDestinationAccountRepository
}: ReportsProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [destinationAccounts, setDestinationAccounts] = useState<DestinationAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ReportTab>("customer-summary");
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [partyRecords, invoiceRecords, paymentRecords, allocationRecords, instructionRecords, destinationAccountRecords] = await Promise.all([
      partyRepository.listParties(),
      invoiceRepository.listInvoices(),
      paymentRepository.listPayments(),
      paymentRepository.listAllocations(),
      paymentInstructionRepository.listInstructions(),
      destinationAccountRepository.listAccounts()
    ]);

    if (!isMountedRef.current) {
      return;
    }

    setParties(partyRecords);
    setInvoices(invoiceRecords);
    setPayments(paymentRecords);
    setAllocations(allocationRecords);
    setInstructions(instructionRecords);
    setDestinationAccounts(destinationAccountRecords);
    setLoading(false);
  }, [destinationAccountRepository, invoiceRepository, partyRepository, paymentInstructionRepository, paymentRepository]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function handleOpenRecord(event: Event) {
      const detail = (event as CustomEvent<{ section?: string; recordId?: string }>).detail;
      if (detail?.section === "reports") {
        setActiveTab("party-statement");
        setFilters((current) => ({ ...current, statementPartyId: detail.recordId ?? current.statementPartyId }));
        document.getElementById("reports")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }
    }

    window.addEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
    return () => window.removeEventListener("tasviehyar-open-record", handleOpenRecord as EventListener);
  }, []);

  useEffect(() => {
    function handleUpdate() {
      void loadData();
    }

    window.addEventListener("tasviehyar-data-updated", handleUpdate);
    return () => window.removeEventListener("tasviehyar-data-updated", handleUpdate);
  }, [loadData]);

  const customerSummaryRows = useMemo(
    () =>
      buildCustomerSummaryRows({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        filters
      }),
    [allocations, filters, invoices, instructions, parties, payments]
  );

  const recipientSummaryRows = useMemo(
    () =>
      buildRecipientSummaryRows({
        parties,
        instructions,
        payments,
        allocations,
        filters
      }),
    [allocations, filters, instructions, parties, payments]
  );

  const invoiceRows = useMemo(
    () =>
      buildInvoiceReportRows({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        filters
      }),
    [allocations, filters, invoices, instructions, parties, payments]
  );

  const instructionRows = useMemo(
    () =>
      buildInstructionReportRows({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        destinationAccounts,
        filters
      }),
    [allocations, destinationAccounts, filters, invoices, instructions, parties, payments]
  );

  const paymentRows = useMemo(
    () =>
      buildPaymentReportRows({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        destinationAccounts,
        filters
      }),
    [allocations, destinationAccounts, filters, invoices, instructions, parties, payments]
  );

  const reconciliationRows = useMemo(
    () =>
      buildReconciliationReportRows({
        parties,
        invoices,
        instructions,
        payments,
        allocations,
        destinationAccounts,
        filters
      }),
    [allocations, destinationAccounts, filters, invoices, instructions, parties, payments]
  );

  const selectedParty = useMemo(() => parties.find((party) => party.id === filters.statementPartyId) ?? null, [filters.statementPartyId, parties]);
  const partyStatement = useMemo(
    () =>
      selectedParty
        ? buildPartyStatement({
            party: selectedParty,
            invoices,
            instructions,
            payments,
            allocations,
            destinationAccounts,
            filters
          })
        : null,
    [allocations, destinationAccounts, filters, instructions, invoices, payments, selectedParty]
  );

  const workbookData = useMemo<OperationalReportWorkbookData>(
    () => ({
      metadata: {
        generatedAt: new Date().toISOString(),
        applicationVersion: packageJson.version,
        filterSummary: [
          `از تاریخ: ${filters.dateFrom || "همه"}`,
          `تا تاریخ: ${filters.dateTo || "همه"}`,
          `مشتری: ${filters.customerQuery || "همه"}`,
          `گیرنده: ${filters.recipientQuery || "همه"}`,
          `گزارش: ${reportTitle(activeTab)}`
        ].join(" · ")
      },
      customerSummaries: customerSummaryRows,
      recipientSummaries: recipientSummaryRows,
      invoices: invoiceRows,
      paymentInstructions: instructionRows,
      payments: paymentRows,
      reconciliationItems: reconciliationRows,
      partyStatement: partyStatement ?? undefined
    }),
    [activeTab, customerSummaryRows, filters.customerQuery, filters.dateFrom, filters.dateTo, filters.recipientQuery, invoiceRows, partyStatement, paymentRows, recipientSummaryRows, reconciliationRows, instructionRows]
  );

  async function handleExportExcel() {
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      const exportData: OperationalReportWorkbookData =
        activeTab === "party-statement" && partyStatement
          ? {
              metadata: workbookData.metadata,
              customerSummaries: [],
              recipientSummaries: [],
              invoices: [],
              paymentInstructions: [],
              payments: [],
              reconciliationItems: [],
              partyStatement
            }
          : workbookData;

      const workbook = await buildOperationalReportWorkbook(exportData);
      const buffer = await workbook.xlsx.writeBuffer();
      const filename =
        activeTab === "party-statement" && partyStatement
          ? createPartyStatementFileName(partyStatement.partyName, workbookData.metadata.generatedAt)
          : createReportFileName(workbookData.metadata.generatedAt);
      downloadBlob(new Blob([buffer]), filename);
      setNotice("فایل اکسل گزارش آماده شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "خروجی اکسل ناموفق بود.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      let csv = "";
      let filename = `${createReportFileName(workbookData.metadata.generatedAt).replace(/\.xlsx$/, "")}.csv`;

      if (activeTab === "customer-summary") {
        csv = serializeRowsToCsv(customerSummaryRows, customerSummaryColumns);
      } else if (activeTab === "recipient-summary") {
        csv = serializeRowsToCsv(recipientSummaryRows, recipientSummaryColumns);
      } else if (activeTab === "invoices") {
        csv = serializeRowsToCsv(invoiceRows, invoiceColumns);
      } else if (activeTab === "payment-instructions") {
        csv = serializeRowsToCsv(instructionRows, paymentInstructionColumns);
      } else if (activeTab === "payments") {
        csv = serializeRowsToCsv(paymentRows, paymentColumns);
      } else if (activeTab === "reconciliation") {
        csv = serializeRowsToCsv(reconciliationRows, reconciliationColumns);
      } else if (partyStatement?.customerSection?.invoiceRows?.length) {
        csv = serializeRowsToCsv(partyStatement.customerSection.invoiceRows, partyStatementInvoiceColumns);
        filename = `${createPartyStatementFileName(partyStatement.partyName, workbookData.metadata.generatedAt).replace(/\.xlsx$/, "")}.csv`;
      } else if (partyStatement?.customerSection?.paymentRows?.length) {
        csv = serializeRowsToCsv(partyStatement.customerSection.paymentRows, partyStatementPaymentColumns);
        filename = `${createPartyStatementFileName(partyStatement.partyName, workbookData.metadata.generatedAt).replace(/\.xlsx$/, "")}.csv`;
      } else if (partyStatement?.recipientSection?.instructionRows?.length) {
        csv = serializeRowsToCsv(partyStatement.recipientSection.instructionRows, partyStatementInstructionColumns);
        filename = `${createPartyStatementFileName(partyStatement.partyName, workbookData.metadata.generatedAt).replace(/\.xlsx$/, "")}.csv`;
      }

      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
      downloadBlob(blob, filename);
      setNotice("فایل CSV گزارش آماده شد.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "خروجی CSV ناموفق بود.");
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function openInvoiceRecord(invoiceId: string) {
    window.dispatchEvent(
      new CustomEvent("tasviehyar-open-record", {
        detail: { section: "invoices", recordId: invoiceId }
      })
    );
  }

  function renderCustomerSummary() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه مشتریان">
          <span>ردیف‌ها: {customerSummaryRows.length.toLocaleString("fa-IR")}</span>
          <span>مشتری با فاکتور: {customerSummaryRows.filter((row) => row.invoiceCount > 0).length.toLocaleString("fa-IR")}</span>
          <span>مانده قطعی: {formatInvoiceAmount(customerSummaryRows.reduce((sum, row) => sum + row.confirmedOutstanding, 0))}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>مشتری</th>
              <th>کل فاکتور</th>
              <th>تخصیص قطعی</th>
              <th>اعلام‌شده</th>
              <th>مانده قطعی</th>
              <th>مانده پیش‌بینی</th>
              <th>فاکتور باز</th>
              <th>لغوشده</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {customerSummaryRows.map((row) => (
              <tr key={row.partyId}>
                <td>{row.customerName}</td>
                <td>{formatInvoiceAmount(row.totalInvoiced)}</td>
                <td>{formatInvoiceAmount(row.confirmedAllocated)}</td>
                <td>{formatInvoiceAmount(row.reportedUnconfirmed)}</td>
                <td>{formatInvoiceAmount(row.confirmedOutstanding)}</td>
                <td>{formatInvoiceAmount(row.provisionalOutstanding)}</td>
                <td>{row.openInvoiceCount.toLocaleString("fa-IR")}</td>
                <td>{row.cancelledInvoiceCount.toLocaleString("fa-IR")}</td>
                <td>{settlementLabelText(row.settlementState)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mobile-report-cards" aria-label="خلاصه مشتریان برای گوشی">
          {customerSummaryRows.map((row) => (
            <MobileReportCard
              key={row.partyId}
              title={row.customerName}
              status={settlementLabelText(row.settlementState)}
              emphasis={`مانده قطعی: ${formatInvoiceAmount(row.confirmedOutstanding)}`}
              action={{ label: "مشاهده شخص", onClick: () => openReportRecord("parties", row.partyId) }}
            >
              <span>کل فاکتورها: {formatInvoiceAmount(row.totalInvoiced)}</span>
              <span>تخصیص قطعی: {formatInvoiceAmount(row.confirmedAllocated)}</span>
              <span>مانده پیش‌بینی: {formatInvoiceAmount(row.provisionalOutstanding)}</span>
              <span>فاکتور باز: {row.openInvoiceCount.toLocaleString("fa-IR")}</span>
            </MobileReportCard>
          ))}
        </div>
      </div>
    );
  }

  function renderRecipientSummary() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه گیرندگان">
          <span>ردیف‌ها: {recipientSummaryRows.length.toLocaleString("fa-IR")}</span>
          <span>مانده قطعی: {formatInvoiceAmount(recipientSummaryRows.reduce((sum, row) => sum + row.confirmedRemaining, 0))}</span>
          <span>بیش‌پرداخت: {formatInvoiceAmount(recipientSummaryRows.reduce((sum, row) => sum + row.overpaymentAmount, 0))}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>گیرنده</th>
              <th>کل دستور</th>
              <th>دریافت قطعی</th>
              <th>اعلام‌شده</th>
              <th>مانده قطعی</th>
              <th>مانده پیش‌بینی</th>
              <th>بیش‌پرداخت</th>
              <th>فعال</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {recipientSummaryRows.map((row) => (
              <tr key={row.partyId}>
                <td>{row.recipientName}</td>
                <td>{formatInvoiceAmount(row.totalInstructed)}</td>
                <td>{formatInvoiceAmount(row.confirmedReceived)}</td>
                <td>{formatInvoiceAmount(row.reportedUnconfirmed)}</td>
                <td>{formatInvoiceAmount(row.confirmedRemaining)}</td>
                <td>{formatInvoiceAmount(row.provisionalRemaining)}</td>
                <td>{formatInvoiceAmount(row.overpaymentAmount)}</td>
                <td>{row.activeInstructionCount.toLocaleString("fa-IR")}</td>
                <td>{settlementLabelText(row.settlementState)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mobile-report-cards" aria-label="پرداخت‌ها برای گوشی">
          {paymentRows.map((row) => (
            <MobileReportCard
              key={row.paymentId}
              title={`${row.payerName} ← ${row.recipientName}`}
              status={row.verificationState}
              emphasis={formatInvoiceAmount(row.amount)}
              action={{ label: "مشاهده پرداخت", onClick: () => openReportRecord("payments", row.paymentId) }}
            >
              <span>تاریخ: {formatInvoiceDate(row.paymentDate)}</span>
              <span>روش: {row.method}</span>
              <span>تخصیص: {formatInvoiceAmount(row.allocatedAmount)}</span>
              <span>بدون تخصیص: {formatInvoiceAmount(row.unallocatedAmount)}</span>
            </MobileReportCard>
          ))}
        </div>
      </div>
    );
  }

  function renderInvoiceReport() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه فاکتورها">
          <span>ردیف‌ها: {invoiceRows.length.toLocaleString("fa-IR")}</span>
          <span>مانده قطعی: {formatInvoiceAmount(invoiceRows.reduce((sum, row) => sum + row.confirmedOutstanding, 0))}</span>
          <span>بدون تخصیص: {formatInvoiceAmount(invoiceRows.reduce((sum, row) => sum + row.unassignedAmount, 0))}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>فاکتور</th>
              <th>مشتری</th>
              <th>تاریخ</th>
              <th>مبلغ کل</th>
              <th>قطعی</th>
              <th>اعلام‌شده</th>
              <th>مانده</th>
              <th>بدون تخصیص</th>
              <th>وضعیت تسویه</th>
              <th>وضعیت فاکتور</th>
            </tr>
          </thead>
          <tbody>
            {invoiceRows.map((row) => (
              <tr key={row.invoiceId}>
                <td>{row.invoiceReference}</td>
                <td>{row.customerName}</td>
                <td>{formatInvoiceDate(row.invoiceDate)}</td>
                <td>{formatInvoiceAmount(row.totalAmount)}</td>
                <td>{formatInvoiceAmount(row.confirmedPayment)}</td>
                <td>{formatInvoiceAmount(row.reportedPayment)}</td>
                <td>{formatInvoiceAmount(row.confirmedOutstanding)}</td>
                <td>{formatInvoiceAmount(row.unassignedAmount)}</td>
                <td>{settlementLabelText(row.settlementState)}</td>
                <td>{row.lifecycleState === "active" ? "فعال" : "لغوشده"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mobile-report-cards" aria-label="مغایرت‌ها برای گوشی">
          {reconciliationRows.map((row) => (
            <MobileReportCard
              key={row.issueId}
              title={row.mismatchType}
              status={row.severity === "high" ? "بالا" : row.severity === "medium" ? "متوسط" : "کم"}
              emphasis={row.explanation}
            >
              <span>شخص: {row.person}</span>
              <span>مرجع: {row.reference}</span>
              <span>تاریخ: {row.relevantDate ? formatInvoiceDate(row.relevantDate) : "—"}</span>
            </MobileReportCard>
          ))}
        </div>
      </div>
    );
  }

  function renderInstructionReport() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه دستورها">
          <span>ردیف‌ها: {instructionRows.length.toLocaleString("fa-IR")}</span>
          <span>مانده قطعی: {formatInvoiceAmount(instructionRows.reduce((sum, row) => sum + row.confirmedRemaining, 0))}</span>
          <span>بیش‌پرداخت: {formatInvoiceAmount(instructionRows.reduce((sum, row) => sum + row.overpaymentAmount, 0))}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>فاکتور</th>
              <th>مشتری</th>
              <th>گیرنده</th>
              <th>حساب مقصد</th>
              <th>مبلغ</th>
              <th>قطعی</th>
              <th>اعلام‌شده</th>
              <th>مانده</th>
              <th>بیش‌پرداخت</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {instructionRows.map((row) => (
              <tr key={row.instructionId}>
                <td>
                  <button type="button" className="tertiary-button" onClick={() => openInvoiceRecord(row.invoiceId)}>
                    {row.invoiceReference}
                  </button>
                </td>
                <td>{row.customerName}</td>
                <td>{row.recipientName}</td>
                <td>{row.destinationAccountLabel}</td>
                <td>{formatInvoiceAmount(row.instructedAmount)}</td>
                <td>{formatInvoiceAmount(row.confirmedReceived)}</td>
                <td>{formatInvoiceAmount(row.reportedUnconfirmed)}</td>
                <td>{formatInvoiceAmount(row.confirmedRemaining)}</td>
                <td>{formatInvoiceAmount(row.overpaymentAmount)}</td>
                <td>{row.lifecycleState === "active" ? "فعال" : "لغوشده"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPaymentReport() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه پرداخت‌ها">
          <span>ردیف‌ها: {paymentRows.length.toLocaleString("fa-IR")}</span>
          <span>تخصیص‌شده: {formatInvoiceAmount(paymentRows.reduce((sum, row) => sum + row.allocatedAmount, 0))}</span>
          <span>بدون تخصیص: {formatInvoiceAmount(paymentRows.reduce((sum, row) => sum + row.unallocatedAmount, 0))}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>تاریخ</th>
              <th>پرداخت‌کننده</th>
              <th>گیرنده</th>
              <th>مبلغ</th>
              <th>روش</th>
              <th>وضعیت تأیید</th>
              <th>وضعیت</th>
              <th>پیگیری</th>
              <th>تخصیص</th>
              <th>بدون تخصیص</th>
            </tr>
          </thead>
          <tbody>
            {paymentRows.map((row) => (
              <tr key={row.paymentId}>
                <td>{formatInvoiceDate(row.paymentDate)}</td>
                <td>{row.payerName}</td>
                <td>{row.recipientName}</td>
                <td>{formatInvoiceAmount(row.amount)}</td>
                <td>{row.method}</td>
                <td>{row.verificationState}</td>
                <td>{row.lifecycleState}</td>
                <td>{row.trackingReference || "—"}</td>
                <td>{formatInvoiceAmount(row.allocatedAmount)}</td>
                <td>{formatInvoiceAmount(row.unallocatedAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderReconciliationReport() {
    return (
      <div className="report-table-wrap">
        <div className="summary-strip" aria-label="خلاصه مغایرت‌ها">
          <span>ردیف‌ها: {reconciliationRows.length.toLocaleString("fa-IR")}</span>
          <span>شدت بالا: {reconciliationRows.filter((row) => row.severity === "high").length.toLocaleString("fa-IR")}</span>
          <span>شدت متوسط: {reconciliationRows.filter((row) => row.severity === "medium").length.toLocaleString("fa-IR")}</span>
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>شدت</th>
              <th>نوع</th>
              <th>توضیح</th>
              <th>شخص</th>
              <th>مرجع</th>
              <th>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {reconciliationRows.map((row) => (
              <tr key={row.issueId}>
                <td>{row.severity === "high" ? "بالا" : row.severity === "medium" ? "متوسط" : "کم"}</td>
                <td>{row.mismatchType}</td>
                <td>{row.explanation}</td>
                <td>{row.person}</td>
                <td>{row.reference}</td>
                <td>{row.relevantDate ? formatInvoiceDate(row.relevantDate) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPartyStatement() {
    if (!selectedParty) {
      return <div className="empty-state"><strong>یک شخص را برای گردش حساب انتخاب کنید.</strong></div>;
    }

    return (
      <div className="report-stack">
        <div className="summary-card">
          <strong>گردش حساب: {selectedParty.displayName}</strong>
          <p className="detail-copy">{partyRoleText(selectedParty.roles)}</p>
          <p className="detail-copy">این نما فقط خواندنی است و مبالغ آن از داده‌های ثبت‌شده مشتق می‌شود.</p>
        </div>
        {partyStatement?.customerSection && (
          <section className="report-subsection" aria-label="خلاصه حساب مشتری">
            <h3>{partyStatement.customerSection.title}</h3>
            <p className="detail-copy">{partyStatement.customerSection.summary}</p>
            {partyStatement.customerSection.invoiceRows?.length ? (
              <>
                <table className="report-table">
                <thead>
                  <tr>
                    <th>فاکتور</th>
                    <th>تاریخ</th>
                    <th>مبلغ</th>
                    <th>مانده قطعی</th>
                    <th>مانده پیش‌بینی</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {partyStatement.customerSection.invoiceRows.map((row) => (
                    <tr key={`${row.invoiceReference}-${row.invoiceDate}`}>
                      <td>{row.invoiceReference}</td>
                      <td>{formatInvoiceDate(row.invoiceDate)}</td>
                      <td>{formatInvoiceAmount(row.totalAmount)}</td>
                      <td>{formatInvoiceAmount(row.confirmedOutstanding)}</td>
                      <td>{formatInvoiceAmount(row.provisionalOutstanding)}</td>
                      <td>{settlementLabelText(row.settlementState)}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
                <div className="mobile-report-cards" aria-label="فاکتورهای گردش حساب برای گوشی">
                  {partyStatement.customerSection.invoiceRows.map((row) => (
                    <MobileReportCard
                      key={`mobile-${row.invoiceReference}-${row.invoiceDate}`}
                      title={row.invoiceReference}
                      status={settlementLabelText(row.settlementState)}
                      emphasis={`مانده قطعی: ${formatInvoiceAmount(row.confirmedOutstanding)}`}
                    >
                      <span>تاریخ: {formatInvoiceDate(row.invoiceDate)}</span>
                      <span>مبلغ: {formatInvoiceAmount(row.totalAmount)}</span>
                      <span>مانده پیش‌بینی: {formatInvoiceAmount(row.provisionalOutstanding)}</span>
                    </MobileReportCard>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        )}
        {partyStatement?.recipientSection && (
          <section className="report-subsection" aria-label="خلاصه حساب گیرنده">
            <h3>{partyStatement.recipientSection.title}</h3>
            <p className="detail-copy">{partyStatement.recipientSection.summary}</p>
            {partyStatement.recipientSection.instructionRows?.length ? (
              <>
                <table className="report-table">
                <thead>
                  <tr>
                    <th>فاکتور</th>
                    <th>گیرنده</th>
                    <th>حساب مقصد</th>
                    <th>مبلغ</th>
                    <th>مانده قطعی</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {partyStatement.recipientSection.instructionRows.map((row) => (
                    <tr key={`${row.invoiceReference}-${row.destinationAccountLabel}-${row.instructedAmount}`}>
                      <td>
                        <button type="button" className="tertiary-button" onClick={() => openInvoiceRecord(row.invoiceId)}>
                          {row.invoiceReference}
                        </button>
                      </td>
                      <td>{row.recipientName}</td>
                      <td>{row.destinationAccountLabel}</td>
                      <td>{formatInvoiceAmount(row.instructedAmount)}</td>
                      <td>{formatInvoiceAmount(row.confirmedRemaining)}</td>
                      <td>{row.lifecycleState === "active" ? "فعال" : "لغوشده"}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
                <div className="mobile-report-cards" aria-label="دستورهای گردش حساب برای گوشی">
                  {partyStatement.recipientSection.instructionRows.map((row) => (
                    <MobileReportCard
                      key={`mobile-${row.invoiceReference}-${row.destinationAccountLabel}-${row.instructedAmount}`}
                      title={row.invoiceReference}
                      status={row.lifecycleState === "active" ? "فعال" : "لغوشده"}
                      emphasis={`مانده قطعی: ${formatInvoiceAmount(row.confirmedRemaining)}`}
                      action={{ label: "مشاهده فاکتور", onClick: () => openInvoiceRecord(row.invoiceId) }}
                    >
                      <span>گیرنده: {row.recipientName}</span>
                      <span>حساب مقصد: {row.destinationAccountLabel}</span>
                      <span>مبلغ دستور: {formatInvoiceAmount(row.instructedAmount)}</span>
                    </MobileReportCard>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        )}
      </div>
    );
  }

  const totalCount =
    activeTab === "customer-summary"
      ? customerSummaryRows.length
      : activeTab === "recipient-summary"
        ? recipientSummaryRows.length
        : activeTab === "invoices"
          ? invoiceRows.length
          : activeTab === "payment-instructions"
            ? instructionRows.length
            : activeTab === "payments"
              ? paymentRows.length
              : activeTab === "reconciliation"
                ? reconciliationRows.length
                : (partyStatement?.customerSection?.invoiceRows?.length ?? 0) + (partyStatement?.recipientSection?.instructionRows?.length ?? 0);

  return (
    <section id="reports" className="reports-panel" aria-labelledby="reports-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">مرحله ۹</p>
          <h2 id="reports-title">گزارش‌ها</h2>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={handlePrint}>
            چاپ
          </button>
          <button type="button" className="primary-button" onClick={() => void handleExportExcel()} disabled={exporting}>
            Excel
          </button>
          <button type="button" className="secondary-button" onClick={() => void handleExportCsv()} disabled={exporting}>
            CSV
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={error ? "notice notice-error" : "notice notice-success"} role="status" aria-live="polite">
          {error ?? notice}
        </div>
      )}

      <div className="summary-strip" aria-label="پیش‌نمایش گزارش">
        <span>گزارش فعال: {reportTitle(activeTab)}</span>
        <span>ردیف‌ها: {totalCount.toLocaleString("fa-IR")}</span>
        <span>تاریخ ایجاد: {formatInvoiceTimestamp(workbookData.metadata.generatedAt)}</span>
      </div>

      <div className="report-tabs" role="tablist" aria-label="انواع گزارش">
        {reportTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "entry-card entry-card-active" : "entry-card"}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="entry-label">{tab.label}</span>
            <span className="entry-meta">{tab.description}</span>
          </button>
        ))}
      </div>

      <div className="report-filters">
        <div className="form-grid">
          <label className="field">
            <span>از تاریخ</span>
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
          </label>
          <label className="field">
            <span>تا تاریخ</span>
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} />
          </label>
        </div>

        {activeTab === "customer-summary" && (
          <div className="form-grid">
            <label className="field">
              <span>جست‌وجوی مشتری</span>
              <input value={filters.customerQuery} onChange={(event) => setFilters((current) => ({ ...current, customerQuery: event.target.value }))} placeholder="نام، تلفن، توضیح" />
            </label>
            <label className="field">
              <span>وضعیت فاکتور</span>
              <select value={filters.customerLifecycle} onChange={(event) => setFilters((current) => ({ ...current, customerLifecycle: event.target.value as LifecycleFilter }))}>
                <option value="all">همه</option>
                <option value="active">فعال</option>
                <option value="cancelled">لغوشده</option>
              </select>
            </label>
          </div>
        )}

        {activeTab === "recipient-summary" && (
          <div className="form-grid">
            <label className="field">
              <span>جست‌وجوی گیرنده</span>
              <input value={filters.recipientQuery} onChange={(event) => setFilters((current) => ({ ...current, recipientQuery: event.target.value }))} placeholder="نام، تلفن، توضیح" />
            </label>
            <label className="field">
              <span>وضعیت دستور</span>
              <select value={filters.recipientLifecycle} onChange={(event) => setFilters((current) => ({ ...current, recipientLifecycle: event.target.value as LifecycleFilter }))}>
                <option value="all">همه</option>
                <option value="active">فعال</option>
                <option value="cancelled">لغوشده</option>
              </select>
            </label>
          </div>
        )}

        {activeTab === "invoices" && (
          <div className="form-grid">
            <label className="field">
              <span>مشتری</span>
              <select value={filters.invoiceCustomerId} onChange={(event) => setFilters((current) => ({ ...current, invoiceCustomerId: event.target.value }))}>
                <option value="">همه مشتریان</option>
                {parties
                  .filter((party) => party.roles.includes("customer"))
                  .map((party) => (
                    <option key={party.id} value={party.id}>
                      {formatPartyDisplayName(party)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>وضعیت فاکتور</span>
              <select value={filters.invoiceLifecycle} onChange={(event) => setFilters((current) => ({ ...current, invoiceLifecycle: event.target.value as LifecycleFilter }))}>
                <option value="all">همه</option>
                <option value="active">فعال</option>
                <option value="cancelled">لغوشده</option>
              </select>
            </label>
            <label className="field">
              <span>وضعیت تسویه</span>
              <select value={filters.invoiceSettlement} onChange={(event) => setFilters((current) => ({ ...current, invoiceSettlement: event.target.value as SettlementFilter }))}>
                <option value="all">همه</option>
                <option value="unpaid">پرداخت نشده</option>
                <option value="partially_paid">پرداخت جزئی</option>
                <option value="provisionally_paid">پیش‌بینی‌شده</option>
                <option value="fully_settled">تسویه‌شده</option>
                <option value="overpaid">بیش‌پرداخت</option>
                <option value="needs_review">نیازمند بررسی</option>
              </select>
            </label>
            <label className="field">
              <span>جست‌وجو</span>
              <input value={filters.invoiceQuery} onChange={(event) => setFilters((current) => ({ ...current, invoiceQuery: event.target.value }))} placeholder="شماره، توضیح، مشتری" />
            </label>
          </div>
        )}

        {activeTab === "payment-instructions" && (
          <div className="form-grid">
            <label className="field">
              <span>گیرنده</span>
              <select value={filters.instructionRecipientId} onChange={(event) => setFilters((current) => ({ ...current, instructionRecipientId: event.target.value }))}>
                <option value="">همه گیرندگان</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {formatPartyDisplayName(party)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>وضعیت دستور</span>
              <select value={filters.instructionLifecycle} onChange={(event) => setFilters((current) => ({ ...current, instructionLifecycle: event.target.value as LifecycleFilter }))}>
                <option value="all">همه</option>
                <option value="active">فعال</option>
                <option value="cancelled">لغوشده</option>
              </select>
            </label>
            <label className="field">
              <span>جست‌وجو</span>
              <input value={filters.instructionQuery} onChange={(event) => setFilters((current) => ({ ...current, instructionQuery: event.target.value }))} placeholder="فاکتور، گیرنده، حساب" />
            </label>
          </div>
        )}

        {activeTab === "payments" && (
          <div className="form-grid">
            <label className="field">
              <span>پرداخت‌کننده</span>
              <select value={filters.paymentPayerId} onChange={(event) => setFilters((current) => ({ ...current, paymentPayerId: event.target.value }))}>
                <option value="">همه پرداخت‌کنندگان</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {formatPartyDisplayName(party)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>گیرنده</span>
              <select value={filters.paymentRecipientId} onChange={(event) => setFilters((current) => ({ ...current, paymentRecipientId: event.target.value }))}>
                <option value="">همه گیرندگان</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {formatPartyDisplayName(party)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>وضعیت تأیید</span>
              <select value={filters.paymentVerificationStatus} onChange={(event) => setFilters((current) => ({ ...current, paymentVerificationStatus: event.target.value as ReportFilters["paymentVerificationStatus"] }))}>
                <option value="all">همه</option>
                <option value="reported">اعلام‌شده</option>
                <option value="confirmed">تأییدشده</option>
                <option value="rejected">ردشده</option>
                <option value="disputed">مورد اختلاف</option>
              </select>
            </label>
            <label className="field">
              <span>روش پرداخت</span>
              <select value={filters.paymentMethod} onChange={(event) => setFilters((current) => ({ ...current, paymentMethod: event.target.value as ReportFilters["paymentMethod"] }))}>
                <option value="all">همه</option>
                <option value="bank_transfer">انتقال بانکی</option>
                <option value="cash">نقد</option>
                <option value="cheque">چک</option>
                <option value="other">سایر</option>
              </select>
            </label>
            <label className="field">
              <span>وضعیت تخصیص</span>
              <select value={filters.paymentAllocationState} onChange={(event) => setFilters((current) => ({ ...current, paymentAllocationState: event.target.value as AllocationStateFilter }))}>
                <option value="all">همه</option>
                <option value="allocated">تخصیص‌شده</option>
                <option value="unallocated">بدون تخصیص</option>
              </select>
            </label>
            <label className="field">
              <span>جست‌وجو</span>
              <input value={filters.paymentQuery} onChange={(event) => setFilters((current) => ({ ...current, paymentQuery: event.target.value }))} placeholder="نام، پیگیری، توضیح" />
            </label>
          </div>
        )}

        {activeTab === "reconciliation" && (
          <div className="form-grid">
            <label className="field">
              <span>شدت</span>
              <select value={filters.reconciliationSeverity} onChange={(event) => setFilters((current) => ({ ...current, reconciliationSeverity: event.target.value as ReconciliationSeverityFilter }))}>
                <option value="all">همه</option>
                <option value="high">بالا</option>
                <option value="medium">متوسط</option>
                <option value="low">کم</option>
              </select>
            </label>
            <label className="field">
              <span>نوع</span>
              <select value={filters.reconciliationType} onChange={(event) => setFilters((current) => ({ ...current, reconciliationType: event.target.value as ReconciliationTypeFilter }))}>
                <option value="all">همه</option>
                <option value="unallocated_payment">پرداخت بدون تخصیص</option>
                <option value="disputed_payment">پرداخت مورد اختلاف</option>
                <option value="duplicate_tracking_reference">شماره پیگیری تکراری</option>
                <option value="probable_duplicate_payment">پرداخت مشابه</option>
                <option value="instruction_overpayment">بیش‌پرداخت دستور</option>
                <option value="invoice_overpayment">بیش‌پرداخت فاکتور</option>
                <option value="cancelled_instruction_allocation">تخصیص به دستور لغوشده</option>
                <option value="recipient_mismatch">ناهمخوانی گیرنده</option>
                <option value="destination_account_owner_mismatch">مالک حساب مقصد</option>
                <option value="active_instruction_without_destination_account">دستور بدون حساب مقصد</option>
                <option value="reported_payment_awaiting_confirmation">در انتظار تأیید</option>
              </select>
            </label>
            <label className="field">
              <span>جست‌وجو</span>
              <input value={filters.reconciliationQuery} onChange={(event) => setFilters((current) => ({ ...current, reconciliationQuery: event.target.value }))} placeholder="نام، فاکتور، پیگیری" />
            </label>
          </div>
        )}

        {activeTab === "party-statement" && (
          <div className="form-grid">
            <label className="field">
              <span>شخص</span>
              <select value={filters.statementPartyId} onChange={(event) => setFilters((current) => ({ ...current, statementPartyId: event.target.value }))}>
                <option value="">یک شخص انتخاب کنید</option>
                {parties.map((party) => (
                  <option key={party.id} value={party.id}>
                    {formatPartyDisplayName(party)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state">
          <strong>در حال بارگذاری گزارش‌ها...</strong>
        </div>
      ) : activeTab === "customer-summary" ? (
        renderCustomerSummary()
      ) : activeTab === "recipient-summary" ? (
        renderRecipientSummary()
      ) : activeTab === "invoices" ? (
        renderInvoiceReport()
      ) : activeTab === "payment-instructions" ? (
        renderInstructionReport()
      ) : activeTab === "payments" ? (
        renderPaymentReport()
      ) : activeTab === "reconciliation" ? (
        renderReconciliationReport()
      ) : (
        renderPartyStatement()
      )}
    </section>
  );
}
