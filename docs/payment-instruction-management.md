# Payment Instruction Management

Stage 4 keeps payment instructions inside invoice details so operators can direct parts of an invoice to one or more recipients and destination accounts without introducing actual payments yet.

## Decisions
- The invoice customer remains the payer source of truth.
- Instructions use active or cancelled lifecycle states in the local UI.
- Active instruction totals are derived and cannot exceed the invoice total.
- Unassigned invoice amount is derived from active instructions.
- Cancelled instructions stay visible for audit and recovery.

## UX
- The invoice detail view shows the instruction summary, a create/edit form, and a list of instructions.
- The account field can stay unset and is shown as `حساب هنوز تعیین نشده`.
- Duplicate instructions produce warnings instead of overwriting existing data.
