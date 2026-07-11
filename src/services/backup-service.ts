import packageJson from "../../package.json";
import { ZodError } from "zod";
import { TasviehYarDatabase, TASVIEHYAR_SCHEMA_VERSION } from "../db/tasviehyar-db";
import type {
  BackupData,
  BackupEnvelope,
  BackupHistoryEntry,
  BackupHistorySummary,
  BackupIntegrityIssue,
  BackupPreview,
  BackupRecordCounts
} from "../domain/backup";
import {
  backupAppIdentifier,
  backupFormatVersion,
  buildBackupRecordCounts,
  createBackupEnvelopeWithoutChecksum,
  createBackupFileName,
  createDemoBackupFileName,
  digestBackupEnvelope,
  parseBackupEnvelope,
  validateBackupIntegrity
} from "../domain/backup";
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
import { seedDemoBackupDatabase } from "./demo-backup";

export interface BackupServiceDependencies {
  now?: () => string;
  storage?: Storage;
  applicationVersion?: string;
}

export interface BackupExportResult {
  filename: string;
  text: string;
  preview: BackupPreview;
  checksum: string;
}

export interface BackupRestoreResult {
  preview: BackupPreview;
  restoredRecordCounts: BackupRecordCounts;
  restoredAt: string;
  sourceFileName: string;
}

export interface BackupInspectionResult {
  preview: BackupPreview;
  envelope: BackupEnvelope | null;
}

interface BackupTableBundle {
  parties: Party[];
  destinationAccounts: DestinationAccount[];
  invoices: Invoice[];
  paymentInstructions: PaymentInstruction[];
  payments: Payment[];
  paymentAllocations: PaymentAllocation[];
  paymentVerifications: PaymentVerification[];
  auditEvents: AuditEvent[];
}

const backupHistoryStorageKey = "tasviehyar.backup.history.v1";

function defaultNow(): string {
  return new Date().toISOString();
}

function getStorage(storage?: Storage): Storage | null {
  return storage ?? globalThis.localStorage ?? null;
}

function isErrorIssue(issue: BackupIntegrityIssue): boolean {
  return issue.severity === "error";
}

function summarizeIssues(issues: readonly BackupIntegrityIssue[]): string {
  return issues
    .map((issue) => issue.message)
    .join(" · ");
}

function buildBackupPreview(envelope: BackupEnvelope | null, issues: BackupIntegrityIssue[]): BackupPreview {
  const hasErrors = issues.some(isErrorIssue);
  return {
    compatible: Boolean(envelope) && !hasErrors,
    ...(envelope?.appIdentifier ? { appIdentifier: envelope.appIdentifier } : {}),
    ...(typeof envelope?.backupFormatVersion === "number" ? { backupFormatVersion: envelope.backupFormatVersion } : {}),
    ...(typeof envelope?.databaseSchemaVersion === "number" ? { databaseSchemaVersion: envelope.databaseSchemaVersion } : {}),
    ...(envelope?.applicationVersion ? { applicationVersion: envelope.applicationVersion } : {}),
    ...(envelope?.createdAt ? { createdAt: envelope.createdAt } : {}),
    ...(envelope?.checksum ? { checksum: envelope.checksum.value } : {}),
    ...(envelope?.recordCounts ? { recordCounts: envelope.recordCounts } : {}),
    issues
  };
}

function historyFromStorage(storage: Storage | null): BackupHistoryEntry[] {
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(backupHistoryStorageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is BackupHistoryEntry => {
      return (
        typeof entry === "object" &&
        entry !== null &&
        ((entry as BackupHistoryEntry).kind === "backup" || (entry as BackupHistoryEntry).kind === "restore")
      );
    });
  } catch {
    return [];
  }
}

function writeHistory(storage: Storage | null, entries: readonly BackupHistoryEntry[]): void {
  if (!storage) {
    return;
  }

  storage.setItem(backupHistoryStorageKey, JSON.stringify(entries));
}

function appendHistoryEntry(storage: Storage | null, entry: BackupHistoryEntry): void {
  const nextEntries = [...historyFromStorage(storage), entry].slice(-20);
  writeHistory(storage, nextEntries);
}

