# ALPHA-01 — P4 Browser-side encryption engine

## 1. Executive summary

P4.1 through P4.3 are implemented as a standalone browser-side TypeScript module. This remediation replaces the incompatible AES-GCM `wrapKey`/`unwrapKey` path with explicit AES-GCM encryption/decryption of raw DEK bytes. It preserves the separate `tasviehyar-encrypted-backup-v1` wrapper, existing inner Backup Format v1, and Dexie Schema v3. The module uses browser Web Crypto AES-256-GCM, a fresh random 256-bit data-encryption key (DEK) per encrypted backup, a fresh 96-bit nonce for the payload and encrypted DEK, strict container validation, authenticated metadata (AAD), and a self-contained independent recovery key.

No PHP API, server communication, storage, UI, restore integration, database migration, Service Worker change, deployment, commit, or production modification was made. The recovery key is never persisted or transmitted by this module. Decryption returns a validated `BackupEnvelope`; it does not write to IndexedDB.

## 2. Initial repository and Git state

**VERIFIED.** Work began on branch `codex/alpha-01-p1`. The working tree already contained the uncommitted P1 changes in the backup service, backup UI/tests, Service Worker v5, PWA tests, the P0 audit, P1 verification report, P3 architecture report, and the untracked production ZIP. Those changes were preserved. The P4 changes are also uncommitted.

**VERIFIED.** Existing architecture was inspected before implementation: eight Dexie stores, BackupService, Backup Format v1 schema/checksum, P1 transaction-safe export/restore behavior, P1 history status, Service Worker v5, and existing test/build conventions.

## 3. Architecture decisions implemented

| Decision | Status and implementation |
| --- | --- |
| Single-user, local-first | **VERIFIED/PRESERVED.** The module has no server dependency and does not change the local database. |
| Independent recovery key | **IMPLEMENTED.** `generateRecoveryKey()` uses `crypto.getRandomValues` for 32 random bytes and a separate random key ID. It does not use `Math.random`, passwords, account credentials, or browser storage. |
| AES-256-GCM | **IMPLEMENTED.** Web Crypto generates a new 256-bit DEK per encryption and uses AES-GCM with a 128-bit tag. |
| Backup Format v1 and schema 3 | **IMPLEMENTED/PRESERVED.** The existing v1 JSON is validated before encryption and after decryption; no v1 field or Dexie schema is changed. |
| No server plaintext | **IMPLEMENTED BY SCOPE.** This module returns an opaque JSON container for a later API; it contains no networking or server code. |
| No UI integration | **IMPLEMENTED BY SCOPE.** P4.4/P4.5 remain future work. |

## 3a. P4.3 compatibility remediation

**Root cause — VERIFIED.** The initial implementation imported the recovery key with `wrapKey`/`unwrapKey` usages and called `subtle.wrapKey()`/`subtle.unwrapKey()` with AES-GCM. The portable Web Crypto operation for this design is explicit `subtle.encrypt()`/`subtle.decrypt()` over the raw 32-byte DEK.

**Exact fix — IMPLEMENTED.** The recovery key is imported as a non-extractable AES-GCM key with only `encrypt` and `decrypt` usages. Encryption generates 32 random DEK bytes, imports them as a non-extractable AES-GCM DEK, encrypts the raw DEK bytes with the recovery key and `wrappedKeyNonce` plus the canonical header as AAD, and encrypts the v1 payload with the DEK and `payloadNonce` plus the same AAD. Decryption reverses this with explicit AES-GCM decrypt, checks the recovered DEK is exactly 32 bytes, imports it non-extractably, then validates the v1 payload and original checksum. The container identifier and version remain unchanged.

**Encoding fix — IMPLEMENTED.** Base64URL decoding now re-encodes decoded bytes and rejects noncanonical encodings, in addition to invalid characters and incorrect lengths.

## 4. Container format specification

The module is [encrypted-backup-service.ts](../src/services/encrypted-backup-service.ts). The serialized container is strict JSON with exactly these fields:

```json
{
  "containerIdentifier": "tasviehyar-encrypted-backup-v1",
  "containerVersion": 1,
  "algorithm": "AES-256-GCM",
  "keyId": "<22-character base64url key id>",
  "createdAt": "<ISO timestamp with offset>",
  "innerBackupFormat": "tasviehyar",
  "innerBackupFormatVersion": 1,
  "innerDatabaseSchemaVersion": 3,
  "payloadNonce": "<base64url 12-byte nonce>",
  "wrappedKeyNonce": "<base64url 12-byte nonce>",
  "wrappedDataEncryptionKey": "<base64url 32-byte DEK plus 16-byte GCM tag>",
  "ciphertext": "<base64url inner JSON plus 16-byte GCM tag>"
}
```

