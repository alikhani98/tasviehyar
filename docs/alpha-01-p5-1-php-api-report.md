# ALPHA-01 / P5.1 — Secure PHP Encrypted Backup API

## 1. Initial state

**VERIFIED.** Branch: `codex/alpha-01-p1`. The working tree contained the existing uncommitted P1–P4.5 source, tests, reports, and production ZIP. No existing PHP implementation was present. `php -v` was unavailable on the development machine.

## 2. Changed-file inventory

- `api/backup-v1.php` — isolated PHP 8.1-compatible same-origin API handler.
- `api/.htaccess` — exact `/api/backup-v1.json` rewrite and direct example-config protection.
- `api/config.example.php` — non-secret environment configuration guidance.
- `docs/alpha-01-p5-1-php-api-report.md` — this report.

No React, Dexie schema, Backup Format v1, Service Worker, financial logic, hosting, or production files were changed.

## 3. API contract

Canonical route: `/api/backup-v1.json`, dispatched by `action` query parameter.

| Action | Method | Auth/CSRF | Result |
|---|---|---|---|
| `status` | GET | none | API version and server time only |
| `login` | POST JSON `{password}` | none; rate-limited session attempts | Rotated session and CSRF token |
| `csrf` | GET | session | Current CSRF token |
| `logout` | POST | session + CSRF | Invalidates session |
| `list` | GET | session | Opaque IDs and bounded metadata |
| `usage` | GET | session | Used/quota bytes |
| `upload` | POST opaque JSON bytes | session + CSRF + same-origin | `201` after validation and atomic rename |
| `download&id=` | GET | session | Raw opaque bytes as attachment |
| `delete&id=` | POST | session + CSRF + same-origin | Manual deletion only |

All responses use `Cache-Control: no-store`, JSON errors (except raw download), `nosniff`, bounded IDs, and generic error identifiers. No CORS is enabled.

## 4. Authentication and CSRF

**IMPLEMENTED.** Authentication uses a single PHP session, `password_verify()` against the environment-provided `TASVIEHYAR_PASSWORD_HASH`, session ID rotation on login, `HttpOnly`, `Secure`, `SameSite=Strict`, `/api/` cookie path, generic authentication errors, and an eight-attempt/15-minute session rate limit. Unsafe requests require `X-CSRF-Token` and same-origin validation. The Recovery Key is not an authentication credential and is never accepted by PHP.

**NOT VERIFIED.** PHP session cookie behavior, HTTPS termination, LiteSpeed rewriting, and host-specific session storage require a PHP 8.1 staging runtime.

## 5. Private storage and quota

**IMPLEMENTED.** `TASVIEHYAR_BACKUP_PRIVATE_DIR` is mandatory; there is no public-directory fallback. The handler rejects a path inside `DOCUMENT_ROOT`, requires an existing writable directory, rejects symlinked object/metadata paths, generates 128-bit random object IDs, rejects paths/traversal, writes a stage file then renames atomically, stores SHA-256 metadata, enforces a configured byte quota, and never automatically deletes older objects. Metadata contains only opaque ID, dates, key ID, size, digest, and optional idempotency label. The server never parses or decrypts the inner financial payload.

## 6. Container validation

**IMPLEMENTED.** Uploads are bounded to 32 MiB and require the exact P4 container identifier/version, AES-256-GCM algorithm, v1/schema-3 metadata, canonical Base64URL, 12-byte nonces, 48-byte wrapped DEK, and authenticated ciphertext of at least a GCM tag. Unknown fields, unsupported versions, malformed JSON, oversized bodies, invalid IDs, and invalid encodings are rejected. The server does not validate or decrypt inner Backup Format v1.

## 7. Security threat model

Mitigations included: HTTPS enforcement except localhost development, no-store headers, same-origin/CSRF checks, session rotation, generic errors, no stack traces, no client filenames or paths, atomic publication, quota errors (`507`), size errors (`413`), authentication errors (`401`), CSRF/origin errors (`403`), and manual deletion only.

Remaining risks: a compromised same-origin frontend can capture keys; a server can replay, withhold, or delete opaque objects; filesystem permissions and LiteSpeed caching require staging verification; login rate limiting is session-local rather than distributed; and PHP upload behavior depends on host request limits.

## 8. Local test status

**BLOCKED.** `php -v` failed because PHP is not installed or on PATH. Therefore no PHP syntax check, built-in server run, HTTP integration test, filesystem permission test, quota test, or concurrency test is claimed.

Required commands once PHP 8.1 is available:

```powershell
php -l api/backup-v1.php
php -S 127.0.0.1:8089 -t .
```

Then execute synthetic-only HTTP tests for authentication, CSRF/origin failures, malformed/unsupported/oversized containers, upload/list/download byte equality and SHA-256, manual deletion, nonexistent deletion, quota exhaustion, stage cleanup, path traversal, private-path non-publicity, concurrent uploads, and absence of Recovery Key/plaintext processing.

## 9. Compatibility assessment

**INFERRED.** The implementation uses PHP 8.1 language/library features (`str_starts_with`, typed returns, `random_bytes`, `password_verify`, sessions, streams, `hash`) and avoids shell execution, databases, Redis, workers, and Node services. LiteSpeed/cPanel compatibility is contingent on verifying `.htaccess` rewrite precedence, PHP SAPI limits, `open_basedir`, session configuration, and private-directory ownership in staging.

## 10. Remaining P5.2/P6 requirements

- P5.2: authenticated client integration, idempotency replay behavior, staging concurrency/quota/disk-failure tests, and operator-facing listing/delete UX.
- P6: Service Worker `/api/` bypass verification in the deployed origin, real HTTPS same-origin cache tests, authentication/session rollout, upload/download outage behavior, and clean-profile remote recovery.
- Owner approval is required for password provisioning/reset, exact private path and quota, deletion semantics, and staging credentials.

## 11. Recommendation

**HOLD for staging qualification.** The isolated API design and source implementation are ready for review, but PHP execution and host-specific security controls remain unverified. Do not deploy or connect the React client until PHP 8.1 staging tests pass and ALPHA approves the authentication and storage configuration.
