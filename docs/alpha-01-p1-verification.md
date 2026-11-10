# ALPHA-01 P1 — Local backup and restore hardening

Stage branch: `codex/alpha-01-p1`, based on `ed6e32f`. This stage changes local backup/restore and the app service worker. It adds no server endpoint, dependencies, schema migration, financial calculation, allocation rule, audit event mutation outside the existing restore, or deployment. Dexie schema **3**, JSON backup format **1**, Asia/Tehran business date, and target origin `https://hesab.54i.ir` are unchanged.

## Changed files

| File | Change |
| --- | --- |
| [Backup service](../src/services/backup-service.ts) | One read transaction across the eight stores. Restore history is recorded after commit on a best-effort basis and its result is returned separately. Unavailable browser history storage no longer prevents using backup or restore. |
| [Backup/restore screen](../src/features/backup-restore/BackupRestore.tsx) | Distinct Persian messages for failure before commit, successful commit, and successful commit with a history warning. Data refresh runs for either committed outcome. |
| [Service worker](../public/sw.js) | Excludes the private API namespace and direct backup-handler path from all cache handling. Skips caching no-store and redirected responses, and isolates shell lookups to the new v5 cache. |
| [Backup service tests](../src/services/__tests__/backup-service.test.ts) | Controlled two-connection write during export, history read/write exceptions after commit, and assertion of successful history logging. Existing all-store round-trip and transaction rollback checks remain. |
| [Backup/restore UI tests](../src/features/backup-restore/BackupRestore.test.tsx) | Covers all three outcomes, the single in-flight submission guard, and whether each outcome emits the refresh event. |
| [PWA tests](../src/pwa.test.ts) | Executes the worker in a VM with Cache Storage/network doubles and covers API bypass, stale responses, no-store, redirects, normal static caching, offline fallback, and old app cache retirement. |
| This report | Scope, evidence, DirectAdmin staging checklist, and rollback. The existing P0 audit and production ZIP were carried over untouched. |

## Before and after

| Behavior | Before | After |
| --- | --- | --- |
| Concurrent financial write | Separate store reads could straddle a multi-store commit. | One Dexie readonly transaction scopes all eight stores, so a conflicting writer cannot commit between reads. Hashing and serialization follow the completed read transaction. No record filtering, field transformation, or change to v1 serialization was introduced. The same reader gives coherent preview counts. |
| Transaction rejects | Restore rejected; UI displayed the thrown error. | Existing single read/write transaction still clears and repopulates all eight stores together. A rejection is shown as failure before commit; the app does not claim a successful rollback. The existing injected late-write test independently checks the prior all-store export. |
| Restore commits | History write or repeated in-memory validation could still reject the operation. | Committed data triggers a refresh and success message; a failed history write adds a separate warning. The duplicate post-commit check of the input bundle was removed; preflight inspection remains. The operation timestamp is captured before the transaction so timestamp generation cannot fail after commit. |
| Backup history storage is unavailable | Storage access could fail at initialization or keep an already generated backup from reaching the download UI. | History access is deferred and treated as ancillary. The file is still available and restore can proceed. History is browser metadata, separate from financial `auditEvents` in the snapshot. |
| Private API request | v4 excluded `.json` but could cache and replay other private GET responses; HTTP response headers were not checked. | v5 bypasses the worker for same-origin `/api`, everything below `/api/`, and `/backup.php` including path info, regardless of method, mode, query or response headers. The path check handles encoded names and case. The planned external path remains `/api/backup-v1.json`; never add an unreviewed alias. |
| Static app and offline | Shell/icon precache, network-first navigation and cache-first static assets. | Same shell URLs and normal caching strategies. The worker skips no-store responses, redirects and private final URLs; navigation cannot write those bodies into the cached index. v5 reads only its own cache and retires earlier TasviehYar shell caches without deleting unrelated caches. Runtime assets are cold after activation; warm the new release online before relying on offline access. |

## Verification

