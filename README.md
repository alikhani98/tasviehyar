# TasviehYar

TasviehYar is a Persian, local-first settlement and payment-reconciliation app for a traditional pistachio wholesale business.

## Stage 0
This stage provides:
- a React + TypeScript + Vite foundation
- Dexie schema scaffolding for local-first storage
- Zod-backed domain types and validation
- pure settlement calculations and warnings
- a simple Persian RTL shell
- tests for the required settlement scenario

## Stage 1
This stage adds party management:
- create, view, edit, search, filter, archive, and restore parties
- multi-role party records
- duplicate-name, alias, and phone warnings
- atomic audit events for party changes

## Stage 2
This stage adds destination-account management inside each party:
- create, view, edit, archive, and restore destination accounts
- multiple accounts per party
- identifier normalization and duplicate warnings
- atomic audit events for account changes
- masked identifiers with reveal/copy in the party details view

## Stage 3
This stage adds invoice management:
- create, view, edit, search, filter, and cancel invoices
- one total amount per invoice
- one invoice per customer
- customer selection limited to active customer-role parties for new invoices
- warning-based duplicate detection and atomic audit events

## Stage 4
This stage adds payment instructions inside invoice details:
- create, view, edit, cancel, and restore instructions
- multiple instructions per invoice
- active total and unassigned remainder derived from the invoice
- duplicate warnings, atomic audit events, and read-only cancelled invoices

## Stage 5
This stage adds payment recording and verification:
- create, view, edit, cancel, and reverse payments
- payment allocations to invoices and instructions
- append-only verification history and duplicate warnings
- simple payment history inside invoice details

## Stage 6
This stage adds settlement visibility:
- derived customer and recipient settlement summaries
- reconciliation cards and mismatch review
- payment/invoice balance visibility inside the main views

## Stage 7
This stage adds backup and restore safety:
- local backup export with metadata and checksum
- preview before restore and replace-all transactional recovery
- integrity validation, restore warnings, and backup history metadata

## Stage 8
This stage prepares the app for controlled pilot use:
- direct navigation to the home, people, invoices, payments, reconciliation, and backup areas
- a simpler home page with pilot priorities and local readiness status
- offline loading with an installable shell and local data access
- clearer money and date previews, plus protection for unsafe actions and unsaved changes
- backup/pilot reminders and end-to-end workflow verification

## Scripts
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run typecheck`

## Notes
- The app intentionally avoids inventory, line items, and backend dependencies.
- Money is stored as integer تومان values only.
- Payment lifecycle states are separate from verification states.
- Settlement labels are derived from records and are not stored as editable truth.
- Backups are local files that contain sensitive financial information.
- Restore is replace-all, not merge, and validation happens before any destructive write.
- Financial history is preserved through audit records.
