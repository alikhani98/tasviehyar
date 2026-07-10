import { z } from "zod";
import type { PaymentInstruction, Party, DestinationAccount } from "./schemas";
import { paymentInstructionSchema } from "./schemas";
import { formatInvoiceAmount, parseInvoiceAmountInput } from "./invoices";

const optionalTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const rawTextSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value;
}, z.string());

export const paymentInstructionStatusFilterValues = ["all", "active", "cancelled"] as const;
export type PaymentInstructionStatusFilter = (typeof paymentInstructionStatusFilterValues)[number];

export interface PaymentInstructionListFilter {
  query: string;
  status: PaymentInstructionStatusFilter;
}

export interface PaymentInstructionDraft {
  invoiceId: string;
  recipientPartyId: string;
  destinationAccountId?: string | undefined;
  instructedAmount: number;
  note?: string | undefined;
}

export type PaymentInstructionDuplicateWarning = {
  kind: "duplicate_instruction";
  matchedInstructionIds: string[];
  matchedInstructionSummaries: string[];
  invoiceId: string;
  recipientPartyId: string;
  destinationAccountId: string | undefined;
  instructedAmount: number;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[يی]/g, "ی")
    .replace(/[كک]/g, "ک")
    .replace(/\p{Mark}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function formatPaymentInstructionAmount(amount: number): string {
  return formatInvoiceAmount(amount);
}

export function formatPaymentInstructionStatus(status: PaymentInstruction["lifecycleStatus"]): string {
  return status === "cancelled" ? "لغوشده" : "فعال";
}

export function formatPaymentInstructionRecipientLabel(
  recipient: Pick<Party, "displayName" | "active">,
  accounts?: readonly DestinationAccount[]
): string {
  const archivedSuffix = recipient.active ? "" : " (بایگانی)";
  const accountSuffix = accounts?.length ? ` · ${accounts[0]?.accountLabel ?? ""}` : "";
  return `${recipient.displayName}${archivedSuffix}${accountSuffix}`;
}

function normalizeDraftValue(draft: {
  invoiceId: string;
  recipientPartyId: string;
  destinationAccountId?: string | undefined;
  instructedAmountText: string;
  note?: string | undefined;
}): PaymentInstructionDraft {
  return {
    invoiceId: draft.invoiceId.trim(),
    recipientPartyId: draft.recipientPartyId.trim(),
    destinationAccountId: draft.destinationAccountId ? draft.destinationAccountId.trim() : undefined,
    instructedAmount: parseInvoiceAmountInput(draft.instructedAmountText),
    note: draft.note ? draft.note.trim() : undefined
  };
}

export const paymentInstructionDraftSchema = z
  .object({
    invoiceId: z.string().trim().min(1, "فاکتور باید مشخص شود."),
    recipientPartyId: z.string().trim().min(1, "گیرنده باید انتخاب شود."),
    destinationAccountId: optionalTextSchema,
    instructedAmountText: rawTextSchema,
    note: optionalTextSchema
  })
  .superRefine((draft, ctx) => {
    try {
      const parsedAmount = parseInvoiceAmountInput(draft.instructedAmountText);
      if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
        throw new Error("مبلغ دستور پرداخت باید بیشتر از صفر تومان باشد.");
      }
    } catch (caught) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instructedAmountText"],
        message: caught instanceof Error ? caught.message : "مبلغ دستور پرداخت معتبر نیست."
      });
    }
  })
  .transform((draft) => normalizeDraftValue(draft));

export function parsePaymentInstructionDraftFromInstruction(instruction: PaymentInstruction): PaymentInstructionDraft {
  return paymentInstructionDraftSchema.parse({
    invoiceId: instruction.invoiceId,
    recipientPartyId: instruction.recipientPartyId,
    destinationAccountId: instruction.destinationAccountId ?? "",
    instructedAmountText: String(instruction.instructedAmount),
    note: instruction.note ?? ""
  });
}

export function buildPaymentInstructionRecord(
  id: string,
  draft: PaymentInstructionDraft,
  timestamps: { createdAt: string; updatedAt: string },
  lifecycleStatus: PaymentInstruction["lifecycleStatus"]
): PaymentInstruction {
  return paymentInstructionSchema.parse({
    id,
    invoiceId: draft.invoiceId,
    recipientPartyId: draft.recipientPartyId,
    destinationAccountId: draft.destinationAccountId,
    instructedAmount: draft.instructedAmount,
    note: draft.note,
    lifecycleStatus,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt
  });
}

function instructionSearchTarget(instruction: PaymentInstruction, recipientName: string, accountLabel?: string): string {
  return [
    recipientName,
    accountLabel ?? "",
    instruction.note ?? "",
    instruction.instructedAmount.toString()
  ]
    .map(normalizeText)
    .join(" ");
}

function duplicateKey(instruction: Pick<PaymentInstruction, "invoiceId" | "recipientPartyId" | "destinationAccountId" | "instructedAmount">): string {
  return [
    instruction.invoiceId,
    instruction.recipientPartyId,
    instruction.destinationAccountId ?? "",
    String(instruction.instructedAmount)
  ].join("|");
}

