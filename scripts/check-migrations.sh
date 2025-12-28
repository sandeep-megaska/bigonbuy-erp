#!/usr/bin/env bash

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "Base reference '$BASE_REF' not found. Ensure the remote exists and fetch it (e.g. git fetch origin main)." >&2
  exit 1
fi

diff_output="$(git diff --name-status "$BASE_REF"...HEAD -- supabase/migrations || true)"

if [[ -z "$diff_output" ]]; then
  echo "No migration changes detected."
  exit 0
fi

disallowed_changes=0

while IFS=$'\t' read -r status path _; do
  # Status can include a similarity score (e.g., R100); only the first character matters.
  primary_status="${status:0:1}"

  if [[ "$primary_status" == "A" ]]; then
    echo "Allowed: added migration $path"
    continue
  fi

  echo "Blocked: existing migration $path was ${primary_status} (only new migrations may be added)." >&2
  disallowed_changes=1
done <<< "$diff_output"

if [[ "$disallowed_changes" -ne 0 ]]; then
  cat >&2 <<'EOF'
Migration modifications or deletions detected.
To preserve history, existing migration files under supabase/migrations must not be changed or removed.
Create a new migration instead.
EOF
  exit 1
fi

echo "Migration check passed."
