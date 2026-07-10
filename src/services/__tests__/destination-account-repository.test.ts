import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createDestinationAccountRepository } from "../destination-account-repository";
import { buildPartyRecord, type PartyDraft } from "../../domain/parties";

const databases: TasviehYarDatabase[] = [];

function createRepository() {
  const database = new TasviehYarDatabase(`destination-account-tests-${crypto.randomUUID()}`);
  const repository = createDestinationAccountRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  databases.push(database);
  return { database, repository };
}

function makePartyDraft(displayName: string): PartyDraft {
  return {
    displayName,
    aliases: [],
    searchableDescription: undefined,
    roles: ["customer"],
    phoneNumber: undefined,
    notes: undefined
  };
}

function makeValidIranianIban(bban: string): string {
  const normalized = bban.replace(/[^\d]/g, "");
  if (normalized.length !== 22) {
    throw new Error("IBAN body must be 22 digits.");
  }

  let remainder = 0;
  for (const digit of `${normalized}182700`) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return `IR${String(98 - remainder).padStart(2, "0")}${normalized}`;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("destination account repository", () => {
  it("creates, updates, archives, restores, and audits destination accounts atomically", async () => {
    const { database, repository } = createRepository();
    const party = buildPartyRecord(
      "party_1",
      makePartyDraft("احمدی"),
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      true
    );
    await database.parties.put(party);

    const created = await repository.createAccount({
      ownerPartyId: party.id,
      accountLabel: "حساب اصلی",
      bankName: "بانک نمونه",
      cardNumber: "۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶"
    });

    expect(created.active).toBe(true);
    expect(created.cardNumber).toBe("1234567890123456");
    expect(await database.destinationAccounts.count()).toBe(1);
    expect(await database.auditEvents.count()).toBe(1);

    const updated = await repository.updateAccount(created.id, {
      ownerPartyId: party.id,
      accountLabel: "حساب اصلی ویرایش‌شده",
      bankName: "بانک نمونه",
      cardNumber: "1234567890123456",
      iban: makeValidIranianIban("5401026800208179090020")
    });

    expect(updated.accountLabel).toBe("حساب اصلی ویرایش‌شده");
    expect(await database.auditEvents.count()).toBe(2);

    const archived = await repository.archiveAccount(created.id);
    expect(archived.active).toBe(false);
    expect(await database.auditEvents.count()).toBe(3);

    const restored = await repository.restoreAccount(created.id);
    expect(restored.active).toBe(true);
    expect(await database.auditEvents.count()).toBe(4);

    const byParty = await repository.listAccountsByParty(party.id, false);
    expect(byParty).toHaveLength(1);
    expect(byParty[0]?.active).toBe(true);
  });

  it("blocks creating new accounts for archived parties", async () => {
    const { database, repository } = createRepository();
    const party = buildPartyRecord(
      "party_1",
      makePartyDraft("احمدی"),
      { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
      false
    );
    await database.parties.put(party);

    await expect(
      repository.createAccount({
        ownerPartyId: party.id,
        accountLabel: "حساب اصلی",
        cardNumber: "1234567890123456"
      })
    ).rejects.toThrow("برای ثبت حساب جدید، ابتدا طرف را بازیابی کنید.");

    expect(await database.destinationAccounts.count()).toBe(0);
    expect(await database.auditEvents.count()).toBe(0);
  });
});
