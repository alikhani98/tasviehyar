import { z } from "zod";
import { moneySchema } from "./money";

export const partyRoleValues = [
  "customer",
  "farmer",
  "broker",
  "destination_account_owner",
  "internal_business_party"
] as const;

export const partyRoleSchema = z.enum(partyRoleValues);

export const partySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  searchableDescription: z.string().min(1).optional(),
  roles: z.array(partyRoleSchema).min(1),
  phoneNumber: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  active: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const invoiceLifecycleValues = [
  "active",
  "cancelled",
  "draft",
  "open",
  "partially_settled",
  "settled",
  "reversed"
] as const;
export const invoiceLifecycleSchema = z.enum(invoiceLifecycleValues);

export const invoiceSchema = z.object({
  id: z.string().min(1),
  customerPartyId: z.string().min(1),
  invoiceDate: z.string().date(),
  referenceNumber: z.string().min(1).optional(),
  totalAmount: moneySchema,
  note: z.string().min(1).optional(),
  paperInvoiceImageRef: z.string().min(1).optional(),
  lifecycleStatus: invoiceLifecycleSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const paymentInstructionLifecycleValues = ["draft", "active", "partially_satisfied", "satisfied", "cancelled", "reversed"] as const;
export const paymentInstructionLifecycleSchema = z.enum(paymentInstructionLifecycleValues);

export const paymentInstructionSchema = z.object({
  id: z.string().min(1),
  invoiceId: z.string().min(1),
  recipientPartyId: z.string().min(1),
  destinationAccountId: z.string().min(1).optional(),
  instructedAmount: moneySchema,
  note: z.string().min(1).optional(),
  lifecycleStatus: paymentInstructionLifecycleSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const destinationAccountSchema = z.object({
  id: z.string().min(1),
  ownerPartyId: z.string().min(1),
  accountLabel: z.string().min(1),
  bankName: z.string().min(1).optional(),
  cardNumber: z.string().regex(/^\d{16}$/).optional(),
  iban: z.string().regex(/^IR\d{24}$/).optional(),
  bankAccountNumber: z.string().regex(/^\d{5,24}$/).optional(),
  active: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const paymentMethodValues = ["bank_transfer", "cash", "cheque", "other"] as const;
export const paymentMethodSchema = z.enum(paymentMethodValues);

export const paymentVerificationStatusValues = ["reported", "confirmed", "rejected", "disputed"] as const;
export const paymentVerificationStatusSchema = z.enum(paymentVerificationStatusValues);
export const paymentLifecycleValues = ["active", "cancelled", "reversed"] as const;
export const paymentLifecycleSchema = z.enum(paymentLifecycleValues);

export const paymentSchema = z.object({
  id: z.string().min(1),
  payerPartyId: z.string().min(1),
  recipientPartyId: z.string().min(1),
  amount: moneySchema,
  paymentDate: z.string().date(),
  paymentMethod: paymentMethodSchema,
  lifecycleStatus: paymentLifecycleSchema,
  verificationStatus: paymentVerificationStatusSchema,
  trackingReference: z.string().min(1).optional(),
  destinationAccountId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const paymentAllocationSchema = z.object({
  id: z.string().min(1),
  paymentId: z.string().min(1),
  invoiceId: z.string().min(1),
  paymentInstructionId: z.string().min(1).optional(),
  allocatedAmount: moneySchema,
  createdAt: z.string().datetime({ offset: true })
});

export const paymentVerificationResultSchema = paymentVerificationStatusSchema;
export const paymentVerificationMethodValues = ["recipient_phone_confirmation", "receipt_review", "account_review", "other"] as const;
export const paymentVerificationMethodSchema = z.enum(paymentVerificationMethodValues);

export const paymentVerificationSchema = z.object({
  id: z.string().min(1),
  paymentId: z.string().min(1),
  verificationResult: paymentVerificationResultSchema,
  verifierDescriptionOrPartyRef: z.string().min(1),
  verificationMethod: paymentVerificationMethodSchema,
  note: z.string().min(1).optional(),
  verifiedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true })
});

export const auditEventSchema = z.object({
  id: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  description: z.string().min(1),
  previousStatus: z.string().min(1).optional(),
  nextStatus: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  actorRef: z.string().min(1).optional()
});

export type PartyRole = z.infer<typeof partyRoleSchema>;
export type Party = z.infer<typeof partySchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type PaymentInstruction = z.infer<typeof paymentInstructionSchema>;
export type DestinationAccount = z.infer<typeof destinationAccountSchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type PaymentVerificationStatus = z.infer<typeof paymentVerificationStatusSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentAllocation = z.infer<typeof paymentAllocationSchema>;
export type PaymentVerification = z.infer<typeof paymentVerificationSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
