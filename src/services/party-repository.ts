import type { AuditEvent, Party } from "../domain";
import { buildPartyRecord, partyDraftSchema, type PartyDraft } from "../domain/parties";

export interface PartyRepositoryDependencies {
  now?: () => string;
  createId?: () => string;
}

export interface PartyRepositoryDatabase {
  parties: { get(id: string): Promise<Party | undefined>; toArray(): Promise<Party[]>; put(party: Party): Promise<string>; };
  auditEvents: { put(event: AuditEvent): Promise<string> };
  transaction(mode: "rw", ...tablesAndCallback: unknown[]): Promise<unknown>;
}

export interface PartyAuditRecordInput {
  action: "created" | "updated" | "archived" | "restored";
  party: Party;
  previousStatus?: boolean;
  nextStatus?: boolean;
  note?: string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(): string {
  return crypto.randomUUID();
}

function buildAuditEvent(input: PartyAuditRecordInput, timestamp: string, id: string): AuditEvent {
  const statusText = input.action === "created" ? "ایجاد شد" : input.action === "updated" ? "ویرایش شد" : input.action === "archived" ? "بایگانی شد" : "بازیابی شد";

  return {
    id,
    entityType: "party",
    entityId: input.party.id,
    action: input.action,
    description: `طرف «${input.party.displayName}» ${statusText}.`,
    previousStatus: typeof input.previousStatus === "boolean" ? (input.previousStatus ? "active" : "archived") : undefined,
    nextStatus: typeof input.nextStatus === "boolean" ? (input.nextStatus ? "active" : "archived") : undefined,
    createdAt: timestamp
  };
}

export class PartyRepository {
  private readonly now: () => string;

  private readonly createId: () => string;

  constructor(private readonly db: PartyRepositoryDatabase, deps: PartyRepositoryDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.createId = deps.createId ?? defaultId;
  }

  async listParties(): Promise<Party[]> {
    return this.db.parties.toArray();
  }

  async getParty(id: string): Promise<Party | undefined> {
    return this.db.parties.get(id);
  }

  async createParty(draft: PartyDraft): Promise<Party> {
    const parsedDraft = partyDraftSchema.parse(draft);
    const now = this.now();
    const party = buildPartyRecord(this.createId(), parsedDraft, { createdAt: now, updatedAt: now }, true);
    const audit = buildAuditEvent({ action: "created", party, nextStatus: true }, now, this.createId());

    await this.db.transaction("rw", this.db.parties, this.db.auditEvents, async () => {
      await this.db.parties.put(party);
      await this.db.auditEvents.put(audit);
    });

    return party;
  }

  async updateParty(id: string, draft: PartyDraft): Promise<Party> {
    const existing = await this.getParty(id);
    if (!existing) {
      throw new Error("Party not found.");
    }

    const parsedDraft = partyDraftSchema.parse(draft);
    const now = this.now();
    const party = buildPartyRecord(id, parsedDraft, { createdAt: existing.createdAt, updatedAt: now }, existing.active);
    const audit = buildAuditEvent({ action: "updated", party, previousStatus: existing.active, nextStatus: party.active }, now, this.createId());

    await this.db.transaction("rw", this.db.parties, this.db.auditEvents, async () => {
      await this.db.parties.put(party);
      await this.db.auditEvents.put(audit);
    });

    return party;
  }

  async archiveParty(id: string): Promise<Party> {
    const existing = await this.getParty(id);
    if (!existing) {
      throw new Error("Party not found.");
    }

    if (!existing.active) {
      return existing;
    }

    const now = this.now();
    const party = { ...existing, active: false, updatedAt: now };
    const audit = buildAuditEvent({ action: "archived", party, previousStatus: true, nextStatus: false }, now, this.createId());

    await this.db.transaction("rw", this.db.parties, this.db.auditEvents, async () => {
      await this.db.parties.put(party);
      await this.db.auditEvents.put(audit);
    });

    return party;
  }

  async restoreParty(id: string): Promise<Party> {
    const existing = await this.getParty(id);
    if (!existing) {
      throw new Error("Party not found.");
    }

    if (existing.active) {
      return existing;
    }

    const now = this.now();
    const party = { ...existing, active: true, updatedAt: now };
    const audit = buildAuditEvent({ action: "restored", party, previousStatus: false, nextStatus: true }, now, this.createId());

    await this.db.transaction("rw", this.db.parties, this.db.auditEvents, async () => {
      await this.db.parties.put(party);
      await this.db.auditEvents.put(audit);
    });

    return party;
  }
}

export function createPartyRepository(db: PartyRepositoryDatabase, deps?: PartyRepositoryDependencies): PartyRepository {
  return new PartyRepository(db, deps);
}
