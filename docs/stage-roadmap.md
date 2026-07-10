# Stage Roadmap

## Stage 0
- Foundation scaffold
- Domain types and validation
- Dexie schema
- Financial calculation helpers
- Persian RTL shell
- Documentation baseline

## Stage 1
- Party management only
- Create, view, edit, search, filter, archive, and restore parties
- Duplicate warnings for names, aliases, and phone numbers
- Atomic local persistence and audit events

## Stage 2
- Destination-account management inside party details
- Identifier normalization, duplicate warnings, and archive/restore
- Local Dexie persistence with atomic audit events
- Search and filtering within account lists

## Stage 3
- Invoice management
- One total per invoice, active/cancelled lifecycle, and warning-based duplicates
- Search, filter, edit, and cancellation flows
- Usability refinements from pilot feedback

## Stage 4
- Payment-instruction management inside invoice details
- Multiple instructions per invoice with active totals and unassigned remainder
- Duplicate warnings, cancellation, restoration, and atomic audit events
- Local-first instruction persistence and RTL mobile-first UI

## Stage 5
- Payment recording, allocation, and verification
- Reported, confirmed, rejected, and disputed payment history
- Payment allocations against invoices and instructions
- Duplicate tracking-reference and probable duplicate-payment warnings
- Local Dexie persistence, audit history, and RTL mobile-first UI

## Stage 6
- Settlement balances and reconciliation
- Derived customer and recipient summaries
- Mismatch review list and payment/invoice settlement visibility
- Simple summary cards for the home and detail views