- `npm.cmd test -- --cache=false`: **27 files, 92 tests passed**. Lint and the TypeScript/Vite build passed. The build reported dependency annotation and bundle-size warnings; the temporary build output was removed after verification.
- The local backup tests use jsdom and fake IndexedDB. The concurrent test opens a second connection and queues a native write after the first read but before the invoice read. The export matches the prior snapshot exactly; a later export includes the new party, invoice and audit event. The test does not depend on sleeps.
- The restore tests verify normal commit and logging, pre-commit rejection with all-store data preserved in the injected late-write case, and a committed database that matches the input even when history reads or writes throw. The UI checks the Persian outcome message and dispatches refresh only for committed results.
- The worker tests execute the checked-in script. They seed private responses in both old and current caches, verify bypass without cache lookup for API reads, writes and navigation, and verify that no-store responses are not written and are not replayed offline from the old shell cache. They also cover normal static caching, offline index fallback, and old app cache retirement.
- Worker evidence is local to the VM tests. Cache bypass does not itself verify the browser HTTP cache, reverse proxy/CDN, PHP routing, authentication or access controls on the host. No live browser, staging PHP, or production hosting change is claimed.

## DirectAdmin staging: access required

**Verified locally:** no staging host, deployment configuration, PHP handler source or authorized hosting connector was found in the workspace. PHP CLI was unavailable locally, and the production hostname did not resolve from this shell. These observations do not establish anything about production availability or host configuration. No production HTTP upload, filesystem operation, credential check or configuration change was attempted.

**Unknown on the actual account:** all host-side checks below. A staging hostname and authorized read-only configuration access (or evidence from the host operator), plus a disposable staging vhost/probe, are needed. A local mock server would not establish these facts. DirectAdmin documents that effective PHP settings depend on the [active PHP handler](https://docs.directadmin.com/webservices/php/php-options.html); the PHP manual documents [upload and request settings](https://www.php.net/manual/en/ini.core.php).

| Check | Staging evidence required |
| --- | --- |
| PHP runtime and extensions | Effective web SAPI/version and modules/capabilities needed for sessions, JSON, hashing, random bytes and password verification. Record effective settings through an authorized private mechanism; CLI alone is not evidence of the web runtime. |
| Proposed route and HTTPS | Test exact `/api/backup-v1.json` externally. The request reaches PHP via an internal route instead of the SPA index, static file, external redirect or public handler alias. Verify certificate and HTTPS enforcement; no authentication/session or upload accepted over HTTP. |
| Private filesystem and public denial | Verify effective web PHP identity, real private path outside every document root/alias, permissions, `open_basedir`, symlink policy, temporary storage, and same-volume publication. Confirm direct public requests for synthetic files are denied across all applicable vhosts and aliases. |
| Request size limits | Check proxy/WAF, PHP `post_max_size`, `upload_max_filesize`, timeouts, temporary space, and account quota. Verify a synthetic request below the chosen limit succeeds and an oversize request fails without leaving a published file. |
| Authentication | Demonstrate PHP session support and secure, HttpOnly, scoped cookies, correct unauthenticated responses, Origin/CSRF controls for mutations, and that logout prevents access. Do not use real credentials or data in test artifacts. |
| Upload and download | In the isolated staging vhost, round-trip bounded synthetic bytes, compare their digest, and verify authorized attachment/no-store headers and denial when unauthenticated. Inspect Cache Storage and the shell index with a v5-controlled browser during online, sign-out and offline attempts. |

This is a staging verification plan, not authorization to implement the server-backup feature. Do not promote a server route or handle real financial data before ALPHA approval and staging evidence.

## Remaining risks and rollback

- This scope does not add a mandatory pre-restore checkpoint, a multi-tab restore lock, an import file-size cap, file authenticity, or proof that a browser download was saved. These are unchanged from the audit. Local v1 JSON still requires safe storage, and storage history is still best effort.
- Offline behavior for uncached lazy chunks, the actual browser worker upgrade, and real browser quota and interruption remain unverified. The service worker guards the reserved API paths; a new private path outside that namespace would need review before use. PHP staging is an open gate.
- There has been no deployment. To roll back locally, revert only the P1 changes on the stage branch; preserve the audit, existing ZIP and all IndexedDB data. If a release is later authorized and must be rolled back, first take and verify a local v1 backup, then restore the previous matching static artifact and assets on the same HTTPS origin. Confirm worker activation, warm the app online, and check balances, counts, audit events and offline launch. If a private route has since been enabled, disable it before reverting the worker or retain the hardened worker; do not reintroduce v4 API caching. Do not clear site data or restore a financial snapshot solely to roll back application code.

**Approval boundary:** stop after local implementation and verification. Leave server-backup implementation, production hosting and retention/deletion untouched pending ALPHA approval.
