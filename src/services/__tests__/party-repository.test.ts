import { afterEach, describe, expect, it } from "vitest";
import { PartyRepository } from "../party-repository";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";

const databases: TasviehYarDatabase[] = [];

function createRepository() {
  const database = new TasviehYarDatabase(`party-tests-${crypto.randomUUID()}`);
  const repository = new PartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  databases.push(database);
  return { database, repository };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("party repository", () => {
  it("creates, updates, archives, restores, and audits parties atomically", async () => {
    const { database, repository } = createRepository();

    const created = await repository.createParty({
      displayName: "احمدی",
      aliases: ["آقای احمدی"],
      searchableDescription: "کشاورز",
      roles: ["customer", "farmer"],
      phoneNumber: "09120000000",
      notes: "یادداشت"
    });

    expect(created.active).toBe(true);
    expect(await database.parties.count()).toBe(1);
    expect(await database.auditEvents.count()).toBe(1);

    const updated = await repository.updateParty(created.id, {
      displayName: "احمدی",
      aliases: ["احمدی"],
      searchableDescription: "مشتری اصلی",
      roles: ["customer"],
      phoneNumber: "09120000001",
      notes: "ویرایش شد"
    });

    expect(updated.phoneNumber).toBe("09120000001");
    expect(await database.auditEvents.count()).toBe(2);

    const archived = await repository.archiveParty(created.id);
    expect(archived.active).toBe(false);
    expect(await database.auditEvents.count()).toBe(3);

    const restored = await repository.restoreParty(created.id);
    expect(restored.active).toBe(true);
    expect(await database.auditEvents.count()).toBe(4);

    const parties = await repository.listParties();
    expect(parties).toHaveLength(1);
    expect(parties[0]?.active).toBe(true);
  });
});
