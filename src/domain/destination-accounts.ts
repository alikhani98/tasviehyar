import { z } from "zod";
import type { DestinationAccount, Party } from "./schemas";
import { destinationAccountSchema } from "./schemas";

const optionalTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const optionalRawTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value;
}, z.string());

export const destinationAccountStatusValues = ["all", "active", "archived"] as const;
export type DestinationAccountStatusFilter = (typeof destinationAccountStatusValues)[number];

export interface DestinationAccountListFilter {
  query: string;
  status: DestinationAccountStatusFilter;
}

export interface DestinationAccountDraft {
  ownerPartyId: string;
  accountLabel: string;
  bankName?: string | undefined;
  cardNumber?: string | undefined;
  iban?: string | undefined;
  bankAccountNumber?: string | undefined;
}

export type DestinationAccountDuplicateWarning =
  | {
      kind: "duplicate_card_number";
      matchedValue: string;
      accountIds: string[];
      accountLabels: string[];
      partyIds: string[];
      partyNames: string[];
    }
  | {
      kind: "duplicate_iban";
      matchedValue: string;
      accountIds: string[];
      accountLabels: string[];
      partyIds: string[];
      partyNames: string[];
    }
  | {
      kind: "duplicate_bank_account_number";
      matchedValue: string;
      accountIds: string[];
      accountLabels: string[];
      partyIds: string[];
      partyNames: string[];
    };

function normalizeDigitGlyphs(value: string): string {
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
    .replace(/[٩۹]/g, "9");
}

export function normalizeDestinationAccountText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeDestinationAccountIdentifier(value: string): string {
  return normalizeDigitGlyphs(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toUpperCase();
}

export function normalizeCardNumber(value: string): string {
  return normalizeDigitGlyphs(value).replace(/[^\d]/g, "");
}

export function normalizeBankAccountNumber(value: string): string {
  return normalizeDigitGlyphs(value).replace(/[^\d]/g, "");
}

export function normalizeIban(value: string): string {
  return normalizeDigitGlyphs(value).replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
}

function isValidIranianIbanChecksum(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0n;

  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) {
      remainder = (remainder * 10n + BigInt(digit)) % 97n;
    }
  }

  return remainder === 1n;
}

export function isLikelyDestinationAccountIban(value: string): boolean {
  return /^IR\d{24}$/.test(value);
}

export function maskDestinationAccountIdentifier(value: string): string {
  if (!value) {
    return "";
  }

  if (value.startsWith("IR") && value.length >= 6) {
    return `IR${"•".repeat(Math.max(0, value.length - 6))}${value.slice(-4)}`;
  }

  if (value.length <= 4) {
    return "••••";
  }

  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export function formatDestinationAccountLabel(account: Pick<DestinationAccount, "accountLabel" | "bankName">): string {
  if (account.bankName) {
    return `${account.accountLabel} · ${account.bankName}`;
  }

  return account.accountLabel;
}

function normalizeDraftValue(draft: {
  ownerPartyId: string;
  accountLabel: string;
  bankName?: string | undefined;
  cardNumber?: string | undefined;
  iban?: string | undefined;
  bankAccountNumber?: string | undefined;
}): DestinationAccountDraft {
  return {
    ownerPartyId: draft.ownerPartyId.trim(),
    accountLabel: normalizeDestinationAccountText(draft.accountLabel),
    bankName: draft.bankName ? normalizeDestinationAccountText(draft.bankName) : undefined,
    cardNumber: draft.cardNumber ? normalizeCardNumber(draft.cardNumber) || undefined : undefined,
    iban: draft.iban ? normalizeIban(draft.iban) || undefined : undefined,
    bankAccountNumber: draft.bankAccountNumber ? normalizeBankAccountNumber(draft.bankAccountNumber) || undefined : undefined
  };
}

export const destinationAccountDraftSchema = z
  .object({
    ownerPartyId: z.string().trim().min(1, "مالک حساب باید انتخاب شود."),
    accountLabel: z.string().min(1, "عنوان حساب باید وارد شود."),
    bankName: optionalTextSchema,
    cardNumber: optionalRawTextSchema,
    iban: optionalRawTextSchema,
    bankAccountNumber: optionalRawTextSchema
  })
  .superRefine((draft, ctx) => {
    const normalized = normalizeDraftValue(draft);

    if (!normalized.cardNumber && !normalized.iban && !normalized.bankAccountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cardNumber"],
        message: "حداقل یکی از شماره کارت، شبا یا شماره حساب باید وارد شود."
      });
    }

    if (normalized.cardNumber && !/^\d{16}$/.test(normalized.cardNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cardNumber"],
        message: "شماره کارت باید دقیقا ۱۶ رقم باشد."
      });
    }

    if (normalized.iban) {
      if (!isLikelyDestinationAccountIban(normalized.iban)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iban"],
          message: "شماره شبا باید با IR آغاز شود و ۲۴ رقم داشته باشد."
        });
      } else if (!isValidIranianIbanChecksum(normalized.iban)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["iban"],
          message: "شماره شبا از نظر کنترل رقم معتبر نیست."
        });
      }
    }

    if (normalized.bankAccountNumber && !/^\d{5,24}$/.test(normalized.bankAccountNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankAccountNumber"],
        message: "شماره حساب باید فقط رقم داشته باشد و بین ۵ تا ۲۴ رقم باشد."
      });
    }
  })
  .transform((draft) => normalizeDraftValue(draft));

