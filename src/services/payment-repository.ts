import type {
  AuditEvent,
  DestinationAccount,
  Invoice,
  Payment,
  PaymentAllocation,
  PaymentInstruction,
  PaymentVerification,
  Party
} from "../domain";
import {
  buildPaymentAllocationRecord,
  buildPaymentRecord,
  buildPaymentVerificationRecord,
  filterPayments,
  findProbablePaymentDraftWarnings,
  paymentAllocationDraftSchema,
  paymentDraftSchema,
  paymentVerificationDraftSchema,
  type PaymentAllocationDraft,
  type PaymentDraft,
  type PaymentDuplicateWarning,
  type PaymentListFilter,
  type PaymentVerificationDraft
} from "../domain/payments";
import { validateAllocationConsistency } from "../domain/validation";

export interface PaymentRepositoryDependencies {
  now?: () => string;
  createId?: () => string;
}

export interface PaymentRepositoryDatabase {
  parties: { get(id: string): Promise<Party | undefined>; toArray(): Promise<Party[]> };
  invoices: { get(id: string): Promise<Invoice | undefined>; toArray(): Promise<Invoice[]> };
  paymentInstructions: { get(id: string): Promise<PaymentInstruction | undefined>; toArray(): Promise<PaymentInstruction[]> };
  destinationAccounts: { get(id: string): Promise<DestinationAccount | undefined>; toArray(): Promise<DestinationAccount[]> };
  payments: {
    get(id: string): Promise<Payment | undefined>;
    toArray(): Promise<Payment[]>;
    put(payment: Payment): Promise<string>;
  };
  paymentAllocations: {
    get(id: string): Promise<PaymentAllocation | undefined>;
    toArray(): Promise<PaymentAllocation[]>;
    put(allocation: PaymentAllocation): Promise<string>;
  };
  paymentVerifications: {
    toArray(): Promise<PaymentVerification[]>;
    put(verification: PaymentVerification): Promise<string>;
  };
  auditEvents: { put(event: AuditEvent): Promise<string> };
  transaction(mode: "rw", ...tablesAndCallback: unknown[]): Promise<unknown>;
}

export interface PaymentVerificationAuditRecordInput {
  payment: Payment;
  verification: PaymentVerification;
}

export interface PaymentAuditRecordInput {
  action: "created" | "updated" | "cancelled" | "reversed";
  payment: Payment;
  payerName: string;
  recipientName: string;
  accountLabel?: string | undefined;
  previousStatus?: string;
  nextStatus?: string;
}

export interface PaymentAllocationAuditRecordInput {
  action: "created" | "updated";
  allocation: PaymentAllocation;
  invoiceReference?: string | undefined;
  instructionLabel?: string | undefined;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  return crypto.randomUUID();
}

function formatPaymentAction(action: PaymentAuditRecordInput["action"]): string {
  switch (action) {
    case "created":
      return "ثبت شد";
    case "updated":
      return "ویرایش شد";
    case "cancelled":
      return "لغو شد";
    case "reversed":
      return "برگشت خورد";
  }
}

function buildPaymentAuditEvent(input: PaymentAuditRecordInput, timestamp: string, id: string): AuditEvent {
  const accountText = input.accountLabel ? `، حساب «${input.accountLabel}»` : "، حساب مقصد تعیین نشده";
  return {
    id,
    entityType: "payment",
    entityId: input.payment.id,
    action: input.action,
    description: `پرداخت ${input.payment.amount.toLocaleString("fa-IR")} تومان از «${input.payerName}» به «${input.recipientName}» در تاریخ ${input.payment.paymentDate}${accountText} ${formatPaymentAction(input.action)}.`,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    createdAt: timestamp
  };
}

function buildVerificationAuditEvent(input: PaymentVerificationAuditRecordInput, timestamp: string, id: string): AuditEvent {
  return {
    id,
    entityType: "payment_verification",
    entityId: input.payment.id,
    action: "verified",
    description: `پرداخت ${input.payment.id} با نتیجه «${input.verification.verificationResult}» و روش «${input.verification.verificationMethod}» ثبت شد.`,
    previousStatus: input.payment.verificationStatus,
    nextStatus: input.verification.verificationResult,
    createdAt: timestamp
  };
}

