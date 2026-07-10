import type { AuditEvent, DestinationAccount, Invoice, Party, PaymentInstruction } from "../domain";
import {
  buildPaymentInstructionRecord,
  findProbablePaymentInstructionDraftWarnings,
  paymentInstructionDraftSchema,
  type PaymentInstructionDraft,
  type PaymentInstructionDuplicateWarning
} from "../domain/payment-instructions";

export interface PaymentInstructionRepositoryDependencies {
  now?: () => string;
  createId?: () => string;
}

export interface PaymentInstructionRepositoryDatabase {
  invoices: { get(id: string): Promise<Invoice | undefined> };
  parties: { get(id: string): Promise<Party | undefined>; toArray(): Promise<Party[]> };
  destinationAccounts: { get(id: string): Promise<DestinationAccount | undefined>; toArray(): Promise<DestinationAccount[]> };
  paymentInstructions: {
    get(id: string): Promise<PaymentInstruction | undefined>;
    toArray(): Promise<PaymentInstruction[]>;
    put(instruction: PaymentInstruction): Promise<string>;
  };
  auditEvents: { put(event: AuditEvent): Promise<string> };
  transaction(mode: "rw", ...tablesAndCallback: unknown[]): Promise<unknown>;
}

export interface PaymentInstructionAuditRecordInput {
  action: "created" | "updated" | "cancelled" | "restored";
  instruction: PaymentInstruction;
  invoiceTotal: number;
  recipientName: string;
  accountLabel?: string | undefined;
  previousStatus?: string;
  nextStatus?: string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  return crypto.randomUUID();
}

function formatAction(action: PaymentInstructionAuditRecordInput["action"]): string {
  switch (action) {
    case "created":
      return "ایجاد شد";
    case "updated":
      return "ویرایش شد";
    case "cancelled":
      return "لغو شد";
    case "restored":
      return "بازیابی شد";
  }
}

function buildAuditEvent(input: PaymentInstructionAuditRecordInput, timestamp: string, id: string): AuditEvent {
  const accountText = input.accountLabel ? `، حساب «${input.accountLabel}»` : "، حساب هنوز تعیین نشده";
  return {
    id,
    entityType: "payment_instruction",
    entityId: input.instruction.id,
    action: input.action,
    description: `دستور پرداخت برای «${input.recipientName}» در فاکتور ${input.instruction.invoiceId} با مبلغ ${input.instruction.instructedAmount.toLocaleString("fa-IR")} تومان${accountText} ${formatAction(input.action)}.`,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    createdAt: timestamp
  };
}

async function getInvoiceOrThrow(db: PaymentInstructionRepositoryDatabase, invoiceId: string): Promise<Invoice> {
  const invoice = await db.invoices.get(invoiceId);
  if (!invoice) {
    throw new Error("فاکتور یافت نشد.");
  }

  return invoice;
}

async function getPartyOrThrow(db: PaymentInstructionRepositoryDatabase, partyId: string): Promise<Party> {
  const party = await db.parties.get(partyId);
  if (!party) {
    throw new Error("گیرنده یافت نشد.");
  }

  return party;
}

async function getAccountOrThrow(db: PaymentInstructionRepositoryDatabase, accountId: string): Promise<DestinationAccount> {
  const account = await db.destinationAccounts.get(accountId);
  if (!account) {
    throw new Error("حساب مقصد یافت نشد.");
  }

  return account;
}

async function ensureInstructionTotalWithinInvoice(
  db: PaymentInstructionRepositoryDatabase,
  invoice: Invoice,
  nextAmount: number,
  excludeInstructionId?: string
): Promise<void> {
  const instructions = await db.paymentInstructions.toArray();
  const activeTotal = instructions
    .filter((instruction) => instruction.invoiceId === invoice.id && instruction.lifecycleStatus === "active" && instruction.id !== excludeInstructionId)
    .reduce((sum, instruction) => sum + instruction.instructedAmount, 0);

  if (activeTotal + nextAmount > invoice.totalAmount) {
    throw new Error("مجموع دستورهای فعال نمی‌تواند از مبلغ فاکتور بیشتر شود.");
  }
}

function assertActiveParty(party: Party): void {
  if (!party.active) {
    throw new Error("برای انتخاب گیرنده، طرف باید فعال باشد.");
  }
}