function buildInstructionSummary(
  instruction: PaymentInstruction,
  recipientName: string,
  accountLabel?: string
): string {
  const accountText = accountLabel ? `، حساب «${accountLabel}»` : "، حساب هنوز تعیین نشده";
  const noteText = instruction.note ? `، یادداشت «${instruction.note}»` : "";
  return `دستور پرداخت برای «${recipientName}» در فاکتور ${instruction.invoiceId} با مبلغ ${formatPaymentInstructionAmount(instruction.instructedAmount)}${accountText}${noteText}`;
}

export function findProbablePaymentInstructionDuplicateWarnings(
  instructions: readonly PaymentInstruction[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[]
): PaymentInstructionDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const grouped = new Map<string, PaymentInstruction[]>();

  for (const instruction of instructions) {
    const key = duplicateKey(instruction);
    const existing = grouped.get(key) ?? [];
    existing.push(instruction);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .filter(([, matches]) => matches.length > 1)
    .map(([, matches]) => {
      const first = matches[0]!;
      return {
        kind: "duplicate_instruction" as const,
        matchedInstructionIds: Array.from(new Set(matches.map((instruction) => instruction.id))),
        matchedInstructionSummaries: Array.from(
          new Set(
            matches.map((instruction) =>
              buildInstructionSummary(
                instruction,
                partiesById.get(instruction.recipientPartyId)?.displayName ?? instruction.recipientPartyId,
                instruction.destinationAccountId ? accountsById.get(instruction.destinationAccountId)?.accountLabel : undefined
              )
            )
          )
        ),
        invoiceId: first.invoiceId,
        recipientPartyId: first.recipientPartyId,
        destinationAccountId: first.destinationAccountId,
        instructedAmount: first.instructedAmount
      } satisfies PaymentInstructionDuplicateWarning;
    });
}

export function findProbablePaymentInstructionDraftWarnings(
  instructions: readonly PaymentInstruction[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[],
  draft: PaymentInstructionDraft,
  excludeInstructionId?: string
): PaymentInstructionDuplicateWarning[] {
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));
  const visibleInstructions = instructions.filter((instruction) => instruction.id !== excludeInstructionId);
  const matchingInstructions = visibleInstructions.filter(
    (instruction) =>
      instruction.invoiceId === draft.invoiceId &&
      instruction.recipientPartyId === draft.recipientPartyId &&
      (instruction.destinationAccountId ?? "") === (draft.destinationAccountId ?? "") &&
      instruction.instructedAmount === draft.instructedAmount
  );

  if (matchingInstructions.length === 0) {
    return [];
  }

  const first = matchingInstructions[0]!;

  return [
    {
      kind: "duplicate_instruction",
      matchedInstructionIds: matchingInstructions.map((instruction) => instruction.id),
      matchedInstructionSummaries: matchingInstructions.map((instruction) =>
        buildInstructionSummary(
          instruction,
          partiesById.get(instruction.recipientPartyId)?.displayName ?? instruction.recipientPartyId,
          instruction.destinationAccountId ? accountsById.get(instruction.destinationAccountId)?.accountLabel : undefined
        )
      ),
      invoiceId: first.invoiceId,
      recipientPartyId: first.recipientPartyId,
      destinationAccountId: first.destinationAccountId,
      instructedAmount: first.instructedAmount
    }
  ];
}

export function filterPaymentInstructions(
  instructions: readonly PaymentInstruction[],
  parties: readonly Party[],
  destinationAccounts: readonly DestinationAccount[],
  filter: PaymentInstructionListFilter
): PaymentInstruction[] {
  const query = normalizeText(filter.query);
  const partiesById = new Map(parties.map((party) => [party.id, party] as const));
  const accountsById = new Map(destinationAccounts.map((account) => [account.id, account] as const));

  return instructions
    .filter((instruction) => {
      const matchesStatus =
        filter.status === "all" ||
        (filter.status === "active" && instruction.lifecycleStatus === "active") ||
        (filter.status === "cancelled" && instruction.lifecycleStatus === "cancelled");

      if (!matchesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const recipientName = partiesById.get(instruction.recipientPartyId)?.displayName ?? instruction.recipientPartyId;
      const accountLabel = instruction.destinationAccountId ? accountsById.get(instruction.destinationAccountId)?.accountLabel : undefined;
      const searchable = instructionSearchTarget(instruction, recipientName, accountLabel);
      return searchable.includes(query);
    })
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt > right.createdAt ? -1 : 1;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function summarizePaymentInstructionForDisplay(
  instruction: PaymentInstruction,
  recipientName: string,
  accountLabel?: string
): string {
  const accountText = accountLabel ? ` · ${accountLabel}` : " · حساب هنوز تعیین نشده";
  return `${recipientName} · ${instruction.instructedAmount.toLocaleString("fa-IR")} تومان${accountText}`;
}
