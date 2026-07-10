import type { AuditEvent, PaymentVerification } from "./schemas";

export function appendAuditEvent(history: readonly AuditEvent[], event: AuditEvent): AuditEvent[] {
  return [...history, event];
}

export function appendPaymentVerificationRecord(
  history: readonly PaymentVerification[],
  verification: PaymentVerification
): PaymentVerification[] {
  return [...history, verification];
}
