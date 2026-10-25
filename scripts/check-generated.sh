#!/bin/sh
set -eu
before=$(mktemp)
after=$(mktemp)
trap 'rm -f "$before" "$after"' EXIT
find internal/api web/src/api -type f -exec shasum -a 256 {} \; | sort > "$before"
pnpm generate
find internal/api web/src/api -type f -exec shasum -a 256 {} \; | sort > "$after"
diff -u "$before" "$after"
