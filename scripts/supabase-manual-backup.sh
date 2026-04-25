#!/usr/bin/env bash
set -euo pipefail

# Safe, manual Supabase backup for LSA GLOBAL Internal OS data plane.
# Uses official Supabase CLI dump commands and keeps secrets out of code.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR_DEFAULT="${ROOT_DIR}/backups/manual/$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_DIR="${SUPABASE_BACKUP_DIR:-$BACKUP_DIR_DEFAULT}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI is not installed or not in PATH." >&2
  echo "Install: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set." >&2
  echo "Set it as a private environment variable (do NOT commit it)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

ROLES_FILE="$BACKUP_DIR/roles.sql"
SCHEMA_FILE="$BACKUP_DIR/schema.sql"
DATA_FILE="$BACKUP_DIR/data.sql"

echo "Starting Supabase backup into: $BACKUP_DIR"

# Official command pattern.
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$ROLES_FILE" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$SCHEMA_FILE"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$DATA_FILE" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

# Basic sanity checks.
for f in "$ROLES_FILE" "$SCHEMA_FILE" "$DATA_FILE"; do
  if [[ ! -s "$f" ]]; then
    echo "ERROR: Backup file missing or empty: $f" >&2
    exit 1
  fi
  printf 'Created %-12s %10s bytes\n' "$(basename "$f")" "$(wc -c < "$f")"
done

echo "Backup complete. Files saved to: $BACKUP_DIR"