export function parseDestinationAccountDraftFromAccount(account: DestinationAccount): DestinationAccountDraft {
  return destinationAccountDraftSchema.parse({
    ownerPartyId: account.ownerPartyId,
    accountLabel: account.accountLabel,
    bankName: account.bankName,
    cardNumber: account.cardNumber ?? "",
    iban: account.iban ?? "",
    bankAccountNumber: account.bankAccountNumber ?? ""
  });
}

export function buildDestinationAccountRecord(
  id: string,
  draft: DestinationAccountDraft,
  timestamps: { createdAt: string; updatedAt: string },
  active: boolean
): DestinationAccount {
  return destinationAccountSchema.parse({
    id,
    ownerPartyId: draft.ownerPartyId,
    accountLabel: draft.accountLabel,
    bankName: draft.bankName,
    cardNumber: draft.cardNumber,
    iban: draft.iban,
    bankAccountNumber: draft.bankAccountNumber,
    active,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  });
}

function collectDestinationAccountWarnings(
  accounts: readonly DestinationAccount[],
  partiesById: Map<string, Party>,
  selector: (account: DestinationAccount) => string | undefined,
  kind: DestinationAccountDuplicateWarning["kind"]
): DestinationAccountDuplicateWarning[] {
  const grouped = new Map<string, DestinationAccount[]>();

  for (const account of accounts) {
    const value = selector(account);
    if (!value) {
      continue;
    }

    const existing = grouped.get(value) ?? [];
    existing.push(account);
    grouped.set(value, existing);
  }

  return Array.from(grouped.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([matchedValue, matches]) => ({
      kind,
      matchedValue,
      accountIds: Array.from(new Set(matches.map((account) => account.id))),
      accountLabels: Array.from(new Set(matches.map((account) => account.accountLabel))),
      partyIds: Array.from(new Set(matches.map((account) => account.ownerPartyId))),
      partyNames: Array.from(
        new Set(matches.map((account) => partiesById.get(account.ownerPartyId)?.displayName ?? account.ownerPartyId))
      )
    })) satisfies DestinationAccountDuplicateWarning[];
}

export function findProbableDestinationAccountDuplicateWarnings(
  accounts: readonly DestinationAccount[],
  parties: readonly Party[]
): DestinationAccountDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  return [
    ...collectDestinationAccountWarnings(accounts, partiesById, (account) => account.cardNumber, "duplicate_card_number"),
    ...collectDestinationAccountWarnings(accounts, partiesById, (account) => account.iban, "duplicate_iban"),
    ...collectDestinationAccountWarnings(
      accounts,
      partiesById,
      (account) => account.bankAccountNumber,
      "duplicate_bank_account_number"
    )
  ];
}

export function findProbableDestinationAccountDraftWarnings(
  accounts: readonly DestinationAccount[],
  parties: readonly Party[],
  draft: DestinationAccountDraft,
  excludeAccountId?: string
): DestinationAccountDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const visibleAccounts = accounts.filter((account) => account.id !== excludeAccountId);
  const warnings: DestinationAccountDuplicateWarning[] = [];

  const compare = (
    selector: (account: DestinationAccount) => string | undefined,
    value: string | undefined,
    kind: DestinationAccountDuplicateWarning["kind"]
  ) => {
    if (!value) {
      return;
    }

    const matchingAccounts = visibleAccounts.filter((account) => selector(account) === value);
    if (matchingAccounts.length === 0) {
      return;
    }

    warnings.push({
      kind,
      matchedValue: value,
      accountIds: matchingAccounts.map((account) => account.id),
      accountLabels: matchingAccounts.map((account) => account.accountLabel),
      partyIds: matchingAccounts.map((account) => account.ownerPartyId),
      partyNames: matchingAccounts.map((account) => partiesById.get(account.ownerPartyId)?.displayName ?? account.ownerPartyId)
    });
  };

  compare((account) => account.cardNumber, draft.cardNumber, "duplicate_card_number");
  compare((account) => account.iban, draft.iban, "duplicate_iban");
  compare((account) => account.bankAccountNumber, draft.bankAccountNumber, "duplicate_bank_account_number");

  return warnings;
}

export function filterDestinationAccounts(
  accounts: readonly DestinationAccount[],
  filter: DestinationAccountListFilter
): DestinationAccount[] {
  const normalizedQuery = normalizeDestinationAccountText(filter.query).toLowerCase();

  return accounts
    .filter((account) => {
      const matchesStatus =
        filter.status === "all" ||
        (filter.status === "active" && account.active) ||
        (filter.status === "archived" && !account.active);

      if (!matchesStatus) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchableValues = [
        account.accountLabel,
        account.bankName ?? "",
        account.cardNumber ?? "",
        account.iban ?? "",
        account.bankAccountNumber ?? ""
      ]
        .map((value) => normalizeDestinationAccountText(value).toLowerCase())
        .join(" ");

      return searchableValues.includes(normalizedQuery);
    })
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }

      return left.accountLabel.localeCompare(right.accountLabel, "fa");
    });
}

