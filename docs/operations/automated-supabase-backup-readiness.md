# Automated Supabase Backup Readiness Runbook

## Purpose

This runbook defines **backup readiness automation** for LSA GLOBAL Internal OS while Supabase remains the current bridge and the private backend remains the strategic destination.

Backup readiness means:
- the process can run automatically and consistently,
- required secrets are validated,
- SQL dump outputs can be generated safely,
- integrity checks can be produced,
- and operations can review evidence without exposing secrets or data contents.

It does **not** mean automatic public storage, and it does **not** replace private infrastructure strategy.

---

## What this automation does

The GitHub Actions workflow `.github/workflows/supabase-backup.yml` is designed to:

1. run on manual trigger (`workflow_dispatch`),
2. optionally run weekly on schedule (cron),
3. stop immediately if `SUPABASE_DB_URL` is missing,
4. execute `scripts/supabase-manual-backup.sh`,
5. generate `roles.sql`, `schema.sql`, and `data.sql` in temporary runner storage,
6. create a timestamped `.tar.gz` archive,
7. compute SHA256 checksums,
8. print a **safe report** containing only:
   - timestamp,
   - git commit SHA,
   - file names,
   - file sizes,
   - checksum values.

The workflow avoids database URL output and does not print SQL file contents.

---

## Operational concepts (simple distinction)

### 1) Manual backup
You run `scripts/supabase-manual-backup.sh` yourself when needed.

### 2) Scheduled backup readiness
GitHub Actions runs the same backup logic weekly and confirms repeatable execution.

### 3) True point-in-time recovery (PITR)
PITR is a different capability from CLI SQL dumps. PITR requires database-level continuous WAL/log retention and restore tooling that can recover to a precise timestamp. SQL dumps are snapshots, not full timeline recovery.

**Important:** real-time/incremental PITR is not the same as `supabase db dump` outputs.

---

## Security and secret handling

### Required secret
- `SUPABASE_DB_URL` (GitHub Actions secret)

### How to set `SUPABASE_DB_URL` securely
1. Open the GitHub repository.
2. Go to **Settings → Secrets and variables → Actions**.
3. Choose **New repository secret**.
4. Name: `SUPABASE_DB_URL`.
5. Paste the DB URL value.
6. Save.

Rules:
- Never commit this value to files.
- Never print this value in logs.
- Never share this value in tickets/screenshots.

---

## How to run manually (recommended first)

1. Open **Actions** tab.
2. Select workflow: **Supabase Backup Readiness**.
3. Click **Run workflow**.
4. Keep `run_backup=true`.
5. Review logs and step summary.

Expected result:
- PASS if secret exists and SQL files are generated.
- FAIL if secret is missing or dumps are not generated.

---

## How to enable / disable weekly schedule

Weekly schedule is defined in `.github/workflows/supabase-backup.yml` with a `cron` entry.

- To keep weekly readiness checks enabled: keep the schedule block.
- To disable: remove or comment out the `schedule` block and commit.

Use manual dispatch whenever schedule is disabled.

---

## Temporary backup location

In GitHub-hosted runners, generated files are stored in temporary runner storage (`$RUNNER_TEMP`) with timestamped names.

This is intentional for safety:
- no backup files are committed to the repository,
- no automatic publishing is performed,
- files are ephemeral to the workflow environment.

---

## Why backup files must never be committed to GitHub

Backup files can contain sensitive business and personal data. Committing them to Git history creates long-term exposure and legal/operational risk.

Never commit:
- `roles.sql`, `schema.sql`, `data.sql`,
- compressed backup archives,
- checksums tied to sensitive dumps,
- provider/client document payloads.

---

## Separate backup plan required for Storage API assets

Database dumps do not cover complete object/file backup strategy for operational assets such as:
- uploads,
- thumbnails,
- provider documents,
- client documents,
- other storage buckets/files.

Define and operate a separate storage-backup process for these assets.

---

## Safe default publishing policy

Current workflow behavior is intentionally conservative:
- ✅ verifies readiness,
- ✅ creates evidence report,
- ✅ avoids secret exposure,
- ❌ does not upload archives,
- ❌ does not commit backup files.

Only introduce storage publishing after explicit approval confirms:
1. repository/privacy posture,
2. destination security,
3. encryption requirements,
4. retention policy,
5. restoration test procedure.

---

## Placeholder approved storage destinations (future)

Use one or a combination of the following once formally approved:
1. private VPS backup directory,
2. encrypted cloud storage,
3. private object storage,
4. offline encrypted archive.

Do not activate these paths in automation until governance and security controls are approved.

---

## Alignment with migration strategy

This backup readiness layer supports transition from Supabase bridge-state toward Hostinger VPS/private backend by:
- enforcing repeatable backup discipline,
- producing integrity metadata,
- preventing accidental data leakage,
- preserving operational safety while infrastructure evolves.

It is a stabilization step, not a permanent dependency decision.
