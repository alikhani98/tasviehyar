# ALPHA-01 / P5.4-B3 — Private CLI Qualification Runner

## Status

**PREPARED.** A self-contained PHP CLI runner and shell wrapper are ready for owner-authorized execution on the qualified cPanel/CloudLinux account. **NOT EXECUTED:** no hosting connection, SSH command, upload, public route, or production access was used in B3.1.

## Initial state

**VERIFIED.** Existing uncommitted P1–P5.3 changes were preserved. The runner imports only the existing API storage primitives under the explicit environment flag `TASVIEHYAR_CLI_LIBRARY=1`; normal HTTP bootstrap is skipped only in CLI library mode. The normal web route remains unchanged.

## Files

- `tools/p5-4-b3/cli-qualification.php` — bounded, private, two-worker qualification runner.
- `tools/p5-4-b3/run-qualification.sh` — documented execution wrapper that creates a unique approved private path.
- `api/backup-v1.php` — minimal CLI-library guard and atomic metadata publication; no CLI guard behavior changes when the flag is absent.

## Prerequisites

- PHP CLI 8.1.34 or compatible.
- `pcntl_fork`, `flock`, `rename`, `random_bytes`, and `hash_file` available.
- `umask` support and a private directory base owned by the operator.
- No public HTTP route required.
- A synthetic environment only; never set production password hashes or real backup paths.

Check before execution:

```sh
php -v
php -m | grep -E 'pcntl|session|standard|hash'
php -l api/backup-v1.php
php -l tools/p5-4-b3/cli-qualification.php
```

## Exact execution

The wrapper uses `/home/jtphyqur/.private`, generates a unique name, applies `umask 077`, validates the direct-child path, and passes it to the runner:

```sh
chmod 700 tools/p5-4-b3/run-qualification.sh
tools/p5-4-b3/run-qualification.sh
```

Equivalent explicit invocation:

```sh
QUAL=/home/jtphyqur/.private/tasviehyar-qual-20261109-$(openssl rand -hex 8)
umask 077
php tools/p5-4-b3/cli-qualification.php --path="$QUAL"
```

The runner sets a 64 KiB quota, uses only a small synthetic encrypted-container-shaped payload, and never performs the optional 32 MiB test. Total test storage is far below 100 MiB.

## Assertions

The runner records the parent PID before installing cleanup, registers cleanup only for that PID, installs bounded signal/barrier/worker timeouts, and waits for every child before cleanup. The runner uses `pcntl_fork` to create exactly two child workers. Both signal `ready-*`; the parent releases a shared `go` barrier; each child enters the API `storage_lock()` exclusive section. Assertions include:

- exactly one concurrent upload succeeds under the intentionally one-object quota;
- quota reservation occurs while holding the exclusive lock;
- successful ciphertext and metadata publication are both same-directory temporary-file plus atomic-rename operations;
- exactly one structured `success` outcome and one structured `quota_rejected` outcome are required;
- worker PIDs, exit status, lock-acquisition timestamps, and lock-release timestamps are required evidence;
- no `.stage-*` residue remains;
- corrupt metadata is excluded from listing;
- the actual winning object ID, size, SHA-256, and complete metadata are checked;
- only that known winner's metadata is corrupted, excluded from listing, restored, and rechecked;
- manifest records the unique path and resource cap;
- cleanup removes known files, barrier files, lock file, and the exact validated directory, then verifies zero residue.

The API’s existing lock is also used by list/download/delete paths in normal HTTP mode. B3’s CLI run directly exercises the shared storage primitives and proves actual process overlap; it does not claim LiteSpeed request routing behavior.

## Fault and failure procedure

The API’s test-only hooks remain disabled unless explicitly set in the isolated process environment:

```sh
TASVIEHYAR_TEST_FAULT=stage
TASVIEHYAR_TEST_FAULT=rename
TASVIEHYAR_TEST_FAULT=metadata
```