function createEphemeralStorage(): Storage {
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

function compareRecordCounts(actual: BackupRecordCounts, expected: BackupRecordCounts): BackupIntegrityIssue[] {
  const fields: Array<keyof BackupRecordCounts> = [
    "parties",
    "destinationAccounts",
    "invoices",
    "paymentInstructions",
    "payments",
    "paymentAllocations",
    "paymentVerifications",
    "auditEvents"
  ];

  return fields.flatMap((field) => {
    if (actual[field] === expected[field]) {
      return [];
    }

    return [
      {
        severity: "error" as const,
        code: `record_count:${field}`,
        message: `تعداد رکوردهای ${field} با محتوای فایل همخوان نیست.`
      }
    ];
  });
}

function buildFileNameAndHistory(envelope: BackupEnvelope, createdAt: string): BackupHistoryEntry {
  return {
    kind: "backup",
    createdAt,
    sourceBackupCreatedAt: envelope.createdAt,
    fileName: createBackupFileName(envelope.createdAt),
    checksum: envelope.checksum.value,
    recordCounts: envelope.recordCounts
  };
}

function readDatabaseBundle(database: TasviehYarDatabase): Promise<BackupTableBundle> {
  return Promise.all([
    database.parties.toArray(),
    database.destinationAccounts.toArray(),
    database.invoices.toArray(),
    database.paymentInstructions.toArray(),
    database.payments.toArray(),
    database.paymentAllocations.toArray(),
    database.paymentVerifications.toArray(),
    database.auditEvents.toArray()
  ]).then(([parties, destinationAccounts, invoices, paymentInstructions, payments, paymentAllocations, paymentVerifications, auditEvents]) => ({
    parties,
    destinationAccounts,
    invoices,
    paymentInstructions,
    payments,
    paymentAllocations,
    paymentVerifications,
    auditEvents
  }));
}

function mapBundleToData(bundle: BackupTableBundle): BackupData {
  return {
    parties: bundle.parties,
    destinationAccounts: bundle.destinationAccounts,
    invoices: bundle.invoices,
    paymentInstructions: bundle.paymentInstructions,
    payments: bundle.payments,
    paymentAllocations: bundle.paymentAllocations,
    paymentVerifications: bundle.paymentVerifications,
    auditEvents: bundle.auditEvents
  };
}

export class BackupService {
  private readonly now: () => string;

  private readonly storage: Storage | null;

  private readonly applicationVersion?: string;

  constructor(private readonly database: TasviehYarDatabase, deps: BackupServiceDependencies = {}) {
    this.now = deps.now ?? defaultNow;
    this.storage = getStorage(deps.storage);
    this.applicationVersion = deps.applicationVersion ?? packageJson.version;
  }

  async exportBackup(): Promise<BackupExportResult> {
    const bundle = await readDatabaseBundle(this.database);
    const createdAt = this.now();
    const { envelope, preview, checksum, text } = await this.buildExportArtifacts(mapBundleToData(bundle), createdAt);

    appendHistoryEntry(this.storage, buildFileNameAndHistory(envelope, createdAt));

    return {
      filename: createBackupFileName(createdAt),
      text,
      preview,
      checksum: checksum.value
    };
  }

  async exportDemoBackup(): Promise<BackupExportResult> {
    const demoDatabase = new TasviehYarDatabase(`tasviehyar-demo-${crypto.randomUUID()}`);
    try {
      await seedDemoBackupDatabase(demoDatabase);
      const createdAt = this.now();
      const demoService = new BackupService(demoDatabase, {
        now: () => createdAt,
        storage: createEphemeralStorage(),
        ...(this.applicationVersion ? { applicationVersion: this.applicationVersion } : {})
      });
      const result = await demoService.exportBackup();
      return {
        ...result,
        filename: createDemoBackupFileName(createdAt)
      };
    } finally {
      await demoDatabase.delete();
    }
  }

  async getCurrentRecordCounts(): Promise<BackupRecordCounts> {
    const bundle = await readDatabaseBundle(this.database);
    return buildBackupRecordCounts(mapBundleToData(bundle));
  }

  async inspectBackupText(text: string): Promise<BackupInspectionResult> {
    let envelope: BackupEnvelope | null = null;
    const issues: BackupIntegrityIssue[] = [];

    try {
      envelope = parseBackupEnvelope(text);
    } catch (caught) {
      if (caught instanceof ZodError) {
        return {
          envelope: null,
          preview: buildBackupPreview(null, caught.issues.map((issue) => ({
            severity: "error",
            code: issue.path.length > 0 ? issue.path.join(".") : "schema",
            message: issue.message
          })))
        };
      }

      return {
        envelope: null,
        preview: buildBackupPreview(null, [
          {
            severity: "error",
            code: "malformed_json",
            message: caught instanceof Error ? "فایل پشتیبان JSON معتبر نیست." : "فایل پشتیبان قابل خواندن نیست."
          }
        ])
      };
    }

    if (envelope.appIdentifier !== backupAppIdentifier) {
      issues.push({
        severity: "error",
        code: "app_identifier",
        message: "شناسه برنامه در فایل پشتیبان با این برنامه مطابقت ندارد."
      });
    }

    if (envelope.backupFormatVersion !== backupFormatVersion) {
      issues.push({
        severity: "error",
        code: "backup_format",
        message: "نسخه قالب پشتیبان پشتیبانی نمی‌شود."
      });
    }

    if (envelope.databaseSchemaVersion !== TASVIEHYAR_SCHEMA_VERSION) {
      issues.push({
        severity: "error",
        code: "schema_version",
        message: "نسخه شِمای پایگاه‌داده با این برنامه سازگار نیست."
      });
    }

    const data = mapBundleToData(envelope);
    issues.push(...validateBackupIntegrity(data));
    issues.push(...compareRecordCounts(buildBackupRecordCounts(data), envelope.recordCounts));

    const checksumSource = createBackupEnvelopeWithoutChecksum(data, {
      createdAt: envelope.createdAt,
      databaseSchemaVersion: envelope.databaseSchemaVersion,
      ...(envelope.applicationVersion ? { applicationVersion: envelope.applicationVersion } : {})
    });
    const checksum = await digestBackupEnvelope(checksumSource);
    if (checksum.value !== envelope.checksum.value) {
      issues.push({
        severity: "error",
        code: "checksum",
        message: "امضای کنترل یکپارچگی فایل معتبر نیست."
      });
    }

    return {
      envelope,
      preview: buildBackupPreview(envelope, issues)
    };
  }

  private async buildExportArtifacts(
    data: BackupData,
    createdAt: string
  ): Promise<{ envelope: BackupEnvelope; preview: BackupPreview; checksum: { value: string }; text: string }> {
    const envelopeWithoutChecksum = createBackupEnvelopeWithoutChecksum(data, {
      createdAt,
      databaseSchemaVersion: TASVIEHYAR_SCHEMA_VERSION,
      ...(this.applicationVersion ? { applicationVersion: this.applicationVersion } : {})
    });
    const checksum = await digestBackupEnvelope(envelopeWithoutChecksum);
    const envelope: BackupEnvelope = {
      ...envelopeWithoutChecksum,
      checksum
    };
    const issues = validateBackupIntegrity(data);
    const preview = buildBackupPreview(envelope, issues);
    return {
      envelope,
      preview,
      checksum,
      text: JSON.stringify(envelope, null, 2)
    };
  }

  async restoreBackupText(text: string): Promise<BackupRestoreResult> {
    const inspection = await this.inspectBackupText(text);
    if (!inspection.envelope) {
      throw new Error(summarizeIssues(inspection.preview.issues) || "فایل پشتیبان معتبر نیست.");
    }

    if (!inspection.preview.compatible) {
      throw new Error(summarizeIssues(inspection.preview.issues) || "بازیابی از این فایل امکان‌پذیر نیست.");
    }

    const bundle = mapBundleToData(inspection.envelope);

    const transactionalDatabase = this.database as unknown as {
      transaction: (...args: unknown[]) => Promise<unknown>;
    };
    await transactionalDatabase.transaction(
      "rw",
      this.database.parties,
      this.database.destinationAccounts,
      this.database.invoices,
      this.database.paymentInstructions,
      this.database.payments,
      this.database.paymentAllocations,
      this.database.paymentVerifications,
      this.database.auditEvents,
      async () => {
        await Promise.all([
          this.database.parties.clear(),
          this.database.destinationAccounts.clear(),
          this.database.invoices.clear(),
          this.database.paymentInstructions.clear(),
          this.database.payments.clear(),
          this.database.paymentAllocations.clear(),
          this.database.paymentVerifications.clear(),
          this.database.auditEvents.clear()
        ]);

        await Promise.all([
          this.database.parties.bulkPut(bundle.parties),
          this.database.destinationAccounts.bulkPut(bundle.destinationAccounts),
          this.database.invoices.bulkPut(bundle.invoices),
          this.database.paymentInstructions.bulkPut(bundle.paymentInstructions),
          this.database.payments.bulkPut(bundle.payments),
          this.database.paymentAllocations.bulkPut(bundle.paymentAllocations),
          this.database.paymentVerifications.bulkPut(bundle.paymentVerifications),
          this.database.auditEvents.bulkPut(bundle.auditEvents)
        ]);
      }
    );

    const restoredIssues = validateBackupIntegrity(bundle);
    if (restoredIssues.some((issue) => issue.severity === "error")) {
      throw new Error("فایل بازیابی‌شده پس از ذخیره هنوز ناسازگاری دارد.");
    }

    const restoredAt = this.now();
    appendHistoryEntry(this.storage, {
      kind: "restore",
      createdAt: restoredAt,
      sourceBackupCreatedAt: inspection.envelope.createdAt,
      fileName: createBackupFileName(inspection.envelope.createdAt),
      checksum: inspection.envelope.checksum.value,
      recordCounts: inspection.envelope.recordCounts
    });

    return {
      preview: inspection.preview,
      restoredRecordCounts: inspection.envelope.recordCounts,
      restoredAt,
      sourceFileName: createBackupFileName(inspection.envelope.createdAt)
    };
  }

  getHistorySummary(): BackupHistorySummary {
    const entries = historyFromStorage(this.storage);
    const lastBackup = [...entries].reverse().find((entry) => entry.kind === "backup") ?? null;
    const lastRestore = [...entries].reverse().find((entry) => entry.kind === "restore") ?? null;

    return {
      entries,
      lastBackup,
      lastRestore
    };
  }
}