**PROPOSED/IMPLEMENTED contract details:** Web Crypto returns the AES-GCM authentication tag appended to the encrypted bytes, so the wrapper has no separate tag field. The header used as AAD is the deterministic JSON serialization of the first ten fields through `wrappedKeyNonce`, in object insertion order. Both explicit DEK encryption and payload encryption authenticate that header. A change to a security-relevant header, nonce, encrypted DEK, or ciphertext fails authentication.

The validator rejects unknown fields, unknown container versions, unknown algorithms, wrong inner format/schema, missing fields, invalid ISO timestamps, invalid base64url, wrong nonce lengths, a wrapped DEK other than 48 bytes, ciphertext shorter than a 16-byte tag, malformed JSON, and containers larger than 32 MiB of UTF-8 JSON.

The module validates the decrypted inner payload with the existing Zod Backup Format v1 schema, existing domain integrity checks, exact app/format/schema identifiers, and the existing SHA-256 checksum reconstruction helper. The helper is important for compatibility: existing v1 files can place optional `applicationVersion` at a different JSON property position, so hashing a parsed object directly would incorrectly reject valid v1 files.

## 5. Recovery Key format and handling

`generateRecoveryKey()` returns:

```text
TYRK1-<22-character base64url key id>-<43-character base64url 256-bit secret>
```

The recovery key contains 256 random bits and an independent 128-bit key identifier. `parseRecoveryKey()` strictly validates the prefix, key-ID length, encoding, and exact 32-byte secret length. The key ID is public metadata; the secret is the recovery material.

The recovery secret is imported as a non-extractable AES-GCM `CryptoKey` with only `encrypt`/`decrypt` usages. The recovered DEK is also imported non-extractably. Neither is returned from the encryption/decryption engine as raw bytes, persisted in IndexedDB/localStorage/sessionStorage, sent over a network, or included in errors. The module cannot securely erase JavaScript memory; callers should minimize key/plaintext lifetimes and avoid logging inputs or outputs.

The design intentionally does not add password derivation. Recovery must remain independent of account passwords and server credentials. User-facing export, confirmation that the key was stored independently, QR/print representation, and clean-profile recovery belong to P4.4/P4.5.

## 6. Cryptographic design

1. Validate the supplied v1 JSON before generating or encrypting anything.
2. Import the independent recovery key as a non-extractable AES-GCM key.
3. Generate fresh random 256-bit DEK bytes and import them as a non-extractable AES-GCM `CryptoKey`.
4. Generate independent random 96-bit `payloadNonce` and `wrappedKeyNonce` values.
5. Encrypt the raw DEK bytes with explicit AES-GCM under the recovery key and the authenticated header as AAD. This is the encrypted DEK field; no `wrapKey` operation is used.
6. Encrypt the exact supplied v1 JSON bytes with the DEK and the same authenticated header as AAD.
7. Serialize only the strict wrapper. No plaintext is returned by the encryption function.
8. On decryption, validate the complete wrapper, check the recovery key ID, decrypt/authenticate the encrypted DEK, import it non-extractably, decrypt/authenticate the payload, parse/validate v1, and verify its original checksum before returning it.

Any wrong key, changed wrapped DEK, changed payload, changed nonce, changed authenticated header, truncation, or malformed structure fails before validated data is returned. The module does not perform a database restore.

## 7. Changed-file inventory

- [src/services/encrypted-backup-service.ts](../src/services/encrypted-backup-service.ts) — P4.1/P4.2/P4.3 implementation, container schema, strict parser, key generator/parser, AES-GCM encryption/decryption, v1 validation.
- [src/services/__tests__/encrypted-backup-service.test.ts](../src/services/__tests__/encrypted-backup-service.test.ts) — recovery-key, round-trip, tamper, malformed-container, compatibility, and safe-error tests using the existing demo v1 fixture.
- [docs/alpha-01-p4-implementation-report.md](../docs/alpha-01-p4-implementation-report.md) — this report.

No other files were intentionally changed by P4.

## 8. Security considerations

**VERIFIED by implementation/tests:**

