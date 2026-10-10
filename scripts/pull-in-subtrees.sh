#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

git subtree add \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  main \
  --squash