Run each as a separate disposable path and verify exit/error, no valid object publication, no stage residue, and cleanup. Do not combine fault injection with production credentials or a shared directory.

## Cleanup and rollback

The runner registers cleanup and uses a manifest plus explicit known filenames. It refuses paths outside the approved private base, refuses pre-existing paths, refuses NULs/path separators in the generated name, and never performs recursive deletion. If interrupted, inspect the exact printed/known qualification path, remove only its manifest-listed and known `.stage-*`, `.barrier/*`, `*.backup`, `*.meta.json`, and `.storage.lock` files, then remove the empty directory. Do not use `rm -rf` against a variable or broad path.

## Expected result format

Successful execution prints one JSON line with `status: "PASS"`, the two structured worker outcomes, verified winner integrity, `contention: true`, `cleanup: "verified"`, and `httpContract: "not-tested"`.

```text
{"status":"PASS","...":"...","httpContract":"not-tested"}
```

Any failed assertion exits nonzero and cleanup reports residual files. A missing extension, unsafe path, pre-existing path, failed lock, abnormal child exit, missing result, ambiguous outcome, or failed cleanup is a hard failure. PASS is printed only after cleanup has succeeded.

## Host qualification gates

1. **CLI-only gate:** owner approves one disposable private path and synthetic credentials.
2. **Concurrency gate:** owner confirms `pcntl_fork` and filesystem `flock` semantics; exactly two workers only.
3. **HTTP/LiteSpeed gate:** separate approval required; not part of this runner. Do not create a web-facing endpoint in B3.
4. **Near-limit gate:** separate approval required; not run by default.

## Remaining risks

**NOT VERIFIED:** actual host execution, shared-filesystem crash durability, LiteSpeed/FPM session behavior, web request limits, ModSecurity/WAF, `open_basedir`, quota/inode enforcement, and Service Worker/cache behavior. The wrapper intentionally does not claim those properties.

## B3.1 corrections

**FIXED/PREPARED:** child shutdown handlers cannot perform parent cleanup because cleanup records the original PID and checks it on every invocation. Parent cleanup waits for every child, has bounded barrier/worker timeouts, handles signals and abnormal exits, requires structured outcomes, and prints PASS only after zero-residue cleanup succeeds.

**FIXED/PREPARED:** metadata publication now uses a same-directory temporary file followed by atomic rename, matching ciphertext publication. The runner verifies the actual winning object ID, exact size, SHA-256, metadata fields, corrupts only that known metadata file, confirms listing exclusion, restores it, and then performs cleanup.

**CLI-library safety:** the guard requires both `PHP_SAPI === 'cli'` and `TASVIEHYAR_CLI_LIBRARY=1`; HTTP requests cannot activate it, and normal web authentication/session/HTTPS/CSRF bootstrap remains unchanged.

**NOT EXECUTED:** PHP syntax or CLI runner execution on the host. Local Windows PHP concurrency remains unavailable; no real host concurrency claim is made.

## B3.2 safety corrections

**FIXED/PREPARED:** the runner now uses an explicit child-reaping state machine. It records every child PID, handles `waitpid` results `0` and `-1`, uses bounded normal and termination deadlines, sends SIGTERM followed by a bounded grace period and SIGKILL when available, and refuses cleanup while child state is unresolved. Any failure path reaps known children before cleanup; PASS is emitted only after cleanup succeeds.

**FIXED/PREPARED:** the metadata corruption path tracks the known winner and includes `*.corrupt` residue in exact-path cleanup. The winner’s object ID, size, SHA-256, metadata, and exit evidence are required before corruption testing proceeds.

**FIXED/PREPARED:** workers record pre-lock time, acquisition time, release time, and wait duration. Worker 1 deliberately holds the exclusive lock for 250 ms; the runner requires the second worker to demonstrate a wait greater than 50 ms. It requires exactly one success, exactly one quota rejection, valid structured results, and exit code 0 for both expected outcomes.

