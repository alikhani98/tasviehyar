import type { AuditEvent, DestinationAccount, Party } from "../domain";
import { buildDestinationAccountRecord, destinationAccountDraftSchema, type DestinationAccountDraft } from "../domain/destination-accounts";

export interface DestinationAccountRepositoryDependencies {
  now?: () => string;
  createId?: () => string;
}

export interface DestinationAccountRepositoryDatabase {
  parties: { get(id: string): Promise<Party | undefined> };
  destinationAccounts: {
    get(id: string): Promise<DestinationAccount | undefined>;
    toArray(): Promise<DestinationAccount[]>;
    put(account: DestinationAccount): Promise<string>;
    where(index: string): { equals(value: unknown): { toArray(): Promise<DestinationAccount[]> } };
  };
  auditEvents: { put(event: AuditEvent): Promise<string> };
  transaction(mode: "rw", ...tablesAndCallback: unknown[]): Promise<unknown>;
}

export interface DestinationAccountAuditRecordInput {
  action: "created" | "updated" | "archived" | "restored";
  account: DestinationAccount;
  ownerPartyName: string;
  previousStatus?: boolean;
  nextStatus?: boolean;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  return crypto.randomUUID();
}

function buildAuditEvent(input: DestinationAccountAuditRecordInput, timestamp: string, id: string): AuditEvent {
  const actionText =
    input.action === "created"
      ? "ایجاد شد"
      : input.action === "updated"
        ? "ویرایش شد"
        : input.action === "archived"
          ? "بایگانی شد"
          : "بازیابی شد";

  return {
    id,
    entityType: "destination_account",
    entityId: input.account.id,
    action: input.action,
    description: `حساب مقصد «${input.account.accountLabel}» برای طرف «${input.ownerPartyName}» ${actionText}.`,
    previousStatus: typeof input.previousStatus === "boolean" ? (input.previousStatus ? "active" : "archived") : undefined,
    nextStatus: typeof input.nextStatus === "boolean" ? (input.nextStatus ? "active" : "archived") : undefined,
    createdAt: timestamp
  };
}

export class DestinationAccountRepository {
  private readonly now: () => string;

  private readonly createId: () => string;

  constructor(private readonly db: DestinationAccountRepositoryDatabase, deps: DestinationAccountRepositoryDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.createId = deps.createId ?? defaultId;
  }

  async listAccounts(): Promise<DestinationAccount[]> {
    return this.db.destinationAccounts.toArray();
  }

  async listAccountsByParty(ownerPartyId: string, includeArchived = true): Promise<DestinationAccount[]> {
    const accounts = await this.db.destinationAccounts.where("ownerPartyId").equals(ownerPartyId).toArray();
    return includeArchived ? accounts : accounts.filter((account) => account.active);
  }

  async getAccount(id: string): Promise<DestinationAccount | undefined> {
    return this.db.destinationAccounts.get(id);
  }

  async createAccount(draft: DestinationAccountDraft): Promise<DestinationAccount> {
    const parsedDraft = destinationAccountDraftSchema.parse(draft);
    const ownerParty = await this.db.parties.get(parsedDraft.ownerPartyId);
    if (!ownerParty) {
      throw new Error("طرف مالک یافت نشد.");
    }

    if (!ownerParty.active) {
      throw new Error("برای ثبت حساب جدید، ابتدا طرف را بازیابی کنید.");
    }

    const now = this.now();
    const account = buildDestinationAccountRecord(this.createId(), parsedDraft, { createdAt: now, updatedAt: now }, true);
    const audit = buildAuditEvent(
      { action: "created", account, ownerPartyName: ownerParty.displayName, nextStatus: true },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.destinationAccounts, this.db.auditEvents, async () => {
      await this.db.destinationAccounts.put(account);
      await this.db.auditEvents.put(audit);
    });

    return account;
  }

  async updateAccount(id: string, draft: DestinationAccountDraft): Promise<DestinationAccount> {
    const existing = await this.getAccount(id);
    if (!existing) {
      throw new Error("حساب مقصد پیدا نشد.");
    }

    const parsedDraft = destinationAccountDraftSchema.parse(draft);
    if (parsedDraft.ownerPartyId !== existing.ownerPartyId) {
      throw new Error("مالک حساب مقصد قابل تغییر نیست.");
    }

    const ownerParty = await this.db.parties.get(existing.ownerPartyId);
    if (!ownerParty) {
      throw new Error("طرف مالک یافت نشد.");
    }

    const now = this.now();
    const account = buildDestinationAccountRecord(id, parsedDraft, { createdAt: existing.createdAt, updatedAt: now }, existing.active);
    const audit = buildAuditEvent(
      {
        action: "updated",
        account,
        ownerPartyName: ownerParty.displayName,
        previousStatus: existing.active,
        nextStatus: account.active
      },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.destinationAccounts, this.db.auditEvents, async () => {
      await this.db.destinationAccounts.put(account);
      await this.db.auditEvents.put(audit);
    });

    return account;
  }

  async archiveAccount(id: string): Promise<DestinationAccount> {
    const existing = await this.getAccount(id);
    if (!existing) {
      throw new Error("حساب مقصد پیدا نشد.");
    }

    if (!existing.active) {
      return existing;
    }

    const ownerParty = await this.db.parties.get(existing.ownerPartyId);
    if (!ownerParty) {
      throw new Error("طرف مالک یافت نشد.");
    }

    const now = this.now();
    const account = { ...existing, active: false, updatedAt: now };
    const audit = buildAuditEvent(
      { action: "archived", account, ownerPartyName: ownerParty.displayName, previousStatus: true, nextStatus: false },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.destinationAccounts, this.db.auditEvents, async () => {
      await this.db.destinationAccounts.put(account);
      await this.db.auditEvents.put(audit);
    });

    return account;
  }

  async restoreAccount(id: string): Promise<DestinationAccount> {
    const existing = await this.getAccount(id);
    if (!existing) {
      throw new Error("حساب مقصد پیدا نشد.");
    }

    if (existing.active) {
      return existing;
    }

    const ownerParty = await this.db.parties.get(existing.ownerPartyId);
    if (!ownerParty) {
      throw new Error("طرف مالک یافت نشد.");
    }

    if (!ownerParty.active) {
      throw new Error("برای بازیابی حساب مقصد، ابتدا طرف را بازیابی کنید.");
    }

    const now = this.now();
    const account = { ...existing, active: true, updatedAt: now };
    const audit = buildAuditEvent(
      { action: "restored", account, ownerPartyName: ownerParty.displayName, previousStatus: false, nextStatus: true },
      now,
      this.createId()
    );

    await this.db.transaction("rw", this.db.destinationAccounts, this.db.auditEvents, async () => {
      await this.db.destinationAccounts.put(account);
      await this.db.auditEvents.put(audit);
    });

    return account;
  }
}

export function createDestinationAccountRepository(
  db: DestinationAccountRepositoryDatabase,
  deps?: DestinationAccountRepositoryDependencies
): DestinationAccountRepository {
  return new DestinationAccountRepository(db, deps);
}
