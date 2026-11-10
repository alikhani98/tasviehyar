import { afterEach, describe, expect, it, vi } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { buildBackupEnvelopeWithoutChecksum, digestBackupEnvelope } from "../../domain/backup";
import { createDestinationAccountRepository } from "../destination-account-repository";
import { createInvoiceRepository } from "../invoice-repository";
import { createPartyRepository } from "../party-repository";
import { createPaymentInstructionRepository } from "../payment-instruction-repository";
import { BackupService } from "../backup-service";
import { createPaymentRepository } from "../payment-repository";

const databases: TasviehYarDatabase[] = [];
const backupHistoryKey = "tasviehyar.backup.history.v1";

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

function createDatabase(prefix: string): TasviehYarDatabase {
  const database = new TasviehYarDatabase(`${prefix}-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    }
  } as Storage;
}

function createService(database: TasviehYarDatabase, storage = createMemoryStorage()): BackupService {
  return new BackupService(database, {
    now: () => "2026-07-10T10:00:00.000Z",
    storage,
    applicationVersion: "0.0.0"
  });
}

async function seedRichDatabase(database: TasviehYarDatabase) {
  const partyRepository = createPartyRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const invoiceRepository = createInvoiceRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const destinationAccountRepository = createDestinationAccountRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const paymentInstructionRepository = createPaymentInstructionRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });
  const paymentRepository = createPaymentRepository(database, {
    now: () => "2026-07-10T08:00:00.000Z",
    createId: () => crypto.randomUUID()
  });

  const customer = await partyRepository.createParty({
    displayName: "زارع",
    aliases: ["آقای زارع"],
    searchableDescription: "مشتری اصلی",
    roles: ["customer", "farmer"],
    phoneNumber: "09120000000",
    notes: "یادداشت"
  });
  const recipient = await partyRepository.createParty({
    displayName: "احمدی",
    aliases: [],
    searchableDescription: "گیرنده",
    roles: ["farmer", "destination_account_owner"],
    phoneNumber: "09120000001",
    notes: undefined
  });
  const account = await destinationAccountRepository.createAccount({
    ownerPartyId: recipient.id,
    accountLabel: "حساب اصلی",
    bankName: "بانک نمونه",
    cardNumber: "۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶",
    iban: makeValidIranianIban("5401026800208179090020")
  });
  const invoice = await invoiceRepository.createInvoice({
    customerPartyId: customer.id,
    invoiceDate: "2026-07-10",
    totalAmount: 500_000_000,
    referenceNumber: "ف-۱",
    note: "فاکتور نمونه"
  });
  const instruction = await paymentInstructionRepository.createInstruction({
    invoiceId: invoice.id,
    recipientPartyId: recipient.id,
    destinationAccountId: account.id,
    instructedAmount: 200_000_000,
    note: "دستور نمونه"
  });
  await paymentRepository.createPayment(
    {
      payerPartyId: customer.id,
      recipientPartyId: recipient.id,
      destinationAccountId: account.id,
      amount: 120_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "trk-1",
      note: "پرداخت نمونه"
    },
    {
      invoiceId: invoice.id,
      paymentInstructionId: instruction.id,
      allocatedAmount: 120_000_000
    },
    {
      verificationResult: "confirmed",
      verifierDescriptionOrPartyRef: "اپراتور",
      verificationMethod: "receipt_review",
      note: "تأیید شد"
    }
  );
}

function mutateEnvelope(text: string, mutate: (envelope: Record<string, unknown>) => void): string {
  const envelope = JSON.parse(text) as Record<string, unknown>;
  mutate(envelope);
  return JSON.stringify(envelope);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
  window.localStorage.removeItem(backupHistoryKey);
});

describe("backup service", () => {
  it("exports a complete backup and restores it into a blank database", async () => {
    const sourceDatabase = createDatabase("backup-source");
    const targetDatabase = createDatabase("backup-target");
    const sourceService = createService(sourceDatabase);
    const targetService = createService(targetDatabase);

    await seedRichDatabase(sourceDatabase);

    const exported = await sourceService.exportBackup();
    expect(exported.filename).toMatch(/^tasviehyar-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(exported.preview.compatible).toBe(true);
    expect(exported.preview.recordCounts).toEqual({
      parties: 2,
      destinationAccounts: 1,
      invoices: 1,
      paymentInstructions: 1,
      payments: 1,
      paymentAllocations: 1,
      paymentVerifications: 1,
      auditEvents: 8
    });

    const restored = await targetService.restoreBackupText(exported.text);
    expect(restored.historyStatus).toBe("recorded");

    expect(await targetDatabase.parties.count()).toBe(2);
    expect(await targetDatabase.destinationAccounts.count()).toBe(1);
    expect(await targetDatabase.invoices.count()).toBe(1);
    expect(await targetDatabase.paymentInstructions.count()).toBe(1);
    expect(await targetDatabase.payments.count()).toBe(1);
    expect(await targetDatabase.paymentAllocations.count()).toBe(1);
    expect(await targetDatabase.paymentVerifications.count()).toBe(1);
    expect(await targetDatabase.auditEvents.count()).toBe(8);
    expect((await targetService.getHistorySummary()).lastRestore).not.toBeNull();

    targetDatabase.close();
    const reopened = new TasviehYarDatabase(targetDatabase.name);
    try {
      await reopened.open();
      expect(reopened.verno).toBe(3);
      expect(exported.preview.backupFormatVersion).toBe(1);
      expect((await createService(reopened).exportBackup()).text).toBe(exported.text);
    } finally {
      reopened.close();
    }
  });

  it("exports a consistent snapshot when another connection writes between table reads", async () => {
    const reader = createDatabase("snapshot-reader");
    const writer = new TasviehYarDatabase(reader.name);
    await seedRichDatabase(reader);
    await writer.open();
    const service = createService(reader);
    const before = await service.exportBackup();
    const [party] = await reader.parties.toArray();
    const [invoice] = await reader.invoices.toArray();
    const [auditEvent] = await reader.auditEvents.toArray();
    const readParties = reader.parties.toArray.bind(reader.parties);
    const readInvoices = reader.invoices.toArray.bind(reader.invoices);
    let partiesRead: ReturnType<typeof readParties>;
    let writeDone: Promise<void> | undefined;
    const partiesSpy = vi.spyOn(reader.parties, "toArray").mockImplementationOnce(() => {
      partiesRead = readParties();
      return partiesRead;
    });
    const invoicesSpy = vi.spyOn(reader.invoices, "toArray").mockImplementationOnce(() =>
      partiesRead.then(() => {
        // Queue the native write synchronously before requesting the invoice read.
        const tx = writer.backendDB().transaction(["parties", "invoices", "auditEvents"], "readwrite");
        writeDone = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error("Writer aborted"));
        });
        tx.objectStore("parties").add({ ...party, id: "concurrent-party" });
        tx.objectStore("invoices").add({ ...invoice, id: "concurrent-invoice", customerPartyId: "concurrent-party" });
        tx.objectStore("auditEvents").add({ ...auditEvent, id: "concurrent-audit", entityType: "invoice", entityId: "concurrent-invoice" });
        return readInvoices();
      })
    );
    try {
      const during = await service.exportBackup();
      expect(writeDone).toBeDefined();
      await writeDone;
      expect(during.text).toBe(before.text);
      const after = await service.exportBackup();
      expect(after.preview.compatible).toBe(true);
      expect(after.preview.recordCounts).toEqual({
        ...before.preview.recordCounts,
        parties: 3,
        invoices: 2,
        auditEvents: 9
      });
      expect(after.text).toContain("concurrent-invoice");
    } finally {
      partiesSpy.mockRestore();
      invoicesSpy.mockRestore();
      writer.close();
    }
  });

  it.each(["getItem", "setItem"] as const)("commits all stores even if history storage %s throws", async (operation) => {
    const source = createDatabase("history-source");
    const target = createDatabase("history-target");
    await seedRichDatabase(source);
    await seedRichDatabase(target);
    const incoming = await createService(source).exportBackup();
    const storage = createMemoryStorage();
    const write = vi.spyOn(storage, operation).mockImplementation(() => {
      throw new DOMException("History storage unavailable", "QuotaExceededError");
    });
    const service = createService(target, storage);
    try {
      const restored = await service.restoreBackupText(incoming.text);
      expect(restored.historyStatus).toBe("failed");
      expect((await service.exportBackup()).text).toBe(incoming.text);
      expect(service.getHistorySummary().lastRestore).toBeNull();
    } finally {
      write.mockRestore();
    }
  });

  it("rolls back replace-all restore if a table write fails", async () => {
    const sourceDatabase = createDatabase("rollback-source");
    const targetDatabase = createDatabase("rollback-target");
    const targetService = createService(targetDatabase);
    await seedRichDatabase(sourceDatabase);
    await seedRichDatabase(targetDatabase);
    const incoming = await createService(sourceDatabase).exportBackup();
    const before = await targetService.exportBackup();
    expect(incoming.checksum).not.toBe(before.checksum);

    const write = vi.spyOn(targetDatabase.auditEvents, "bulkPut")
      .mockRejectedValueOnce(new Error("synthetic audit write failure"));
    try {
      await expect(targetService.restoreBackupText(incoming.text)).rejects.toThrow("synthetic audit write failure");
      expect(write).toHaveBeenCalledOnce();
      expect((await targetService.exportBackup()).text).toBe(before.text);
      expect(targetService.getHistorySummary().lastRestore).toBeNull();
    } finally {
      write.mockRestore();
    }
  });

  it("exports a ready-made demo backup without mutating the live database", async () => {
    const database = createDatabase("backup-demo");
    const service = createService(database);

    const exported = await service.exportDemoBackup();

    expect(exported.filename).toMatch(/^tasviehyar-demo-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    expect(exported.preview.compatible).toBe(true);
    expect(exported.preview.recordCounts).toEqual({
      parties: 6,
      destinationAccounts: 6,
      invoices: 5,
      paymentInstructions: 5,
      payments: 10,
      paymentAllocations: 7,
      paymentVerifications: 7,
      auditEvents: 51
    });
    expect(await database.parties.count()).toBe(0);
    expect(await database.auditEvents.count()).toBe(0);
  });

  it("restores an empty-database backup round-trip", async () => {
    const sourceDatabase = createDatabase("backup-empty-source");
    const targetDatabase = createDatabase("backup-empty-target");
    const sourceService = createService(sourceDatabase);
    const targetService = createService(targetDatabase);

    const exported = await sourceService.exportBackup();

    expect(exported.preview.compatible).toBe(true);
    expect(exported.preview.recordCounts).toEqual({
      parties: 0,
      destinationAccounts: 0,
      invoices: 0,
      paymentInstructions: 0,
      payments: 0,
      paymentAllocations: 0,
      paymentVerifications: 0,
      auditEvents: 0
    });

    await targetService.restoreBackupText(exported.text);
    expect(await targetDatabase.parties.count()).toBe(0);
    expect(await targetDatabase.auditEvents.count()).toBe(0);
  });

  it("rejects malformed JSON, invalid app identifiers, unsupported versions, and unsafe monetary values", async () => {
    const database = createDatabase("backup-invalid");
    await seedRichDatabase(database);
    const service = createService(database);
    const exported = await service.exportBackup();

    await expect(service.restoreBackupText("{")).rejects.toThrow("JSON");
    await expect(
      service.restoreBackupText(
        mutateEnvelope(exported.text, (envelope) => {
          envelope.appIdentifier = "other-app";
        })
      )
    ).rejects.toThrow("شناسه برنامه");
    await expect(
      service.restoreBackupText(
        mutateEnvelope(exported.text, (envelope) => {
          envelope.backupFormatVersion = 99;
        })
      )
    ).rejects.toThrow("نسخه قالب");

    const unsafeMoney = JSON.parse(exported.text) as Record<string, unknown>;
    const payments = unsafeMoney.payments as Array<Record<string, unknown>>;
    payments[0]!.amount = Number.MAX_SAFE_INTEGER + 1;
    const checksumEnvelope = buildBackupEnvelopeWithoutChecksum(unsafeMoney as never, {
      createdAt: String(unsafeMoney.createdAt),
      databaseSchemaVersion: Number(unsafeMoney.databaseSchemaVersion),
      applicationVersion: String(unsafeMoney.applicationVersion ?? "0.0.0")
    });
    const checksum = await digestBackupEnvelope(checksumEnvelope);
    await expect(service.restoreBackupText(JSON.stringify({ ...checksumEnvelope, checksum }))).rejects.toThrow("safe integer");
  });

  it("rejects duplicate ids, orphan relationships, invalid ownership, and invalid totals while preserving current data", async () => {
    const sourceDatabase = createDatabase("backup-bad-source");
    await seedRichDatabase(sourceDatabase);
    const sourceService = createService(sourceDatabase);
    const exported = await sourceService.exportBackup();

    const targetDatabase = createDatabase("backup-bad-target");
    await seedRichDatabase(targetDatabase);
    const targetService = createService(targetDatabase);
    const beforeParties = await targetDatabase.parties.count();

    const duplicateId = JSON.parse(exported.text) as Record<string, unknown>;
    const partyRecords = duplicateId.parties as Array<Record<string, unknown>>;
    partyRecords[1]!.id = partyRecords[0]!.id as string;
    const duplicateEnvelope = buildBackupEnvelopeWithoutChecksum(duplicateId as never, {
      createdAt: String(duplicateId.createdAt),
      databaseSchemaVersion: Number(duplicateId.databaseSchemaVersion),
      applicationVersion: String(duplicateId.applicationVersion ?? "0.0.0")
    });
    const duplicateChecksum = await digestBackupEnvelope(duplicateEnvelope);
    await expect(targetService.restoreBackupText(JSON.stringify({ ...duplicateEnvelope, checksum: duplicateChecksum }))).rejects.toThrow("شناسه تکراری");

    const orphanInvoice = JSON.parse(exported.text) as Record<string, unknown>;
    (orphanInvoice.invoices as Array<Record<string, unknown>>)[0]!.customerPartyId = "missing_party";
    const orphanInvoiceEnvelope = buildBackupEnvelopeWithoutChecksum(orphanInvoice as never, {
      createdAt: String(orphanInvoice.createdAt),
      databaseSchemaVersion: Number(orphanInvoice.databaseSchemaVersion),
      applicationVersion: String(orphanInvoice.applicationVersion ?? "0.0.0")
    });
    const orphanInvoiceChecksum = await digestBackupEnvelope(orphanInvoiceEnvelope);
    await expect(
      targetService.restoreBackupText(JSON.stringify({ ...orphanInvoiceEnvelope, checksum: orphanInvoiceChecksum }))
    ).rejects.toThrow("مشتری موجود");

    const invalidOwner = JSON.parse(exported.text) as Record<string, unknown>;
    (invalidOwner.destinationAccounts as Array<Record<string, unknown>>)[0]!.ownerPartyId = "wrong_owner";
    const invalidOwnerEnvelope = buildBackupEnvelopeWithoutChecksum(invalidOwner as never, {
      createdAt: String(invalidOwner.createdAt),
      databaseSchemaVersion: Number(invalidOwner.databaseSchemaVersion),
      applicationVersion: String(invalidOwner.applicationVersion ?? "0.0.0")
    });
    const invalidOwnerChecksum = await digestBackupEnvelope(invalidOwnerEnvelope);
    await expect(targetService.restoreBackupText(JSON.stringify({ ...invalidOwnerEnvelope, checksum: invalidOwnerChecksum }))).rejects.toThrow("مالک حساب مقصد");

    const overPayment = JSON.parse(exported.text) as Record<string, unknown>;
    (overPayment.paymentAllocations as Array<Record<string, unknown>>)[0]!.allocatedAmount = 500_000_001;
    const overPaymentEnvelope = buildBackupEnvelopeWithoutChecksum(overPayment as never, {
      createdAt: String(overPayment.createdAt),
      databaseSchemaVersion: Number(overPayment.databaseSchemaVersion),
      applicationVersion: String(overPayment.applicationVersion ?? "0.0.0")
    });
    const overPaymentChecksum = await digestBackupEnvelope(overPaymentEnvelope);
    await expect(targetService.restoreBackupText(JSON.stringify({ ...overPaymentEnvelope, checksum: overPaymentChecksum }))).rejects.toThrow("بیشتر است");

    const overInvoice = JSON.parse(exported.text) as Record<string, unknown>;
    (overInvoice.paymentInstructions as Array<Record<string, unknown>>)[0]!.instructedAmount = 600_000_000;
    const overInvoiceEnvelope = buildBackupEnvelopeWithoutChecksum(overInvoice as never, {
      createdAt: String(overInvoice.createdAt),
      databaseSchemaVersion: Number(overInvoice.databaseSchemaVersion),
      applicationVersion: String(overInvoice.applicationVersion ?? "0.0.0")
    });
    const overInvoiceChecksum = await digestBackupEnvelope(overInvoiceEnvelope);
    await expect(targetService.restoreBackupText(JSON.stringify({ ...overInvoiceEnvelope, checksum: overInvoiceChecksum }))).rejects.toThrow("بیشتر است");

    expect(await targetDatabase.parties.count()).toBe(beforeParties);
    expect(await targetDatabase.auditEvents.count()).toBe(8);
  });
});
