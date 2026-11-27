#!/usr/bin/env bash
# Fail unless the CI workflow succeeded on a push to main for exactly this commit.
# Publication paths that do not start from a CI run (manual releases) call this first, so neither
# the version tag nor `latest` can come from a commit that was not fully validated.
set -euo pipefail
sha=${1:?commit SHA required}
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}
passed=$(gh run list --repo "$repo" --workflow ci.yml --branch main --commit "$sha" --event push \
    --json conclusion --jq '[.[] | select(.conclusion == "success")] | length')
if [ "${passed:-0}" -lt 1 ]; then
    echo "CI has not succeeded on main for commit $sha; refusing to publish." >&2
    exit 1
fi
echo "CI succeeded on main for $sha."
