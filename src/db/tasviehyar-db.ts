import Dexie, { type Table } from "dexie";
import type {
  AuditEvent,
  DestinationAccount,
  Invoice,
  Party,
  Payment,
  PaymentAllocation,
  PaymentInstruction,
  PaymentVerification
} from "../domain";

export class TasviehYarDatabase extends Dexie {
  parties!: Table<Party, string>;
  invoices!: Table<Invoice, string>;
  paymentInstructions!: Table<PaymentInstruction, string>;
  destinationAccounts!: Table<DestinationAccount, string>;
  payments!: Table<Payment, string>;
  paymentAllocations!: Table<PaymentAllocation, string>;
  paymentVerifications!: Table<PaymentVerification, string>;
  auditEvents!: Table<AuditEvent, string>;

  constructor() {
    super("tasviehyar");

    this.version(1).stores({
      parties: "id, displayName, active, updatedAt",
      invoices: "id, customerPartyId, invoiceDate, lifecycleStatus, updatedAt",
      paymentInstructions: "id, invoiceId, recipientPartyId, lifecycleStatus, updatedAt",
      destinationAccounts: "id, ownerPartyId, active, updatedAt",
      payments: "id, payerPartyId, recipientPartyId, paymentDate, lifecycleStatus, verificationStatus, trackingReference, updatedAt",
      paymentAllocations: "id, paymentId, invoiceId, paymentInstructionId, createdAt",
      paymentVerifications: "id, paymentId, verificationResult, verifiedAt, createdAt",
      auditEvents: "id, entityType, entityId, action, createdAt"
    });
  }
}

export const db = new TasviehYarDatabase();
