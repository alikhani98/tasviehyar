# Decision Log

- The MVP stores invoice totals only, not invoice line items.
- Paper notebooks remain in use during the pilot.
- The primary initial data-entry user is a staff operator.
- The elderly manager initially uses the application mainly to view results.
- Stage 1 is party management only; invoice and payment workflows remain disabled.
- Reported and confirmed payments are separate states.
- Invoice instructions may be assigned gradually.
- Stage 3 invoices contain only one total amount and one customer.
- Stage 3 stores invoice lifecycle as active/cancelled instead of editable settlement status.
- Stage 3 uses cancellation instead of hard deletion for invoices.
- Stage 3 duplicate invoice detection is warning-based rather than blocking.
- Stage 3 does not store payment or balance state yet.
- No hard deletion of financial records.
- All money is stored in integer تومان values.
- No commit, push, or pull request is created without explicit instruction.
