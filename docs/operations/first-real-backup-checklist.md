# FIRST REAL BACKUP CHECKLIST FOR LSA GLOBAL

Use this checklist for the first real production-grade Supabase backup for LSA GLOBAL Internal OS.

## 1) Securely set `SUPABASE_DB_URL` (never commit, never paste in PRs)
- Set `SUPABASE_DB_URL` only in a secure secret manager, protected CI secret, or a private shell/session that is not shared.
- Recommended secure locations:
  - CI/CD secret store (preferred for repeatable controlled runs).
  - Operator local secure environment/session manager.
- Do not save the full URL in repository files (`.env`, markdown, scripts, commits) unless the file is local-only and ignored.
- Confirm availability without printing the secret value:
  ```bash
  [ -n "${SUPABASE_DB_URL:-}" ] && echo "SUPABASE_DB_URL is set" || echo "SUPABASE_DB_URL missing"
  ```

## 2) Run the backup script
From repository root:

```bash
bash scripts/supabase-manual-backup.sh
```

Optional secure destination override:

```bash
export SUPABASE_BACKUP_DIR="/secure/location/lsa-global-backup-<UTC_DATE>"
bash scripts/supabase-manual-backup.sh
```

## 3) Confirm where backup files are created
- Default location:
  - `backups/manual/<UTC_TIMESTAMP>/roles.sql`
  - `backups/manual/<UTC_TIMESTAMP>/schema.sql`
  - `backups/manual/<UTC_TIMESTAMP>/data.sql`
- If `SUPABASE_BACKUP_DIR` is set, files are created in that secure custom directory.

## 4) Verify output file presence and sizes
Run (without exposing DB credentials):

```bash
LATEST_DIR="$(ls -1dt backups/manual/* 2>/dev/null | head -n 1)"
[ -n "$LATEST_DIR" ] && ls -lh "$LATEST_DIR"/roles.sql "$LATEST_DIR"/schema.sql "$LATEST_DIR"/data.sql
```

Minimum checks:
- all three files exist,
- none of the files are zero bytes,
- timestamps match the backup run window.

## 5) Store backup outside GitHub
- Move/copy the timestamped backup directory to secure storage outside GitHub:
  - encrypted internal backup storage,
  - secured cloud vault,
  - restricted access archive with retention policy.
- Keep at least two controlled copies in separate secure locations.
- Record operator, timestamp, and storage location in internal operations log.

## 6) Never screenshot/share these items
- Full `SUPABASE_DB_URL`.
- SQL dump contents (`roles.sql`, `schema.sql`, `data.sql`) containing real data.
- Any credential material, tokens, API keys, private keys, or internal identifiers.
- File listings that reveal sensitive customer/provider information.

## 7) Mandatory separate backups (later phase)
The SQL dump is only one part of full operational resilience. Back up separately:
- **Supabase Storage objects** (object binaries are separate from SQL dumps).
- **Uploaded provider/client documents** managed in storage layers and local upload paths.
- **WhatsApp/media uploads** and operational file assets not inside PostgreSQL rows.
- **Supabase dashboard/project configuration** (Auth providers, SMTP, redirect settings, edge/runtime config).

## 8) Final go/no-go checkpoint
Declare **READY** only if all are true:
- `SUPABASE_DB_URL` is set securely.
- Script run completed without error.
- `roles.sql`, `schema.sql`, `data.sql` exist and are non-empty.
- Files were moved/copied to secure storage outside GitHub.
- Separate Storage/documents backup plan is scheduled and assigned.
