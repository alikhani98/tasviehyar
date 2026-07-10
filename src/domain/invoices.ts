import { z } from "zod";
import type { Invoice, Party } from "./schemas";
import { invoiceSchema } from "./schemas";

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

export const invoiceStatusFilterValues = ["all", "active", "cancelled"] as const;
export type InvoiceStatusFilter = (typeof invoiceStatusFilterValues)[number];

export interface InvoiceListFilter {
  query: string;
  status: InvoiceStatusFilter;
}

export interface InvoiceDraft {
  customerPartyId: string;
  invoiceDate: string;
  totalAmount: number;
  referenceNumber?: string | undefined;
  note?: string | undefined;
}

export type InvoiceDuplicateWarning = {
  kind: "duplicate_invoice";
  matchedInvoiceIds: string[];
  matchedInvoiceSummaries: string[];
  customerNames: string[];
  matchedCustomerId: string;
  matchedInvoiceDate: string;
  matchedTotalAmount: number;
  matchedReferenceNumber: string | undefined;
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

export function normalizeInvoiceText(value: string): string {
  return normalizeDigitGlyphs(value)
    .replace(/[يی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function normalizeInvoiceReference(value: string): string {
  return normalizeInvoiceText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeInvoiceAmountText(value: string): string {
  return normalizeDigitGlyphs(value).replace(/[,\u066C\u060C_\s\u200c\u200f]/gu, "");
}

export function parseInvoiceAmountInput(value: string): number {
  const normalized = normalizeInvoiceAmountText(value);
  if (!normalized) {
    throw new Error("مبلغ کل فاکتور باید وارد شود.");
  }

  if (/[.\u066B]/u.test(value)) {
    throw new Error("مبلغ کل فاکتور باید به‌صورت عدد صحیح تومان وارد شود.");
  }

  if (!/^\d+$/.test(normalized)) {
    throw new Error("مبلغ کل فاکتور باید فقط شامل رقم باشد.");
  }

  const parsed = BigInt(normalized);
  if (parsed <= 0n) {
    throw new Error("مبلغ کل فاکتور باید بیشتر از صفر تومان باشد.");
  }

  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("مبلغ کل فاکتور از محدوده امن عددی فراتر می‌رود.");
  }

  return Number(parsed);
}

export function formatInvoiceAmount(amount: number): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

export function formatInvoiceDate(date: string): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function normalizeDraftValue(draft: {
  customerPartyId: string;
  invoiceDate: string;
  totalAmountText: string;
  referenceNumber?: string | undefined;
  note?: string | undefined;
}): InvoiceDraft {
  return {
    customerPartyId: draft.customerPartyId.trim(),
    invoiceDate: draft.invoiceDate,
    totalAmount: parseInvoiceAmountInput(draft.totalAmountText),
    referenceNumber: draft.referenceNumber ? draft.referenceNumber.trim() : undefined,
    note: draft.note ? draft.note.trim() : undefined
  };
}

export const invoiceDraftSchema = z
  .object({
    customerPartyId: z.string().trim().min(1, "مشتری باید انتخاب شود."),
    invoiceDate: z.string().date("تاریخ فاکتور معتبر نیست."),
    totalAmountText: rawTextSchema,
    referenceNumber: optionalTextSchema,
    note: optionalTextSchema
  })
  .superRefine((draft, ctx) => {
    try {
      parseInvoiceAmountInput(draft.totalAmountText);
    } catch (caught) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAmountText"],
        message: caught instanceof Error ? caught.message : "مبلغ کل فاکتور معتبر نیست."
      });
    }
  })
  .transform((draft) => normalizeDraftValue(draft));

export function parseInvoiceDraftFromInvoice(invoice: Invoice): InvoiceDraft {
  return invoiceDraftSchema.parse({
    customerPartyId: invoice.customerPartyId,
    invoiceDate: invoice.invoiceDate,
    totalAmountText: String(invoice.totalAmount),
    referenceNumber: invoice.referenceNumber ?? "",
    note: invoice.note ?? ""
  });
}

export function buildInvoiceRecord(
  id: string,
  draft: InvoiceDraft,
  timestamps: { createdAt: string; updatedAt: string },
  lifecycleStatus: Invoice["lifecycleStatus"]
): Invoice {
  return invoiceSchema.parse({
    id,
    customerPartyId: draft.customerPartyId,
    invoiceDate: draft.invoiceDate,
    referenceNumber: draft.referenceNumber,
    totalAmount: draft.totalAmount,
    note: draft.note,
    lifecycleStatus,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  });
}

function buildInvoiceSearchTarget(invoice: Invoice, partyName: string): string {
  return [
    partyName,
    invoice.referenceNumber ?? "",
    invoice.note ?? "",
    invoice.invoiceDate,
    String(invoice.totalAmount)
  ]
    .map(normalizeInvoiceText)
    .join(" ");
}

function invoiceDuplicateKey(invoice: Pick<Invoice, "customerPartyId" | "invoiceDate" | "totalAmount" | "referenceNumber">): string {
  const referenceKey = invoice.referenceNumber ? normalizeInvoiceReference(invoice.referenceNumber) : "";
  return [invoice.customerPartyId, invoice.invoiceDate, String(invoice.totalAmount), referenceKey].join("|");
}

function buildInvoiceSummary(invoice: Invoice, partyName: string): string {
  const refText = invoice.referenceNumber ? `، ${invoice.referenceNumber}` : "";
  return `${partyName}، ${invoice.invoiceDate}، ${formatInvoiceAmount(invoice.totalAmount)}${refText}`;
}

export function findProbableInvoiceDuplicateWarnings(
  invoices: readonly Invoice[],
  parties: readonly Party[]
): InvoiceDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const grouped = new Map<string, Invoice[]>();

  for (const invoice of invoices) {
    const key = invoiceDuplicateKey(invoice);
    const existing = grouped.get(key) ?? [];
    existing.push(invoice);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([, matches]) => {
      const first = matches[0]!;
      return {
        kind: "duplicate_invoice" as const,
        matchedInvoiceIds: Array.from(new Set(matches.map((invoice) => invoice.id))),
        matchedInvoiceSummaries: Array.from(
          new Set(matches.map((invoice) => buildInvoiceSummary(invoice, partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId)))
        ),
        customerNames: Array.from(new Set(matches.map((invoice) => partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId))),
        matchedCustomerId: first.customerPartyId,
        matchedInvoiceDate: first.invoiceDate,
        matchedTotalAmount: first.totalAmount,
        matchedReferenceNumber: first.referenceNumber
      } satisfies InvoiceDuplicateWarning;
    });
}

