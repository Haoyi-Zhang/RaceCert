#!/usr/bin/env bash
set -euo pipefail
cd -- "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 20+ is required. Install Node.js and Python 3 before starting.' >&2
  exit 1
fi
exec node launch.js