function assertAccountOwnership(account: DestinationAccount, party: Party): void {
  if (!account.active) {
    throw new Error("فقط حساب فعال قابل انتخاب است.");
  }

  if (account.ownerPartyId !== party.id) {
    throw new Error("حساب مقصد باید متعلق به گیرنده انتخاب‌شده باشد.");
  }
}

export class PaymentInstructionRepository {
  private readonly now: () => string;

  private readonly createId: () => string;

  constructor(private readonly db: PaymentInstructionRepositoryDatabase, deps: PaymentInstructionRepositoryDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.createId = deps.createId ?? defaultId;
  }

  async listInstructions(): Promise<PaymentInstruction[]> {
    return this.db.paymentInstructions.toArray();
  }

  async listInstructionsByInvoice(invoiceId: string): Promise<PaymentInstruction[]> {
    return (await this.db.paymentInstructions.toArray()).filter((instruction) => instruction.invoiceId === invoiceId);
  }

  async getInstruction(id: string): Promise<PaymentInstruction | undefined> {
    return this.db.paymentInstructions.get(id);
  }

  async findProbableDuplicateWarnings(
    draft: PaymentInstructionDraft,
    excludeInstructionId?: string
  ): Promise<PaymentInstructionDuplicateWarning[]> {
    const instructions = await this.db.paymentInstructions.toArray();
    const parties = await this.db.parties.toArray();
    const destinationAccounts = await this.db.destinationAccounts.toArray();
    return findProbablePaymentInstructionDraftWarnings(instructions, parties, destinationAccounts, draft, excludeInstructionId);
  }

