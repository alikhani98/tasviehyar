import { z } from "zod";
import type {
  DestinationAccount,
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentInstruction,
  PaymentMethod,
  PaymentVerification,
  PaymentVerificationStatus,
  Party
} from "./schemas";
import {
  paymentAllocationSchema,
  paymentMethodSchema,
  paymentSchema,
  paymentVerificationMethodSchema,
  paymentVerificationSchema,
  paymentVerificationStatusSchema
} from "./schemas";
import { findDuplicateTrackingReferenceWarnings, type DomainWarning } from "./calculations";
import { formatInvoiceAmount, parseInvoiceAmountInput } from "./invoices";

type PaymentVerificationMethod = PaymentVerification["verificationMethod"];

const optionalTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const rawTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value;
}, z.string());

export const paymentLifecycleStatusValues = ["all", "active", "cancelled", "reversed"] as const;
export type PaymentLifecycleStatusFilter = (typeof paymentLifecycleStatusValues)[number];

export const paymentVerificationStatusFilterValues = ["all", "reported", "confirmed", "rejected", "disputed"] as const;
export type PaymentVerificationStatusFilter = (typeof paymentVerificationStatusFilterValues)[number];

export interface PaymentListFilter {
  query: string;
  lifecycleStatus: PaymentLifecycleStatusFilter;
  verificationStatus: PaymentVerificationStatusFilter;
}

export interface PaymentDraft {
  payerPartyId: string;
  recipientPartyId: string;
  destinationAccountId?: string | undefined;
  amount: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  verificationStatus: PaymentVerificationStatus;
  trackingReference?: string | undefined;
  note?: string | undefined;
}

export interface PaymentAllocationDraft {
  invoiceId: string;
  paymentInstructionId?: string | undefined;
  allocatedAmount: number;
}

export interface PaymentVerificationDraft {
  verificationResult: PaymentVerificationStatus;
  verifierDescriptionOrPartyRef: string;
  verificationMethod: PaymentVerificationMethod;
  note?: string | undefined;
}

export type PaymentDuplicateWarning = {
  kind: "duplicate_payment";
  matchedPaymentIds: string[];
  matchedPaymentSummaries: string[];
  payerPartyId: string;
  recipientPartyId: string;
  paymentDate: string;
  amount: number;
  trackingReference?: string | undefined;
};

function normalizeDigitGlyphs(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[٠۰]/g, "0")
    .replace(/[١۱]/g, "1")
    .replace(/[٢۲]/g, "2")
    .replace(/[٣۳]/g, "3")
    .replace(/[٤۴]/g, "4")
    .replace(/[٥۵]/g, "5")
    .replace(/[٦۶]/g, "6")
    .replace(/[٧۷]/g, "7")
    .replace(/[٨۸]/g, "8")
    .replace(/[٩۹]/g, "9");
}

