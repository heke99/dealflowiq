#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'TXT'
Usage:
  ./scripts/sync-supabase.sh --local-reset
  CONFIRM_MIGRATION_HISTORY_REWRITE=YES ./scripts/sync-supabase.sh --existing-linked-project

--local-reset
  Rebuilds the local Supabase database from all timestamped migrations.

--existing-linked-project
  For a database that already contains the old 001..037 schema. It rewrites
  only Supabase's migration-history records to the new timestamped filenames,
  then applies the new reconciliation migration. Take a backup first.
TXT
}

command -v supabase >/dev/null || { echo "Supabase CLI is required." >&2; exit 1; }
node scripts/check-migrations.mjs

case "${1:-}" in
  --local-reset)
    supabase db reset
    ;;
  --existing-linked-project)
    if [[ "${CONFIRM_MIGRATION_HISTORY_REWRITE:-}" != "YES" ]]; then
      echo "Refusing to rewrite migration history without CONFIRM_MIGRATION_HISTORY_REWRITE=YES" >&2
      exit 1
    fi
    backup="backups/pre-auth-tenant-reconciliation-$(date +%Y%m%d-%H%M%S).sql"
    mkdir -p backups
    supabase db dump --linked --file "$backup"
    echo "Backup written to $backup"

    mapfile -t old_versions < <(tail -n +2 supabase/migration-version-map.csv | cut -d, -f1 | cut -d_ -f1 | sort -u)
    mapfile -t new_versions < <(tail -n +2 supabase/migration-version-map.csv | cut -d, -f2 | cut -d_ -f1)

    for version in "${old_versions[@]}"; do
      supabase migration repair --linked --status reverted "$version" || true
    done
    for version in "${new_versions[@]}"; do
      supabase migration repair --linked --status applied "$version"
    done
    supabase db push --linked
    ;;
  *) usage; exit 1 ;;
esac
