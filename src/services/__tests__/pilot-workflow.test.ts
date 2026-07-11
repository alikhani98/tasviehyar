import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { summarizeCustomerSettlement, summarizeInvoiceBalance, summarizeInstructionBalance, summarizeRecipientSettlement } from "../../domain/settlement";
import { BackupService } from "../backup-service";
import { createDestinationAccountRepository } from "../destination-account-repository";
import { createInvoiceRepository } from "../invoice-repository";
import { createPartyRepository } from "../party-repository";
import { createPaymentInstructionRepository } from "../payment-instruction-repository";
import { createPaymentRepository } from "../payment-repository";

const databases: TasviehYarDatabase[] = [];

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

async function seedPilotScenario(database: TasviehYarDatabase) {
  const now = () => "2026-07-10T08:00:00.000Z";
  const createId = () => crypto.randomUUID();
  const partyRepository = createPartyRepository(database, { now, createId });
  const destinationAccountRepository = createDestinationAccountRepository(database, { now, createId });
  const invoiceRepository = createInvoiceRepository(database, { now, createId });
  const paymentInstructionRepository = createPaymentInstructionRepository(database, { now, createId });
  const paymentRepository = createPaymentRepository(database, { now, createId });

  const customer = await partyRepository.createParty({
    displayName: "زاره",
    aliases: [],
    searchableDescription: "مشتری پایلوت",
    roles: ["customer"],
    phoneNumber: "09120000000",
    notes: undefined
  });
  const ahmadi = await partyRepository.createParty({
    displayName: "احمدی",
    aliases: [],
    searchableDescription: "گیرنده نخست",
    roles: ["farmer", "destination_account_owner"],
    phoneNumber: "09120000001",
    notes: undefined
  });
  const rezaei = await partyRepository.createParty({
    displayName: "رضایی",
    aliases: [],
    searchableDescription: "گیرنده دوم",
    roles: ["farmer", "destination_account_owner"],
    phoneNumber: "09120000002",
    notes: undefined
  });

  const ahmadiAccount = await destinationAccountRepository.createAccount({
    ownerPartyId: ahmadi.id,
    accountLabel: "حساب اصلی",
    bankName: "بانک نمونه",
    cardNumber: "۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶"
  });
  const rezaeiAccount = await destinationAccountRepository.createAccount({
    ownerPartyId: rezaei.id,
    accountLabel: "کارت کشاورزی",
    bankName: "بانک نمونه",
    iban: makeValidIranianIban("5401026800208179090020")
  });

  const invoice = await invoiceRepository.createInvoice({
    customerPartyId: customer.id,
    invoiceDate: "2026-07-10",
    totalAmount: 1_500_000_000,
    referenceNumber: "ف-پایلوت",
    note: "سناریوی پایلوت"
  });
  const ahmadiInstruction = await paymentInstructionRepository.createInstruction({
    invoiceId: invoice.id,
    recipientPartyId: ahmadi.id,
    destinationAccountId: ahmadiAccount.id,
    instructedAmount: 200_000_000,
    note: "دستور احمدی"
  });
  const rezaeiInstruction = await paymentInstructionRepository.createInstruction({
    invoiceId: invoice.id,
    recipientPartyId: rezaei.id,
    destinationAccountId: rezaeiAccount.id,
    instructedAmount: 300_000_000,
    note: "دستور رضایی"
  });

  await paymentRepository.createPayment(
    {
      payerPartyId: customer.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiAccount.id,
      amount: 50_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "trk-a-1",
      note: "پرداخت نخست"
    },
    {
      invoiceId: invoice.id,
      paymentInstructionId: ahmadiInstruction.id,
      allocatedAmount: 50_000_000
    }
  );
  await paymentRepository.createPayment(
    {
      payerPartyId: customer.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiAccount.id,
      amount: 30_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "reported",
      trackingReference: "trk-a-2",
      note: "پرداخت اعلام‌شده"
    },
    {
      invoiceId: invoice.id,
      paymentInstructionId: ahmadiInstruction.id,
      allocatedAmount: 30_000_000
    }
  );
  await paymentRepository.createPayment(
    {
      payerPartyId: customer.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiAccount.id,
      amount: 100_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "trk-a-3",
      note: "پرداخت دوم"
    },
    {
      invoiceId: invoice.id,
      paymentInstructionId: ahmadiInstruction.id,
      allocatedAmount: 100_000_000
    }
  );
  await paymentRepository.createPayment(
    {
      payerPartyId: customer.id,
      recipientPartyId: ahmadi.id,
      destinationAccountId: ahmadiAccount.id,
      amount: 20_000_000,
      paymentDate: "2026-07-10",
      paymentMethod: "bank_transfer",
      verificationStatus: "confirmed",
      trackingReference: "trk-a-4",
      note: "پرداخت سوم"
    },
    {
      invoiceId: invoice.id,
      paymentInstructionId: ahmadiInstruction.id,
      allocatedAmount: 20_000_000
    }
  );

  return {
    customer,
    ahmadi,
    rezaei,
    invoice,
    ahmadiInstruction,
    rezaeiInstruction
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("pilot workflow", () => {
  it("preserves the end-to-end balances through backup export and restore", async () => {
    const sourceDatabase = createDatabase("pilot-source");
    const targetDatabase = createDatabase("pilot-target");
    const sourceService = new BackupService(sourceDatabase, {
      now: () => "2026-07-10T10:00:00.000Z",
      storage: createMemoryStorage(),
      applicationVersion: "0.0.0"
    });
    const targetService = new BackupService(targetDatabase, {
      now: () => "2026-07-10T10:00:00.000Z",
      storage: createMemoryStorage(),
      applicationVersion: "0.0.0"
    });

    await seedPilotScenario(sourceDatabase);

    const sourceParties = await sourceDatabase.parties.toArray();
    const sourceInvoices = await sourceDatabase.invoices.toArray();
    const sourceInstructions = await sourceDatabase.paymentInstructions.toArray();
    const sourcePayments = await sourceDatabase.payments.toArray();
    const sourceAllocations = await sourceDatabase.paymentAllocations.toArray();

    const sourceInvoice = sourceInvoices[0]!;
    const sourceAhmadi = sourceParties.find((party) => party.displayName === "احمدی")!;
    const sourceZare = sourceParties.find((party) => party.displayName === "زاره")!;
    const sourceAhmadiInstruction = sourceInstructions.find((instruction) => instruction.recipientPartyId === sourceAhmadi.id)!;

    const beforeCustomerSummary = summarizeCustomerSettlement(sourceZare.id, sourceInvoices, sourceInstructions, sourcePayments, sourceAllocations, sourceParties);
    const beforeRecipientSummary = summarizeRecipientSettlement(sourceAhmadi.id, sourceInstructions, sourcePayments, sourceAllocations, sourceParties);
    const beforeInvoiceSummary = summarizeInvoiceBalance(sourceInvoice, sourceInstructions.filter((instruction) => instruction.invoiceId === sourceInvoice.id), sourcePayments, sourceAllocations);
    const beforeInstructionSummary = summarizeInstructionBalance(sourceAhmadiInstruction, sourcePayments, sourceAllocations);

    expect(beforeRecipientSummary.confirmedReceived).toBe(170_000_000);
    expect(beforeRecipientSummary.reportedUnconfirmed).toBe(30_000_000);
    expect(beforeRecipientSummary.confirmedRemaining).toBe(30_000_000);
    expect(beforeRecipientSummary.provisionalRemaining).toBe(0);
    expect(beforeInvoiceSummary.confirmedOutstandingAmount).toBe(1_330_000_000);
    expect(beforeInvoiceSummary.provisionalOutstandingAmount).toBe(1_300_000_000);
    expect(beforeInvoiceSummary.unassignedInvoiceAmount).toBe(1_000_000_000);
    expect(beforeInstructionSummary.confirmedRemainingAmount).toBe(30_000_000);
    expect(beforeInstructionSummary.provisionalRemainingAmount).toBe(0);

    const exported = await sourceService.exportBackup();
    await targetService.restoreBackupText(exported.text);

    const targetParties = await targetDatabase.parties.toArray();
    const targetInvoices = await targetDatabase.invoices.toArray();
    const targetInstructions = await targetDatabase.paymentInstructions.toArray();
    const targetPayments = await targetDatabase.payments.toArray();
    const targetAllocations = await targetDatabase.paymentAllocations.toArray();
    const targetInvoice = targetInvoices[0]!;
    const targetAhmadi = targetParties.find((party) => party.displayName === "احمدی")!;
    const targetZare = targetParties.find((party) => party.displayName === "زاره")!;
    const targetAhmadiInstruction = targetInstructions.find((instruction) => instruction.recipientPartyId === targetAhmadi.id)!;

    const afterCustomerSummary = summarizeCustomerSettlement(targetZare.id, targetInvoices, targetInstructions, targetPayments, targetAllocations, targetParties);
    const afterRecipientSummary = summarizeRecipientSettlement(targetAhmadi.id, targetInstructions, targetPayments, targetAllocations, targetParties);
    const afterInvoiceSummary = summarizeInvoiceBalance(targetInvoice, targetInstructions.filter((instruction) => instruction.invoiceId === targetInvoice.id), targetPayments, targetAllocations);
    const afterInstructionSummary = summarizeInstructionBalance(targetAhmadiInstruction, targetPayments, targetAllocations);

    expect(afterCustomerSummary).toEqual(beforeCustomerSummary);
    expect(afterRecipientSummary).toEqual(beforeRecipientSummary);
    expect(afterInvoiceSummary).toEqual(beforeInvoiceSummary);
    expect(afterInstructionSummary).toEqual(beforeInstructionSummary);
    expect(await targetService.getCurrentRecordCounts()).toEqual(exported.preview.recordCounts);
    expect((await targetService.getHistorySummary()).lastRestore).not.toBeNull();
  });
});
