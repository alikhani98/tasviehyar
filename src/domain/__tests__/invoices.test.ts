import { describe, expect, it } from "vitest";
import type { Invoice, Party } from "../schemas";
import {
  buildInvoiceRecord,
  filterInvoices,
  findProbableInvoiceDraftWarnings,
  formatInvoiceAmount,
  invoiceDraftSchema,
  parseInvoiceAmountInput,
  summarizeInvoiceForDisplay
} from "../invoices";
import { day, iso } from "../../test/helpers";

function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: "party_1",
    displayName: "احمدی",
    aliases: [],
    searchableDescription: undefined,
    roles: ["customer"],
    phoneNumber: undefined,
    notes: undefined,
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    ...buildInvoiceRecord(
      "inv_1",
      {
        customerPartyId: "party_1",
        invoiceDate: day("2026-07-10"),
        totalAmount: 1_250_000,
        referenceNumber: "ف-۱",
        note: "یادداشت"
      },
      { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      "active"
    ),
    ...overrides
  };
}

describe("invoice domain", () => {
  it("parses Persian-digit amounts and formats them with grouping", () => {
    const draft = invoiceDraftSchema.parse({
      customerPartyId: "party_1",
      invoiceDate: day("2026-07-10"),
      totalAmountText: "۱۲۳٬۴۵۶",
      referenceNumber: "ف-۱",
      note: "یادداشت"
    });

    expect(draft.totalAmount).toBe(123456);
    expect(formatInvoiceAmount(draft.totalAmount)).toContain("۱۲۳٬۴۵۶");
    expect(summarizeInvoiceForDisplay(makeInvoice(), "احمدی")).toContain("احمدی");
  });

  it("rejects zero, negative, decimal, and unsafe invoice totals", () => {
    expect(() => parseInvoiceAmountInput("0")).toThrow("بیشتر از صفر");
    expect(() => parseInvoiceAmountInput("-1")).toThrow("فقط شامل رقم");
    expect(() => parseInvoiceAmountInput("12.5")).toThrow("عدد صحیح تومان");
    expect(() => parseInvoiceAmountInput(String(Number.MAX_SAFE_INTEGER + 1))).toThrow("محدوده امن");
  });

  it("filters invoices by customer name and reference and warns on probable duplicates", () => {
    const parties = [makeParty(), makeParty({ id: "party_2", displayName: "کرباسیان" })];
    const invoices = [
      buildInvoiceRecord(
        "inv_a",
        {
          customerPartyId: "party_1",
          invoiceDate: day("2026-07-10"),
          totalAmount: 1_250_000,
          referenceNumber: "ف-۱"
        },
        { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
        "active"
      ),
      buildInvoiceRecord(
        "inv_b",
        {
          customerPartyId: "party_1",
          invoiceDate: day("2026-07-11"),
          totalAmount: 1_500_000,
          referenceNumber: "ف-۲"
        },
        { createdAt: iso("2026-07-11T08:00:00.000Z"), updatedAt: iso("2026-07-11T08:00:00.000Z") },
        "cancelled"
      ),
      buildInvoiceRecord(
        "inv_c",
        {
          customerPartyId: "party_2",
          invoiceDate: day("2026-07-12"),
          totalAmount: 2_000_000,
          referenceNumber: "ف-۳"
        },
        { createdAt: iso("2026-07-12T08:00:00.000Z"), updatedAt: iso("2026-07-12T08:00:00.000Z") },
        "active"
      )
    ];

    expect(filterInvoices(invoices, parties, { query: "احمدی", status: "all" })).toHaveLength(2);
    expect(filterInvoices(invoices, parties, { query: "ف-۲", status: "cancelled" })).toHaveLength(1);
    expect(filterInvoices(invoices, parties, { query: "", status: "active" }).map((invoice) => invoice.id)).toEqual(["inv_c", "inv_a"]);

    const duplicateWarnings = findProbableInvoiceDraftWarnings(
      invoices,
      parties,
      {
        customerPartyId: "party_1",
        invoiceDate: day("2026-07-10"),
        totalAmount: 1_250_000,
        referenceNumber: "ف-۱",
        note: "تست"
      },
      "inv_a"
    );

    expect(duplicateWarnings).toEqual([]);

    const matchingDraftWarnings = findProbableInvoiceDraftWarnings(
      invoices,
      parties,
      {
        customerPartyId: "party_1",
        invoiceDate: day("2026-07-10"),
        totalAmount: 1_250_000,
        referenceNumber: "ف-۱",
        note: "تست"
      }
    );

    expect(matchingDraftWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate_invoice",
          matchedInvoiceSummaries: expect.arrayContaining([expect.stringContaining("ف-۱")])
        })
      ])
    );
  });
});
