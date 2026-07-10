import type { AuditEvent, Invoice, Party } from "../domain";
import {
  buildInvoiceRecord,
  filterInvoices,
  findProbableInvoiceDraftWarnings,
  invoiceDraftSchema,
  type InvoiceDraft,
  type InvoiceDuplicateWarning,
  type InvoiceListFilter
} from "../domain/invoices";

export interface InvoiceRepositoryDependencies {
  now?: () => string;
  createId?: () => string;
}

export interface InvoiceRepositoryDatabase {
  parties: { get(id: string): Promise<Party | undefined>; toArray(): Promise<Party[]> };
  invoices: {
    get(id: string): Promise<Invoice | undefined>;
    toArray(): Promise<Invoice[]>;
    put(invoice: Invoice): Promise<string>;
  };
  auditEvents: { put(event: AuditEvent): Promise<string> };
  transaction(mode: "rw", ...tablesAndCallback: unknown[]): Promise<unknown>;
}

export interface InvoiceAuditRecordInput {
  action: "created" | "updated" | "cancelled";
  invoice: Invoice;
  customerName: string;
  previousStatus?: string;
  nextStatus?: string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  return crypto.randomUUID();
}

function formatAction(action: InvoiceAuditRecordInput["action"]): string {
  if (action === "created") {
    return "ایجاد شد";
  }

  if (action === "updated") {
    return "ویرایش شد";
  }

  return "لغو شد";
}

function formatInvoiceSummary(invoice: Invoice, customerName: string): string {
  const referenceText = invoice.referenceNumber ? `، شماره/عنوان «${invoice.referenceNumber}»` : "";
  return `فاکتور مشتری «${customerName}» در تاریخ ${invoice.invoiceDate} با مبلغ ${invoice.totalAmount.toLocaleString("fa-IR")} تومان${referenceText}`;
}

function buildAuditEvent(input: InvoiceAuditRecordInput, timestamp: string, id: string): AuditEvent {
  return {
    id,
    entityType: "invoice",
    entityId: input.invoice.id,
    action: input.action,
    description: `${formatInvoiceSummary(input.invoice, input.customerName)} ${formatAction(input.action)}.`,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    createdAt: timestamp
  };
}

async function getPartyOrThrow(db: InvoiceRepositoryDatabase, partyId: string): Promise<Party> {
  const party = await db.parties.get(partyId);
  if (!party) {
    throw new Error("مشتری یافت نشد.");
  }

  return party;
}

function assertCustomerRole(party: Party): void {
  if (!party.roles.includes("customer")) {
    throw new Error("طرف انتخاب‌شده نقش مشتری ندارد.");
  }
}

function assertAmountValidity(draft: InvoiceDraft): void {
  if (!Number.isSafeInteger(draft.totalAmount) || draft.totalAmount <= 0) {
    throw new Error("مبلغ کل فاکتور باید یک تومانِ صحیح و بزرگ‌تر از صفر باشد.");
  }
}

export class InvoiceRepository {
  private readonly now: () => string;

  private readonly createId: () => string;

  constructor(private readonly db: InvoiceRepositoryDatabase, deps: InvoiceRepositoryDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.createId = deps.createId ?? defaultId;
  }

  async listInvoices(): Promise<Invoice[]> {
    const invoices = await this.db.invoices.toArray();
    const parties = await this.db.parties.toArray();
    return filterInvoices(invoices, parties, { query: "", status: "all" });
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.db.invoices.get(id);
  }

  async searchInvoices(filter: InvoiceListFilter): Promise<Invoice[]> {
    const invoices = await this.db.invoices.toArray();
    const parties = await this.db.parties.toArray();
    return filterInvoices(invoices, parties, filter);
  }

  async findProbableDuplicateWarnings(draft: InvoiceDraft, excludeInvoiceId?: string): Promise<InvoiceDuplicateWarning[]> {
    const invoices = await this.db.invoices.toArray();
    const parties = await this.db.parties.toArray();
    return findProbableInvoiceDraftWarnings(invoices, parties, draft, excludeInvoiceId);
  }

