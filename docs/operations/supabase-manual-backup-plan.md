# LSA GLOBAL Supabase Manual Backup Plan (Safe / Official CLI)

## Purpose
This plan creates a **manual, production-safe backup** of the current Supabase PostgreSQL database used by LSA GLOBAL Internal OS using the official Supabase CLI dump method.

## Security rules (mandatory)
- Never hardcode or commit database connection strings.
- Keep the connection string only in:
  - a private local environment variable (`SUPABASE_DB_URL`), or
  - a GitHub Actions Secret for CI/manual workflow execution.
- Never paste database passwords into repository files, commits, or PR text.

## Required backup outputs
This backup must produce exactly:
1. `roles.sql`
2. `schema.sql`
3. `data.sql`

## Official dump commands
Use this exact official pattern (connection string injected from env var):

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" -f data.sql --use-copy --data-only
```

## Recommended execution (repo script)
From repository root:

```bash
export SUPABASE_DB_URL='postgresql://postgres.[PROJECT_REF]:[PASSWORD]@[HOST]:5432/postgres?sslmode=require'
bash scripts/supabase-manual-backup.sh
```

The script saves files to:
- `backups/manual/<UTC_TIMESTAMP>/roles.sql`
- `backups/manual/<UTC_TIMESTAMP>/schema.sql`
- `backups/manual/<UTC_TIMESTAMP>/data.sql`

You can override target folder with:

```bash
export SUPABASE_BACKUP_DIR="/secure/location/lsa-global-backup-<date>"
bash scripts/supabase-manual-backup.sh
```

## Coverage confirmation for LSA GLOBAL Internal OS application tables
Based on current runtime queries, the app uses these Postgres tables in `public`:
- `app_config`
- `conversations`
- `kb_articles`
- `kb_capture_assistant`
- `kb_categories`
- `kb_quick_capture`
- `provider_documents`
- `providers`

A full DB dump (`schema.sql` + `data.sql`) should include these tables **if they exist in the target database and the DB user has access**.

### Post-backup verification query
Run against the same DB and compare with expected app table set:

```sql
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in (
    'app_config','conversations','kb_articles','kb_capture_assistant',
    'kb_categories','kb_quick_capture','provider_documents','providers'
  )
order by table_name;
```

## What needs separate backup handling (outside these SQL dumps)
The SQL dumps above **do not fully cover all operational assets**. Handle separately:

1. **Storage objects / buckets**
   - If Supabase Storage buckets are used, object files need separate export/sync.
   - Bucket definitions may appear in DB metadata, but object binaries are not preserved by standard SQL table dumps in a restorable object-store form.

2. **Supabase Auth configuration / provider settings**
   - Auth users can appear in DB (`auth` schema), but dashboard-level Auth settings (providers, templates, external OAuth secrets, SMTP configs, redirect URLs, etc.) require separate configuration backup/documentation.

3. **Platform-level project settings**
   - API settings, rate limits, network restrictions, edge functions configuration, and other dashboard-managed settings require separate backup/checklist handling.

4. **Non-DB application files used by this repo**
   - Provider and WhatsApp uploads are currently written to local filesystem paths under `uploads/` in this app and are not included by Supabase SQL dumps.

## Operational cadence recommendation
- Minimum: run manual backup before every production schema change.
- Recommended: weekly full manual backup + pre-release backup.
- Keep immutable timestamped archives and test restore quarterly.