function normalizeText(value: string): string {
  return normalizeDigitGlyphs(value)
    .replace(/[يی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function normalizeReference(value: string): string {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizePaymentDraftValue(draft: {
  payerPartyId: string;
  recipientPartyId: string;
  destinationAccountId?: string | undefined;
  amountText: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  verificationStatus: PaymentVerificationStatus;
  trackingReference?: string | undefined;
  note?: string | undefined;
}): PaymentDraft {
  return {
    payerPartyId: draft.payerPartyId.trim(),
    recipientPartyId: draft.recipientPartyId.trim(),
    destinationAccountId: draft.destinationAccountId ? draft.destinationAccountId.trim() : undefined,
    amount: parseInvoiceAmountInput(draft.amountText),
    paymentDate: draft.paymentDate,
    paymentMethod: draft.paymentMethod,
    verificationStatus: draft.verificationStatus,
    trackingReference: draft.trackingReference ? normalizeReference(draft.trackingReference) : undefined,
    note: draft.note ? draft.note.trim() : undefined
  };
}

export const paymentDraftSchema = z
  .object({
    payerPartyId: z.string().trim().min(1, "پرداخت‌کننده باید انتخاب شود."),
    recipientPartyId: z.string().trim().min(1, "گیرنده باید انتخاب شود."),
    destinationAccountId: optionalTextSchema,
    amountText: rawTextSchema,
    paymentDate: z.string().date("تاریخ پرداخت معتبر نیست."),
    paymentMethod: paymentMethodSchema,
    verificationStatus: paymentVerificationStatusSchema,
    trackingReference: optionalTextSchema,
    note: optionalTextSchema
  })
  .superRefine((draft, ctx) => {
    try {
      parseInvoiceAmountInput(draft.amountText);
    } catch (caught) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountText"],
        message: caught instanceof Error ? caught.message : "مبلغ پرداخت معتبر نیست."
      });
    }
  })
  .transform((draft) => normalizePaymentDraftValue(draft));

export const paymentAllocationDraftSchema = z
  .object({
    invoiceId: z.string().trim().min(1, "فاکتور باید مشخص شود."),
    paymentInstructionId: optionalTextSchema,
    allocatedAmountText: rawTextSchema
  })
  .superRefine((draft, ctx) => {
    try {
      parseInvoiceAmountInput(draft.allocatedAmountText);
    } catch (caught) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allocatedAmountText"],
        message: caught instanceof Error ? caught.message : "مبلغ تخصیص معتبر نیست."
      });
    }
  })
  .transform((draft) => ({
    invoiceId: draft.invoiceId.trim(),
    paymentInstructionId: draft.paymentInstructionId ? draft.paymentInstructionId.trim() : undefined,
    allocatedAmount: parseInvoiceAmountInput(draft.allocatedAmountText)
  }));

export const paymentVerificationDraftSchema = z
  .object({
    verificationResult: paymentVerificationStatusSchema,
    verifierDescriptionOrPartyRef: z.string().trim().min(1, "شناسه یا توضیح تأییدکننده باید وارد شود."),
    verificationMethod: paymentVerificationMethodSchema,
    note: optionalTextSchema
  })
  .transform((draft) => ({
    verificationResult: draft.verificationResult,
    verifierDescriptionOrPartyRef: draft.verifierDescriptionOrPartyRef.trim(),
    verificationMethod: draft.verificationMethod,
    note: draft.note
  }));

export function parsePaymentDraftFromPayment(payment: Payment): PaymentDraft {
  return paymentDraftSchema.parse({
    payerPartyId: payment.payerPartyId,
    recipientPartyId: payment.recipientPartyId,
    destinationAccountId: payment.destinationAccountId ?? "",
    amountText: String(payment.amount),
    paymentDate: payment.paymentDate,
    paymentMethod: payment.paymentMethod,
    verificationStatus: payment.verificationStatus,
    trackingReference: payment.trackingReference ?? "",
    note: payment.note ?? ""
  });
}

export function parsePaymentAllocationDraftFromAllocation(allocation: PaymentAllocation): PaymentAllocationDraft {
  return paymentAllocationDraftSchema.parse({
    invoiceId: allocation.invoiceId,
    paymentInstructionId: allocation.paymentInstructionId ?? "",
    allocatedAmountText: String(allocation.allocatedAmount)
  });
}

export function parsePaymentVerificationDraftFromVerification(verification: PaymentVerification): PaymentVerificationDraft {
  return paymentVerificationDraftSchema.parse({
    verificationResult: verification.verificationResult,
    verifierDescriptionOrPartyRef: verification.verifierDescriptionOrPartyRef,
    verificationMethod: verification.verificationMethod,
    note: verification.note ?? ""
  });
}

