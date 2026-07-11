import ExcelJS from "exceljs";
import packageJson from "../../package.json";

export interface ReportMetadata {
  generatedAt: string;
  applicationVersion?: string;
  filterSummary: string;
}

export interface CustomerSummaryReportRow {
  partyId: string;
  customerName: string;
  totalInvoiced: number;
  confirmedAllocated: number;
  reportedUnconfirmed: number;
  confirmedOutstanding: number;
  provisionalOutstanding: number;
  openInvoiceCount: number;
  cancelledInvoiceCount: number;
  invoiceCount: number;
  settlementState: string;
}

export interface RecipientSummaryReportRow {
  partyId: string;
  recipientName: string;
  totalInstructed: number;
  confirmedReceived: number;
  reportedUnconfirmed: number;
  confirmedRemaining: number;
  provisionalRemaining: number;
  overpaymentAmount: number;
  activeInstructionCount: number;
  instructionCount: number;
  settlementState: string;
}

export interface InvoiceReportRow {
  invoiceId: string;
  invoiceReference: string;
  customerName: string;
  invoiceDate: string;
  totalAmount: number;
  confirmedPayment: number;
  reportedPayment: number;
  confirmedOutstanding: number;
  provisionalOutstanding: number;
  activeInstructedAmount: number;
  unassignedAmount: number;
  settlementState: string;
  lifecycleState: string;
}

export interface PaymentInstructionReportRow {
  instructionId: string;
  invoiceId: string;
  invoiceReference: string;
  customerName: string;
  recipientName: string;
  destinationAccountLabel: string;
  instructedAmount: number;
  confirmedReceived: number;
  reportedUnconfirmed: number;
  confirmedRemaining: number;
  provisionalRemaining: number;
  overpaymentAmount: number;
  lifecycleState: string;
}

export interface PaymentReportRow {
  paymentId: string;
  paymentDate: string;
  payerName: string;
  recipientName: string;
  amount: number;
  method: string;
  verificationState: string;
  lifecycleState: string;
  trackingReference: string;
  allocatedAmount: number;
  unallocatedAmount: number;
  invoiceReferences: string;
  instructionReferences: string;
}

export interface ReconciliationReportRow {
  issueId: string;
  severity: string;
  mismatchType: string;
  explanation: string;
  person: string;
  reference: string;
  relevantDate: string;
}

export interface PartyStatementInvoiceRow {
  invoiceReference: string;
  invoiceDate: string;
  totalAmount: number;
  confirmedAllocated: number;
  reportedUnconfirmed: number;
  confirmedOutstanding: number;
  provisionalOutstanding: number;
  activeInstructedAmount: number;
  unassignedAmount: number;
  settlementState: string;
  lifecycleState: string;
}

export interface PartyStatementPaymentRow {
  paymentDate: string;
  amount: number;
  verificationState: string;
  lifecycleState: string;
  trackingReference: string;
  allocatedAmount: number;
  unallocatedAmount: number;
  invoiceReferences: string;
  instructionReferences: string;
}

export interface PartyStatementInstructionRow {
  invoiceId: string;
  invoiceReference: string;
  recipientName: string;
  destinationAccountLabel: string;
  instructedAmount: number;
  confirmedReceived: number;
  reportedUnconfirmed: number;
  confirmedRemaining: number;
  provisionalRemaining: number;
  overpaymentAmount: number;
  lifecycleState: string;
}

export interface PartyStatementSection {
  title: string;
  summary: string;
  invoiceRows?: PartyStatementInvoiceRow[] | undefined;
  paymentRows?: PartyStatementPaymentRow[] | undefined;
  instructionRows?: PartyStatementInstructionRow[] | undefined;
}

export interface PartyStatementReport {
  partyId: string;
  partyName: string;
  roles: string[];
  customerSection?: PartyStatementSection | undefined;
  recipientSection?: PartyStatementSection | undefined;
}

export interface OperationalReportWorkbookData {
  metadata: ReportMetadata;
  customerSummaries: CustomerSummaryReportRow[];
  recipientSummaries: RecipientSummaryReportRow[];
  invoices: InvoiceReportRow[];
  paymentInstructions: PaymentInstructionReportRow[];
  payments: PaymentReportRow[];
  reconciliationItems: ReconciliationReportRow[];
  partyStatement?: PartyStatementReport | undefined;
}

type TableColumn = {
  header: string;
  key: string;
  width?: number;
};

