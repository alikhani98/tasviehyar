# Invoice Management

Stage 3 adds a simple local-first invoice workflow that stores one total amount per invoice.

## Decisions
- One invoice belongs to one customer.
- No line items, product rows, or freight breakdowns are stored.
- New invoices may only target active parties with the `customer` role.
- Existing invoices remain visible even if the customer is later archived.
- Invoice lifecycle is active/cancelled.
- Cancellation replaces hard deletion.
- Duplicate invoice detection is warning-based.
- Payment and balance states are intentionally absent in this stage.

## UX
- The main shell enables the `ثبت فاکتور` entry point.
- The create form shows a review summary before save.
- The list supports customer-name and reference search with active/cancelled filtering.
- Cancelled invoices stay preserved and can be reviewed, but not normally edited.

