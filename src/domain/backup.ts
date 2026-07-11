import { z } from "zod";
import { findDuplicateTrackingReferenceWarnings } from "./calculations";
import { findProbableDestinationAccountDuplicateWarnings } from "./destination-accounts";
import { findProbablePartyDuplicateWarnings } from "./parties";
import { findProbablePaymentDuplicateWarnings } from "./payments";
import { sumMoney } from "./money";
import {
  auditEventSchema,
  destinationAccountSchema,
  invoiceSchema,
  paymentAllocationSchema,
  paymentInstructionSchema,
  paymentSchema,
  paymentVerificationSchema,
  partySchema
} from "./schemas";

export const backupAppIdentifier = "tasviehyar" as const;
export const backupFormatVersion = 1 as const;

export interface BackupRecordCounts {
  parties: number;
  destinationAccounts: number;
  invoices: number;
  paymentInstructions: number;
  payments: number;
  paymentAllocations: number;
  paymentVerifications: number;
  auditEvents: number;
}

export interface BackupData {
  parties: z.infer<typeof partySchema>[];
  destinationAccounts: z.infer<typeof destinationAccountSchema>[];
  invoices: z.infer<typeof invoiceSchema>[];
  paymentInstructions: z.infer<typeof paymentInstructionSchema>[];
  payments: z.infer<typeof paymentSchema>[];
  paymentAllocations: z.infer<typeof paymentAllocationSchema>[];
  paymentVerifications: z.infer<typeof paymentVerificationSchema>[];
  auditEvents: z.infer<typeof auditEventSchema>[];
}

export interface BackupChecksum {
  algorithm: "SHA-256";
  value: string;
}

export interface BackupEnvelope extends BackupData {
  appIdentifier: string;
  backupFormatVersion: number;
  databaseSchemaVersion: number;
  applicationVersion?: string | undefined;
  createdAt: string;
  recordCounts: BackupRecordCounts;
  checksum: BackupChecksum;
}

export interface BackupEnvelopeWithoutChecksum extends BackupData {
  appIdentifier: string;
  backupFormatVersion: number;
  databaseSchemaVersion: number;
  applicationVersion?: string | undefined;
  createdAt: string;
  recordCounts: BackupRecordCounts;
}

export type BackupIntegritySeverity = "error" | "warning";

export interface BackupIntegrityIssue {
  severity: BackupIntegritySeverity;
  code: string;
  message: string;
}

export interface BackupPreview {
  compatible: boolean;
  appIdentifier?: string;
  backupFormatVersion?: number;
  databaseSchemaVersion?: number;
  applicationVersion?: string;
  createdAt?: string;
  checksum?: string;
  recordCounts?: BackupRecordCounts;
  issues: BackupIntegrityIssue[];
}

export interface BackupHistoryEntry {
  kind: "backup" | "restore";
  createdAt: string;
  sourceBackupCreatedAt: string;
  fileName: string;
  checksum: string;
  recordCounts: BackupRecordCounts;
}

export interface BackupHistorySummary {
  entries: BackupHistoryEntry[];
  lastBackup: BackupHistoryEntry | null;
  lastRestore: BackupHistoryEntry | null;
}

const backupEnvelopeSchema = z.object({
  appIdentifier: z.string().min(1),
  backupFormatVersion: z.number().int().nonnegative(),
  databaseSchemaVersion: z.number().int().nonnegative(),
  applicationVersion: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  recordCounts: z.object({
    parties: z.number().int().nonnegative(),
    destinationAccounts: z.number().int().nonnegative(),
    invoices: z.number().int().nonnegative(),
    paymentInstructions: z.number().int().nonnegative(),
    payments: z.number().int().nonnegative(),
    paymentAllocations: z.number().int().nonnegative(),
    paymentVerifications: z.number().int().nonnegative(),
    auditEvents: z.number().int().nonnegative()
  }),
  checksum: z.object({
    algorithm: z.literal("SHA-256"),
    value: z.string().regex(/^[a-f0-9]{64}$/i)
  }),
  parties: z.array(partySchema),
  destinationAccounts: z.array(destinationAccountSchema),
  invoices: z.array(invoiceSchema),
  paymentInstructions: z.array(paymentInstructionSchema),
  payments: z.array(paymentSchema),
  paymentAllocations: z.array(paymentAllocationSchema),
  paymentVerifications: z.array(paymentVerificationSchema),
  auditEvents: z.array(auditEventSchema)
});

