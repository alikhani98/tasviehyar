import { describe, expect, it } from "vitest";
import type { DestinationAccount, Party, Payment } from "../schemas";
import {
  buildPaymentRecord,
  filterPayments,
  findProbablePaymentDraftWarnings,
  formatPaymentLifecycleLabel,
  formatPaymentMethodLabel,
  paymentDraftSchema,
  summarizePaymentAllocationProgress,
  summarizePaymentForDisplay
} from "../payments";
import { iso } from "../../test/helpers";

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

function makeAccount(overrides: Partial<DestinationAccount> = {}): DestinationAccount {
  return {
    id: "acct_1",
    ownerPartyId: "party_2",
    accountLabel: "حساب اصلی",
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    ...buildPaymentRecord(
      "pay_1",
      {
        payerPartyId: "party_1",
        recipientPartyId: "party_2",
        destinationAccountId: "acct_1",
        amount: 150_000_000,
        paymentDate: "2026-07-10",
        paymentMethod: "bank_transfer",
        verificationStatus: "reported",
        trackingReference: "trk-1",
        note: "یادداشت"
      },
      { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      "active"
    ),
    ...overrides
  };
}

describe("payment domain", () => {
  it("parses Persian digits, formats labels, and finds probable duplicate payments", () => {
    const draft = paymentDraftSchema.parse({
      payerPartyId: "party_1",
      recipientPartyId: "party_2",
      destinationAccountId: "acct_1",
      amountText: "۱۵۰٬۰۰۰٬۰۰۰",
      paymentDate: "2026-07-10",
      paymentMethod: "cash",
      verificationStatus: "reported",
      trackingReference: " پیگیری-۱۲۳ ",
      note: "  یادداشت  "
    });

    expect(draft.amount).toBe(150_000_000);
    expect(draft.trackingReference).toBe("پیگیری123");
    expect(formatPaymentMethodLabel("cash")).toBe("نقد");
    expect(formatPaymentLifecycleLabel("reversed")).toBe("برگشتی");
    expect(summarizePaymentForDisplay(makePayment(), "زارع", "احمدی", "حساب اصلی")).toContain("زارع");

    const warnings = findProbablePaymentDraftWarnings(
      [makePayment(), makePayment({ id: "pay_2" })],
      [makeParty(), makeParty({ id: "party_2", displayName: "احمدی" })],
      [makeAccount(), makeAccount({ id: "acct_2" })],
      draft,
      "pay_1"
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.matchedPaymentIds).toEqual(["pay_2"]);
  });

  it("filters payments and summarizes allocation progress", () => {
    const parties = [makeParty(), makeParty({ id: "party_2", displayName: "حسینی" })];
    const accounts = [makeAccount(), makeAccount({ id: "acct_2", ownerPartyId: "party_1", accountLabel: "حساب دوم" })];
    const invoices = [
      { id: "inv_1", customerPartyId: "party_1", invoiceDate: "2026-07-10", totalAmount: 100, lifecycleStatus: "active", createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      { id: "inv_2", customerPartyId: "party_1", invoiceDate: "2026-07-11", totalAmount: 100, lifecycleStatus: "active", createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") }
    ] as const;
    const instructions = [
      { id: "inst_1", invoiceId: "inv_1", recipientPartyId: "party_2", instructedAmount: 100, lifecycleStatus: "active", createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") }
    ] as const;
    const allocations = [{ id: "alloc_1", paymentId: "pay_1", invoiceId: "inv_1", paymentInstructionId: "inst_1", allocatedAmount: 50, createdAt: iso("2026-07-10T08:00:00.000Z") }];

    const payment = makePayment();
    expect(
      filterPayments([payment], parties, accounts, invoices, instructions, allocations, {
        query: "trk",
        lifecycleStatus: "active",
        verificationStatus: "all"
      })
    ).toHaveLength(1);
    expect(summarizePaymentAllocationProgress(payment, allocations)).toEqual({
      allocatedAmount: 50,
      remainingAmount: 149_999_950,
      isUnallocated: false,
      isOverallocated: false
    });
  });
});