function buildAllocationAuditEvent(input: PaymentAllocationAuditRecordInput, timestamp: string, id: string): AuditEvent {
  const invoiceText = input.invoiceReference ? `فاکتور «${input.invoiceReference}»` : `فاکتور ${input.allocation.invoiceId}`;
  const instructionText = input.instructionLabel ? `، دستور «${input.instructionLabel}»` : "";
  return {
    id,
    entityType: "payment_allocation",
    entityId: input.allocation.id,
    action: input.action,
    description: `تخصیص پرداخت به ${invoiceText}${instructionText} با مبلغ ${input.allocation.allocatedAmount.toLocaleString("fa-IR")} تومان ${input.action === "created" ? "ثبت شد" : "ویرایش شد"}.`,
    createdAt: timestamp
  };
}

async function getPartyOrThrow(db: PaymentRepositoryDatabase, partyId: string): Promise<Party> {
  const party = await db.parties.get(partyId);
  if (!party) {
    throw new Error("طرف یافت نشد.");
  }

  return party;
}

async function getInvoiceOrThrow(db: PaymentRepositoryDatabase, invoiceId: string): Promise<Invoice> {
  const invoice = await db.invoices.get(invoiceId);
  if (!invoice) {
    throw new Error("فاکتور یافت نشد.");
  }

  return invoice;
}

async function getInstructionOrThrow(db: PaymentRepositoryDatabase, instructionId: string): Promise<PaymentInstruction> {
  const instruction = await db.paymentInstructions.get(instructionId);
  if (!instruction) {
    throw new Error("دستور پرداخت یافت نشد.");
  }

  return instruction;
}

async function getAccountOrThrow(db: PaymentRepositoryDatabase, accountId: string): Promise<DestinationAccount> {
  const account = await db.destinationAccounts.get(accountId);
  if (!account) {
    throw new Error("حساب مقصد یافت نشد.");
  }

  return account;
}

function assertActiveParty(party: Party, roleLabel: string): void {
  if (!party.active) {
    throw new Error(`برای ثبت ${roleLabel}، طرف باید فعال باشد.`);
  }
}

function sumAllocationsForPayment(allocations: readonly PaymentAllocation[], paymentId: string, excludeAllocationId?: string): number {
  return allocations
    .filter((allocation) => allocation.paymentId === paymentId && allocation.id !== excludeAllocationId)
    .reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
}

async function ensureAllocationValidity(
  db: PaymentRepositoryDatabase,
  payment: Payment,
  draft: PaymentAllocationDraft,
  excludeAllocationId?: string
): Promise<{ invoice: Invoice; instruction: PaymentInstruction | undefined }> {
  const parsedDraft = paymentAllocationDraftSchema.parse({
    invoiceId: draft.invoiceId,
    paymentInstructionId: draft.paymentInstructionId,
    allocatedAmountText: String(draft.allocatedAmount)
  });

  if (payment.lifecycleStatus !== "active") {
    throw new Error("پرداخت لغوشده یا برگشتی، تخصیص جدید نمی‌پذیرد.");
  }

  const invoice = await getInvoiceOrThrow(db, parsedDraft.invoiceId);
  if (invoice.lifecycleStatus === "cancelled") {
    throw new Error("فاکتور لغوشده تخصیص جدید نمی‌پذیرد.");
  }

  const payer = await getPartyOrThrow(db, payment.payerPartyId);
  const invoiceCustomer = await getPartyOrThrow(db, invoice.customerPartyId);
  if (payment.payerPartyId !== invoice.customerPartyId || payer.id !== invoiceCustomer.id) {
    throw new Error("پرداخت باید به فاکتور مشتری درست تخصیص یابد.");
  }

  const instruction = parsedDraft.paymentInstructionId ? await getInstructionOrThrow(db, parsedDraft.paymentInstructionId) : undefined;
  if (instruction) {
    if (instruction.invoiceId !== invoice.id) {
      throw new Error("دستور پرداخت باید به همان فاکتور تخصیص داده شود.");
    }

    if (instruction.lifecycleStatus === "cancelled") {
      throw new Error("دستور لغوشده تخصیص جدید نمی‌پذیرد.");
    }

    if (instruction.recipientPartyId !== payment.recipientPartyId) {
      throw new Error("گیرنده پرداخت و دستور پرداخت باید یکسان باشند.");
    }
  }

  if (payment.destinationAccountId) {
    const account = await getAccountOrThrow(db, payment.destinationAccountId);
    if (!account.active) {
      throw new Error("حساب مقصد غیرفعال برای تخصیص معتبر نیست.");
    }
    if (account.ownerPartyId !== payment.recipientPartyId) {
      throw new Error("حساب مقصد باید متعلق به گیرنده پرداخت باشد.");
    }
  }

  const allocations = await db.paymentAllocations.toArray();
  const allocatedAmount = sumAllocationsForPayment(allocations, payment.id, excludeAllocationId);
  if (allocatedAmount + parsedDraft.allocatedAmount > payment.amount) {
    throw new Error("مجموع تخصیص‌ها نمی‌تواند از مبلغ پرداخت بیشتر شود.");
  }

  validateAllocationConsistency({
    invoice,
    payment,
    allocation: {
      id: excludeAllocationId ?? "allocation_preview",
      paymentId: payment.id,
      invoiceId: invoice.id,
      paymentInstructionId: parsedDraft.paymentInstructionId,
      allocatedAmount: parsedDraft.allocatedAmount,
      createdAt: new Date().toISOString()
    },
    instruction,
    destinationAccount: payment.destinationAccountId ? await getAccountOrThrow(db, payment.destinationAccountId) : undefined,
    remainingAllocatableAmount: payment.amount - allocatedAmount
  });

  return { invoice, instruction };
}

