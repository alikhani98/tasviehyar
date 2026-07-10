# Party Management

Stage 1 introduces the first managed business object in TasviehYar: the party directory.

## Supported Actions
- Create parties
- View party details
- Edit existing parties
- Search and filter the party list
- Archive parties without deleting history
- Restore archived parties

## Duplicate Warnings
The interface warns when a party name, alias, or phone number appears to overlap with another stored party after normalizing punctuation and common Persian/Arabic character variants.

## Audit Behavior
Every create, update, archive, and restore action writes an audit event inside the same local transaction as the party change.

## Scope Boundary
This stage intentionally does not introduce invoices, payments, balances, reconciliations, export features, or server-backed syncing.
