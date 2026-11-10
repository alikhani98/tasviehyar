# ALPHA-01 / P5.3 — PHP Backup Storage Integrity & Concurrency Verification

## 1. Initial state

**VERIFIED.** Existing uncommitted P1–P5.2 changes were preserved on `codex/alpha-01-p1`. The PHP API was reviewed before modification. No production or hosting files were touched.

## 2. Changed files

- `api/backup-v1.php` — private storage lock, quota reservation/publication ordering, bounded staged writes, download SHA-256 verification, and deterministic test fault hooks.
- `docs/alpha-01-p5-3-storage-verification.md` — this report.

No React, Service Worker, Dexie schema, Backup Format v1, or financial logic changes were made.

## 3. Race findings and hardening

**FIXED.** The previous implementation performed `usage()` and publication without a common lock, allowing concurrent uploads to bypass the total quota. Listing, deletion, and download also had no shared storage coordination, and downloads trusted files without checking stored SHA-256 metadata.

The handler now uses a private `.storage.lock` file with `flock()`:

- uploads use an exclusive lock across quota check, stage write, final rename, and metadata publication;
- list uses a shared lock while reading metadata;
- download uses a shared lock while checking metadata SHA-256 and streaming bytes;
- deletion uses an exclusive lock across ciphertext and metadata removal.

Upload staging writes in bounded 8 KiB chunks and publishes only after close/flush and atomic same-directory rename. Test-only fault injection is enabled only when `TASVIEHYAR_TEST_FAULT` is explicitly set (`stage`, `rename`, or `metadata`); it is inert in normal operation.

## 4. Executed verification

**VERIFIED.** Official PHP 8.1.34 NTS was used from an isolated temporary directory. `php -l api/backup-v1.php` passed with `No syntax errors detected`.

**VERIFIED by inspection.** Symlinked objects/metadata are rejected; object IDs remain strict 32-character lowercase hex; no automatic deletion exists; malformed metadata is excluded from listing; missing ciphertext/metadata causes download failure rather than serving arbitrary paths; download SHA-256 is compared against metadata before bytes are emitted.

**NOT VERIFIED.** Genuine overlapping HTTP requests could not be executed on Windows with the PHP built-in server. The attempted command:

```powershell
$env:PHP_CLI_SERVER_WORKERS='4'
php -S 127.0.0.1:8094 -t .
```

reported `forking is not supported on this platform`. Therefore no concurrency result is claimed for two simultaneous uploads, concurrent quota pressure, upload/delete, list/upload, list/delete, download/delete, or shared-session locking.

**NOT VERIFIED.** Disk-full behavior, interrupted process recovery, partial-write fault injection over HTTP, and LiteSpeed/cPanel filesystem semantics require a multi-process PHP/FPM or LiteSpeed staging environment. The fault hooks are implemented but were not claimed as executed without a genuinely concurrent server.

## 5. Storage invariants

**VERIFIED by code review:** no object is listed before metadata publication; failed stage/rename/metadata paths remove temporary/partial artifacts; quota accounting occurs under the exclusive lock; deletion cannot traverse outside the private root; valid backups are never auto-deleted.

**REMAINING HOSTING DEPENDENCIES:** atomic rename semantics, `flock()` behavior on the selected shared filesystem, owner-only permissions, crash durability, and proxy request limits must be qualified on LiteSpeed/cPanel.

## 6. Near-limit valid backup

**NOT VERIFIED.** A structurally valid encrypted container approaching 32 MiB was not generated in this phase because the available Windows PHP server could not provide the required concurrent storage test environment. Existing P5.2 boundary tests covered application framing, not a near-limit valid container publication under concurrency.

## 7. Recommendation

**RECOMMENDATION: CONDITIONAL PASS FOR ISOLATED LITESPEED QUALIFICATION.** The source-level race and integrity hardening is complete and syntax-verified. Before P6 or any remote integration, run the exact storage suite on a disposable multi-process PHP/FPM or LiteSpeed staging account with private storage, quota pressure, fault injection, and overlapping requests. Do not infer concurrency safety from the Windows built-in server.
