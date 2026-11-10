# ALPHA-01 / P5.4-A — Isolated Host Qualification Plan

## 1. Initial Git state

**VERIFIED.** Branch `codex/alpha-01-p1` contains the existing uncommitted P1–P5.3 work. This preparation phase does not modify production, hosting, React, Service Worker, schema, financial logic, or backup formats.

## 2. Required qualification files

Use a temporary, operator-created staging workspace only. The package under review is:

- `api/backup-v1.php`
- `api/.htaccess`
- `api/config.example.php`
- `docs/alpha-01-p5-1-php-api-report.md`
- `docs/alpha-01-p5-2-php-verification.md`
- `docs/alpha-01-p5-3-storage-verification.md`

Do not expose diagnostic scripts under the production document root. If HTTP qualification is approved, copy only the API route and a temporary router into an isolated staging path, with a random non-production directory and no production credentials.

## 3. Isolation strategy

**PREPARED.** Qualification uses:

- a unique private directory such as `/home/jtphyqur/.private/tasviehyar-qual-<UTC>-<random>/`;
- a separate PHP environment file outside the document root containing only a synthetic password hash and quota;
- synthetic encrypted containers generated locally from the checked-in demo fixture;
- a per-run request ID and cleanup manifest;
- a hard byte quota, request limit, timeout, and concurrency cap;
- no connection to `https://hesab.54i.ir` until a separate approval explicitly authorizes isolated HTTP testing.

The previously reported cPanel/CloudLinux/LiteSpeed/PHP 8.1.34 facts are **NOT VERIFIED for this run** and must be re-confirmed read-only.

## 4. A — Read-only host inspection

**Approval gate:** no upload, configuration change, or endpoint creation.

Run through the hosting control panel or an approved shell session:

```sh
php -v
php -m
php --ini
php -r 'printf("SAPI=%s\nDOCROOT=%s\n", PHP_SAPI, $_SERVER["DOCUMENT_ROOT"] ?? "");'
php -r 'foreach (["post_max_size","upload_max_filesize","memory_limit","max_execution_time","open_basedir","session.save_path","display_errors","log_errors"] as $k) printf("%s=%s\n", $k, ini_get($k));'
df -h
df -i
umask
```

Record only versions, limits, SAPI, effective document root, filesystem capacity/inodes, and permission facts. Never print environment secrets, session contents, password hashes, or real backup names.

Verify that the intended private directory is outside the document root and that the web user can access it without making it web-readable. Do not create it during read-only inspection.

## 5. B — Private-directory CLI qualification

**Approval gate:** owner authorizes creation of one disposable private directory and synthetic files only.

Create the directory with restrictive permissions, for example:

```sh
QUAL="/home/jtphyqur/.private/tasviehyar-qual-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8)"
install -d -m 700 "$QUAL"
export TASVIEHYAR_BACKUP_PRIVATE_DIR="$QUAL"
export TASVIEHYAR_BACKUP_QUOTA_BYTES=104857600
export TASVIEHYAR_PASSWORD_HASH='<synthetic password_hash output; never production>'
php -l api/backup-v1.php
```

CLI checks:

1. Generate a synthetic encrypted container with the existing browser engine; never include a Recovery Key in the host workspace.
2. Exercise upload/list/download/delete through a local PHP runner or approved staging route.
3. Confirm raw download SHA-256 equals the uploaded bytes.
4. Confirm `.stage-*` files do not remain after success or injected failure.
5. Create malformed metadata, missing ciphertext, symlinked ciphertext, and symlinked metadata in the disposable directory; confirm list/download reject them without following links.
6. Set the directory read-only and rename it away; confirm generic storage errors and no stack traces.
7. Set a small quota and verify concurrent reservations cannot exceed it.

The current handler’s test-only fault variable may be used only in the disposable run:

```sh
TASVIEHYAR_TEST_FAULT=stage
TASVIEHYAR_TEST_FAULT=rename
TASVIEHYAR_TEST_FAULT=metadata
```

Unset it before any normal qualification or deployment test.

## 6. C — Optional isolated HTTP/LiteSpeed qualification

**EXPLICIT APPROVAL REQUIRED.** Do not modify `/api`, `.htaccess`, PHP selectors, LiteSpeed cache rules, DNS, or the production document root. Use a temporary staging directory under the existing origin only after ALPHA and hosting-owner approval.

Required controls:

