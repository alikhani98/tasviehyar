import { describe, expect, it } from "vitest";
import type { Party } from "../schemas";
import {
  buildDestinationAccountRecord,
  destinationAccountDraftSchema,
  findProbableDestinationAccountDraftWarnings,
  maskDestinationAccountIdentifier,
  normalizeBankAccountNumber,
  normalizeCardNumber,
  normalizeIban
} from "../destination-accounts";
import { iso } from "../../test/helpers";

function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: "party_1",
    displayName: "احمدی",
    aliases: [],
    roles: ["customer"],
    active: true,
    createdAt: iso("2026-07-10T08:00:00.000Z"),
    updatedAt: iso("2026-07-10T08:00:00.000Z"),
    ...overrides
  };
}

describe("destination account domain", () => {
  it("normalizes Persian, Arabic, and Latin digits while stripping separators", () => {
    const draft = destinationAccountDraftSchema.parse({
      ownerPartyId: "party_1",
      accountLabel: "  حساب اصلی  ",
      bankName: "  بانک نمونه  ",
      cardNumber: "۱۲۳۴-۵۶۷۸ ۹۰۱۲/۳۴۵۶",
      iban: "",
      bankAccountNumber: "۰۱۲۳۴ ۵۶۷۸"
    });

    expect(draft.accountLabel).toBe("حساب اصلی");
    expect(draft.bankName).toBe("بانک نمونه");
    expect(draft.cardNumber).toBe("1234567890123456");
    expect(draft.bankAccountNumber).toBe("012345678");
  });

  it("rejects drafts without a usable identifier and invalid IBAN checksums", () => {
    expect(() =>
      destinationAccountDraftSchema.parse({
        ownerPartyId: "party_1",
        accountLabel: "حساب اصلی"
      })
    ).toThrow("حداقل یکی از شماره کارت، شبا یا شماره حساب باید وارد شود.");

    expect(() =>
      destinationAccountDraftSchema.parse({
        ownerPartyId: "party_1",
        accountLabel: "حساب اصلی",
        iban: "IR000000000000000000000000"
      })
    ).toThrow("کنترل رقم");
  });

  it("flags duplicate identifiers against existing accounts", () => {
    const parties = [makeParty({ id: "party_1", displayName: "احمدی" }), makeParty({ id: "party_2", displayName: "کرباسیان" })];
    const accountA = buildDestinationAccountRecord(
      "account_1",
      {
        ownerPartyId: "party_1",
        accountLabel: "حساب اصلی",
        cardNumber: "1234567890123456"
      },
      { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      true
    );
    const accountB = buildDestinationAccountRecord(
      "account_2",
      {
        ownerPartyId: "party_2",
        accountLabel: "کارت کشاورزی",
        cardNumber: "1234567890123456"
      },
      { createdAt: iso("2026-07-10T08:00:00.000Z"), updatedAt: iso("2026-07-10T08:00:00.000Z") },
      true
    );

    const warnings = findProbableDestinationAccountDraftWarnings(
      [accountA, accountB],
      parties,
      {
        ownerPartyId: "party_1",
        accountLabel: "حساب فرعی",
        cardNumber: normalizeCardNumber("۱۲۳۴-۵۶۷۸-۹۰۱۲-۳۴۵۶"),
        iban: undefined,
        bankAccountNumber: normalizeBankAccountNumber("۰۱۲۳۴۵۶۷")
      },
      "account_1"
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "duplicate_card_number",
          matchedValue: "1234567890123456"
        })
      ])
    );
    expect(maskDestinationAccountIdentifier(normalizeIban("IR820540102680020817909002"))).toContain("IR");
  });
});