  async createInstruction(draft: PaymentInstructionDraft): Promise<PaymentInstruction> {
    const parsedDraft = paymentInstructionDraftSchema.parse({
      invoiceId: draft.invoiceId,
      recipientPartyId: draft.recipientPartyId,
      destinationAccountId: draft.destinationAccountId,
      instructedAmountText: String(draft.instructedAmount),
      note: draft.note
    });

    const invoice = await getInvoiceOrThrow(this.db, parsedDraft.invoiceId);
    if (invoice.lifecycleStatus === "cancelled") {
      throw new Error("فاکتور لغوشده فقط خواندنی است.");
    }

    const recipient = await getPartyOrThrow(this.db, parsedDraft.recipientPartyId);
    assertActiveParty(recipient);

    if (parsedDraft.destinationAccountId) {
      const account = await getAccountOrThrow(this.db, parsedDraft.destinationAccountId);
      assertAccountOwnership(account, recipient);
    }

    await ensureInstructionTotalWithinInvoice(this.db, invoice, parsedDraft.instructedAmount);

    const now = this.now();
    const instruction = buildPaymentInstructionRecord(this.createId(), parsedDraft, { createdAt: now, updatedAt: now }, "active");
    const audit = buildAuditEvent(
      {
        action: "created",
        instruction,
        invoiceTotal: invoice.totalAmount,
        recipientName: recipient.displayName,
        accountLabel: parsedDraft.destinationAccountId
          ? (await this.db.destinationAccounts.get(parsedDraft.destinationAccountId))?.accountLabel
          : undefined,
        nextStatus: "active"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentInstructions, this.db.auditEvents, async () => {
      await this.db.paymentInstructions.put(instruction);
      await this.db.auditEvents.put(audit);
    });

    return instruction;
  }

  async updateInstruction(id: string, draft: PaymentInstructionDraft): Promise<PaymentInstruction> {
    const existing = await this.getInstruction(id);
    if (!existing) {
      throw new Error("دستور پرداخت یافت نشد.");
    }

    if (existing.lifecycleStatus === "cancelled") {
      throw new Error("دستور لغوشده قابل ویرایش نیست.");
    }

    const parsedDraft = paymentInstructionDraftSchema.parse({
      invoiceId: draft.invoiceId,
      recipientPartyId: draft.recipientPartyId,
      destinationAccountId: draft.destinationAccountId,
      instructedAmountText: String(draft.instructedAmount),
      note: draft.note
    });

    if (parsedDraft.invoiceId !== existing.invoiceId) {
      throw new Error("فاکتور دستور پرداخت قابل تغییر نیست.");
    }

    const invoice = await getInvoiceOrThrow(this.db, existing.invoiceId);
    const recipient = await getPartyOrThrow(this.db, parsedDraft.recipientPartyId);
    if (parsedDraft.recipientPartyId !== existing.recipientPartyId || recipient.active) {
      assertActiveParty(recipient);
    }

    if (parsedDraft.destinationAccountId) {
      const account = await getAccountOrThrow(this.db, parsedDraft.destinationAccountId);
      assertAccountOwnership(account, recipient);
    }

    await ensureInstructionTotalWithinInvoice(this.db, invoice, parsedDraft.instructedAmount, existing.id);

    const now = this.now();
    const instruction = buildPaymentInstructionRecord(
      id,
      parsedDraft,
      { createdAt: existing.createdAt, updatedAt: now },
      existing.lifecycleStatus
    );
    const audit = buildAuditEvent(
      {
        action: "updated",
        instruction,
        invoiceTotal: invoice.totalAmount,
        recipientName: recipient.displayName,
        accountLabel: parsedDraft.destinationAccountId
          ? (await this.db.destinationAccounts.get(parsedDraft.destinationAccountId))?.accountLabel
          : undefined,
        previousStatus: existing.lifecycleStatus,
        nextStatus: instruction.lifecycleStatus
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentInstructions, this.db.auditEvents, async () => {
      await this.db.paymentInstructions.put(instruction);
      await this.db.auditEvents.put(audit);
    });

    return instruction;
  }

  async cancelInstruction(id: string): Promise<PaymentInstruction> {
    const existing = await this.getInstruction(id);
    if (!existing) {
      throw new Error("دستور پرداخت یافت نشد.");
    }

    if (existing.lifecycleStatus === "cancelled") {
      return existing;
    }

    const recipient = await getPartyOrThrow(this.db, existing.recipientPartyId);
    const invoice = await getInvoiceOrThrow(this.db, existing.invoiceId);
    const account = existing.destinationAccountId ? await this.db.destinationAccounts.get(existing.destinationAccountId) : undefined;
    const now = this.now();
    const instruction = { ...existing, lifecycleStatus: "cancelled" as const, updatedAt: now };
    const audit = buildAuditEvent(
      {
        action: "cancelled",
        instruction,
        invoiceTotal: invoice.totalAmount,
        recipientName: recipient.displayName,
        accountLabel: account?.accountLabel,
        previousStatus: existing.lifecycleStatus,
        nextStatus: "cancelled"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentInstructions, this.db.auditEvents, async () => {
      await this.db.paymentInstructions.put(instruction);
      await this.db.auditEvents.put(audit);
    });

    return instruction;
  }

  async restoreInstruction(id: string): Promise<PaymentInstruction> {
    const existing = await this.getInstruction(id);
    if (!existing) {
      throw new Error("دستور پرداخت یافت نشد.");
    }

    if (existing.lifecycleStatus === "active") {
      return existing;
    }

    const invoice = await getInvoiceOrThrow(this.db, existing.invoiceId);
    if (invoice.lifecycleStatus === "cancelled") {
      throw new Error("فاکتور لغوشده فقط خواندنی است.");
    }

    const recipient = await getPartyOrThrow(this.db, existing.recipientPartyId);
    assertActiveParty(recipient);

    if (existing.destinationAccountId) {
      const account = await getAccountOrThrow(this.db, existing.destinationAccountId);
      assertAccountOwnership(account, recipient);
    }

    await ensureInstructionTotalWithinInvoice(this.db, invoice, existing.instructedAmount);

    const now = this.now();
    const instruction = { ...existing, lifecycleStatus: "active" as const, updatedAt: now };
    const audit = buildAuditEvent(
      {
        action: "restored",
        instruction,
        invoiceTotal: invoice.totalAmount,
        recipientName: recipient.displayName,
        accountLabel: existing.destinationAccountId
          ? (await this.db.destinationAccounts.get(existing.destinationAccountId))?.accountLabel
          : undefined,
        previousStatus: existing.lifecycleStatus,
        nextStatus: "active"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentInstructions, this.db.auditEvents, async () => {
      await this.db.paymentInstructions.put(instruction);
      await this.db.auditEvents.put(audit);
    });

    return instruction;
  }
}

export function createPaymentInstructionRepository(
  db: PaymentInstructionRepositoryDatabase,
  deps?: PaymentInstructionRepositoryDependencies
): PaymentInstructionRepository {
  return new PaymentInstructionRepository(db, deps);
}
