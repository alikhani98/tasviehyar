# Domain Model

## Party
Represents a person or business involved in the settlement flow. A single entity may play several roles at once. Stage 1 uses it as the first fully managed business object, with create/view/edit/search/filter/archive/restore support and duplicate warnings.

## Invoice
Stores exactly one customer, one invoice date, an optional reference, one total amount, and an active/cancelled lifecycle state. No line items are stored, and settlement state is not stored in Stage 3.

## PaymentInstruction
Represents a direction for how some part of an invoice should be settled. Instructions may be assigned gradually. The invoice customer is the single source of truth for who the payer is, so the instruction does not redundantly store a payer field. Stage 4 manages active, cancelled, and restored instructions inside invoice details.

## DestinationAccount
Stores a lightweight account reference for identification, without requiring full account numbers in the MVP.

## Payment
Stores a payment amount, payer, recipient, date, method, lifecycle state, verification state, optional tracking reference, optional destination account, and notes. Verification stays separate from the payment record itself so status transitions can be audited.

## PaymentAllocation
Connects a payment to an invoice and optionally to one instruction, so one payment may be split across multiple targets when needed.

## PaymentVerification
Stores the verification method and result for a payment as append-only history.

## AuditEvent
Records creation, cancellation, reversal, status changes, and corrections so history is not silently overwritten.

## BackupEnvelope
Stores a local-file snapshot of the application tables with metadata, counts, and checksum information so the app can validate and restore the local database safely.
