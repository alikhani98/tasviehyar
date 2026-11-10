# ALPHA-01 / P4.5 — Secure Encrypted Restore Verification

## 1. Initial Git state

**VERIFIED.** Work started on `codex/alpha-01-p1` with the pre-existing uncommitted P1–P4.4 changes. No reset, commit, merge, deployment, PHP change, hosting change, schema change, or Service Worker change was performed.

## 2. Changed-file inventory

- `src/features/backup-restore/BackupRestore.tsx` — encrypted restore integration through the existing `BackupService.restoreBackupText()` path; confirmation gate, stale-operation invalidation, result messaging, and sensitive-state cleanup.
- `src/features/backup-restore/BackupRestore.test.tsx` — successful encrypted restore, confirmation cancellation, wrong-key/tamper rejection, and no-restore-before-validation regressions.
- `docs/alpha-01-p4-5-recovery-verification.md` — this report.

The encrypted engine, Backup Format v1, Dexie Schema v3, financial calculations, P1 restore implementation, PHP, hosting, production files, and Service Worker were not modified.

## 3. Restore integration design

**VERIFIED.** The encrypted workflow now performs:

1. File selection and local text read.
2. Recovery-key format validation.
3. AES-GCM authentication/decryption through `decryptBackupText()`.
4. Existing Backup Format v1/schema/checksum validation performed by the engine.
5. Safe preview of counts, format version, schema version, timestamp, and checksum.
6. Explicit confirmation that local data will be replaced.
7. Invocation of the existing `service.restoreBackupText()` atomic pathway.

The encrypted component does not write Dexie tables directly and does not implement a second restore engine.

## 4. Safety guarantees

**VERIFIED by code and tests:**

- Inspection and decryption do not call the restore service or IndexedDB APIs.
- Wrong keys and tampered containers fail before restore is invoked.
- Restore requires an explicit confirmation dialog.
- Existing P1 result handling is preserved: pre-commit failures are reported as failures; committed restores are reported as successful; committed restores with history logging failure include a warning.
- Operation tokens invalidate in-flight encrypted inspection when the selected file, key, or workflow changes.
- Closing/unmounting clears encrypted key, file, and decrypted-payload state. JavaScript memory cannot be cryptographically zeroized.
- No plaintext, key, or DEK is sent to a server.

## 5. Automated test results

**VERIFIED.** Full Vitest suite: **28 test files, 110 tests passed**.

Added UI regressions cover:

- successful encrypted restore through `restoreBackupText()`;
- confirmation cancellation preventing restore;
- wrong Recovery Key and tampered ciphertext rejection;
- no restore before successful validation;
- existing plaintext restore behavior;
- Recovery Key state cleanup.

**VERIFIED.** `npm.cmd run typecheck` passed.

**VERIFIED.** `npm.cmd run lint -- --max-warnings=0` passed.

**VERIFIED.** `npm.cmd run build` passed. Only existing dependency annotation and bundle-size warnings were emitted.

## 6. Independent browser profile A/B drill

**VERIFIED — PASS.** The drill ran against the installed Google Chrome executable at `C:\Program Files\Google\Chrome\Application\chrome.exe` using the globally installed Python Playwright runner and two separate Playwright browser contexts. No Chromium download or application dependency installation was required.

Commands:

```powershell
npm.cmd run dev -- --host 127.0.0.1
python -u .tmp-p4-5-drill.py
```

The temporary drill seeded only the checked-in synthetic demo dataset into context A's local IndexedDB, exported an encrypted container through the rendered P4.4 UI, captured the separately displayed Recovery Key, and transferred only those two artifacts to context B.

Evidence from the completed run:

```json
{
  "status": "PASS",
  "stores": {
    "parties": 6,
    "destinationAccounts": 6,
    "invoices": 5,
    "paymentInstructions": 5,
    "payments": 10,
    "paymentAllocations": 7,
    "paymentVerifications": 7,
    "auditEvents": 51
  },
  "recoveryKeyTransferred": true
}
```

Profile B was a fresh context and its eight stores were asserted empty before import. After decryption, explicit confirmation, and restore, all eight counts matched the fixture. Foreign-key relationships were verified for invoice customers, payment instructions, payments, allocations, and verifications. The page was reloaded and all eight counts still matched.

Request capture recorded only localhost `GET` requests for Vite assets and modules. No `POST` request, external request, financial payload, or Recovery Key upload occurred.

The prior P4.3 real Chrome Web Crypto engine check remains valid, but it did not exercise this P4.5 restore UI or two-profile recovery sequence.

## 7. Failure-mode verification

**VERIFIED:** wrong key, tampered encrypted input, invalid decrypted payload, cancellation, and pre-restore rejection paths.

**VERIFIED by existing P1 tests and preserved integration:** atomic transaction behavior, pre-commit failure reporting, committed restore reporting, and history-log failure warning.

**VERIFIED in the browser drill:** profile-isolated persistence and no-upload behavior. **NOT VERIFIED in this drill:** deliberate stale-result race injection; the invalidation guard remains covered structurally by the operation-token path and automated UI tests.

## 8. Known limitations

- The completed drill used a temporary global Python Playwright runner and installed Chrome executable; no repository Playwright test runner is retained.
- No remote backup, PHP, authentication, retention, or server availability behavior is included in P4.5.
- P4.5 still relies on the existing P1 policy for local recovery checkpoints and atomic replacement; no new checkpoint mechanism was introduced.
- JavaScript-held keys and plaintext cannot be guaranteed to be erased from memory.

## 9. Readiness recommendation for P5

**RECOMMENDATION: READY FOR ALPHA REVIEW.** The independent browser recovery drill passed against the installed Chrome executable using two isolated Playwright contexts. P5 may proceed only after ALPHA reviews this evidence and approves the remaining server-side scope separately.

## 10. Reproducible manual procedure when Playwright is approved

1. Install/enable the approved Playwright runner without changing application dependencies, or provide a preinstalled runner and Chromium binary.
2. Start `npm.cmd run dev -- --host 127.0.0.1`.
3. Launch two isolated Playwright contexts with separate `storageState`/profiles and verify `indexedDB.databases()` is empty in profile B before import.
4. In profile A, create only synthetic parties, destination account, invoice, payment, allocation, verification, and audit records; export encrypted backup and capture the downloaded container plus Recovery Key through test fixtures only.
5. Transfer only those two artifacts to profile B; assert no `fetch`/XHR requests were made and no Recovery Key appears in URL, localStorage, sessionStorage, cookies, or request bodies.
6. Inspect, confirm restore, assert all eight stores and relationships, reload, and assert persistence.
7. Save Playwright traces/screenshots and append their hashes and exact command output to this report.
