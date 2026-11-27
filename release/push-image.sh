#!/usr/bin/env bash
# Publish the multi-platform image for one release: an immutable vX.Y.Z tag and, for the newest
# stable version only, the `latest` tag pointing at the very same manifest list (no second build).
#
# Inputs (environment): RELEASE_TAG, TESTED_SHA, GITHUB_REPOSITORY (or IMAGE_NAME), GH_TOKEN and
# GITHUB_ACTOR for the registry login. Optional: REGISTRY (default ghcr.io), SKIP_LOGIN=1 (tests).
#
# Guarantees:
#  * an existing version tag is never rebuilt or overwritten; it is verified and reused (idempotent reruns)
#  * prereleases (vX.Y.Z-rc.1) never touch `latest`
#  * an older version never moves `latest` backwards (semantic comparison in release/automatic.py)
#  * both tags are verified to have the same index digest and both linux/amd64 and linux/arm64
set -euo pipefail

tag=${RELEASE_TAG:?RELEASE_TAG is required}
sha=${TESTED_SHA:?TESTED_SHA is required}
registry=${REGISTRY:-ghcr.io}
name=${IMAGE_NAME:-${GITHUB_REPOSITORY:?GITHUB_REPOSITORY or IMAGE_NAME is required}}
image="$registry/${name,,}"
here=$(cd "$(dirname "$0")" && pwd)
context=${BUILD_CONTEXT:-$here/..} # tests on Windows pass a Windows-style path

if ! [[ $tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Unexpected release tag: $tag" >&2
    exit 1
fi
prerelease=false
[[ $tag == *-* ]] && prerelease=true

if [ "${SKIP_LOGIN:-0}" != 1 ]; then
    printf '%s' "$GH_TOKEN" | docker login "$registry" -u "$GITHUB_ACTOR" --password-stdin
fi

# raw <ref>: print the manifest list JSON, or nothing when the tag does not exist; fail on any other error.
raw() {
    local error out
    error=$(mktemp)
    if out=$(docker buildx imagetools inspect --raw "$1" 2>"$error"); then
        rm -f "$error"
        printf '%s' "$out"
        return 0
    fi
    if grep -Eiq 'manifest unknown|manifest_unknown|(^|: )[^ ]+: not found$|name unknown|404' "$error"; then
        rm -f "$error"
        return 0
    fi
    cat "$error" >&2
    rm -f "$error"
    return 1
}

# digest <ref>: print the digest of the manifest list the tag points to.
digest() {
    docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | jq -r .digest
}

# has_both_platforms: read a manifest list on stdin, succeed when linux/amd64 and linux/arm64 are present.
has_both_platforms() {
    jq -e '[.manifests[]?.platform | select(.os == "linux") | .architecture]
           | (index("amd64") != null and index("arm64") != null)' >/dev/null
}

summary() {
    echo "$*"
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY" || true
}

existing=$(raw "$image:$tag")
if [ -n "$existing" ]; then
    # Version tags are immutable: verify and reuse, never replace.
    has_both_platforms <<< "$existing" || { echo "$image:$tag exists but lacks linux/amd64 or linux/arm64." >&2; exit 1; }
    revision=$(jq -r '.annotations["org.opencontainers.image.revision"] // empty' <<< "$existing")
    if [ -n "$revision" ] && [ "$revision" != "$sha" ]; then
        echo "$image:$tag already exists for commit $revision, not $sha. Version tags are immutable." >&2
        exit 1
    fi
    echo "Reusing the immutable image $image:$tag (revision ${revision:-not recorded})."
else
    [ "${SKIP_BUILDER_SETUP:-0}" = 1 ] || docker buildx create --use >/dev/null 2>&1 || true
    docker buildx build --platform linux/amd64,linux/arm64 -f "$context/docker/Dockerfile" \
        --build-arg "VERSION=$tag" --build-arg "REVISION=$sha" \
        --annotation "index:org.opencontainers.image.revision=$sha" \
        --annotation "index:org.opencontainers.image.version=$tag" \
        --annotation "index:org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY:-$name}" \
        --label "org.opencontainers.image.revision=$sha" \
        --label "org.opencontainers.image.version=$tag" \
        --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY:-$name}" \
        --tag "$image:$tag" --push "$context"
    raw "$image:$tag" | has_both_platforms || { echo "Published $image:$tag lacks a required platform." >&2; exit 1; }
fi
version_digest=$(digest "$image:$tag")

if [ "$prerelease" = true ]; then
    summary "Published $image:$tag ($version_digest). Prerelease: \`latest\` was not touched."
    exit 0
fi

# Assign first so a failing decision (for example the GitHub API) aborts the job instead of
# silently skipping `latest`.
# The first interpreter that really runs: on Windows, python3 can be a Store stub that does nothing.
py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)
decision=$("$py" "$here/automatic.py" update-latest)
case "$decision" in true | false) ;; *) echo "Unexpected update-latest answer: '$decision'" >&2; exit 1 ;; esac
if [ "$decision" != true ]; then
    summary "Published $image:$tag ($version_digest). A newer stable release exists, so \`latest\` was not moved."
    exit 0
fi

# Re-point latest at the existing manifest list: same digest, no rebuild. Safe to repeat.
docker buildx imagetools create --tag "$image:latest" "$image:$tag"
latest_digest=$(digest "$image:latest")
if [ "$latest_digest" != "$version_digest" ]; then
    echo "latest ($latest_digest) differs from $tag ($version_digest)." >&2
    exit 1
fi
raw "$image:latest" | has_both_platforms || { echo "$image:latest lacks a required platform." >&2; exit 1; }
summary "Published $image:$tag and $image:latest, both $version_digest (linux/amd64, linux/arm64)."
