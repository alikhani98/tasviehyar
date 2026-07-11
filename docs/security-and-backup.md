# Security and Backup

- Keep the app local-first.
- Store data in IndexedDB through Dexie.
- Prefer append-only audit records for important events.
- Avoid hidden mutation paths that make financial history hard to explain.
- Preserve enough metadata for manual backups and recovery.
- Do not add concealment features or transaction-falsification workflows.
- Backups are local files, not cloud uploads.
- Backup files contain sensitive financial information and should be stored in multiple safe locations.
- Restore is replace-all, so validation must happen before any destructive write.
- Restore should be transactional and leave the existing database unchanged if validation or writes fail.
- The installable shell should not cache exported backup files.
- Browser storage helps local persistence, but paper records remain part of the pilot safety plan.