export function buildPaymentRecord(
  id: string,
  draft: PaymentDraft,
  timestamps: { createdAt: string; updatedAt: string },
  lifecycleStatus: Payment["lifecycleStatus"]
): Payment {
  return paymentSchema.parse({
    id,
    payerPartyId: draft.payerPartyId,
    recipientPartyId: draft.recipientPartyId,
    destinationAccountId: draft.destinationAccountId,
    amount: draft.amount,
    paymentDate: draft.paymentDate,
    paymentMethod: draft.paymentMethod,
    verificationStatus: draft.verificationStatus,
    lifecycleStatus,
    trackingReference: draft.trackingReference,
    note: draft.note,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  });
}

export function buildPaymentAllocationRecord(
  id: string,
  paymentId: string,
  draft: PaymentAllocationDraft,
  createdAt: string
): PaymentAllocation {
  return paymentAllocationSchema.parse({
    id,
    paymentId,
    invoiceId: draft.invoiceId,
    paymentInstructionId: draft.paymentInstructionId,
    allocatedAmount: draft.allocatedAmount,
    createdAt
  });
}

export function buildPaymentVerificationRecord(
  id: string,
  paymentId: string,
  draft: PaymentVerificationDraft,
  timestamps: { createdAt: string; verifiedAt: string }
): PaymentVerification {
  return paymentVerificationSchema.parse({
    id,
    paymentId,
    verificationResult: draft.verificationResult,
    verifierDescriptionOrPartyRef: draft.verifierDescriptionOrPartyRef,
    verificationMethod: draft.verificationMethod,
    note: draft.note,
    verifiedAt: timestamps.verifiedAt,
    createdAt: timestamps.createdAt
  });
}

function paymentSearchTarget(
  payment: Payment,
  payerName: string,
  recipientName: string,
  accountLabel?: string,
  relatedText?: string
): string {
  return [
    payerName,
    recipientName,
    accountLabel ?? "",
    payment.trackingReference ?? "",
    payment.note ?? "",
    payment.paymentDate,
    formatInvoiceAmount(payment.amount),
    relatedText ?? ""
  ]
    .map(normalizeText)
    .join(" ");
}

function paymentDuplicateKey(payment: Pick<Payment, "payerPartyId" | "recipientPartyId" | "paymentDate" | "amount">): string {
  return [payment.payerPartyId, payment.recipientPartyId, payment.paymentDate, String(payment.amount)].join("|");
}

function buildPaymentSummary(
  payment: Payment,
  payerName: string,
  recipientName: string,
  accountLabel?: string
): string {
  const accountText = accountLabel ? `، حساب «${accountLabel}»` : "، حساب مقصد هنوز تعیین نشده";
  const trackingText = payment.trackingReference ? `، پیگیری «${payment.trackingReference}»` : "";
  return `پرداخت از «${payerName}» به «${recipientName}» در تاریخ ${payment.paymentDate} با مبلغ ${formatInvoiceAmount(payment.amount)}${accountText}${trackingText}`;
}

export function formatPaymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case "bank_transfer":
      return "انتقال بانکی";
    case "cash":
      return "نقد";
    case "cheque":
      return "چک";
    case "other":
      return "سایر";
  }
}

export function formatPaymentVerificationStatusLabel(status: PaymentVerificationStatus): string {
  switch (status) {
    case "reported":
      return "اعلام‌شده";
    case "confirmed":
      return "تأییدشده";
    case "rejected":
      return "ردشده";
    case "disputed":
      return "مورد اختلاف";
  }
}

export function formatPaymentVerificationMethodLabel(method: PaymentVerificationMethod): string {
  switch (method) {
    case "recipient_phone_confirmation":
      return "تأیید تلفنی گیرنده";
    case "receipt_review":
      return "بررسی رسید";
    case "account_review":
      return "بررسی حساب";
    case "other":
      return "سایر";
  }
}

export function formatPaymentLifecycleLabel(status: Payment["lifecycleStatus"]): string {
  switch (status) {
    case "active":
      return "فعال";
    case "cancelled":
      return "لغوشده";
    case "reversed":
      return "برگشتی";
  }

  throw new Error("Unknown payment lifecycle status.");
}