async function ensurePaymentUpdateAllowed(existing: Payment): Promise<void> {
  if (existing.lifecycleStatus !== "active") {
    throw new Error("پرداخت لغوشده یا برگشتی قابل ویرایش نیست.");
  }

  if (existing.verificationStatus !== "reported") {
    throw new Error("پرداخت‌های تأییدشده یا مورد اختلاف باید با وضعیت‌گذاری صریح اصلاح شوند.");
  }
}

export class PaymentRepository {
  private readonly now: () => string;

  private readonly createId: () => string;

  constructor(private readonly db: PaymentRepositoryDatabase, deps: PaymentRepositoryDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.createId = deps.createId ?? defaultId;
  }

  async listPayments(): Promise<Payment[]> {
    return this.db.payments.toArray();
  }

  async getPayment(id: string): Promise<Payment | undefined> {
    return this.db.payments.get(id);
  }

  async searchPayments(filter: {
    query: string;
    lifecycleStatus: "all" | "active" | "cancelled" | "reversed";
    verificationStatus: "all" | "reported" | "confirmed" | "rejected" | "disputed";
  }): Promise<Payment[]> {
    const payments = await this.db.payments.toArray();
    const parties = await this.db.parties.toArray();
    const destinationAccounts = await this.db.destinationAccounts.toArray();
    const invoices = await this.db.invoices.toArray();
    const instructions = await this.db.paymentInstructions.toArray();
    const allocations = await this.db.paymentAllocations.toArray();
    const listFilter: PaymentListFilter = filter;
    return filterPayments(payments, parties, destinationAccounts, invoices, instructions, allocations, listFilter);
  }

  async findProbableDuplicateWarnings(draft: PaymentDraft, excludePaymentId?: string): Promise<PaymentDuplicateWarning[]> {
    const payments = await this.db.payments.toArray();
    const parties = await this.db.parties.toArray();
    const destinationAccounts = await this.db.destinationAccounts.toArray();
    return findProbablePaymentDraftWarnings(payments, parties, destinationAccounts, draft, excludePaymentId);
  }

