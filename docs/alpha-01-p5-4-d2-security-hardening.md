# ALPHA-01 / P5.4-D2 — Security Hardening

## Status

Implementation is **PREPARED** for owner review. Runtime verification is **NOT RUN** because PHP is unavailable in the current local environment. No production or hosting access was used.

## Findings and changes

### High — container type validation could raise a PHP `TypeError`

**VERIFIED by source inspection.** `strict_b64url()` previously required `string`, while decoded JSON fields were untrusted. Wrong-type nonce, wrapped-key, or ciphertext fields could therefore escape the intended deterministic client-error path.

**FIXED:** `strict_b64url()` accepts mixed input and rejects non-strings. `validate_container()` now validates all required field types, RFC3339 timestamps, the supported inner format, and version fields before encoding checks. Invalid client containers retain HTTP 400 responses; oversized containers retain HTTP 413.

### Medium — session-only login throttling was bypassable

**VERIFIED by source inspection.** The previous counter lived only in `$_SESSION` and could be reset by obtaining a new session.

**FIXED:** login attempts now use an atomic private `.login-rate.json` file under the configured private root and the existing exclusive `flock()` lock. The limiter keys only on `REMOTE_ADDR` (no forwarded headers), hashes the address, allows eight attempts per 900-second window, prunes expired entries, and caps state at 256 entries. Malformed or unwritable rate state fails closed with a generic storage error. Password correctness is not disclosed.

### Medium — configuration values were not consistently validated

**FIXED:** quota configuration must be a positive decimal integer within a bounded range. Password configuration must identify a supported PHP password-hash algorithm. Private storage paths that are symlinks or resolve inside the public document root are rejected.

### Medium — publication error handling depended on `exit`

**Previously fixed and preserved:** publication failures use the internal throwable path, rollback remains under the exclusive lock, and the HTTP route maps failures back to the existing JSON `507 storage_failed` contract. No previously committed object is removed.

## Automated checks

Prepared regression scripts:

- `tools/p5-4-b3/security-hardening-regression.php` — malformed/wrong-type container rejection, invalid-quota rejection, and overlapping authentication attempts from separate worker processes; expects eight accepted attempts and two rate-limited responses.
- `tools/p5-4-b3/fault-injection.php` — existing four publication-failure cases.
- `tools/p5-4-b3/cli-library-regression.php` — existing CLI import contract.
- `tools/p5-4-b3/cli-qualification.php` — existing deterministic two-worker storage qualification.

Results for this run:

- `git diff --check`: **PASS** (pre-existing line-ending warning only).
- PHP syntax checks: **NOT RUN** — `php.exe` unavailable.
- Security-hardening regression: **NOT RUN**.
- Fault-injection regression: **NOT RUN**.
- CLI-library regression: **NOT RUN**.
- B3.3 concurrency qualification: **NOT RUN**.

Historical results cited in the task remain historical and were not re-claimed as current execution evidence.

## Remaining risks and limitations

- IP-based limiting is bypassable through distributed addresses and can affect users behind shared NAT; no trusted proxy headers are accepted.
- The limiter is filesystem-based and depends on reliable private-directory locking and write/rename behavior on LiteSpeed shared hosting.
- Crash consistency after power loss is not demonstrated; atomic rename is preserved but directory durability is not guaranteed.
- Real HTTP behavior, reverse-proxy headers, CloudLinux limits, and LiteSpeed request handling remain unverified in this run.

## Private-host qualification plan

1. Confirm PHP 8.1, private root mode 700, writable lock/temp files, and document-root separation.
2. Run syntax checks and CLI-library regression privately.
3. Run security-hardening and fault-injection scripts with synthetic data only.
4. Exercise login attempts from one real client address and verify the 9th attempt returns generic JSON `429 rate_limited`, then verify expiry after 900 seconds using a controlled test clock or isolated test fixture.
5. Perform approved HTTP checks for malformed container fields, invalid configuration, authentication, CSRF, Origin, and request limits.
6. Remove only the manifest-listed qualification directory and confirm zero residue.

## Proposed release artifact manifest

- `api/backup-v1.php`
- `api/.htaccess`
- `api/config.example.php`
- `tools/p5-4-b3/cli-library-regression.php`
- `tools/p5-4-b3/fault-injection.php`
- `tools/p5-4-b3/security-hardening-regression.php`
- `tools/p5-4-b3/cli-qualification.php`
- `tools/p5-4-b3/run-qualification.sh`

No secrets, recovery keys, production data, or generated test storage belong in the release artifact.

## P5.4-D3 host compatibility correction

**FIXED/PREPARED:** the security regression harness no longer uses `escapeshellarg()`, `proc_open()`, shell commands, or subprocess creation. The host-compatible runner uses `pcntl_fork()` and `pcntl_waitpid()` only, writes child results into the disposable private directory, verifies normal child exit statuses, and uses bounded parent-side reaping with termination fallback. Child shutdown handlers cannot remove the shared directory because cleanup is parent-PID guarded.

The harness still covers wrong-type container rejection, invalid quota configuration, session-independent rate limiting, and ten overlapping authentication workers (expected eight accepted and two rate-limited). **NOT RUN:** PHP execution remains unavailable in the local Windows environment.

## P5.4-D4 final host-safe correction

**FIXED/PREPARED:** all `posix_kill()` usage was removed. The harness now relies only on `pcntl_waitpid()` with the `WNOHANG` constant. On timeout or failure it writes a private shutdown marker, waits for cooperative child exit, verifies every child status, and refuses to delete the test directory while any child remains unreaped. It deliberately does not claim that cooperative cancellation can stop a blocked or unresponsive child. If a child remains alive after the bounded grace period, the run fails closed and leaves the directory for manual qualification cleanup.

`pcntl_kill()` is not assumed or required; no forced-termination API is used by the harness. Invalid-container and invalid-quota children capture the API's JSON-and-exit behavior through a child shutdown result file, while the parent requires normal exit status and exact error identifiers.
