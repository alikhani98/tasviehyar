# TasviehYar / تسویه‌یار

TasviehYar is a Persian, local-first settlement and payment-reconciliation app for a traditional pistachio wholesale business. It helps the team track parties, invoices, payment instructions, payments, balances, reconciliation issues, reports, and backups without relying on a backend.

TasviehYar یک نرم‌افزار فارسی و محلی‌اول برای تسویه‌حساب و پیگیری پرداخت‌ها در یک کسب‌وکار عمده‌فروشی پسته است. این برنامه برای ثبت اشخاص، فاکتورها، دستورهای پرداخت، پرداخت‌ها، مغایرت‌ها، گزارش‌ها و پشتیبان‌ها طراحی شده و بدون سرور هم کار می‌کند.

## Status

Public alpha, pilot-stage.

This repository is available for review and evaluation, but the software is not production-ready.

## What problem it solves

- Keeps one local working copy of settlement data in the browser
- Makes invoice totals, payment instructions, payments, and balances visible
- Surfaces warnings and reconciliation issues instead of hiding them
- Provides a safe local backup and restore flow for pilot use

## Principles

- Local-first and offline-first
- Persian-first and RTL-first
- Derived balances, not manual ledger editing
- Audit history for important lifecycle changes
- Clear warnings before destructive or high-risk actions

## Implemented through Stage 10

- Party management with multiple roles
- Destination accounts inside party details
- Invoice management with duplicate warnings and lifecycle controls
- Payment-instruction management inside invoice details
- Payment recording, allocation, and verification
- Settlement summaries and reconciliation
- Read-only operational reports
- Excel export with CSV fallback for reports
- Backup and restore with integrity checks
- Unified visual design across the main workflows
- Demo backup download for training and quick starts
- Pilot-ready navigation and offline-friendly shell

## Technology

- React
- TypeScript
- Vite
- Dexie
- Zod
- Vitest
- Testing Library

## Requirements

- Node.js 20 or newer
- npm
- A modern browser with IndexedDB support

## Install

```bash
npm ci
```

## Development

```bash
npm run dev
npm run preview
npm run typecheck
npm run lint
npm run test
npm run build
```

## Privacy and local storage

TasviehYar stores working data locally in IndexedDB through Dexie. No backend is required for core use. Because data stays on the device, browser storage and local backups should be treated as sensitive.

Do not enter real customer information, real banking identifiers, or real financial records into test or demo data unless you are sure the environment is private and intended for that purpose.

## Backup and restore

The application includes local backup and restore features for pilot safety.

- Backups are local files
- Restore is replace-all, not merge
- Restore validation happens before destructive writes
- Backup files can contain sensitive financial information
- The repo includes `demo/tasviehyar-demo-backup-v1.json`, a fictional sample backup for onboarding and quick-start demos

Do not confuse report exports with backups. Excel and CSV report files are for analysis and review only and cannot be restored into TasviehYar.

The backup screen also includes a demo backup download. It is a separate sample file for onboarding and demonstrations, not a replacement for the live local database.

## Reports and Excel export

Stage 9 adds read-only operational reports:

- customer summaries
- recipient summaries
- invoice reports
- payment-instruction reports
- payment reports
- reconciliation reports
- single-party statements

Reports are derived from the existing records in the browser. They do not mutate source data.

Excel export is available for reports, with CSV fallback where implemented. Exported files may contain sensitive financial information and should be stored carefully.

## Current limitations

- No backend or cloud sync
- No accounting, ERP, tax, or inventory module
- No line-item invoices
- No AI, OCR, or voice input
- No bank connectivity
- No production-readiness claim

## Roadmap summary

The repository is organized by stage:

- Stage 0 to Stage 2: foundation, parties, and destination accounts
- Stage 3 to Stage 5: invoices, instructions, and payments
- Stage 6: balances and reconciliation
- Stage 7: backup and restore safety
- Stage 8: pilot readiness and UX polish
- Stage 9: operational reports and Excel export
- Stage 10: unified visual design and demo backup

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request or issue.

Keep changes small, local-first, and compatible with the current Stage 9 baseline.

## Security reporting

If you find a security or privacy concern, read [SECURITY.md](SECURITY.md) first.

Do not publish customer information, real financial records, banking identifiers, or backup files in issues or pull requests.

## License status

No open-source license is currently granted.

All rights are reserved by default.

A licensing decision will be made before any stable release.

Public repository access on GitHub allows inspection of the source, but it does not grant unrestricted reuse rights.

## Important note

TasviehYar is not professional accounting, legal, or tax advice.