export function findProbableInvoiceDraftWarnings(
  invoices: readonly Invoice[],
  parties: readonly Party[],
  draft: InvoiceDraft,
  excludeInvoiceId?: string
): InvoiceDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const visibleInvoices = invoices.filter((invoice) => invoice.id !== excludeInvoiceId);
  const normalizedReference = draft.referenceNumber ? normalizeInvoiceReference(draft.referenceNumber) : "";
  const matchingInvoices = visibleInvoices.filter((invoice) => {
    if (invoice.customerPartyId !== draft.customerPartyId) {
      return false;
    }

    if (invoice.invoiceDate !== draft.invoiceDate || invoice.totalAmount !== draft.totalAmount) {
      return false;
    }

    if (!normalizedReference) {
      return true;
    }

    return normalizeInvoiceReference(invoice.referenceNumber ?? "") === normalizedReference;
  });

  if (matchingInvoices.length === 0) {
    return [];
  }

  const first = matchingInvoices[0]!;
  return [
    {
      kind: "duplicate_invoice",
      matchedInvoiceIds: matchingInvoices.map((invoice) => invoice.id),
      matchedInvoiceSummaries: matchingInvoices.map(
        (invoice) => buildInvoiceSummary(invoice, partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId)
      ),
      customerNames: Array.from(
        new Set(matchingInvoices.map((invoice) => partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId))
      ),
      matchedCustomerId: first.customerPartyId,
      matchedInvoiceDate: first.invoiceDate,
      matchedTotalAmount: first.totalAmount,
      matchedReferenceNumber: first.referenceNumber
    }
  ];
}

export function filterInvoices(invoices: readonly Invoice[], parties: readonly Party[], filter: InvoiceListFilter): Invoice[] {
  const query = normalizeInvoiceText(filter.query);
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));

  return invoices
    .filter((invoice) => {
      const matchesStatus =
        filter.status === "all" ||
        (filter.status === "active" && invoice.lifecycleStatus === "active") ||
        (filter.status === "cancelled" && invoice.lifecycleStatus === "cancelled");

      if (!matchesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const partyName = partiesById.get(invoice.customerPartyId)?.displayName ?? invoice.customerPartyId;
      const searchable = buildInvoiceSearchTarget(invoice, partyName);
      return searchable.includes(query);
    })
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt > right.createdAt ? -1 : 1;
      }

      if (left.invoiceDate !== right.invoiceDate) {
        return left.invoiceDate > right.invoiceDate ? -1 : 1;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function summarizeInvoiceForDisplay(invoice: Invoice, partyName: string): string {
  const reference = invoice.referenceNumber ? ` · ${invoice.referenceNumber}` : "";
  return `${partyName} · ${invoice.invoiceDate} · ${formatInvoiceAmount(invoice.totalAmount)}${reference}`;
}
