# Domain Model

## Party
Represents a person or business involved in the settlement flow. A single entity may play several roles at once. Stage 1 uses it as the first fully managed business object, with create/view/edit/search/filter/archive/restore support and duplicate warnings.

## Invoice
Stores the customer, invoice date, optional reference, total amount, and lifecycle state. No line items are stored.

## PaymentInstruction
Represents a direction for how some part of an invoice should be settled. Instructions may be assigned gradually. The invoice customer is the single source of truth for who the payer is, so the instruction does not redundantly store a payer field.

## DestinationAccount
Stores a lightweight account reference for identification, without requiring full account numbers in the MVP.

## Payment
Stores a payment amount, payer, recipient, date, method, lifecycle state, verification state, and optional tracking reference.

## PaymentAllocation
Connects a payment to an invoice and optionally to one instruction.

## PaymentVerification
Stores the verification method and result for a payment.

## AuditEvent
Records creation, cancellation, reversal, status changes, and corrections so history is not silently overwritten.