- Recovery-key generation uses Web Crypto randomness and has strict length/format validation.
- Recovery keys are independent of login credentials and browser storage.
- AES-GCM uses separate fresh nonces for explicit DEK encryption and payload encryption.
- Recovery-key import uses only supported `encrypt`/`decrypt` usages; both recovery key and recovered DEK are non-extractable.
- Security-relevant metadata is authenticated as AAD.
- Unknown container fields and versions are rejected rather than ignored.
- Decrypted data is not returned until v1 schema, domain integrity, and original SHA-256 validation pass.
- Failure messages do not include keys, plaintext, or cryptographic internals.

**INFERRED limitations:** JavaScript cannot guarantee zeroization of strings, typed arrays, or garbage-collected objects. A compromised same-origin frontend can capture keys or plaintext while the user uses the app. AES-GCM authenticates integrity and origin of the selected container but does not prove freshness; an API must later treat remote objects as replayable and expose metadata/warnings.

## 9. Test inventory and actual results

The new test file covers:

- valid independent 256-bit recovery keys;
- malformed and wrong-length recovery keys;
- v1 encryption/decryption round trip with the checked-in demo fixture;
- rejection of invalid inner v1 input;
- wrong recovery key;
- modified ciphertext, wrapped DEK, payload nonce, wrapping nonce, and authenticated metadata;
- truncated, malformed, unknown-version, unknown-algorithm, and unknown-field containers;
- safe cryptographic errors without key or plaintext disclosure.

**VERIFIED.** The focused remediation suite passed: **14 tests**. The final full suite passed: **28 test files, 106 tests**. The result includes all pre-existing P1 tests and the expanded P4 tests. `npm.cmd run typecheck` passed. `npm.cmd run lint` passed. `npm.cmd run build` passed.

The build emitted existing dependency annotation warnings from Zod and an existing large-chunk warning for the Reports bundle. No P4-specific build error occurred.

## 10. Regression results

**VERIFIED.** Existing local backup/restore behavior, Dexie schema 3, Backup Format v1 tests, P1 Service Worker v5 tests, UI tests, financial rules, and audit-history tests continue to pass. The module has no import path from application UI and no database dependency, so it cannot alter current restore behavior.

**VERIFIED.** The automated test uses the existing fixture and real Web Crypto exposed by the jsdom test environment. It proves the engine accepts a recovery key independently of the originating database instance, but it does not by itself prove browser-independent recovery in a separate browser profile or device.

**VERIFIED — real browser.** A temporary Vite localhost page was opened in installed Chrome over `http://127.0.0.1:5173`. It imported the actual module, fetched the checked-in v1 fixture, verified the recovery-key import policy, encrypted, decrypted, and checked format 1/schema 3. Chrome returned `P4_BROWSER_CRYPTO_PASS`. The page, local server, Chrome process, and temporary profile were removed after the test.

## 11. Build and lint results

- **VERIFIED:** TypeScript typecheck passed.
- **VERIFIED:** ESLint passed with `--max-warnings=0`.
- **VERIFIED:** Vite production build passed.
- **VERIFIED:** No production or hosting command was run.
- **VERIFIED:** real Chrome localhost Web Crypto round trip and supported recovery-key usages.
- **NOT VERIFIED:** Safari behavior, HTTPS deployment behavior, memory pressure, and clean-profile/device recovery UX.

## 12. Known limitations

- No encrypted backup UI, recovery-key dialog, import/export flow, or explicit user confirmation exists yet.
- No PHP API, authentication, upload/download, server storage, or Service Worker integration exists in P4.
- The encrypted wrapper uses JSON/base64url, which adds overhead; 32 MiB is a defensive container limit and must be reconciled with real backup size and future hosting limits.
- The recovery key has no password-derived fallback and no server escrow by design. Losing the independently stored secret makes remote ciphertext unrecoverable.
- DEK bytes exist briefly to import the non-extractable DEK and encrypt its wrapped representation; the recovery key and imported DEK are non-extractable. JavaScript memory is not securely erasable.
- Replay/freshness, server object deletion, retention, and account recovery are intentionally deferred.

## 13. Unresolved risks

**UNKNOWN/BLOCKED:** A browser-independent recovery drill has not been run because P4 explicitly excludes UI and server integration. A real-browser secure-context test, clean profile, device replacement simulation, and future PHP staging round trip remain required. The P3 hosting qualification was supplied as evidence, but no P4 server access or production change was attempted.

## 14. Exact next steps for P4.4 and P4.5