- synthetic credentials and synthetic containers only;
- `display_errors=0`, `log_errors=1`;
- `post_max_size` and proxy body limits above 32 MiB;
- `memory_limit` safely above the request limit;
- no-store and no-cache headers observed at the client;
- API route excluded from Service Worker, LiteSpeed, CDN, and browser caching;
- private directory outside document root and denied by direct HTTP access;
- request timeout and rate limits recorded before testing.

Use a temporary path such as `/api/backup-v1-qual-<random>.json` only if the owner authorizes it. Delete the route and all temporary files immediately after the run. Never test through `https://hesab.54i.ir` without explicit production qualification approval.

## 7. Concurrency test design

The Windows PHP built-in server is single-threaded and must not be used as concurrency evidence. Use PHP-FPM/LiteSpeed or another approved multi-process SAPI with at least two workers.

Bounded tests:

```sh
# Example only; use the approved runner and synthetic fixture.
seq 1 2 | xargs -n1 -P2 -I{} curl --fail-with-body .../upload
```

Capture request IDs, status codes, and final private-directory inventory. Assert:

- two simultaneous uploads create two complete immutable objects;
- quota is never exceeded;
- no `.stage-*` or partial metadata is listed;
- list/upload and list/delete observe only complete metadata;
- download/delete returns either a complete verified object or a generic not-found result;
- same-session requests serialize safely without leaking CSRF/session state.

Never run uncontrolled load tests. Maximum parallelism: two workers, one short test batch.

## 8. Filesystem-failure test design

Use deterministic fault injection or disposable filesystem permissions only:

- stage open/write failure;
- final rename failure;
- metadata publication failure;
- missing/unwritable private directory;
- corrupted metadata JSON;
- missing ciphertext;
- symlinked object/metadata;
- quota exhaustion;
- interrupted stage file followed by a manual inventory check.

For each case record status, JSON error ID, directory listing, and whether any valid backup was altered. The expected invariant is no incomplete object in list and no automatic deletion of valid backups.

## 9. Near-limit valid backup design

Generate a structurally valid encrypted container whose JSON UTF-8 size is approximately 32 MiB minus 1 KiB, exactly 32 MiB, and 32 MiB plus 1 byte. Use a large valid Base64URL ciphertext field while preserving the strict approved wrapper fields. Test:

- below-limit upload succeeds;
- exact-limit upload reaches application validation;
- above-limit request receives application `413` if PHP/proxy limits permit application execution;
- if proxy/PHP rejects first, record its status/body as infrastructure behavior, not an application guarantee;
- list/download SHA-256 equality and manual deletion.

Never decrypt or transmit the synthetic Recovery Key to the host.

## 10. Resource limits

Before HTTP qualification, record and cap:

- request body: application maximum 32 MiB;
- `post_max_size`: greater than 32 MiB, with margin;
- `memory_limit`: greater than request limit and measured peak;
- `upload_max_filesize`: not relied upon for raw-body requests;
- execution timeout and LiteSpeed request timeout;
- private quota and inode budget;
- two-worker concurrency maximum;
- test duration and temporary object count.

## 11. Cleanup and rollback

After every run:

```sh
find "$QUAL" -maxdepth 1 -type f -print
rm -rf -- "$QUAL"
```

Use an explicit, unique qualification path only. Verify it no longer exists, verify no temporary route or `.htaccess` remains, and confirm no production file timestamps changed. If any test route or setting was enabled, disable it first, then remove the route and restore the prior configuration. Do not delete real backups, rotate production credentials, or clear application storage as rollback shortcuts.

## 12. Approval gates

1. ALPHA approval for read-only host inspection.
2. Hosting-owner approval for creating one disposable private directory.
3. Separate ALPHA approval for any web-facing isolated route.
4. Separate approval for multi-process LiteSpeed/FPM concurrency testing.
5. Explicit stop if private storage cannot be proven outside document root, if limits cannot be raised above 32 MiB, or if cache bypass cannot be verified.

## 13. Remaining risks

**NOT VERIFIED:** LiteSpeed rewrite precedence, `flock()` semantics on the hosting filesystem, crash durability of rename, session locking under the actual SAPI, ModSecurity/WAF limits, proxy body limits, `open_basedir`, inode quotas, and Service Worker/cache behavior on the production origin.

**PREPARED.** This document provides the isolated CLI-first and optional HTTP qualification procedure. No host command, upload, production access, or configuration change was executed in P5.4-A.