function escapeCsvCell(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function formatCsvValue(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return String(value);
}

function buildCsv<T extends object>(rows: readonly T[], columns: readonly TableColumn[]): string {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const lines = rows.map((row) => {
    const entry = row as Record<string, unknown>;
    return columns.map((column) => escapeCsvCell(formatCsvValue(entry[column.key]))).join(",");
  });
  return [header, ...lines].join("\n");
}

function applyWorksheetStyling(worksheet: ExcelJS.Worksheet, columns: readonly TableColumn[]): void {
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? Math.max(16, column.header.length + 2)
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  };
  worksheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
    if (rowNumber === 1) {
      row.font = { bold: true };
    }
  });
}

function addTableSheet<T extends object>(workbook: ExcelJS.Workbook, title: string, columns: readonly TableColumn[], rows: readonly T[]): void {
  const worksheet = workbook.addWorksheet(title);
  applyWorksheetStyling(worksheet, columns);
  worksheet.addRows([...rows]);
  worksheet.getRow(1).font = { bold: true };
}

function addMetadataSheet(workbook: ExcelJS.Workbook, metadata: ReportMetadata): void {
  const worksheet = workbook.addWorksheet("اطلاعات گزارش");
  worksheet.columns = [
    { header: "کلید", key: "label", width: 24 },
    { header: "مقدار", key: "value", width: 60 }
  ];
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.addRows([
    { label: "زمان ایجاد", value: metadata.generatedAt },
    { label: "نسخه برنامه", value: metadata.applicationVersion ?? packageJson.version },
    { label: "خلاصه فیلترها", value: metadata.filterSummary }
  ]);
  worksheet.getRow(1).font = { bold: true };
}

function addPartyStatementSheet(workbook: ExcelJS.Workbook, report: PartyStatementReport): void {
  const worksheet = workbook.addWorksheet("گردش یک شخص");
  worksheet.columns = [
    { header: "بخش", key: "section", width: 18 },
    { header: "شرح", key: "label", width: 24 },
    { header: "مقدار", key: "value", width: 34 }
  ];
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.addRows([
    { section: "اطلاعات", label: "شخص", value: report.partyName },
    { section: "اطلاعات", label: "نقش‌ها", value: report.roles.join("، ") },
    ...(report.customerSection
      ? [
          { section: "خلاصه حساب", label: report.customerSection.title, value: report.customerSection.summary },
          { section: "خلاصه حساب", label: "تعداد فاکتور", value: String(report.customerSection.invoiceRows?.length ?? 0) }
        ]
      : []),
    ...(report.recipientSection
      ? [
          { section: "خلاصه حساب", label: report.recipientSection.title, value: report.recipientSection.summary },
          { section: "خلاصه حساب", label: "تعداد دریافتی/دستور", value: String((report.recipientSection.paymentRows?.length ?? 0) + (report.recipientSection.instructionRows?.length ?? 0)) }
        ]
      : [])
  ]);
  worksheet.getRow(1).font = { bold: true };
}

function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TasviehYar";
  workbook.company = "TasviehYar";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;
  return workbook;
}

export function createReportFileName(generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  return `tasviehyar-report-${date}.xlsx`;
}

export function createPartyStatementFileName(partyName: string, generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  const slug = partyName
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safeSlug = slug || "party";
  return `tasviehyar-party-${safeSlug}-${date}.xlsx`;
}

export function serializeRowsToCsv<T extends object>(rows: readonly T[], columns: readonly TableColumn[]): string {
  return buildCsv(rows, columns);
}

