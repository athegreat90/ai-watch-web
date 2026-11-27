#!/usr/bin/env bash
# Tests for upsert-issue.sh with a stubbed gh: the first run creates the issue, later runs only edit it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
if [ "$1 $2" = "issue list" ]; then
    case " $* " in *" --search "*) exit 0 ;; esac  # the search API finds nothing for an app token
    filter=""
    while [ $# -gt 0 ]; do if [ "$1" = --jq ]; then filter=$2; fi; shift; done
    jq -r "$filter" < "$GH_ISSUES" | tr -d ''  # behave like gh --jq on the canned issue list
fi
STUB
chmod +x "$work/bin/gh"
echo body > "$work/body.md"
export PATH="$work/bin:$PATH" GH_LOG="$work/log" GH_ISSUES="$work/issues.json"
fail() { echo "FAIL: $*" >&2; cat "$work/log" >&2; exit 1; }

# 1. No open issue: create one, never edit.
echo '[{"number":3,"title":"Unrelated issue"}]' > "$GH_ISSUES"; : > "$GH_LOG"
bash "$here/upsert-issue.sh" "$work/body.md"
grep -q '^issue create ' "$GH_LOG" || fail "expected a create"
grep -q '^issue edit ' "$GH_LOG" && fail "unexpected edit"

# 2. An open issue exists: edit the lowest-numbered one, never create.
echo '[{"number":15,"title":"Daily container vulnerability findings"},{"number":9,"title":"Daily container vulnerability findings"},{"number":4,"title":"Daily container vulnerability findings (old)"}]' > "$GH_ISSUES"; : > "$GH_LOG"
bash "$here/upsert-issue.sh" "$work/body.md"
grep -q '^issue edit 9 ' "$GH_LOG" || fail "expected an edit of issue 9"
grep -q '^issue create ' "$GH_LOG" && fail "unexpected create"
grep -q -- '--search' "$GH_LOG" && fail "the search API must not be used"
echo "upsert-issue: ok"
