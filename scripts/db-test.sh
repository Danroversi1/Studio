#!/usr/bin/env bash
# Verify migrations on a throwaway plain PostgreSQL database (no Docker, no Supabase CLI).
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/db-test.sh
# The database must be disposable: it is dropped and recreated.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${STUDIO_TEST_DB:-studio_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
"${PSQL[@]}" -d "$DB" -f db/test/00_supabase_auth_shim.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done
for t in db/test/[1-9]*.sql; do
  echo "running $t"
  "${PSQL[@]}" -d "$DB" -f "$t"
done
