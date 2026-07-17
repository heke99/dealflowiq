#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Use a direct Postgres connection string for the isolated/local or linked database." >&2
  exit 1
fi
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/audit-supabase-security.sql
