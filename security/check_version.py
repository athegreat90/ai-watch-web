"""Fail when the Node pins drift apart or a base image is not pinned by digest.

Checked: the Dockerfile pins Node and Nginx by version and digest, `.nvmrc` equals the Node version
of the Dockerfile, and (when asked) the Node that is running is that version too.

Usage: python3 security/check_version.py [--installed]   (run from the repository root)
"""
import re
import subprocess
import sys
from pathlib import Path

NODE_ARG = re.compile(r"^ARG NODE_IMAGE=node:(\d+\.\d+\.\d+)-alpine@sha256:[0-9a-f]{64}$", re.M)
NGINX_ARG = re.compile(
    r"^ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:(\d+\.\d+\.\d+)-alpine@sha256:[0-9a-f]{64}$", re.M
)
BUILD_STAGE = re.compile(r"^FROM --platform=\$BUILDPLATFORM \$\{NODE_IMAGE\} AS build$", re.M)
RUNTIME_STAGE = re.compile(r"^FROM \$\{NGINX_IMAGE\}$", re.M)


def problems(dockerfile, nvmrc, installed=None):
    """Return a list of problems (empty when everything is consistent)."""
    found = []
    node, nginx = NODE_ARG.search(dockerfile), NGINX_ARG.search(dockerfile)
    if not node:
        found.append("Dockerfile: ARG NODE_IMAGE must be node:X.Y.Z-alpine pinned by digest.")
    if not nginx:
        found.append("Dockerfile: ARG NGINX_IMAGE must be nginxinc/nginx-unprivileged:X.Y.Z-alpine pinned by digest.")
    if not BUILD_STAGE.search(dockerfile):
        found.append("Dockerfile: the build stage must be FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build.")
    if not RUNTIME_STAGE.search(dockerfile):
        found.append("Dockerfile: the runtime stage must be FROM ${NGINX_IMAGE}.")
    if node and nvmrc.strip() != node[1]:
        found.append(f".nvmrc ({nvmrc.strip()}) and the Dockerfile Node ({node[1]}) differ.")
    if node and installed is not None and installed.strip().lstrip("v") != node[1]:
        found.append(f"Expected Node {node[1]}, found {installed.strip() or 'no Node'}.")
    return found


def main(argv):
    installed = None
    if "--installed" in argv:
        run = subprocess.run(["node", "--version"], capture_output=True, text=True)
        installed = run.stdout if run.returncode == 0 else ""
    found = problems(Path("docker/Dockerfile").read_text(), Path(".nvmrc").read_text(), installed)
    if found:
        sys.exit("\n".join(found))
    print("Node and Nginx pins are consistent across the Dockerfile and .nvmrc.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
