#!/bin/sh
# Run against a disposable local PostgreSQL 17 cluster only; no cloud DSN.
set -eu
if [ "$#" -ne 2 ]; then
  printf '%s\n' 'Usage: sales-concurrency.sh /absolute/postgresql17/bin /absolute/pg/lib/index.js' >&2
  exit 2
fi
exec node "$(dirname "$0")/sales-concurrency.mjs" "$1" "$2"