  async createInvoice(draft: InvoiceDraft): Promise<Invoice> {
    const parsedDraft = invoiceDraftSchema.parse({
      customerPartyId: draft.customerPartyId,
      invoiceDate: draft.invoiceDate,
      totalAmountText: String(draft.totalAmount),
      referenceNumber: draft.referenceNumber,
      note: draft.note
    });
    assertAmountValidity(parsedDraft);

    const customer = await getPartyOrThrow(this.db, parsedDraft.customerPartyId);
    assertCustomerRole(customer);
    if (!customer.active) {
      throw new Error("برای ثبت فاکتور جدید، مشتری باید فعال باشد.");
    }

    const now = this.now();
    const invoice = buildInvoiceRecord(this.createId(), parsedDraft, { createdAt: now, updatedAt: now }, "active");
    const audit = buildAuditEvent(
      { action: "created", invoice, customerName: customer.displayName, nextStatus: "active" },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.invoices, this.db.auditEvents, async () => {
      await this.db.invoices.put(invoice);
      await this.db.auditEvents.put(audit);
    });

    return invoice;
  }

  async updateInvoice(id: string, draft: InvoiceDraft): Promise<Invoice> {
    const existing = await this.getInvoice(id);
    if (!existing) {
      throw new Error("فاکتور پیدا نشد.");
    }

    if (existing.lifecycleStatus === "cancelled") {
      throw new Error("فاکتور لغوشده قابل ویرایش نیست.");
    }

    const parsedDraft = invoiceDraftSchema.parse({
      customerPartyId: draft.customerPartyId,
      invoiceDate: draft.invoiceDate,
      totalAmountText: String(draft.totalAmount),
      referenceNumber: draft.referenceNumber,
      note: draft.note
    });
    assertAmountValidity(parsedDraft);

    const customer = await getPartyOrThrow(this.db, parsedDraft.customerPartyId);
    assertCustomerRole(customer);
    if (parsedDraft.customerPartyId !== existing.customerPartyId && !customer.active) {
      throw new Error("برای تغییر مشتری، باید یک مشتری فعال انتخاب شود.");
    }

    const now = this.now();
    const invoice = buildInvoiceRecord(
      id,
      parsedDraft,
      { createdAt: existing.createdAt, updatedAt: now },
      existing.lifecycleStatus
    );
    const audit = buildAuditEvent(
      {
        action: "updated",
        invoice,
        customerName: customer.displayName,
        previousStatus: existing.lifecycleStatus,
        nextStatus: invoice.lifecycleStatus
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.invoices, this.db.auditEvents, async () => {
      await this.db.invoices.put(invoice);
      await this.db.auditEvents.put(audit);
    });

    return invoice;
  }

  async cancelInvoice(id: string): Promise<Invoice> {
    const existing = await this.getInvoice(id);
    if (!existing) {
      throw new Error("فاکتور پیدا نشد.");
    }

    if (existing.lifecycleStatus === "cancelled") {
      return existing;
    }

    const customer = await getPartyOrThrow(this.db, existing.customerPartyId);
    const now = this.now();
    const invoice = { ...existing, lifecycleStatus: "cancelled" as const, updatedAt: now };
    const audit = buildAuditEvent(
      {
        action: "cancelled",
        invoice,
        customerName: customer.displayName,
        previousStatus: existing.lifecycleStatus,
        nextStatus: "cancelled"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.invoices, this.db.auditEvents, async () => {
      await this.db.invoices.put(invoice);
      await this.db.auditEvents.put(audit);
    });

    return invoice;
  }
}

export function createInvoiceRepository(db: InvoiceRepositoryDatabase, deps?: InvoiceRepositoryDependencies): InvoiceRepository {
  return new InvoiceRepository(db, deps);
}