export function summarizePaymentForDisplay(
  payment: Payment,
  payerName: string,
  recipientName: string,
  accountLabel?: string
): string {
  const accountText = accountLabel ? ` · ${accountLabel}` : " · حساب مقصد ثبت نشده";
  return `${payerName} → ${recipientName} · ${payment.amount.toLocaleString("fa-IR")} تومان${accountText}`;
}

export function findProbablePaymentDuplicateWarnings(
  payments: readonly Payment[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[]
): PaymentDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const grouped = new Map<string, Payment[]>();

  for (const payment of payments) {
    const key = paymentDuplicateKey(payment);
    const existing = grouped.get(key) ?? [];
    existing.push(payment);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([, matches]) => {
      const first = matches[0]!;
      return {
        kind: "duplicate_payment" as const,
        matchedPaymentIds: Array.from(new Set(matches.map((payment) => payment.id))),
        matchedPaymentSummaries: Array.from(
          new Set(
            matches.map((payment) =>
              buildPaymentSummary(
                payment,
                partiesById.get(payment.payerPartyId)?.displayName ?? payment.payerPartyId,
                partiesById.get(payment.recipientPartyId)?.displayName ?? payment.recipientPartyId,
                payment.destinationAccountId ? accountsById.get(payment.destinationAccountId)?.accountLabel : undefined
              )
            )
          )
        ),
        payerPartyId: first.payerPartyId,
        recipientPartyId: first.recipientPartyId,
        paymentDate: first.paymentDate,
        amount: first.amount,
        trackingReference: first.trackingReference
      } satisfies PaymentDuplicateWarning;
    });
}

export function findProbablePaymentDraftWarnings(
  payments: readonly Payment[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[],
  draft: PaymentDraft,
  excludePaymentId?: string
): PaymentDuplicateWarning[] {
  const visiblePayments = payments.filter((payment) => payment.id !== excludePaymentId);
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const matchingPayments = visiblePayments.filter(
    (payment) =>
      payment.payerPartyId === draft.payerPartyId &&
      payment.recipientPartyId === draft.recipientPartyId &&
      payment.paymentDate === draft.paymentDate &&
      payment.amount === draft.amount
  );

  if (matchingPayments.length === 0) {
    return [];
  }

  const first = matchingPayments[0]!;

  return [
    {
      kind: "duplicate_payment",
      matchedPaymentIds: matchingPayments.map((payment) => payment.id),
      matchedPaymentSummaries: matchingPayments.map((payment) =>
        buildPaymentSummary(
          payment,
          partiesById.get(payment.payerPartyId)?.displayName ?? payment.payerPartyId,
          partiesById.get(payment.recipientPartyId)?.displayName ?? payment.recipientPartyId,
          payment.destinationAccountId ? accountsById.get(payment.destinationAccountId)?.accountLabel : undefined
        )
      ),
      payerPartyId: first.payerPartyId,
      recipientPartyId: first.recipientPartyId,
      paymentDate: first.paymentDate,
      amount: first.amount,
      trackingReference: first.trackingReference
    }
  ];
}

export function filterPayments(
  payments: readonly Payment[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[],
  invoices: readonly Invoice[],
  instructions: readonly PaymentInstruction[],
  allocations: readonly PaymentAllocation[],
  filter: PaymentListFilter
): Payment[] {
  const query = normalizeText(filter.query);
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice] as const));
  const instructionsById = new Map(instructions.map((instruction) => [instruction.id, instruction] as const));
  const allocationsByPayment = new Map<string, PaymentAllocation[]>();

  for (const allocation of allocations) {
    const existing = allocationsByPayment.get(allocation.paymentId) ?? [];
    existing.push(allocation);
    allocationsByPayment.set(allocation.paymentId, existing);
  }

  return payments
    .filter((payment) => {
      const matchesLifecycle =
        filter.lifecycleStatus === "all" ||
        (filter.lifecycleStatus === "active" && payment.lifecycleStatus === "active") ||
        (filter.lifecycleStatus === "cancelled" && payment.lifecycleStatus === "cancelled") ||
        (filter.lifecycleStatus === "reversed" && payment.lifecycleStatus === "reversed");

      const matchesVerification =
        filter.verificationStatus === "all" || payment.verificationStatus === filter.verificationStatus;

      if (!matchesLifecycle || !matchesVerification) {
        return false;
      }

      if (!query) {
        return true;
      }

      const relatedText = (allocationsByPayment.get(payment.id) ?? [])
        .map((allocation) => {
          const invoice = invoicesById.get(allocation.invoiceId);
          const instruction = allocation.paymentInstructionId ? instructionsById.get(allocation.paymentInstructionId) : undefined;
          return [invoice?.referenceNumber ?? invoice?.id ?? "", instruction?.note ?? "", instruction?.id ?? ""].join(" ");
        })
        .join(" ");

      const searchable = paymentSearchTarget(
        payment,
        partiesById.get(payment.payerPartyId)?.displayName ?? payment.payerPartyId,
        partiesById.get(payment.recipientPartyId)?.displayName ?? payment.recipientPartyId,
        payment.destinationAccountId ? accountsById.get(payment.destinationAccountId)?.accountLabel : undefined,
        relatedText
      );
      return searchable.includes(query);
    })
    .sort((left, right) => {
      if (left.paymentDate !== right.paymentDate) {
        return left.paymentDate > right.paymentDate ? -1 : 1;
      }

      return right.createdAt.localeCompare(left.createdAt);
    });
}

