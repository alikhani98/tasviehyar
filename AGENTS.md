# AGENTS.md

## Product Purpose
TasviehYar is a Persian, local-first settlement and payment-reconciliation app for a traditional pistachio wholesale business.

It exists to track invoice totals, payment instructions, partial payments, payment verification, balance states, mismatches, and audit history. It is not a full accounting or ERP system.

## MVP Scope
- Parties with multiple roles
- One total amount per customer invoice
- Payment instructions that can be assigned gradually
- Partial payments
- Reported, confirmed, rejected, and disputed payment states
- Confirmed and provisional outstanding balances
- Unallocated invoice amounts
- Underpayment, overpayment, duplicate-reference warnings, and mismatch visibility
- Audit history for important lifecycle changes
- Persian RTL application shell with a simple home screen

## Explicit Non-Goals
- Invoice line items
- Pistachio type
- Bag count
- Weight
- Price per kilogram
- Inventory
- Warehouse data
- Detailed freight calculations
- Backend services
- Cloud databases
- Authentication providers
- Paid APIs
- AI APIs
- OCR
- Voice input
- Bank connections
- Messaging integrations
- Tax integrations
- Analytics dashboards
- Excel export

## Architecture Rules
- Use React, TypeScript, Vite, Dexie, Zod, Vitest, and Testing Library.
- Keep the app local-first and browser-friendly.
- Keep business rules in pure calculation and validation functions.
- Store durable state in IndexedDB through Dexie.
- Prefer explicit domain types and schemas over ad hoc objects.
- Keep UI shell code separate from domain logic.
- Do not introduce architecture that depends on a backend to work.

## Persian RTL Requirements
- The UI must be Persian-first.
- The document and app shell must be RTL.
- Text must read naturally right-to-left.
- Controls must be easy to read for users with limited technical familiarity.

## Accessibility Requirements
- Use large, readable text and generous spacing.
- Make touch targets easy to press on mobile.
- Avoid dense screens and hidden navigation.
- Keep labels literal and plain.
- Support elderly users and technology-averse users by reducing cognitive load.

## Financial Data Invariants
- All money values must be non-negative integer تومان values.
- Floating-point money arithmetic is prohibited.
- Invoice balances are derived, not stored as editable values.
- Reported payments do not reduce confirmed balance.
- Confirmed allocations reduce confirmed invoice balance.
- Provisional balance may include reported payments, but must be clearly labeled.
- Allocations cannot exceed payment amount.
- Confirmed allocation to an instruction reduces its remaining amount.
- Overpayments must remain visible.
- An invoice may have an unassigned amount.
- Instructions may total less than the invoice total.
- Instructions exceeding the invoice total must produce a mismatch or validation error.
- Duplicate tracking references must create warnings, not silent data loss.
- Cancelled or reversed records must keep audit history.
- Hard deletion of financial records is prohibited.

## Testing Requirements
- Cover domain rules with pure tests.
- Cover the required settlement scenario in tests.
- Cover duplicate-reference warnings.
- Cover allocation overages and instruction overages.
- Cover overpayment visibility and payment-without-allocation behavior.
- Cover audit-event preservation for cancellations or reversals.
- Keep tests deterministic and fast.

## Git Rules
- Create work on the requested stage branch.
- Leave `main` untouched.
- Do not commit unless explicitly asked.
- Do not push unless explicitly asked.
- Do not create pull requests unless explicitly asked.

## No-Hard-Delete Policy
- Never silently delete or overwrite financial history.
- Use audit events for reversals, cancellations, and corrections.
- Prefer marking records inactive or cancelled over removing them.

## Local-First Constraints
- The app must work without a server.
- IndexedDB is the primary persistence layer.
- Network access must not be required for core functionality.
- Keep the UI and calculations usable offline.

## Security And Backup Principles
- Keep stored financial history durable and inspectable.
- Prefer append-only audit trails for important events.
- Avoid hidden mutations that make records impossible to explain later.
- Preserve enough metadata to support manual backup and recovery workflows.

## Integrity And Ethics
- Do not build features intended to conceal, falsify, or obscure transactions.
- Do not erase discrepancies to make balances look better.
- The app should make mismatches visible, not hide them.

## Controlled AI Loop
1. Implement the requested stage.
2. Review the diff and confirm scope compliance.
3. Run validation.
4. Fix only small issues that remain within scope.
5. Rerun validation.
6. Perform no more than two loops.
7. Stop and report if a fix requires scope expansion, schema redesign, destructive migration, or architectural change.
