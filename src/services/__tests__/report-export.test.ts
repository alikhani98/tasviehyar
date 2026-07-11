import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildOperationalReportWorkbook,
  createPartyStatementFileName,
  createReportFileName,
  customerSummaryColumns,
  partyStatementInvoiceColumns,
  serializeRowsToCsv
} from "../report-export";

describe("report export helpers", () => {
  it("formats report file names and CSV values safely", () => {
    expect(createReportFileName("2026-07-11T08:30:00.000Z")).toBe("tasviehyar-report-2026-07-11.xlsx");
    expect(createPartyStatementFileName("احمدی / صادرات", "2026-07-11T08:30:00.000Z")).toBe("tasviehyar-party-احمدی-صادرات-2026-07-11.xlsx");

    const csv = serializeRowsToCsv(
      [{ customerName: 'شیر,خام', totalInvoiced: 125000 }],
      customerSummaryColumns.filter((column) => column.key === "customerName" || column.key === "totalInvoiced")
    );

    expect(csv).toContain('"شیر,خام"');
    expect(csv).toContain("125000");
  });

  it("builds a workbook with the operational sheets and party statement sheets", async () => {
    const workbook = await buildOperationalReportWorkbook({
      metadata: {
        generatedAt: "2026-07-11T08:30:00.000Z",
        applicationVersion: "0.0.0",
        filterSummary: "همه"
      },
      customerSummaries: [
        {
          partyId: "party-1",
          customerName: "احمدی",
          totalInvoiced: 125000,
          confirmedAllocated: 75000,
          reportedUnconfirmed: 0,
          confirmedOutstanding: 50000,
          provisionalOutstanding: 50000,
          openInvoiceCount: 1,
          cancelledInvoiceCount: 0,
          invoiceCount: 1,
          settlementState: "partially_paid"
        }
      ],
      recipientSummaries: [],
      invoices: [],
      paymentInstructions: [],
      payments: [],
      reconciliationItems: [],
      partyStatement: {
        partyId: "party-1",
        partyName: "احمدی",
        roles: ["customer"],
        customerSection: {
          title: "خلاصه حساب مشتری",
          summary: "نمونه",
          invoiceRows: [
            {
              invoiceReference: "INV-1",
              invoiceDate: "2026-07-01",
              totalAmount: 125000,
              confirmedAllocated: 75000,
              reportedUnconfirmed: 0,
              confirmedOutstanding: 50000,
              provisionalOutstanding: 50000,
              activeInstructedAmount: 0,
              unassignedAmount: 50000,
              settlementState: "partially_paid",
              lifecycleState: "active"
            }
          ],
          paymentRows: []
        }
      }
    });

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining(["اطلاعات گزارش", "خلاصه مشتریان", "گردش یک شخص", "فاکتورهای شخص"])
    );
    const customerSheet = workbook.getWorksheet("خلاصه مشتریان");
    const statementSheet = workbook.getWorksheet("گردش یک شخص");
    const invoiceSheet = workbook.getWorksheet("فاکتورهای شخص");

    expect(customerSheet).toBeDefined();
    expect(statementSheet).toBeDefined();
    expect(invoiceSheet).toBeDefined();
    expect(customerSheet?.getRow(1).getCell(1).value).toBe("مشتری");
    expect(statementSheet?.getRow(2).getCell(2).value).toBe("شخص");
    expect(invoiceSheet?.getRow(1).getCell(1).value).toBe(partyStatementInvoiceColumns[0]!.header);

    const buffer = await workbook.xlsx.writeBuffer();
    const parsedWorkbook = new ExcelJS.Workbook();
    await parsedWorkbook.xlsx.load(buffer as ArrayBuffer);

    expect(parsedWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining(["اطلاعات گزارش", "خلاصه مشتریان", "گردش یک شخص", "فاکتورهای شخص"])
    );
    expect(parsedWorkbook.getWorksheet("خلاصه مشتریان")?.getRow(2).getCell(6).value).toBe(50000);
  });
});