export function summarizePaymentAllocationProgress(
  payment: Payment,
  allocations: readonly PaymentAllocation[]
): { allocatedAmount: number; remainingAmount: number; isUnallocated: boolean; isOverallocated: boolean } {
  const allocatedAmount = allocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
  return {
    allocatedAmount,
    remainingAmount: Math.max(0, payment.amount - allocatedAmount),
    isUnallocated: allocatedAmount === 0,
    isOverallocated: allocatedAmount > payment.amount
  };
}

export function summarizePaymentAllocationForDisplay(allocation: PaymentAllocation, invoiceReference?: string, instructionLabel?: string): string {
  const invoiceText = invoiceReference ? `فاکتور ${invoiceReference}` : `فاکتور ${allocation.invoiceId}`;
  const instructionText = instructionLabel ? `، دستور «${instructionLabel}»` : "";
  return `${invoiceText}${instructionText} · ${allocation.allocatedAmount.toLocaleString("fa-IR")} تومان`;
}

export function summarizePaymentVerificationForDisplay(verification: PaymentVerification): string {
  return `${formatPaymentVerificationStatusLabel(verification.verificationResult)} · ${formatPaymentVerificationMethodLabel(verification.verificationMethod)}`;
}

export function summarizePaymentMethodForDisplay(method: PaymentMethod): string {
  return formatPaymentMethodLabel(method);
}

export function isPaymentEditable(payment: Payment): boolean {
  return payment.lifecycleStatus === "active" && payment.verificationStatus === "reported";
}

export function isPaymentAllocatable(payment: Payment): boolean {
  return payment.lifecycleStatus === "active";
}

export function isPaymentVerifiable(payment: Payment): boolean {
  return payment.lifecycleStatus === "active";
}

export function normalizePaymentReferenceText(value: string): string {
  return normalizeReference(value);
}

export function combinePaymentWarnings(
  payments: readonly Payment[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[]
): Array<DomainWarning | PaymentDuplicateWarning> {
  return [...findDuplicateTrackingReferenceWarnings(payments), ...findProbablePaymentDuplicateWarnings(payments, parties, destinationAccounts)];
}