export function createBackupFileName(createdAt: string): string {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `tasviehyar-backup-${year}-${month}-${day}-${hour}${minute}.json`;
}

export function buildBackupRecordCounts(data: BackupData): BackupRecordCounts {
  return {
    parties: data.parties.length,
    destinationAccounts: data.destinationAccounts.length,
    invoices: data.invoices.length,
    paymentInstructions: data.paymentInstructions.length,
    payments: data.payments.length,
    paymentAllocations: data.paymentAllocations.length,
    paymentVerifications: data.paymentVerifications.length,
    auditEvents: data.auditEvents.length
  };
}

export function buildBackupEnvelopeWithoutChecksum(
  data: BackupData,
  context: { createdAt: string; databaseSchemaVersion: number; applicationVersion?: string }
): BackupEnvelopeWithoutChecksum {
  const recordCounts = buildBackupRecordCounts(data);
  const envelope = {
    appIdentifier: backupAppIdentifier,
    backupFormatVersion: backupFormatVersion,
    databaseSchemaVersion: context.databaseSchemaVersion,
    createdAt: context.createdAt,
    recordCounts,
    ...data
  } as BackupEnvelopeWithoutChecksum;

  if (context.applicationVersion) {
    envelope.applicationVersion = context.applicationVersion;
  }

  return envelope;
}

export const createBackupEnvelopeWithoutChecksum = buildBackupEnvelopeWithoutChecksum;

export async function digestBackupEnvelope(envelope: BackupEnvelopeWithoutChecksum): Promise<BackupChecksum> {
  const encoded = new TextEncoder().encode(JSON.stringify(envelope));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const value = Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return { algorithm: "SHA-256", value };
}

export function parseBackupEnvelope(value: string): BackupEnvelope {
  const parsed = backupEnvelopeSchema.parse(JSON.parse(value));
  return parsed;
}

function issue(severity: BackupIntegritySeverity, code: string, message: string): BackupIntegrityIssue {
  return { severity, code, message };
}

function hasDuplicateIds<T extends { id: string }>(items: readonly T[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
      continue;
    }

    seen.add(item.id);
  }

  return Array.from(duplicates);
}

function buildLookup<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item] as const));
}

function ensureMoneyValue(value: number, label: string, issues: BackupIntegrityIssue[]): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    issues.push(issue("error", `invalid_money:${label}`, `${label} باید یک مبلغ صحیح و غیرمنفی باشد.`));
  }
}

function checkDuplicateIdIssues<T extends { id: string }>(items: readonly T[], entityLabel: string, issues: BackupIntegrityIssue[]): void {
  for (const duplicateId of hasDuplicateIds(items)) {
    issues.push(issue("error", `duplicate_id:${entityLabel}:${duplicateId}`, `شناسه تکراری برای ${entityLabel} «${duplicateId}» پیدا شد.`));
  }
}

