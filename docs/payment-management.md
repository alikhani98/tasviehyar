# Payment Management

Stage 5 adds a local payment register that tracks the real transfers made against invoices and instructions.

## Decisions
- Payments are recorded separately from instructions.
- New payments normally start as `reported`.
- Confirmation is explicit and append-only through verification history.
- Payments can be cancelled or reversed without hard deletion.
- One payment may be allocated across multiple invoices or instructions when the relationships are valid.
- Duplicate tracking references and probable duplicate payments are warnings, not silent overwrites.

## UX
- The main shell enables the `ثبت پرداخت` entry point.
- The payment form shows a confirmation summary before save.
- The payment details panel shows payment information, allocations, lifecycle state, and verification history.
- The invoice details view shows a simple payment history based on allocations.
