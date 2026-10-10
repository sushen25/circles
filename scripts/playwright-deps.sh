#!/usr/bin/env bash
# Installs the system libraries Playwright's browsers load, retrying a hang.
#
#   scripts/playwright-deps.sh webkit
#   scripts/playwright-deps.sh chromium
#
# `playwright install-deps` is an `apt-get update` and an `apt-get install`. Twice
# (SUS-143) it sat in the apt step until the job's 30-minute timeout, on a step
# that takes under a minute, and took the whole run with it. Each attempt here
# gets three minutes and is killed after that; three attempts, then the step
# fails with its own log rather than the job timing out silently. CI only (the
# runner image has passwordless sudo).
set -euo pipefail

for attempt in 1 2 3; do
  if timeout --kill-after=10 180 pnpm exec playwright install-deps "$@"; then
    exit 0
  fi
  echo "playwright install-deps $* did not finish (attempt $attempt of 3)" >&2
  # `timeout` runs as the runner user and cannot signal the root-owned
  # `sudo sh -c "apt-get …"` below pnpm, so the hung apt-get is still holding
  # the dpkg lock. Kill it by name, then put dpkg right before trying again.
  sudo pkill -9 -x apt-get || true
  sudo pkill -9 -x apt || true
  sudo dpkg --configure -a || true
done
echo "playwright install-deps $* failed three times" >&2
exit 1
