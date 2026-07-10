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
- Financial history is preserved through audit records.