**SCOPE LIMIT:** this runner exercises storage primitives only. It does not claim the complete HTTP upload contract, authentication, CSRF, Origin, LiteSpeed routing, or web SAPI behavior. The output explicitly reports `httpContract: not-tested`.

## B3.3 corrections

**FIXED/PREPARED:** `api/backup-v1.php` now returns immediately after defining its constants and reusable functions when, and only when, both `PHP_SAPI === 'cli'` and `TASVIEHYAR_CLI_LIBRARY=1` are true. The CLI-library regression script is `tools/p5-4-b3/cli-library-regression.php`; it requires the API and then verifies execution continues and expected library symbols exist. HTTP requests cannot activate this mode, so normal session, HTTPS, authentication, CSRF, and routing bootstrap remain unchanged.

**FIXED/PREPARED:** lock contention is now deterministic. Two workers first report readiness. Worker 1 acquires the exclusive lock and writes `worker1-held`; only then does the parent write `worker2-go`. Worker 2 records `preLockAt`, writes `worker2-attempt`, and calls `storage_lock()`. Worker 1 holds the lock for a bounded 250 ms after the attempt signal, then releases it. The runner requires the event timestamps to be ordered, requires one success and one quota rejection, and requires exactly one worker to show a wait greater than 50 ms. Missing, malformed, or ambiguous evidence fails closed.

**NOT EXECUTED:** this Windows environment has no `php` executable and no `sh` executable available on PATH, so PHP syntax checks, CLI-library execution, and the private multi-process runner were not run. No host connection or HTTP test was attempted. Host concurrency and LiteSpeed behavior remain unverified.

The intended local commands are:

```sh
php -l api/backup-v1.php
php -l tools/p5-4-b3/cli-library-regression.php
php -l tools/p5-4-b3/cli-qualification.php
sh -n tools/p5-4-b3/run-qualification.sh
php tools/p5-4-b3/cli-library-regression.php
php tools/p5-4-b3/fault-injection.php
php tools/p5-4-b3/cli-qualification.php --path=/home/jtphyqur/.private/tasviehyar-qual-<unique>
```

## B3.4 metadata failure safety

**FIXED/PREPARED:** publication is now centralized in `publish_backup_transaction()`. Storage publication failures use a throwable internal exception rather than the HTTP `fail()`/`exit` path. The HTTP upload route converts that exception back to the existing JSON `507 storage_failed` contract. The transaction holds the exclusive storage lock across quota check, ciphertext publication, metadata publication, and rollback. If metadata publication fails, only the transaction's newly published ciphertext is removed; pre-existing or colliding paths are rejected rather than deleted. Temporary metadata and stage files are removed, and cleanup failure fails closed as `507 storage_failed`.

**PREPARED:** `tools/p5-4-b3/fault-injection.php` covers stage write, stage rename, metadata write, metadata rename, and a valid upload after each injected failure. Each case checks the `507 storage_failed` outcome, unchanged quota usage, preservation of a baseline object, absence of stage/metadata temporary residue, lock reacquisition, and subsequent successful publication.

**NOT EXECUTED:** PHP is unavailable in the current local environment, so the fault runner, syntax checks, CLI-library regression, and B3.3 concurrency runner were not executed. No production readiness claim is made.

## B3.4/D6 host-safe reaping correction

**FIXED/PREPARED:** `cli-qualification.php` no longer references `posix_kill()` or assumes `pcntl_kill()`. Timeout and failure paths write a private `.shutdown` marker and wait with bounded `pcntl_waitpid(..., WNOHANG)` polling. Cooperative workers check the marker while waiting at barriers. Cleanup refuses to remove the qualification directory while any child remains unreaped.

**LIMITATION:** a child blocked inside a system call such as `flock()` may not observe the marker. The runner does not claim cooperative cancellation can terminate such a child; it fails closed and leaves the disposable directory for manual cleanup if reaping cannot be proven. PASS still requires every child’s normal exit status, all existing contention/quota/integrity assertions, and verified zero residue.
