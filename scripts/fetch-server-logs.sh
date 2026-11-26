#!/usr/bin/env bash
# Copies the production API minute logs (last 30+ minutes, one file per UTC minute) to
# debug-logs/<local timestamp>/. See DEBUGGING.md.
#
#   scripts/fetch-server-logs.sh                 # every minute file on the server
#   scripts/fetch-server-logs.sh 14-2            # only the minutes matching *_14-2*Z.log (14:20-14:29 UTC)
#
# The SSH target comes from NANOMMO_SSH (default: the `idlelords` alias in ~/.ssh/config).
set -euo pipefail
target="${NANOMMO_SSH:-idlelords}"
filter="${1:-}"
cd "$(dirname "$0")/.."
out="debug-logs/$(date +%Y-%m-%d_%H-%M-%S)"
mkdir -p "$out"
scp "${target}:~/nanommo/logs/api/api_*${filter}*Z.log" "$out/"
echo "Saved $(ls "$out" | wc -l) file(s) to $out (names are UTC; Manaus = UTC-4)"
