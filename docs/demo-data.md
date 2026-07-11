# Demo Data

This repository includes a fictional demo backup at `demo/tasviehyar-demo-backup-v1.json`.

## Purpose

- Train new users without exposing live data.
- Validate the backup/restore workflow in a realistic but safe way.
- Exercise the report and reconciliation surfaces with representative settlement scenarios.

## Fictional Records

The demo backup contains:

- 6 parties
- 6 destination accounts
- 5 invoices
- 5 payment instructions
- 10 payments
- 7 payment allocations
- 7 payment verifications
- 51 audit events

All parties, identifiers, banking details, and notes are fictional. None of the demo records should be treated as real business data.

## Scenario Coverage

- Scenario A: `ف-زارع-01`
  - invoice total: 1,500,000,000 تومان
  - confirmed received: 170,000,000 تومان
  - reported unconfirmed: 30,000,000 تومان
  - confirmed remaining: 30,000,000 تومان
  - provisional remaining: 0 تومان
  - invoice confirmed outstanding: 1,330,000,000 تومان
  - invoice provisional outstanding: 1,300,000,000 تومان
  - invoice unassigned amount: 1,000,000,000 تومان
- Scenario B: `ف-کریمی-01`
  - fully settled active invoice with confirmed payment history
- Scenario C:
  - reported payment awaiting confirmation
  - unallocated payment
  - disputed payment
  - active instruction without destination account
- Scenario D:
  - valid instruction overpayment
  - no payment allocation exceeds its payment total
- Historical examples:
  - cancelled invoice
  - cancelled payment
  - archived party
  - archived destination account
  - verification history
  - duplicate tracking-reference warning
  - multi-role party statement coverage

## Workbook Check

The demo validation generates the operational workbook and expects these sheets:

- خلاصه مشتریان
- خلاصه گیرندگان
- فاکتورها
- دستورهای پرداخت
- پرداخت‌ها
- مغایرت‌ها

## How To Validate

Run:

```bash
npm run generate:demo-backup
npm run test
```

The generator restores the backup into an isolated database, validates integrity, and compares the restored counts and balances before writing the static JSON file.

## Removal

The demo backup does not alter the live app database. To remove the file from the repository, delete `demo/tasviehyar-demo-backup-v1.json` and regenerate it only if you need the sample artifact again.
