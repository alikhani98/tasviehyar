import { describe, expect, it } from "vitest";
import type { DestinationAccount, Party, PaymentInstruction } from "../schemas";
import {
  buildPaymentInstructionRecord,
  filterPaymentInstructions,
  findProbablePaymentInstructionDraftWarnings,
  formatPaymentInstructionAmount,
  paymentInstructionDraftSchema,
  summarizePaymentInstructionForDisplay
} from "../payment-instructions";
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

function makeInstruction(overrides: Partial<PaymentInstruction> = {}): PaymentInstruction {
  return {
    ...buildPaymentInstructionRecord(
    "inst_1",
    {
      invoiceId: "inv_1",
      recipientPartyId: "party_2",
      destinationAccountId: "acct_1",
      instructedAmount: 100_000_000,
      note: "یادداشت"
    },
      { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      "active"
    ),
    ...overrides
  };
}

describe("payment instruction domain", () => {
  it("parses Persian-digit amounts and warns on duplicate instruction drafts", () => {
    const draft = paymentInstructionDraftSchema.parse({
      invoiceId: "inv_1",
      recipientPartyId: "party_2",
      destinationAccountId: "acct_1",
      instructedAmountText: "۱۲۳٬۴۵۶",
      note: "یادداشت"
    });

    expect(draft.instructedAmount).toBe(123456);
    expect(formatPaymentInstructionAmount(draft.instructedAmount)).toContain("۱۲۳٬۴۵۶");
    expect(summarizePaymentInstructionForDisplay(makeInstruction({ instructedAmount: 123456 }), "احمدی", "حساب اصلی")).toContain("احمدی");

    const warnings = findProbablePaymentInstructionDraftWarnings(
      [makeInstruction({ instructedAmount: 123456 }), makeInstruction({ id: "inst_2", instructedAmount: 123456 })],
      [makeParty(), makeParty({ id: "party_2", displayName: "حسینی" })],
      [makeAccount(), makeAccount({ id: "acct_2" })],
      draft,
      "inst_1"
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.matchedInstructionIds).toEqual(["inst_2"]);
  });

  it("filters instruction lists by query and status", () => {
    const parties = [makeParty(), makeParty({ id: "party_2", displayName: "حسینی" })];
    const accounts = [makeAccount(), makeAccount({ id: "acct_2", ownerPartyId: "party_1", accountLabel: "حساب دوم" })];
    const instructions = [
      makeInstruction(),
      makeInstruction({
        id: "inst_2",
        recipientPartyId: "party_1",
        destinationAccountId: "acct_2",
        instructedAmount: 150_000_000,
        lifecycleStatus: "cancelled",
        createdAt: iso("2026-07-10T09:00:00.000Z"),
        updatedAt: iso("2026-07-10T09:00:00.000Z")
      })
    ];

    expect(filterPaymentInstructions(instructions, parties, accounts, { query: "حسینی", status: "all" })).toHaveLength(1);
    expect(filterPaymentInstructions(instructions, parties, accounts, { query: "", status: "active" })).toHaveLength(1);
    expect(filterPaymentInstructions(instructions, parties, accounts, { query: "", status: "cancelled" })).toHaveLength(1);
  });
});