export function validateBackupIntegrity(data: BackupData): BackupIntegrityIssue[] {
  const issues: BackupIntegrityIssue[] = [];
  const partiesById = buildLookup(data.parties);
  const destinationAccountsById = buildLookup(data.destinationAccounts);
  const invoicesById = buildLookup(data.invoices);
  const instructionsById = buildLookup(data.paymentInstructions);
  const paymentsById = buildLookup(data.payments);

  checkDuplicateIdIssues(data.parties, "طرف", issues);
  checkDuplicateIdIssues(data.destinationAccounts, "حساب مقصد", issues);
  checkDuplicateIdIssues(data.invoices, "فاکتور", issues);
  checkDuplicateIdIssues(data.paymentInstructions, "دستور پرداخت", issues);
  checkDuplicateIdIssues(data.payments, "پرداخت", issues);
  checkDuplicateIdIssues(data.paymentAllocations, "تخصیص", issues);
  checkDuplicateIdIssues(data.paymentVerifications, "تأیید پرداخت", issues);
  checkDuplicateIdIssues(data.auditEvents, "رویداد حسابرسی", issues);

  for (const invoice of data.invoices) {
    if (!partiesById.has(invoice.customerPartyId)) {
      issues.push(issue("error", `orphan_invoice:${invoice.id}`, `فاکتور «${invoice.id}» به مشتری موجود اشاره نمی‌کند.`));
    }
    ensureMoneyValue(invoice.totalAmount, `فاکتور ${invoice.id}`, issues);
  }

  for (const account of data.destinationAccounts) {
    if (!partiesById.has(account.ownerPartyId)) {
      issues.push(issue("error", `orphan_destination_account:${account.id}`, `حساب مقصد «${account.id}» به طرف موجود اشاره نمی‌کند.`));
    }
  }

  for (const instruction of data.paymentInstructions) {
    if (!invoicesById.has(instruction.invoiceId)) {
      issues.push(issue("error", `orphan_instruction_invoice:${instruction.id}`, `دستور پرداخت «${instruction.id}» به فاکتور موجود اشاره نمی‌کند.`));
    }
    if (!partiesById.has(instruction.recipientPartyId)) {
      issues.push(issue("error", `orphan_instruction_recipient:${instruction.id}`, `دستور پرداخت «${instruction.id}» گیرنده معتبر ندارد.`));
    }
    if (instruction.destinationAccountId) {
      const destinationAccount = destinationAccountsById.get(instruction.destinationAccountId);
      if (!destinationAccount) {
        issues.push(issue("error", `orphan_instruction_account:${instruction.id}`, `دستور پرداخت «${instruction.id}» به حساب مقصد موجود اشاره نمی‌کند.`));
      } else if (destinationAccount.ownerPartyId !== instruction.recipientPartyId) {
        issues.push(issue("error", `instruction_account_owner:${instruction.id}`, `مالک حساب مقصد دستور پرداخت «${instruction.id}» با گیرنده آن یکسان نیست.`));
      }
    }
    ensureMoneyValue(instruction.instructedAmount, `دستور پرداخت ${instruction.id}`, issues);
  }

  for (const payment of data.payments) {
    if (!partiesById.has(payment.payerPartyId)) {
      issues.push(issue("error", `orphan_payment_payer:${payment.id}`, `پرداخت «${payment.id}» به طرف پرداخت‌کننده موجود اشاره نمی‌کند.`));
    }
    if (!partiesById.has(payment.recipientPartyId)) {
      issues.push(issue("error", `orphan_payment_recipient:${payment.id}`, `پرداخت «${payment.id}» به گیرنده موجود اشاره نمی‌کند.`));
    }
    if (payment.destinationAccountId) {
      const destinationAccount = destinationAccountsById.get(payment.destinationAccountId);
      if (!destinationAccount) {
        issues.push(issue("error", `orphan_payment_account:${payment.id}`, `پرداخت «${payment.id}» به حساب مقصد موجود اشاره نمی‌کند.`));
      } else if (destinationAccount.ownerPartyId !== payment.recipientPartyId) {
        issues.push(issue("error", `payment_account_owner:${payment.id}`, `مالک حساب مقصد پرداخت «${payment.id}» با گیرنده آن یکسان نیست.`));
      }
    }
    ensureMoneyValue(payment.amount, `پرداخت ${payment.id}`, issues);
  }

  for (const allocation of data.paymentAllocations) {
    const payment = paymentsById.get(allocation.paymentId);
    const invoice = invoicesById.get(allocation.invoiceId);
    const instruction = allocation.paymentInstructionId ? instructionsById.get(allocation.paymentInstructionId) : undefined;

    if (!payment) {
      issues.push(issue("error", `orphan_allocation_payment:${allocation.id}`, `تخصیص «${allocation.id}» به پرداخت موجود اشاره نمی‌کند.`));
    }
    if (!invoice) {
      issues.push(issue("error", `orphan_allocation_invoice:${allocation.id}`, `تخصیص «${allocation.id}» به فاکتور موجود اشاره نمی‌کند.`));
    }
    if (allocation.paymentInstructionId && !instruction) {
      issues.push(issue("error", `orphan_allocation_instruction:${allocation.id}`, `تخصیص «${allocation.id}» به دستور پرداخت موجود اشاره نمی‌کند.`));
    }
    if (payment && invoice && payment.payerPartyId !== invoice.customerPartyId) {
      issues.push(issue("error", `allocation_customer_mismatch:${allocation.id}`, `تخصیص «${allocation.id}» مشتری فاکتور و پرداخت را یکسان نگه نمی‌دارد.`));
    }
    if (instruction && invoice && instruction.invoiceId !== invoice.id) {
      issues.push(issue("error", `allocation_instruction_invoice_mismatch:${allocation.id}`, `تخصیص «${allocation.id}» به دستور پرداختی از فاکتور دیگر اشاره می‌کند.`));
    }
    if (instruction && payment && instruction.recipientPartyId !== payment.recipientPartyId) {
      issues.push(issue("error", `allocation_instruction_recipient_mismatch:${allocation.id}`, `گیرنده دستور و پرداخت در تخصیص «${allocation.id}» یکسان نیست.`));
    }
    ensureMoneyValue(allocation.allocatedAmount, `تخصیص ${allocation.id}`, issues);
  }

  for (const verification of data.paymentVerifications) {
    if (!paymentsById.has(verification.paymentId)) {
      issues.push(issue("error", `orphan_verification:${verification.id}`, `تأیید پرداخت «${verification.id}» به پرداخت موجود اشاره نمی‌کند.`));
    }
  }

  for (const payment of data.payments) {
    const allocatedTotal = sumMoney(
      data.paymentAllocations.filter((allocation) => allocation.paymentId === payment.id).map((allocation) => allocation.allocatedAmount)
    );
    if (allocatedTotal > payment.amount) {
      issues.push(issue("error", `allocation_over_payment:${payment.id}`, `مجموع تخصیص‌های پرداخت «${payment.id}» از مبلغ آن بیشتر است.`));
    }
  }

  for (const invoice of data.invoices) {
    const activeInstructionTotal = sumMoney(
      data.paymentInstructions
        .filter((instruction) => instruction.invoiceId === invoice.id && instruction.lifecycleStatus === "active")
        .map((instruction) => instruction.instructedAmount)
    );
    if (activeInstructionTotal > invoice.totalAmount) {
      issues.push(issue("error", `instruction_over_invoice:${invoice.id}`, `مجموع دستورهای فعال فاکتور «${invoice.id}» از مبلغ فاکتور بیشتر است.`));
    }
  }

  for (const warning of findProbablePartyDuplicateWarnings(data.parties)) {
    issues.push(issue("warning", `party_duplicate:${warning.kind}:${warning.matchedValue}`, "مشابهت احتمالی در طرف‌ها پیدا شد."));
  }

  for (const warning of findProbableDestinationAccountDuplicateWarnings(data.destinationAccounts, data.parties)) {
    issues.push(issue("warning", `destination_account_duplicate:${warning.kind}:${warning.matchedValue}`, "مشابهت احتمالی در حساب‌های مقصد پیدا شد."));
  }

  for (const warning of findDuplicateTrackingReferenceWarnings(data.payments)) {
    if (warning.kind === "duplicate_tracking_reference") {
      issues.push(issue("warning", `duplicate_tracking_reference:${warning.trackingReference}`, "شماره پیگیری تکراری پیدا شد."));
    }
  }

  for (const warning of findProbablePaymentDuplicateWarnings(data.payments, data.parties, data.destinationAccounts)) {
    issues.push(issue("warning", `probable_payment_duplicate:${warning.payerPartyId}:${warning.recipientPartyId}:${warning.amount}`, "پرداخت مشابه احتمالی پیدا شد."));
  }

  // Keep the validation strict enough to reject stale or incomplete audit history.
  for (const auditEvent of data.auditEvents) {
    if (!auditEvent.description.trim()) {
      issues.push(issue("error", `audit_description:${auditEvent.id}`, `رویداد حسابرسی «${auditEvent.id}» توضیح معتبر ندارد.`));
    }
  }
  return issues;
}

export function getBackupRecordCountSummary(data: BackupData): string {
  const counts = buildBackupRecordCounts(data);
  return [
    counts.parties,
    counts.destinationAccounts,
    counts.invoices,
    counts.paymentInstructions,
    counts.payments,
    counts.paymentAllocations,
    counts.paymentVerifications,
    counts.auditEvents
  ]
    .map((value) => value.toLocaleString("fa-IR"))
    .join(" · ");
}
