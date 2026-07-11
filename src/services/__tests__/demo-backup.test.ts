import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { TasviehYarDatabase } from "../../db/tasviehyar-db";
import { BackupService } from "../backup-service";
import { buildDemoOperationalReportWorkbookData } from "../report-snapshot";
import { buildOperationalReportWorkbook } from "../report-export";
import { summarizeInstructionBalance, summarizeInvoiceBalance } from "../../domain/settlement";

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

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("demo backup artifact", () => {
  it("restores the generated demo backup and reproduces the expected report workbook", async () => {
    const filePath = resolve("demo", "tasviehyar-demo-backup-v1.json");
    const text = await readFile(filePath, "utf8");
    const restoreDatabase = createDatabase("demo-restore");
    const service = new BackupService(restoreDatabase, {
      now: () => "2026-07-10T08:00:00.000Z",
      storage: createMemoryStorage(),
      applicationVersion: "0.9.0-alpha.0"
    });

    const restoreResult = await service.restoreBackupText(text);
    expect(restoreResult.restoredRecordCounts).toEqual({
      parties: 6,
      destinationAccounts: 6,
      invoices: 5,
      paymentInstructions: 5,
      payments: 10,
      paymentAllocations: 7,
      paymentVerifications: 7,
      auditEvents: 51
    });

    const parties = await restoreDatabase.parties.toArray();
    const invoices = await restoreDatabase.invoices.toArray();
    const instructions = await restoreDatabase.paymentInstructions.toArray();
    const payments = await restoreDatabase.payments.toArray();
    const allocations = await restoreDatabase.paymentAllocations.toArray();
    const destinationAccounts = await restoreDatabase.destinationAccounts.toArray();

    const zare = parties.find((party) => party.displayName === "آقای زارع");
    const ahmadi = parties.find((party) => party.displayName === "آقای احمدی");
    const karimi = parties.find((party) => party.displayName === "آقای کریمی");
    expect(zare).toBeDefined();
    expect(ahmadi).toBeDefined();
    expect(karimi).toBeDefined();

    const scenarioAInvoice = invoices.find((invoice) => invoice.referenceNumber === "ف-زارع-01");
    const scenarioAInstruction = instructions.find((instruction) => instruction.invoiceId === scenarioAInvoice?.id && instruction.recipientPartyId === ahmadi?.id);
    expect(scenarioAInvoice).toBeDefined();
    expect(scenarioAInstruction).toBeDefined();

    const invoiceSummary = summarizeInvoiceBalance(
      scenarioAInvoice!,
      instructions.filter((instruction) => instruction.invoiceId === scenarioAInvoice!.id),
      payments,
      allocations
    );
    expect(invoiceSummary.confirmedAllocatedAmount).toBe(170_000_000);
    expect(invoiceSummary.reportedAllocatedAmount).toBe(30_000_000);
    expect(invoiceSummary.confirmedOutstandingAmount).toBe(1_330_000_000);
    expect(invoiceSummary.provisionalOutstandingAmount).toBe(1_300_000_000);
    expect(invoiceSummary.unassignedInvoiceAmount).toBe(1_000_000_000);

    const instructionSummary = summarizeInstructionBalance(scenarioAInstruction!, payments, allocations);
    expect(instructionSummary.confirmedReceived).toBe(170_000_000);
    expect(instructionSummary.reportedButUnconfirmedAmount).toBe(30_000_000);
    expect(instructionSummary.confirmedRemainingAmount).toBe(30_000_000);
    expect(instructionSummary.provisionalRemainingAmount).toBe(0);

    const workbookData = buildDemoOperationalReportWorkbookData({
      parties,
      invoices,
      instructions,
      payments,
      allocations,
      destinationAccounts,
      generatedAt: "2026-07-10T08:00:00.000Z",
      applicationVersion: "0.9.0-alpha.0",
      statementPartyId: karimi!.id
    });

    expect(workbookData.customerSummaries.length).toBeGreaterThan(0);
    expect(workbookData.recipientSummaries.length).toBeGreaterThan(0);
    expect(workbookData.reconciliationItems.map((row) => row.mismatchType)).toEqual(
      expect.arrayContaining([
        "reported_payment_awaiting_confirmation",
        "unallocated_payment",
        "disputed_payment",
        "active_instruction_without_destination_account",
        "duplicate_tracking_reference",
        "instruction_overpayment"
      ])
    );

    const workbook = await buildOperationalReportWorkbook(workbookData);
    const buffer = await workbook.xlsx.writeBuffer();
    const parsedWorkbook = new ExcelJS.Workbook();
    await parsedWorkbook.xlsx.load(buffer as ArrayBuffer);

    expect(parsedWorkbook.worksheets.map((worksheet) => worksheet.name)).toEqual(
      expect.arrayContaining(["اطلاعات گزارش", "خلاصه مشتریان", "خلاصه گیرندگان", "فاکتورها", "دستورهای پرداخت", "پرداخت‌ها", "مغایرت‌ها", "گردش یک شخص"])
    );
    const customerSheet = parsedWorkbook.getWorksheet("خلاصه مشتریان");
    const recipientSheet = parsedWorkbook.getWorksheet("خلاصه گیرندگان");
    expect(customerSheet).toBeDefined();
    expect(recipientSheet).toBeDefined();
    expect(customerSheet!.getRow(2).getCell(2).value).toBe(zare!.id);
    expect(customerSheet!.getRow(2).getCell(6).value).toBe(
      workbookData.customerSummaries.find((row) => row.partyId === zare!.id)?.confirmedOutstanding
    );
    expect(customerSheet!.rowCount - 1).toBe(workbookData.customerSummaries.length);
    expect(recipientSheet!.rowCount - 1).toBe(workbookData.recipientSummaries.length);
  });
});