export async function buildOperationalReportWorkbook(data: OperationalReportWorkbookData): Promise<ExcelJS.Workbook> {
  const workbook = createWorkbook();
  addMetadataSheet(workbook, data.metadata);

  if (data.customerSummaries.length > 0) {
    addTableSheet(workbook, "خلاصه مشتریان", customerSummaryColumns, data.customerSummaries);
  }

  if (data.recipientSummaries.length > 0) {
    addTableSheet(workbook, "خلاصه گیرندگان", recipientSummaryColumns, data.recipientSummaries);
  }

  if (data.invoices.length > 0) {
    addTableSheet(workbook, "فاکتورها", invoiceColumns, data.invoices);
  }

  if (data.paymentInstructions.length > 0) {
    addTableSheet(workbook, "دستورهای پرداخت", paymentInstructionColumns, data.paymentInstructions);
  }

  if (data.payments.length > 0) {
    addTableSheet(workbook, "پرداخت‌ها", paymentColumns, data.payments);
  }

  if (data.reconciliationItems.length > 0) {
    addTableSheet(workbook, "مغایرت‌ها", reconciliationColumns, data.reconciliationItems);
  }

  if (data.partyStatement) {
    addPartyStatementSheet(workbook, data.partyStatement);

    if (data.partyStatement.customerSection?.invoiceRows?.length) {
      addTableSheet(workbook, "فاکتورهای شخص", partyStatementInvoiceColumns, data.partyStatement.customerSection.invoiceRows);
    }

    if (data.partyStatement.customerSection?.paymentRows?.length) {
      addTableSheet(workbook, "پرداخت‌های شخص", partyStatementPaymentColumns, data.partyStatement.customerSection.paymentRows);
    }

    if (data.partyStatement.recipientSection?.instructionRows?.length) {
      addTableSheet(workbook, "دریافتی‌های شخص", partyStatementInstructionColumns, data.partyStatement.recipientSection.instructionRows);
    }
  }

  return workbook;
}