  async createPayment(draft: PaymentDraft, initialAllocation?: PaymentAllocationDraft, initialVerification?: PaymentVerificationDraft): Promise<Payment> {
    const parsedDraft = paymentDraftSchema.parse({
      payerPartyId: draft.payerPartyId,
      recipientPartyId: draft.recipientPartyId,
      destinationAccountId: draft.destinationAccountId,
      amountText: String(draft.amount),
      paymentDate: draft.paymentDate,
      paymentMethod: draft.paymentMethod,
      verificationStatus: draft.verificationStatus,
      trackingReference: draft.trackingReference,
      note: draft.note
    });

    const payer = await getPartyOrThrow(this.db, parsedDraft.payerPartyId);
    const recipient = await getPartyOrThrow(this.db, parsedDraft.recipientPartyId);
    assertActiveParty(payer, "پرداخت");
    assertActiveParty(recipient, "پرداخت");

    let account: DestinationAccount | undefined;
    if (parsedDraft.destinationAccountId) {
      account = await getAccountOrThrow(this.db, parsedDraft.destinationAccountId);
      if (!account.active) {
        throw new Error("حساب مقصد غیرفعال قابل انتخاب نیست.");
      }
      if (account.ownerPartyId !== recipient.id) {
        throw new Error("حساب مقصد باید متعلق به گیرنده پرداخت باشد.");
      }
    }

    const now = this.now();
    const payment = buildPaymentRecord(this.createId(), parsedDraft, { createdAt: now, updatedAt: now }, "active");
    const auditEvents: AuditEvent[] = [
      buildPaymentAuditEvent(
        {
          action: "created",
          payment,
          payerName: payer.displayName,
          recipientName: recipient.displayName,
          accountLabel: account?.accountLabel,
          nextStatus: "active"
        },
        now,
        this.createId()
      )
    ];

    const allocationRecords: PaymentAllocation[] = [];
    const verificationRecords: PaymentVerification[] = [];

    if (initialAllocation) {
      const { invoice, instruction } = await ensureAllocationValidity(this.db, payment, initialAllocation);
      const allocationDraft = paymentAllocationDraftSchema.parse({
        invoiceId: invoice.id,
        paymentInstructionId: instruction?.id ?? initialAllocation.paymentInstructionId ?? "",
        allocatedAmountText: String(initialAllocation.allocatedAmount)
      });
      const allocation = buildPaymentAllocationRecord(this.createId(), payment.id, allocationDraft, now);
      const allocationRecord = allocation;
      allocationRecords.push(allocationRecord);
      auditEvents.push(
        buildAllocationAuditEvent(
          {
            action: "created",
            allocation: allocationRecord,
            invoiceReference: invoice.referenceNumber ?? invoice.id,
            instructionLabel: instruction?.id
          },
          now,
          this.createId()
        )
      );
    }

    if (parsedDraft.verificationStatus !== "reported") {
      const verificationDraft = initialVerification
        ? paymentVerificationDraftSchema.parse(initialVerification)
        : paymentVerificationDraftSchema.parse({
            verificationResult: parsedDraft.verificationStatus,
            verifierDescriptionOrPartyRef: "ثبت اولیه",
            verificationMethod: "other",
            note: undefined
          });
      if (verificationDraft.verificationResult !== parsedDraft.verificationStatus) {
        throw new Error("وضعیت اولیه و نتیجه تأیید اولیه باید یکسان باشند.");
      }
      const verification = buildPaymentVerificationRecord(this.createId(), payment.id, verificationDraft, {
        createdAt: now,
        verifiedAt: now
      });
      verificationRecords.push(verification);
      auditEvents.push(buildVerificationAuditEvent({ payment, verification }, now, this.createId()));
    }

    await this.db.transaction(
      "rw",
      this.db.payments,
      this.db.paymentAllocations,
      this.db.paymentVerifications,
      this.db.auditEvents,
      async () => {
        await this.db.payments.put(payment);
        for (const allocation of allocationRecords) {
          await this.db.paymentAllocations.put(allocation);
        }
        for (const verification of verificationRecords) {
          await this.db.paymentVerifications.put(verification);
        }
        for (const audit of auditEvents) {
          await this.db.auditEvents.put(audit);
        }
      }
    );

    return payment;
  }

