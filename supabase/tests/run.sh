#!/usr/bin/env bash
# Runs migrations + RLS tests against a throwaway local Postgres. Usage: supabase/tests/run.sh
# Needs Postgres 14+ binaries (initdb, pg_ctl, psql). Runs as a non-root user if invoked as root.
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="$(mktemp -d)"
PORT="${PGPORT:-54329}"
if [ "$(id -u)" = "0" ]; then
  chown -R claude "$DIR"; RUN=(su claude -c)
  run() { su claude -c "$*"; }
else
  run() { bash -c "$*"; }
fi
cleanup() { run "$PGBIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1 || true"; rm -rf "$DIR"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
PSQL="$PGBIN/psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
run "$PSQL -c 'create database t'"
for f in supabase/tests/00_supabase_stub.sql supabase/migrations/*.sql supabase/tests/rls.sql; do
  echo "-- $f"; chmod a+r "$f"
  run "$PSQL -d t -f $PWD/$f"
done
