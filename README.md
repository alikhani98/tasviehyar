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
