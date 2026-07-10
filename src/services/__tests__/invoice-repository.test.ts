import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { createInvoiceRepository } from "../invoice-repository";
import { buildPartyRecord, type PartyDraft } from "../../domain/parties";
import { createPartyRepository } from "../party-repository";

const databases: TasviehYarDatabase[] = [];

function makePartyDraft(displayName: string, roles: PartyDraft["roles"]): PartyDraft {
  return {
    displayName,
    aliases: [],
    searchableDescription: undefined,
    roles,
    phoneNumber: undefined,
    notes: undefined
  };
}

function createRepositories() {
  const database = new TasviehYarDatabase(`invoice-tests-${crypto.randomUUID()}`);
  const partyRepository = createPartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const invoiceRepository = createInvoiceRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  databases.push(database);
  return { database, partyRepository, invoiceRepository };
}

async function putParty(database: TasviehYarDatabase, id: string, displayName: string, roles: PartyDraft["roles"], active = true) {
  const party = buildPartyRecord(
    id,
    makePartyDraft(displayName, roles),
    { createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z" },
    active
  );
  await database.parties.put(party);
  return party;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("invoice repository", () => {
  it("creates, updates, cancels, and audits invoices atomically", async () => {
    const { database, invoiceRepository } = createRepositories();
    const customer = await putParty(database, "party_customer", "احمدی", ["customer"], true);

    const created = await invoiceRepository.createInvoice({
      customerPartyId: customer.id,
      invoiceDate: "2026-07-10",
      totalAmount: 1_250_000,
      referenceNumber: "ف-۱",
      note: "فاکتور نمونه"
    });

    expect(created.lifecycleStatus).toBe("active");
    expect(created.totalAmount).toBe(1_250_000);
    expect(await database.invoices.count()).toBe(1);
    expect(await database.auditEvents.count()).toBe(1);

    const updated = await invoiceRepository.updateInvoice(created.id, {
      customerPartyId: customer.id,
      invoiceDate: "2026-07-11",
      totalAmount: 1_500_000,
      referenceNumber: "ف-۲",
      note: "ویرایش شد"
    });

    expect(updated.invoiceDate).toBe("2026-07-11");
    expect(await database.auditEvents.count()).toBe(2);

    const cancelled = await invoiceRepository.cancelInvoice(created.id);
    expect(cancelled.lifecycleStatus).toBe("cancelled");
    expect(await database.auditEvents.count()).toBe(3);

    await expect(
      invoiceRepository.updateInvoice(created.id, {
        customerPartyId: customer.id,
        invoiceDate: "2026-07-12",
        totalAmount: 1_600_000,
        referenceNumber: "ف-۳",
        note: "نباید ذخیره شود"
      })
    ).rejects.toThrow("فاکتور لغوشده قابل ویرایش نیست.");

    expect(await database.invoices.count()).toBe(1);
    expect((await invoiceRepository.getInvoice(created.id))?.lifecycleStatus).toBe("cancelled");
  });

  it("validates customer selection and preserves invoices when a customer is archived later", async () => {
    const { database, partyRepository, invoiceRepository } = createRepositories();
    const activeCustomer = await putParty(database, "party_customer", "احمدی", ["customer"], true);
    await putParty(database, "party_farmer", "کرباسیان", ["farmer"], true);
    const archivedCustomer = await putParty(database, "party_archived", "حسینی", ["customer"], false);

    await expect(
      invoiceRepository.createInvoice({
        customerPartyId: "missing_party",
        invoiceDate: "2026-07-10",
        totalAmount: 1_000_000,
        referenceNumber: "ف-۱"
      })
    ).rejects.toThrow("مشتری یافت نشد.");

    await expect(
      invoiceRepository.createInvoice({
        customerPartyId: "party_farmer",
        invoiceDate: "2026-07-10",
        totalAmount: 1_000_000,
        referenceNumber: "ف-۱"
      })
    ).rejects.toThrow("نقش مشتری ندارد");

    await expect(
      invoiceRepository.createInvoice({
        customerPartyId: archivedCustomer.id,
        invoiceDate: "2026-07-10",
        totalAmount: 1_000_000,
        referenceNumber: "ف-۱"
      })
    ).rejects.toThrow("مشتری باید فعال باشد");

    const invoice = await invoiceRepository.createInvoice({
      customerPartyId: activeCustomer.id,
      invoiceDate: "2026-07-10",
      totalAmount: 1_000_000,
      referenceNumber: "ف-۱"
    });

    await partyRepository.archiveParty(activeCustomer.id);

    expect((await invoiceRepository.listInvoices()).map((entry) => entry.id)).toEqual([invoice.id]);
    expect(await invoiceRepository.searchInvoices({ query: "احمدی", status: "all" })).toHaveLength(1);
  });

  it("searches and filters invoices with newest-first ordering and duplicate warnings", async () => {
    const { database, invoiceRepository } = createRepositories();
    const customer = await putParty(database, "party_customer", "احمدی", ["customer"], true);
    await putParty(database, "party_other", "کرباسیان", ["customer"], true);

    const first = await invoiceRepository.createInvoice({
      customerPartyId: customer.id,
      invoiceDate: "2026-07-10",
      totalAmount: 1_250_000,
      referenceNumber: "ف-۱"
    });

    const second = await invoiceRepository.createInvoice({
      customerPartyId: customer.id,
      invoiceDate: "2026-07-11",
      totalAmount: 1_500_000,
      referenceNumber: "ف-۲"
    });

    await invoiceRepository.cancelInvoice(second.id);

    expect(await invoiceRepository.searchInvoices({ query: "ف-۱", status: "all" })).toHaveLength(1);
    expect(await invoiceRepository.searchInvoices({ query: "احمدی", status: "cancelled" })).toHaveLength(1);
    expect((await invoiceRepository.listInvoices()).map((entry) => entry.id)).toEqual([second.id, first.id]);

    const duplicateWarnings = await invoiceRepository.findProbableDuplicateWarnings({
      customerPartyId: customer.id,
      invoiceDate: "2026-07-10",
      totalAmount: 1_250_000,
      referenceNumber: "ف-۱"
    });

    expect(duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate_invoice",
          matchedInvoiceIds: expect.arrayContaining([first.id])
        })
      ])
    );
  });
});
