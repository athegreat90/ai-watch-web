#!/usr/bin/env bash
# Tests release/push-image.sh against a throwaway local registry, with real multi-platform builds.
# It checks what protects a release: version tags are immutable, `latest` only follows the newest
# stable version and shares its digest, prereleases never touch it, and both architectures exist.
# Needs Docker with buildx and QEMU for arm64 (docker/setup-qemu-action in CI). Takes a few minutes.
# It creates its own registry container and builder, and removes them. It never changes your default builder.
# Usage: bash release/test_push_image.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
id=$$
registry_name="aiw-test-registry-$id"
builder="aiw-test-builder-$id"
work=$(mktemp -d)
cleanup() {
    docker rm -f "$registry_name" >/dev/null 2>&1 || true
    docker buildx rm -f "$builder" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

# On Linux the builder shares the host network, so localhost works. Docker Desktop runs the builder in a
# VM where localhost is not the machine's, so both the builder and this shell use host.docker.internal.
# The registry is then published on all interfaces for the minutes the test lasts (no secrets in it).
if docker info --format '{{.OperatingSystem}}' | grep -qi 'docker desktop'; then
    registry_host=host.docker.internal
    publish=0.0.0.0::5000
    driver_opts=()
else
    registry_host=localhost
    publish=127.0.0.1::5000
    driver_opts=(--driver-opt network=host)
fi
docker run -d --rm --name "$registry_name" -p "$publish" registry:2 >/dev/null
port=$(docker port "$registry_name" 5000/tcp | awk -F: 'NR == 1 { print $NF }')
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$port/v2/" >/dev/null 2>&1 && break; sleep 1; done

cat > "$work/buildkitd.toml" <<TOML
[registry."$registry_host:$port"]
  http = true
  insecure = true
TOML
config=$work/buildkitd.toml
if command -v cygpath >/dev/null 2>&1; then config=$(cygpath -m "$config"); fi
docker buildx create --name "$builder" --driver docker-container "${driver_opts[@]}" \
    --buildkitd-config "$config" >/dev/null
docker buildx inspect "$builder" --bootstrap >/dev/null
export BUILDX_BUILDER=$builder

export REGISTRY="$registry_host:$port" IMAGE_NAME=test/ai-watch-web SKIP_LOGIN=1 SKIP_BUILDER_SETUP=1
export GITHUB_REPOSITORY=test/ai-watch-web
image="$REGISTRY/$IMAGE_NAME"
sha_a=$(printf 'a%.0s' $(seq 1 40))
sha_b=$(printf 'b%.0s' $(seq 1 40))

fail() { echo "FAIL: $*" >&2; exit 1; }
digest() { docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | jq -r .digest; }
exists() { docker buildx imagetools inspect --raw "$1" >/dev/null 2>&1; }
# push <tag> <sha> <published tags>: run the script the way the workflow does
push() {
    RELEASE_TAG=$1 TESTED_SHA=$2 AIW_PUBLISHED_TAGS=$3 bash "$here/push-image.sh" > "$work/out" 2>&1
}

echo "1. first release: the version tag and latest, same digest, both architectures, revision recorded"
push v0.1.0 "$sha_a" "" || { cat "$work/out"; fail "the first release failed"; }
v010=$(digest "$image:v0.1.0")
[ "$(digest "$image:latest")" = "$v010" ] || fail "latest and v0.1.0 differ"
platforms=$(docker buildx imagetools inspect --raw "$image:v0.1.0" | jq -r '[.manifests[]?.platform | select(.os == "linux") | .architecture] | sort | join(",")')
[ "$platforms" = "amd64,arm64" ] || fail "expected amd64 and arm64, got '$platforms'"
revision=$(docker buildx imagetools inspect --raw "$image:v0.1.0" | jq -r '.annotations["org.opencontainers.image.revision"]')
[ "$revision" = "$sha_a" ] || fail "the revision annotation is '$revision'"

echo "2. a rerun reuses the image: same digest, no rebuild"
push v0.1.0 "$sha_a" "v0.1.0" || { cat "$work/out"; fail "the rerun failed"; }
grep -q "Reusing the immutable image" "$work/out" || fail "the rerun did not reuse the image"
[ "$(digest "$image:v0.1.0")" = "$v010" ] || fail "the rerun changed the version tag"

echo "3. the same version for a different commit is refused and nothing changes"
if push v0.1.0 "$sha_b" "v0.1.0"; then fail "a version tag was accepted for another commit"; fi
grep -q "immutable" "$work/out" || fail "the refusal does not say why"
[ "$(digest "$image:v0.1.0")" = "$v010" ] || fail "a refused push changed the version tag"
[ "$(digest "$image:latest")" = "$v010" ] || fail "a refused push changed latest"

echo "4. a prerelease never touches latest"
push v0.2.0-rc.1 "$sha_b" "v0.1.0" || { cat "$work/out"; fail "the prerelease failed"; }
exists "$image:v0.2.0-rc.1" || fail "the prerelease tag was not published"
[ "$(digest "$image:latest")" = "$v010" ] || fail "a prerelease moved latest"

echo "5. an older stable version never takes latest back"
push v0.0.5 "$sha_b" "v0.1.0 v0.0.5" || { cat "$work/out"; fail "the older release failed"; }
exists "$image:v0.0.5" || fail "the older tag was not published"
[ "$(digest "$image:latest")" = "$v010" ] || fail "an older version moved latest"

echo "6. a newer stable version moves latest to the same digest"
push v0.2.0 "$sha_b" "v0.1.0 v0.2.0" || { cat "$work/out"; fail "the newer release failed"; }
v020=$(digest "$image:v0.2.0")
[ "$v020" != "$v010" ] || fail "the new version has the old digest (different commit, same image?)"
[ "$(digest "$image:latest")" = "$v020" ] || fail "latest did not move to v0.2.0"
[ "$(digest "$image:v0.1.0")" = "$v010" ] || fail "v0.1.0 changed when v0.2.0 was published"

echo "7. a malformed tag is refused before anything is built"
for bad in latest v1.2 1.2.3 "v1.2.3;rm" v01.2.3; do
    if push "$bad" "$sha_a" ""; then fail "the tag '$bad' was accepted"; fi
    grep -q "Unexpected release tag" "$work/out" || fail "the refusal of '$bad' did not come from the tag check"
    # Nothing may be published under a refused name ("latest" already exists, from the first release).
    if [ "$bad" != latest ] && exists "$image:$bad"; then fail "a refused tag '$bad' was published anyway"; fi
done
[ "$(digest "$image:latest")" = "$v020" ] || fail "a refused tag changed latest"

echo "push-image: ok"
