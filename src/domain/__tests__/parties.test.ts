import { describe, expect, it } from "vitest";
import type { Party } from "../schemas";
import {
  filterParties,
  findProbablePartyDraftWarnings,
  findProbablePartyDuplicateWarnings,
  normalizePartyText,
  normalizePhoneNumber
} from "../parties";

function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: "party_1",
    displayName: "احمدی",
    aliases: ["آقای احمدی"],
    searchableDescription: "کشاورز",
    roles: ["customer"],
    phoneNumber: "09120000000",
    notes: "یادداشت",
    active: true,
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
    ...overrides
  };
}

describe("party helpers", () => {
  it("normalizes Persian text and phone numbers for duplicate detection", () => {
    expect(normalizePartyText("  كرباسیان  ")).toBe("کرباسیان");
    expect(normalizePhoneNumber("۰۹۱۲-۳۴۵-۶۷۸۹")).toBe("09123456789");
  });

  it("finds probable duplicate warnings by name, alias, and phone number", () => {
    const warnings = findProbablePartyDuplicateWarnings([
      makeParty({ id: "party_a", displayName: "احمدی", aliases: ["علی احمدی"], phoneNumber: "09120000000" }),
      makeParty({ id: "party_b", displayName: "احمدی", aliases: ["رضا"], phoneNumber: "09123330000" }),
      makeParty({ id: "party_c", displayName: "کاشانی", aliases: ["علی احمدی"], phoneNumber: "09124440000" }),
      makeParty({ id: "party_d", displayName: "صادقی", aliases: ["صادقی"], phoneNumber: "09120000000" })
    ]);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "duplicate_display_name" }),
        expect.objectContaining({ kind: "duplicate_alias" }),
        expect.objectContaining({ kind: "duplicate_phone_number" })
      ])
    );
  });

  it("warns when a draft overlaps with existing parties", () => {
    const warnings = findProbablePartyDraftWarnings(
      [
        makeParty({ id: "party_a", displayName: "احمدی", aliases: ["آقای احمدی"], phoneNumber: "09120000000" }),
        makeParty({ id: "party_b", displayName: "کاشانی", aliases: ["کاشی"], phoneNumber: "09123330000" })
      ],
      {
        displayName: "احمدی",
        aliases: ["کاشی"],
        searchableDescription: "مشتری",
        roles: ["customer"],
        phoneNumber: "0912 000 0000",
        notes: "تست"
      }
    );

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "duplicate_display_name" }),
        expect.objectContaining({ kind: "duplicate_alias" }),
        expect.objectContaining({ kind: "duplicate_phone_number" })
      ])
    );
  });

  it("filters parties by query, role, and status", () => {
    const parties = [
      makeParty({ id: "party_a", displayName: "احمدی", roles: ["customer"], active: true }),
      makeParty({ id: "party_b", displayName: "کرباسیان", roles: ["farmer"], active: false }),
      makeParty({ id: "party_c", displayName: "شریفی", roles: ["broker"], aliases: ["واسطه شریفی"], active: true })
    ];

    expect(filterParties(parties, { query: "واسطه", role: "all", status: "all" })).toHaveLength(1);
    expect(filterParties(parties, { query: "", role: "farmer", status: "archived" })).toHaveLength(1);
    expect(filterParties(parties, { query: "", role: "customer", status: "archived" })).toHaveLength(0);
  });
});
