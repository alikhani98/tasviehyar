# ALPHA-01 / P5.2 — PHP API Verification

## Initial state

**VERIFIED.** Existing uncommitted P1–P5.1 changes were preserved on `codex/alpha-01-p1`. The P5.1 PHP handler and `.htaccess` were inspected before verification.

## Runtime discovery and setup

**VERIFIED.** No PHP executable existed initially in PATH or common XAMPP, Laragon, Scoop, tools, `Program Files`, or user-local locations. With approval, the official `php-8.1.34-nts-Win32-vs16-x64.zip` was downloaded from `https://windows.php.net/downloads/releases/`, SHA-256 captured as `9CFE246CB144076C16F5913A3EF88A474C3DD7E60F0F0C8BB95FAF68674016CC`, and extracted to temporary `.tmp-php81`. No PATH, registry, or global configuration was modified. `php -v` reported PHP 8.1.34 NTS.

## Static security review and fixes

**VERIFIED.** The handler uses mandatory private storage, strict container validation, session authentication/rotation, Secure/HttpOnly/SameSite cookies, CSRF and same-origin checks, HTTPS enforcement outside localhost, bounded bodies, random IDs, atomic stage/rename, SHA-256 metadata, quota checks, no-store responses, and generic errors.

**FIXED.** Object/metadata symlinks are rejected before use and ignored in quota accounting. Local-host detection handles `host:port`. Private-root resolution occurs after authentication so unauthenticated requests do not expose storage configuration failures.

## Executed tests

**VERIFIED.** Syntax and local server commands:

```powershell
php -l api/backup-v1.php
php -S 127.0.0.1:8091 -t . .tmp-server-router.php
```

Result: `No syntax errors detected`.

**VERIFIED.** Synthetic localhost HTTP suite passed:

`PASS auth csrf origin malformed upload list download quota delete missing`

Coverage included unauthenticated rejection, login success, CSRF rejection, invalid-origin rejection, malformed JSON, encrypted-container upload, listing, byte-for-byte download equality, quota exhaustion (`507`), manual deletion, and nonexistent-object rejection.

**FAILED / HOST CONFIGURATION REQUIRED.** A 33,554,433-byte request hit the PHP development server default `post_max_size=8M` before application code. PHP emitted runtime warnings and returned an unusable `200` response instead of API JSON `413`. This is a SAPI/request-limit issue; staging must set request limits above the API 32 MiB maximum and disable `display_errors`, then retest.

**NOT EXECUTED.** True concurrent upload races, disk-full simulation, symlink attack execution, and LiteSpeed/cPanel behavior remain pending.

## Remaining limitations

- cPanel/LiteSpeed rewrite, session, request-size, filesystem permission, and `open_basedir` behavior remain unverified.
- Upload idempotency and concurrent metadata coordination require staging tests.
- The local oversized-body result demonstrates why host request limits must be explicitly qualified.

## Status

**PARTIAL PASS / HOST CONFIGURATION BLOCKER.** PHP 8.1 syntax and core local API tests pass. Oversized-request behavior requires explicit staging configuration before P5.2 is complete. No deployment, hosting modification, React integration, schema change, Service Worker change, financial logic change, commit, or merge occurred.

## P5.2.1 request-limit hardening

**FIXED.** The application now reads `php://input` incrementally in 8 KiB chunks with a hard `maximumBytes + 1` bound. Login/JSON control requests remain capped at 1 MiB; encrypted upload bodies remain capped at exactly 32 MiB (`33,554,432` bytes). A body exceeding the application limit returns JSON `413` with `{"ok":false,"error":"backup_too_large"}` once PHP passes the request to the script. `display_errors=0` and `log_errors=1` are set by the handler as defense in depth.

Local test server configuration:

```powershell
php -d post_max_size=40M -d memory_limit=128M -d display_errors=0 -S 127.0.0.1:8092 -t . .tmp-p52-router.php
```

Observed boundary results with authenticated synthetic requests:

- `33,554,431` bytes: application reached; `400 malformed_container` (body below limit but intentionally not a valid container).
- `33,554,432` bytes: application reached; `400 malformed_container` (exact limit, intentionally not a valid container).
- `33,554,433` bytes: `413 backup_too_large`.

An isolated server with `post_max_size=8M` was also exercised. PHP’s handling of a request rejected before script processing is SAPI-dependent; the application cannot guarantee a JSON response in that case. Hosting must set `post_max_size` and web-server body limits above 32 MiB, keep `memory_limit` safely above the request limit, and disable `display_errors`. The server/proxy may return its own `413` or another generic rejection before PHP runs; this is explicitly outside application control.

**VERIFIED.** PHP syntax, login/session establishment, CSRF/origin checks, and the new boundary tests passed under PHP 8.1.34. The complete P5.2 authenticated HTTP regression suite was executed before the request-reader change and had passed; the post-change smoke path revalidated login plus the boundary requests. **NOT VERIFIED:** concurrent uploads, disk-full behavior, and LiteSpeed/cPanel enforcement.
