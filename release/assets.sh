#!/usr/bin/env bash
# Build the versioned release assets into dist/: the SBOM of each image architecture (written by
# security/check-image.sh into security-results/), the deployment bundle when deploy/ai-watch-web-deploy
# exists (phase 12), and SHA256SUMS covering all of them.
# Usage: RELEASE_TAG=v0.1.0 bash release/assets.sh   (run security/check-image.sh amd64 and arm64 first)
set -euo pipefail
tag=${RELEASE_TAG:?RELEASE_TAG is required}
root=$(cd "$(dirname "$0")/.." && pwd)
dist=${ASSETS_DIR:-$root/dist}
results=${RESULTS_DIR:-$root/security-results}
rm -rf "$dist" && mkdir -p "$dist"
cd "$root"

for arch in amd64 arm64; do
    sbom="$results/sbom-$arch.cdx.json"
    [ -s "$sbom" ] || { echo "Missing $sbom: run security/check-image.sh $arch first." >&2; exit 1; }
    cp "$sbom" "$dist/ai-watch-web_${tag}_sbom_${arch}.cdx.json"
done

# The bundle is the deploy/ai-watch-web-deploy directory, with the version recorded in it.
if [ -d deploy/ai-watch-web-deploy ]; then
    bundle=$(mktemp -d)
    trap 'rm -rf "$bundle"' EXIT
    # Only the known files, never the folder: someone who ran the installer in place has secrets, a server
    # config and a .env there, and none of that may end up in a release.
    mkdir "$bundle/ai-watch-web-deploy"
    for f in compose.yaml compose.server.yaml compose.auth.yaml env.example install.sh install.ps1 README.md; do
        cp "deploy/ai-watch-web-deploy/$f" "$bundle/ai-watch-web-deploy/$f"
    done
    # A file added from Windows may be committed as 644: the zip must still let people run ./install.sh.
    chmod 755 "$bundle/ai-watch-web-deploy/install.sh"
    echo "$tag" > "$bundle/ai-watch-web-deploy/VERSION"
    # Reproducible archive: fixed timestamps.
    find "$bundle" -exec touch -d '2000-01-01 00:00:00' {} +
    if command -v zip >/dev/null 2>&1; then
        (cd "$bundle" && zip -qrX "$dist/ai-watch-web-deploy-$tag.zip" ai-watch-web-deploy)
    else
        py=$(for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { echo "$c"; break; }; done)
        (cd "$bundle" && "$py" -m zipfile -c "$dist/ai-watch-web-deploy-$tag.zip" ai-watch-web-deploy)
    fi
fi

(cd "$dist" && sha256sum -- * > SHA256SUMS.tmp && mv SHA256SUMS.tmp SHA256SUMS)
ls -l "$dist"