export const customerSummaryColumns: TableColumn[] = [
  { header: "مشتری", key: "customerName", width: 24 },
  { header: "شناسه شخص", key: "partyId", width: 28 },
  { header: "کل فاکتور", key: "totalInvoiced", width: 16 },
  { header: "تخصیص قطعی", key: "confirmedAllocated", width: 16 },
  { header: "پرداخت اعلام‌شده", key: "reportedUnconfirmed", width: 18 },
  { header: "مانده قطعی", key: "confirmedOutstanding", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalOutstanding", width: 18 },
  { header: "فاکتور باز", key: "openInvoiceCount", width: 12 },
  { header: "فاکتور لغوشده", key: "cancelledInvoiceCount", width: 14 },
  { header: "تعداد فاکتور", key: "invoiceCount", width: 12 },
  { header: "وضعیت", key: "settlementState", width: 18 }
];

export const recipientSummaryColumns: TableColumn[] = [
  { header: "گیرنده", key: "recipientName", width: 24 },
  { header: "شناسه شخص", key: "partyId", width: 28 },
  { header: "کل دستور", key: "totalInstructed", width: 16 },
  { header: "دریافت قطعی", key: "confirmedReceived", width: 16 },
  { header: "دریافت اعلام‌شده", key: "reportedUnconfirmed", width: 18 },
  { header: "مانده قطعی", key: "confirmedRemaining", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalRemaining", width: 18 },
  { header: "بیش‌پرداخت", key: "overpaymentAmount", width: 16 },
  { header: "تعداد دستور فعال", key: "activeInstructionCount", width: 16 },
  { header: "تعداد دستور", key: "instructionCount", width: 12 },
  { header: "وضعیت", key: "settlementState", width: 18 }
];

export const invoiceColumns: TableColumn[] = [
  { header: "فاکتور", key: "invoiceReference", width: 24 },
  { header: "شناسه فاکتور", key: "invoiceId", width: 28 },
  { header: "مشتری", key: "customerName", width: 24 },
  { header: "تاریخ فاکتور", key: "invoiceDate", width: 14 },
  { header: "مبلغ کل", key: "totalAmount", width: 16 },
  { header: "تخصیص قطعی", key: "confirmedPayment", width: 16 },
  { header: "پرداخت اعلام‌شده", key: "reportedPayment", width: 18 },
  { header: "مانده قطعی", key: "confirmedOutstanding", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalOutstanding", width: 18 },
  { header: "مبلغ دستور فعال", key: "activeInstructedAmount", width: 16 },
  { header: "مبلغ بدون تخصیص", key: "unassignedAmount", width: 16 },
  { header: "وضعیت تسویه", key: "settlementState", width: 16 },
  { header: "وضعیت فاکتور", key: "lifecycleState", width: 14 }
];

export const paymentInstructionColumns: TableColumn[] = [
  { header: "دستور", key: "instructionId", width: 28 },
  { header: "فاکتور", key: "invoiceReference", width: 24 },
  { header: "مشتری", key: "customerName", width: 24 },
  { header: "گیرنده", key: "recipientName", width: 24 },
  { header: "حساب مقصد", key: "destinationAccountLabel", width: 24 },
  { header: "مبلغ دستور", key: "instructedAmount", width: 16 },
  { header: "دریافت قطعی", key: "confirmedReceived", width: 16 },
  { header: "دریافت اعلام‌شده", key: "reportedUnconfirmed", width: 18 },
  { header: "مانده قطعی", key: "confirmedRemaining", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalRemaining", width: 18 },
  { header: "بیش‌پرداخت", key: "overpaymentAmount", width: 16 },
  { header: "وضعیت", key: "lifecycleState", width: 14 }
];

export const paymentColumns: TableColumn[] = [
  { header: "پرداخت", key: "paymentId", width: 28 },
  { header: "تاریخ پرداخت", key: "paymentDate", width: 14 },
  { header: "پرداخت‌کننده", key: "payerName", width: 24 },
  { header: "گیرنده", key: "recipientName", width: 24 },
  { header: "مبلغ", key: "amount", width: 16 },
  { header: "روش", key: "method", width: 16 },
  { header: "وضعیت تأیید", key: "verificationState", width: 16 },
  { header: "وضعیت", key: "lifecycleState", width: 14 },
  { header: "شماره پیگیری", key: "trackingReference", width: 18 },
  { header: "تخصیص‌شده", key: "allocatedAmount", width: 16 },
  { header: "بدون تخصیص", key: "unallocatedAmount", width: 16 },
  { header: "فاکتورهای مرتبط", key: "invoiceReferences", width: 30 },
  { header: "دستورهای مرتبط", key: "instructionReferences", width: 30 }
];

export const reconciliationColumns: TableColumn[] = [
  { header: "مورد", key: "issueId", width: 32 },
  { header: "شدت", key: "severity", width: 12 },
  { header: "نوع", key: "mismatchType", width: 28 },
  { header: "توضیح", key: "explanation", width: 44 },
  { header: "شخص", key: "person", width: 24 },
  { header: "مرجع", key: "reference", width: 24 },
  { header: "تاریخ", key: "relevantDate", width: 14 }
];

export const partyStatementInvoiceColumns: TableColumn[] = [
  { header: "فاکتور", key: "invoiceReference", width: 24 },
  { header: "تاریخ", key: "invoiceDate", width: 14 },
  { header: "مبلغ کل", key: "totalAmount", width: 16 },
  { header: "تخصیص قطعی", key: "confirmedAllocated", width: 16 },
  { header: "اعلام‌شده", key: "reportedUnconfirmed", width: 16 },
  { header: "مانده قطعی", key: "confirmedOutstanding", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalOutstanding", width: 18 },
  { header: "دستور فعال", key: "activeInstructedAmount", width: 16 },
  { header: "بدون تخصیص", key: "unassignedAmount", width: 16 },
  { header: "وضعیت تسویه", key: "settlementState", width: 16 },
  { header: "وضعیت", key: "lifecycleState", width: 14 }
];

export const partyStatementPaymentColumns: TableColumn[] = [
  { header: "تاریخ پرداخت", key: "paymentDate", width: 14 },
  { header: "مبلغ", key: "amount", width: 16 },
  { header: "وضعیت تأیید", key: "verificationState", width: 16 },
  { header: "وضعیت", key: "lifecycleState", width: 14 },
  { header: "شماره پیگیری", key: "trackingReference", width: 18 },
  { header: "تخصیص‌شده", key: "allocatedAmount", width: 16 },
  { header: "بدون تخصیص", key: "unallocatedAmount", width: 16 },
  { header: "فاکتورهای مرتبط", key: "invoiceReferences", width: 30 },
  { header: "دستورهای مرتبط", key: "instructionReferences", width: 30 }
];

export const partyStatementInstructionColumns: TableColumn[] = [
  { header: "فاکتور", key: "invoiceReference", width: 24 },
  { header: "گیرنده", key: "recipientName", width: 24 },
  { header: "حساب مقصد", key: "destinationAccountLabel", width: 24 },
  { header: "مبلغ دستور", key: "instructedAmount", width: 16 },
  { header: "دریافت قطعی", key: "confirmedReceived", width: 16 },
  { header: "دریافت اعلام‌شده", key: "reportedUnconfirmed", width: 18 },
  { header: "مانده قطعی", key: "confirmedRemaining", width: 16 },
  { header: "مانده پیش‌بینی", key: "provisionalRemaining", width: 18 },
  { header: "بیش‌پرداخت", key: "overpaymentAmount", width: 16 },
  { header: "وضعیت", key: "lifecycleState", width: 14 }
];
