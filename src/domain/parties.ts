import { z } from "zod";
import type { Party, PartyRole } from "./schemas";
import { partyRoleSchema, partyRoleValues, partySchema } from "./schemas";

const optionalTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

export const partyDraftSchema = z.object({
  displayName: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  searchableDescription: optionalTextSchema,
  roles: z.array(partyRoleSchema).min(1),
  phoneNumber: optionalTextSchema,
  notes: optionalTextSchema
});

export type PartyDraft = z.infer<typeof partyDraftSchema>;

export const partyStatusFilterValues = ["all", "active", "archived"] as const;
export type PartyStatusFilter = (typeof partyStatusFilterValues)[number];

export const partyFilterRoleValues = ["all", ...partyRoleValues] as const;
export type PartyRoleFilter = "all" | PartyRole;

export interface PartyListFilter {
  query: string;
  status: PartyStatusFilter;
  role: PartyRoleFilter;
}

export type PartyDuplicateWarning =
  | {
      kind: "duplicate_display_name";
      matchedValue: string;
      partyIds: string[];
      partyNames: string[];
    }
  | {
      kind: "duplicate_alias";
      matchedValue: string;
      partyIds: string[];
      partyNames: string[];
    }
  | {
      kind: "duplicate_phone_number";
      matchedValue: string;
      partyIds: string[];
      partyNames: string[];
    };

export const partyRoleLabels: Record<PartyRole, string> = {
  customer: "مشتری",
  farmer: "کشاورز",
  broker: "واسطه",
  destination_account_owner: "صاحب حساب مقصد",
  internal_business_party: "طرف داخلی کسب‌وکار"
};

const canonicalText = new Intl.Collator("fa", { sensitivity: "base" });

export function normalizePartyText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizePhoneNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[٠۰]/g, "0")
    .replace(/[١۱]/g, "1")
    .replace(/[٢۲]/g, "2")
    .replace(/[٣۳]/g, "3")
    .replace(/[٤۴]/g, "4")
    .replace(/[٥۵]/g, "5")
    .replace(/[٦۶]/g, "6")
    .replace(/[٧۷]/g, "7")
    .replace(/[٨۸]/g, "8")
    .replace(/[٩۹]/g, "9")
    .replace(/[^\d+]/g, "");
}

function groupPartiesByValue(parties: readonly Party[], selector: (party: Party) => readonly string[], kind: PartyDuplicateWarning["kind"]) {
  const grouped = new Map<string, Party[]>();

  for (const party of parties) {
    for (const value of selector(party)) {
      const normalized = normalizePartyText(value);
      if (!normalized) {
        continue;
      }

      const existing = grouped.get(normalized) ?? [];
      existing.push(party);
      grouped.set(normalized, existing);
    }
  }

  return Array.from(grouped.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([matchedValue, matches]) => ({
      kind,
      matchedValue,
      partyIds: Array.from(new Set(matches.map((party) => party.id))),
      partyNames: Array.from(new Set(matches.map((party) => party.displayName)))
    })) satisfies PartyDuplicateWarning[];
}

export function findProbablePartyDuplicateWarnings(parties: readonly Party[]): PartyDuplicateWarning[] {
  return [
    ...groupPartiesByValue(parties, (party) => [party.displayName], "duplicate_display_name"),
    ...groupPartiesByValue(parties, (party) => party.aliases, "duplicate_alias"),
    ...groupPartiesByValue(parties, (party) => (party.phoneNumber ? [party.phoneNumber] : []), "duplicate_phone_number")
  ];
}

export function findProbablePartyDraftWarnings(
  parties: readonly Party[],
  draft: PartyDraft,
  excludePartyId?: string
): PartyDuplicateWarning[] {
  const visibleParties = parties.filter((party) => party.id !== excludePartyId);
  const warnings: PartyDuplicateWarning[] = [];
  const draftDisplayName = normalizePartyText(draft.displayName);
  const draftAliases = draft.aliases.map(normalizePartyText).filter(Boolean);
  const draftPhone = draft.phoneNumber ? normalizePhoneNumber(draft.phoneNumber) : "";

  if (draftDisplayName) {
    const matchingParties = visibleParties.filter((party) => {
      if (normalizePartyText(party.displayName) === draftDisplayName) {
        return true;
      }

      return party.aliases.some((alias) => normalizePartyText(alias) === draftDisplayName);
    });

    if (matchingParties.length > 0) {
      warnings.push({
        kind: "duplicate_display_name",
        matchedValue: draft.displayName,
        partyIds: matchingParties.map((party) => party.id),
        partyNames: matchingParties.map((party) => party.displayName)
      });
    }
  }

  for (const alias of draftAliases) {
    const matchingParties = visibleParties.filter((party) => {
      if (normalizePartyText(party.displayName) === alias) {
        return true;
      }

      return party.aliases.some((existingAlias) => normalizePartyText(existingAlias) === alias);
    });

    if (matchingParties.length > 0) {
      warnings.push({
        kind: "duplicate_alias",
        matchedValue: alias,
        partyIds: matchingParties.map((party) => party.id),
        partyNames: matchingParties.map((party) => party.displayName)
      });
    }
  }

  if (draftPhone) {
    const matchingParties = visibleParties.filter((party) => normalizePhoneNumber(party.phoneNumber ?? "") === draftPhone);
    if (matchingParties.length > 0) {
      warnings.push({
        kind: "duplicate_phone_number",
        matchedValue: draftPhone,
        partyIds: matchingParties.map((party) => party.id),
        partyNames: matchingParties.map((party) => party.displayName)
      });
    }
  }

  return warnings;
}

export function filterParties(parties: readonly Party[], filter: PartyListFilter): Party[] {
  const query = normalizePartyText(filter.query);

  return parties
    .filter((party) => {
      const matchesStatus =
        filter.status === "all" ||
        (filter.status === "active" && party.active) ||
        (filter.status === "archived" && !party.active);

      const matchesRole = filter.role === "all" || party.roles.includes(filter.role);

      if (!matchesStatus || !matchesRole) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableValues = [
        party.displayName,
        party.searchableDescription ?? "",
        party.phoneNumber ?? "",
        party.notes ?? "",
        ...party.aliases,
        ...party.roles.map((role) => partyRoleLabels[role])
      ].map(normalizePartyText);

      return searchableValues.some((value) => value.includes(query));
    })
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      return canonicalText.compare(left.displayName, right.displayName);
    });
}

export function isPartyActive(party: Party): boolean {
  return party.active;
}

export function parsePartyDraftFromParty(party: Party): PartyDraft {
  return partyDraftSchema.parse({
    displayName: party.displayName,
    aliases: party.aliases,
    searchableDescription: party.searchableDescription,
    roles: party.roles,
    phoneNumber: party.phoneNumber,
    notes: party.notes
  });
}

export function buildPartyRecord(
  id: string,
  draft: PartyDraft,
  timestamps: { createdAt: string; updatedAt: string },
  active: boolean
): Party {
  return partySchema.parse({
    id,
    displayName: draft.displayName,
    aliases: draft.aliases,
    searchableDescription: draft.searchableDescription,
    roles: draft.roles,
    phoneNumber: draft.phoneNumber,
    notes: draft.notes,
    active,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  });
}