  async updatePayment(id: string, draft: PaymentDraft): Promise<Payment> {
    const existing = await this.getPayment(id);
    if (!existing) {
      throw new Error("پرداخت یافت نشد.");
    }

    await ensurePaymentUpdateAllowed(existing);

    const parsedDraft = paymentDraftSchema.parse({
      payerPartyId: draft.payerPartyId,
      recipientPartyId: draft.recipientPartyId,
      destinationAccountId: draft.destinationAccountId,
      amountText: String(draft.amount),
      paymentDate: draft.paymentDate,
      paymentMethod: draft.paymentMethod,
      verificationStatus: draft.verificationStatus,
      trackingReference: draft.trackingReference,
      note: draft.note
    });

    if (parsedDraft.verificationStatus !== existing.verificationStatus) {
      throw new Error("تغییر وضعیت تأیید فقط از مسیر ثبت تأیید مجاز است.");
    }

    const payer = await getPartyOrThrow(this.db, parsedDraft.payerPartyId);
    const recipient = await getPartyOrThrow(this.db, parsedDraft.recipientPartyId);
    if (parsedDraft.payerPartyId !== existing.payerPartyId) {
      assertActiveParty(payer, "پرداخت");
    }
    if (parsedDraft.recipientPartyId !== existing.recipientPartyId) {
      assertActiveParty(recipient, "پرداخت");
    }

    let account: DestinationAccount | undefined;
    if (parsedDraft.destinationAccountId) {
      account = await getAccountOrThrow(this.db, parsedDraft.destinationAccountId);
      if (!account.active) {
        throw new Error("حساب مقصد غیرفعال قابل انتخاب نیست.");
      }
      if (account.ownerPartyId !== recipient.id) {
        throw new Error("حساب مقصد باید متعلق به گیرنده پرداخت باشد.");
      }
    }

    const now = this.now();
    const payment = buildPaymentRecord(id, parsedDraft, { createdAt: existing.createdAt, updatedAt: now }, existing.lifecycleStatus);
    const audit = buildPaymentAuditEvent(
      {
        action: "updated",
        payment,
        payerName: payer.displayName,
        recipientName: recipient.displayName,
        accountLabel: account?.accountLabel,
        previousStatus: existing.lifecycleStatus,
        nextStatus: existing.lifecycleStatus
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.payments, this.db.auditEvents, async () => {
      await this.db.payments.put(payment);
      await this.db.auditEvents.put(audit);
    });

    return payment;
  }

  async cancelPayment(id: string): Promise<Payment> {
    const existing = await this.getPayment(id);
    if (!existing) {
      throw new Error("پرداخت یافت نشد.");
    }

    if (existing.lifecycleStatus === "cancelled") {
      return existing;
    }

    const payer = await getPartyOrThrow(this.db, existing.payerPartyId);
    const recipient = await getPartyOrThrow(this.db, existing.recipientPartyId);
    const account = existing.destinationAccountId ? await this.db.destinationAccounts.get(existing.destinationAccountId) : undefined;
    const now = this.now();
    const payment = { ...existing, lifecycleStatus: "cancelled" as const, updatedAt: now };
    const audit = buildPaymentAuditEvent(
      {
        action: "cancelled",
        payment,
        payerName: payer.displayName,
        recipientName: recipient.displayName,
        accountLabel: account?.accountLabel,
        previousStatus: existing.lifecycleStatus,
        nextStatus: "cancelled"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.payments, this.db.auditEvents, async () => {
      await this.db.payments.put(payment);
      await this.db.auditEvents.put(audit);
    });

    return payment;
  }

  async reversePayment(id: string): Promise<Payment> {
    const existing = await this.getPayment(id);
    if (!existing) {
      throw new Error("پرداخت یافت نشد.");
    }

    if (existing.lifecycleStatus === "reversed") {
      return existing;
    }

    const payer = await getPartyOrThrow(this.db, existing.payerPartyId);
    const recipient = await getPartyOrThrow(this.db, existing.recipientPartyId);
    const account = existing.destinationAccountId ? await this.db.destinationAccounts.get(existing.destinationAccountId) : undefined;
    const now = this.now();
    const payment = { ...existing, lifecycleStatus: "reversed" as const, updatedAt: now };
    const audit = buildPaymentAuditEvent(
      {
        action: "reversed",
        payment,
        payerName: payer.displayName,
        recipientName: recipient.displayName,
        accountLabel: account?.accountLabel,
        previousStatus: existing.lifecycleStatus,
        nextStatus: "reversed"
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.payments, this.db.auditEvents, async () => {
      await this.db.payments.put(payment);
      await this.db.auditEvents.put(audit);
    });

    return payment;
  }

  async listAllocations(): Promise<PaymentAllocation[]> {
    return this.db.paymentAllocations.toArray();
  }

  async listAllocationsByPayment(paymentId: string): Promise<PaymentAllocation[]> {
    return (await this.db.paymentAllocations.toArray()).filter((allocation) => allocation.paymentId === paymentId);
  }

  async createAllocation(paymentId: string, draft: PaymentAllocationDraft): Promise<PaymentAllocation> {
    const payment = await this.getPayment(paymentId);
    if (!payment) {
      throw new Error("پرداخت یافت نشد.");
    }

    const { invoice, instruction } = await ensureAllocationValidity(this.db, payment, draft);
    const allocationDraft = paymentAllocationDraftSchema.parse({
      invoiceId: invoice.id,
      paymentInstructionId: instruction?.id ?? draft.paymentInstructionId ?? "",
      allocatedAmountText: String(draft.allocatedAmount)
    });
    const now = this.now();
    const allocation = {
      ...buildPaymentAllocationRecord(this.createId(), paymentId, allocationDraft, now)
    };
    const audit = buildAllocationAuditEvent(
      {
        action: "created",
        allocation,
        invoiceReference: invoice.referenceNumber ?? invoice.id,
        instructionLabel: instruction?.id
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentAllocations, this.db.auditEvents, async () => {
      await this.db.paymentAllocations.put(allocation);
      await this.db.auditEvents.put(audit);
    });

    return allocation;
  }

  async updateAllocation(allocationId: string, draft: PaymentAllocationDraft): Promise<PaymentAllocation> {
    const existing = await this.db.paymentAllocations.get(allocationId);
    if (!existing) {
      throw new Error("تخصیص یافت نشد.");
    }

    const payment = await this.getPayment(existing.paymentId);
    if (!payment) {
      throw new Error("پرداخت یافت نشد.");
    }

    const { invoice, instruction } = await ensureAllocationValidity(this.db, payment, draft, existing.id);
    const allocationDraft = paymentAllocationDraftSchema.parse({
      invoiceId: invoice.id,
      paymentInstructionId: instruction?.id ?? draft.paymentInstructionId ?? "",
      allocatedAmountText: String(draft.allocatedAmount)
    });
    const now = this.now();
    const allocation = {
      ...buildPaymentAllocationRecord(existing.id, existing.paymentId, allocationDraft, now),
      paymentId: existing.paymentId,
      createdAt: existing.createdAt
    };
    const audit = buildAllocationAuditEvent(
      {
        action: "updated",
        allocation,
        invoiceReference: invoice.referenceNumber ?? invoice.id,
        instructionLabel: instruction?.id
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.paymentAllocations, this.db.auditEvents, async () => {
      await this.db.paymentAllocations.put(allocation);
      await this.db.auditEvents.put(audit);
    });

    return allocation;
  }

  async listVerifications(): Promise<PaymentVerification[]> {
    return this.db.paymentVerifications.toArray();
  }

  async listVerificationsByPayment(paymentId: string): Promise<PaymentVerification[]> {
    return (await this.db.paymentVerifications.toArray()).filter((verification) => verification.paymentId === paymentId);
  }

  async recordVerification(paymentId: string, draft: PaymentVerificationDraft): Promise<PaymentVerification> {
    const payment = await this.getPayment(paymentId);
    if (!payment) {
      throw new Error("پرداخت یافت نشد.");
    }

    if (payment.lifecycleStatus !== "active") {
      throw new Error("پرداخت لغوشده یا برگشتی، تأیید جدید نمی‌پذیرد.");
    }

    const parsedDraft = paymentVerificationDraftSchema.parse(draft);
    const now = this.now();
    const verification = buildPaymentVerificationRecord(this.createId(), paymentId, parsedDraft, { createdAt: now, verifiedAt: now });
    const updatedPayment = { ...payment, verificationStatus: parsedDraft.verificationResult, updatedAt: now };
    const payer = await getPartyOrThrow(this.db, payment.payerPartyId);
    const recipient = await getPartyOrThrow(this.db, payment.recipientPartyId);
    const account = payment.destinationAccountId ? await this.db.destinationAccounts.get(payment.destinationAccountId) : undefined;
    const paymentAudit = buildPaymentAuditEvent(
      {
        action: "updated",
        payment: updatedPayment,
        payerName: payer.displayName,
        recipientName: recipient.displayName,
        accountLabel: account?.accountLabel,
        previousStatus: payment.lifecycleStatus,
        nextStatus: payment.lifecycleStatus
      },
      now,
      this.createId()
    );
    const verificationAudit = buildVerificationAuditEvent({ payment: updatedPayment, verification }, now, this.createId());

    await this.db.transaction("rw", this.db.payments, this.db.paymentVerifications, this.db.auditEvents, async () => {
      await this.db.payments.put(updatedPayment);
      await this.db.paymentVerifications.put(verification);
      await this.db.auditEvents.put(paymentAudit);
      await this.db.auditEvents.put(verificationAudit);
    });

    return verification;
  }
}

export function createPaymentRepository(db: PaymentRepositoryDatabase, deps?: PaymentRepositoryDependencies): PaymentRepository {
  return new PaymentRepository(db, deps);
}
