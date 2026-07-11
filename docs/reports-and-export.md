# Reports and Export

TasviehYar Stage 9 adds read-only operational reports derived from the existing local records.

## Included reports
- Customer summaries
- Recipient summaries
- Invoice report
- Payment-instruction report
- Payment report
- Reconciliation report
- Single-party statement

## Export behavior
- Excel files are reports, not backups.
- Excel files cannot be restored into TasviehYar.
- CSV fallback is available for the active report where implemented.
- Exported files contain sensitive financial information and should be treated as confidential business records.

## Display rules
- Reports are read-only and do not mutate source data.
- The UI masks bank identifiers by default in list views.
- Focused detail views can reveal and copy identifiers when needed.

## Validation notes
- The workbook includes metadata such as the creation timestamp and applied filters.
- Generated workbooks are verified in tests by parsing the exported file back into ExcelJS.
- Representative tests compare totals shown in the UI with totals written into the workbook.