1. **P4.4 — browser-facing key UX:** add a Persian RTL recovery-key generation/export/import dialog with explicit confirmation that the key was saved independently. Keep raw keys out of application storage and logs. Add a clean-profile browser test procedure and a user-visible warning that loss of the key prevents remote recovery.
2. **P4.5 — encrypted backup integration:** add opt-in manual encryption around the existing P1 export result and decryption before the existing v1 inspection/restore flow. Keep local plaintext download/restore available. Do not send plaintext or recovery keys to the server.
3. Before PHP work, test the wrapper in real Chrome and Safari secure contexts, then run synthetic-ciphertext-only staging tests for authenticated upload, list, download, retirement, no-store behavior, idempotency, quota failures, and Service Worker v5 cache isolation.
4. Return those results to ALPHA for approval before enabling any production server route.

## 15. P4.4 encrypted-backup user experience

**IMPLEMENTED/VERIFIED.** The existing BackupRestore screen now exposes two optional, manual workflows while preserving the plaintext local backup buttons:

- Persian RTL recovery-key workflow: generate a fresh key, display it in a left-to-right code block, explicitly copy it, explicitly download a separate key file, and confirm that it was stored independently. No key is automatically copied, downloaded, persisted, logged, or placed in a URL. Closing either workflow clears the component-held key/file state; this is lifecycle cleanup, not a guarantee of cryptographic zeroization.
- Encrypted export: the existing P1 `exportBackup()` result is encrypted with the existing P4 engine and downloaded as an opaque JSON container. Export is blocked until the user confirms independent key storage. No network request is made and the plaintext workflow remains available.
- Encrypted inspection: a separate file picker accepts an encrypted container and a password-type recovery-key field. Decryption and existing Backup Format v1 validation produce only a safe summary (format/schema/date/counts/checksum). This path never calls restore or any IndexedDB write API.

**SECURITY BEHAVIOR — VERIFIED BY CODE/TESTS.** Wrong or malformed keys/files produce a generic user-facing error. The UI does not expose cryptographic details. The key is not reused after closing the relevant workflow. The implementation does not use `fetch`, PHP, hosting APIs, localStorage, sessionStorage, cookies, or telemetry for encrypted backup UX.

## 16. P4.4 changed-file inventory

- [src/features/backup-restore/BackupRestore.tsx](../src/features/backup-restore/BackupRestore.tsx) — recovery-key actions, confirmation gate, encrypted export, encrypted inspection, safe summary, lifecycle cleanup.
- [src/features/backup-restore/BackupRestore.test.tsx](../src/features/backup-restore/BackupRestore.test.tsx) — explicit key-action/confirmation regression and encrypted inspection/no-restore regression.
- [docs/alpha-01-p4-implementation-report.md](../docs/alpha-01-p4-implementation-report.md) — this P4.4 report update.

No PHP, hosting, Service Worker, schema, financial, restore, or production files were intentionally changed by P4.4.

## 17. P4.4 validation results

**VERIFIED.** Full Vitest suite passed: **28 test files, 109 tests**. The new UI tests cover Persian key display, explicit copy/download, confirmation before encrypted export, successful encrypted export, encrypted inspection without restore/database calls, invalid-key handling, and key/file workflow state cleanup. Existing plaintext backup/restore and P1 history-status regressions remain green.

**VERIFIED.** `npm.cmd run typecheck` passed. `npm.cmd run lint -- --max-warnings=0` passed. `npm.cmd run build` passed. The build output contains only the pre-existing Zod annotation and large-chunk warnings plus a harmless note that the engine is both statically and dynamically referenced; no P4.4 error occurred.

**NOT CLAIMED.** No hosting or production test was run. No PHP endpoint, server upload/download, restore integration, Service Worker change, or browser-independent recovery drill was performed in P4.4.

## 18. Remaining limitations and P4.5 requirements

- The key is visible while the export/inspection panel is open; JavaScript memory cannot be securely erased. Users must store the separate key file or copied value independently.
- P4.4 intentionally does not restore decrypted data. P4.5 must connect validated inspection output to the already-approved atomic restore path, preserve the three restore outcomes (pre-commit failure, committed, committed/history-log failure), and add UI regression coverage for each.
- P4.5 still requires a clean-profile browser recovery drill, server-side encrypted-object API design/approval, authentication and quota handling, no-store/cache isolation verification, replay/freshness policy, and retention approval.

## 19. Final status

P4.1–P4.4 are implemented and locally verified. Plaintext local backup remains available; encrypted export and inspection are manual, client-only, and non-restoring. P4.5 restore integration and all server communication remain pending and require ALPHA approval.
