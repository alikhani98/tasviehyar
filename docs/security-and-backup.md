# Security and Backup

- Keep the app local-first.
- Store data in IndexedDB through Dexie.
- Prefer append-only audit records for important events.
- Avoid hidden mutation paths that make financial history hard to explain.
- Preserve enough metadata for manual backups and recovery.
- Do not add concealment features or transaction-falsification workflows.
