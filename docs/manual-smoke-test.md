# Manual Smoke Test

Run this smoke test after a release candidate or major browser change.

## Steps
1. Open the app.
2. Confirm the home page loads in Persian RTL layout.
3. Confirm the navigation buttons are visible and reachable.
4. Open `حساب اشخاص` and create a test customer.
5. Open `فاکتورها` and create a test invoice.
6. Add at least one payment instruction inside the invoice details.
7. Open `ثبت پرداخت` and record a payment.
8. Open the payment record and confirm the details page renders.
9. Open `مغایرت‌ها` and confirm the summary cards render.
10. Open `پشتیبان‌گیری و بازیابی` and download a backup.
11. Restore the backup into an empty test database or separate browser profile.
12. Confirm the restored counts and balances match the pre-backup values.
13. Refresh the page with the browser offline after the first successful load.
14. Confirm the app shell still opens from the cached build.

## Pass Criteria
- The app stays readable on a small screen.
- No raw technical error is shown to the operator.
- Money and date previews are understandable.
- Confirm/restore prompts are clear and Persian.
- Offline shell loading works after the app has been opened once online.
