#!/usr/bin/env bash
# Keep exactly one open "Daily container vulnerability findings" issue: edit it when it exists, create it otherwise.
# Usage: bash security/upsert-issue.sh <body-file>   (needs gh authenticated for the repository)
# The lookup lists open issues and compares the title exactly. It deliberately avoids the search API, which
# returns nothing for a GitHub App installation token and would open a new issue on every run.
set -euo pipefail
title='Daily container vulnerability findings'
body=${1:?usage: upsert-issue.sh <body-file>}
issue=$(gh issue list --state open --limit 200 --json number,title \
    --jq ".[] | select(.title == \"$title\") | .number" | sort -n | head -1)
if [ -n "$issue" ]; then
    gh issue edit "$issue" --body-file "$body"
else
    gh issue create --title "$title" --body-file "$body"
fi
