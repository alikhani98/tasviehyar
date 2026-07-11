import "fake-indexeddb/auto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { TasviehYarDatabase } from "../src/db/tasviehyar-db";
import { buildBackupEnvelopeWithoutChecksum, digestBackupEnvelope, parseBackupEnvelope, validateBackupIntegrity } from "../src/domain/backup";
import { summarizeCustomerSettlement, summarizeInstructionBalance, summarizeInvoiceBalance, summarizeRecipientSettlement, deriveSettlementReviewItems } from "../src/domain/settlement";
import { BackupService } from "../src/services/backup-service";
import { seedDemoBackupDatabase } from "../src/services/demo-backup";
import { buildDemoOperationalReportWorkbookData } from "../src/services/report-snapshot";
import { buildOperationalReportWorkbook } from "../src/services/report-export";

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

async function main(): Promise<void> {
  const generatedAt = "2026-07-10T08:00:00.000Z";
  const applicationVersion = "0.9.0-alpha.0";
  const outputPath = resolve("demo", "tasviehyar-demo-backup-v1.json");
  const sourceDb = new TasviehYarDatabase(`tasviehyar-demo-source-${crypto.randomUUID()}`);
  const restoreDb = new TasviehYarDatabase(`tasviehyar-demo-restore-${crypto.randomUUID()}`);

  try {
    await seedDemoBackupDatabase(sourceDb);
    const sourceService = new BackupService(sourceDb, {
      now: () => generatedAt,
      storage: createMemoryStorage(),
      applicationVersion
    });
    const exported = await sourceService.exportBackup();

    await mkdir("demo", { recursive: true });
    await writeFile(outputPath, exported.text, "utf8");

    const writtenText = await import("node:fs/promises").then((fs) => fs.readFile(outputPath, "utf8"));
    const envelope = parseBackupEnvelope(writtenText);
    const sourceIssues = validateBackupIntegrity({
      parties: envelope.parties,
      destinationAccounts: envelope.destinationAccounts,
      invoices: envelope.invoices,
      paymentInstructions: envelope.paymentInstructions,
      payments: envelope.payments,
      paymentAllocations: envelope.paymentAllocations,
      paymentVerifications: envelope.paymentVerifications,
      auditEvents: envelope.auditEvents
    });
    if (sourceIssues.some((issue) => issue.severity === "error")) {
      throw new Error(`Integrity validation failed for generated demo backup: ${sourceIssues.map((issue) => issue.message).join(" · ")}`);
    }
    const restoreService = new BackupService(restoreDb, {
      now: () => generatedAt,
      storage: createMemoryStorage(),
      applicationVersion
    });
    const restoreResult = await restoreService.restoreBackupText(writtenText);

    const restoredIssues = validateBackupIntegrity({
      parties: await restoreDb.parties.toArray(),
      destinationAccounts: await restoreDb.destinationAccounts.toArray(),
      invoices: await restoreDb.invoices.toArray(),
      paymentInstructions: await restoreDb.paymentInstructions.toArray(),
      payments: await restoreDb.payments.toArray(),
      paymentAllocations: await restoreDb.paymentAllocations.toArray(),
      paymentVerifications: await restoreDb.paymentVerifications.toArray(),
      auditEvents: await restoreDb.auditEvents.toArray()
    });
    if (restoredIssues.some((issue) => issue.severity === "error")) {
      throw new Error(`Restored demo backup failed integrity validation: ${restoredIssues.map((issue) => issue.message).join(" · ")}`);
    }

    const restoredChecksumSource = buildBackupEnvelopeWithoutChecksum(
      {
        parties: await restoreDb.parties.toArray(),
        destinationAccounts: await restoreDb.destinationAccounts.toArray(),
        invoices: await restoreDb.invoices.toArray(),
        paymentInstructions: await restoreDb.paymentInstructions.toArray(),
        payments: await restoreDb.payments.toArray(),
        paymentAllocations: await restoreDb.paymentAllocations.toArray(),
        paymentVerifications: await restoreDb.paymentVerifications.toArray(),
        auditEvents: await restoreDb.auditEvents.toArray()
      },
      {
        createdAt: envelope.createdAt,
        databaseSchemaVersion: envelope.databaseSchemaVersion,
        ...(envelope.applicationVersion ? { applicationVersion: envelope.applicationVersion } : {})
      }
    );
    const checksum = await digestBackupEnvelope(restoredChecksumSource);
    if (checksum.value !== envelope.checksum.value) {
      throw new Error("Checksum validation failed for generated demo backup.");
    }

    const sourceCounts = exported.preview.recordCounts;
    const restoredCounts = restoreResult.restoredRecordCounts;
    if (JSON.stringify(sourceCounts) !== JSON.stringify(restoredCounts)) {
      throw new Error("Restored record counts do not match the exported backup.");
    }

    const restoredParties = await restoreDb.parties.toArray();
    const restoredInvoices = await restoreDb.invoices.toArray();
    const restoredInstructions = await restoreDb.paymentInstructions.toArray();
    const restoredPayments = await restoreDb.payments.toArray();
    const restoredAllocations = await restoreDb.paymentAllocations.toArray();
    const restoredAccounts = await restoreDb.destinationAccounts.toArray();

    const zare = restoredParties.find((party) => party.displayName === "آقای زارع");
    const ahmadi = restoredParties.find((party) => party.displayName === "آقای احمدی");
    const rezaei = restoredParties.find((party) => party.displayName === "آقای رضایی");
    const internalBusiness = restoredParties.find((party) => party.displayName === "حساب مجموعه علیخانی");
    const bahrami = restoredParties.find((party) => party.displayName === "آقای بهرامی");
    const karimi = restoredParties.find((party) => party.displayName === "آقای کریمی");
    if (!zare || !ahmadi || !rezaei || !internalBusiness || !bahrami || !karimi) {
      throw new Error("One or more demo parties are missing from the restored backup.");
    }

    const zareOutstanding = restoredInvoices.find((invoice) => invoice.referenceNumber === "ف-زارع-01");
    const karimiSettled = restoredInvoices.find((invoice) => invoice.referenceNumber === "ف-کریمی-01");
    const zareRecipientStatement = restoredInvoices.find((invoice) => invoice.referenceNumber === "ف-زارع-02");
    const zareOverpayment = restoredInvoices.find((invoice) => invoice.referenceNumber === "ف-زارع-03");
    if (!zareOutstanding || !karimiSettled || !zareRecipientStatement || !zareOverpayment) {
      throw new Error("Representative invoices were not restored correctly.");
    }

    const zareAhmadiInstruction = restoredInstructions.find((instruction) => instruction.invoiceId === zareOutstanding.id && instruction.recipientPartyId === ahmadi.id);
    const karimiRecipientInstruction = restoredInstructions.find((instruction) => instruction.invoiceId === zareRecipientStatement.id && instruction.recipientPartyId === karimi.id);
    const zareOverpaymentInstruction = restoredInstructions.find((instruction) => instruction.invoiceId === zareOverpayment.id);
    if (!zareAhmadiInstruction || !karimiRecipientInstruction || !zareOverpaymentInstruction) {
      throw new Error("Representative instructions were not restored correctly.");
    }

    const scenarioASummary = summarizeInvoiceBalance(
      zareOutstanding,
      restoredInstructions.filter((instruction) => instruction.invoiceId === zareOutstanding.id),
      restoredPayments,
      restoredAllocations
    );
    if (
      scenarioASummary.confirmedAllocatedAmount !== 170_000_000 ||
      scenarioASummary.reportedAllocatedAmount !== 30_000_000 ||
      scenarioASummary.confirmedOutstandingAmount !== 1_330_000_000 ||
      scenarioASummary.provisionalOutstandingAmount !== 1_300_000_000 ||
      scenarioASummary.unassignedInvoiceAmount !== 1_000_000_000
    ) {
      throw new Error("Scenario A balances do not match the expected values.");
    }

    const scenarioAInstructionSummary = summarizeInstructionBalance(zareAhmadiInstruction, restoredPayments, restoredAllocations);
    if (
      scenarioAInstructionSummary.confirmedReceived !== 170_000_000 ||
      scenarioAInstructionSummary.reportedButUnconfirmedAmount !== 30_000_000 ||
      scenarioAInstructionSummary.confirmedRemainingAmount !== 30_000_000 ||
      scenarioAInstructionSummary.provisionalRemainingAmount !== 0
    ) {
      throw new Error("Scenario A instruction balances do not match the expected values.");
    }

    const karimiSummary = summarizeCustomerSettlement(karimi.id, restoredInvoices, restoredInstructions, restoredPayments, restoredAllocations, restoredParties);
    const ahmadiSummary = summarizeRecipientSettlement(ahmadi.id, restoredInstructions, restoredPayments, restoredAllocations, restoredParties);
    if (karimiSummary.confirmedOutstanding !== 0 || karimiSummary.provisionalOutstanding !== 0) {
      throw new Error("Scenario B settlement is not fully closed.");
    }
    if (ahmadiSummary.confirmedRemaining !== 30_000_000 || ahmadiSummary.provisionalRemaining !== 0) {
      throw new Error("Recipient summary totals do not match the expected values.");
    }

    const reconciliationItems = deriveSettlementReviewItems({
      parties: restoredParties,
      invoices: restoredInvoices,
      instructions: restoredInstructions,
      payments: restoredPayments,
      allocations: restoredAllocations,
      destinationAccounts: restoredAccounts
    });
    const mismatchTypes = new Set(reconciliationItems.map((item) => item.mismatchType));
    for (const mismatchType of [
      "reported_payment_awaiting_confirmation",
      "unallocated_payment",
      "disputed_payment",
      "active_instruction_without_destination_account",
      "duplicate_tracking_reference",
      "instruction_overpayment"
    ] as const) {
      if (!mismatchTypes.has(mismatchType)) {
        throw new Error(`Missing reconciliation item: ${mismatchType}`);
      }
    }

    const reportData = buildDemoOperationalReportWorkbookData({
      parties: restoredParties,
      invoices: restoredInvoices,
      instructions: restoredInstructions,
      payments: restoredPayments,
      allocations: restoredAllocations,
      destinationAccounts: restoredAccounts,
      generatedAt,
      applicationVersion,
      statementPartyId: karimi.id
    });
    const workbook = await buildOperationalReportWorkbook(reportData);
    const workbookBuffer = await workbook.xlsx.writeBuffer();
    const parsedWorkbook = new ExcelJS.Workbook();
    await parsedWorkbook.xlsx.load(workbookBuffer as ArrayBuffer);
    const sheetNames = parsedWorkbook.worksheets.map((worksheet) => worksheet.name);
    for (const sheetName of ["اطلاعات گزارش", "خلاصه مشتریان", "خلاصه گیرندگان", "فاکتورها", "دستورهای پرداخت", "پرداخت‌ها", "مغایرت‌ها", "گردش یک شخص"]) {
      if (!sheetNames.includes(sheetName)) {
        throw new Error(`Missing workbook sheet: ${sheetName}`);
      }
    }

    const reportCounts = {
      customerSummaries: reportData.customerSummaries.length,
      recipientSummaries: reportData.recipientSummaries.length,
      invoices: reportData.invoices.length,
      paymentInstructions: reportData.paymentInstructions.length,
      payments: reportData.payments.length,
      reconciliationItems: reportData.reconciliationItems.length
    };
    if (reportCounts.customerSummaries < 1 || reportCounts.recipientSummaries < 1 || reportCounts.reconciliationItems < 1) {
      throw new Error("Representative report rows were not generated.");
    }

    console.log(
      JSON.stringify(
        {
          file: outputPath,
          checksum: envelope.checksum.value,
          counts: sourceCounts,
          restoredCounts,
          sheetNames,
          scenarioA: {
            confirmedReceived: scenarioAInstructionSummary.confirmedReceived,
            reportedUnconfirmed: scenarioAInstructionSummary.reportedButUnconfirmedAmount,
            confirmedRemaining: scenarioAInstructionSummary.confirmedRemainingAmount,
            provisionalRemaining: scenarioAInstructionSummary.provisionalRemainingAmount,
            invoiceConfirmedOutstanding: scenarioASummary.confirmedOutstandingAmount,
            invoiceProvisionalOutstanding: scenarioASummary.provisionalOutstandingAmount,
            invoiceUnassignedAmount: scenarioASummary.unassignedInvoiceAmount
          },
          reportCounts,
          reconciliationTypes: Array.from(mismatchTypes).sort()
        },
        null,
        2
      )
    );
  } finally {
    await sourceDb.delete();
    await restoreDb.delete();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
