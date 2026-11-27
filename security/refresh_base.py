"""Refresh the digest-pinned base images.

Node: the newest patch of the pinned major series (`-alpine`), and `.nvmrc` follows it.
Nginx: the newest patch of the pinned minor series of nginx-unprivileged (`-alpine`).
Both must publish linux/amd64 and linux/arm64, or nothing is changed.

Usage: python3 security/refresh_base.py   (run from the repository root; needs the network)
"""
import json
import re
import urllib.request
from pathlib import Path

REQUIRED = {("linux", "amd64"), ("linux", "arm64")}
ACCEPT = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"
NODE = re.compile(r"^(ARG NODE_IMAGE=node:)(\d+\.\d+\.\d+)(-alpine@)(sha256:[0-9a-f]{64})$", re.M)
NGINX = re.compile(r"^(ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:)(\d+\.\d+\.\d+)(-alpine@)(sha256:[0-9a-f]{64})$", re.M)


def newest(names, prefix, current):
    """The highest X.Y.Z-alpine among `names` that starts with `prefix` (for example "26." or "1.30."), or `current`."""
    versions = [n.removesuffix("-alpine") for n in names if re.fullmatch(re.escape(prefix) + r"\d+(\.\d+)*-alpine", n)]
    versions = [v for v in versions if re.fullmatch(r"\d+\.\d+\.\d+", v)]
    return max(versions + [current], key=lambda v: tuple(map(int, v.split("."))))


def pin(dockerfile, pattern, version, digest):
    """Rewrite one ARG line of the Dockerfile with a new version and digest."""
    return pattern.sub(lambda m: f"{m[1]}{version}{m[3]}{digest}", dockerfile, count=1)


def platforms(index):
    return {(row.get("platform", {}).get("os"), row.get("platform", {}).get("architecture")) for row in index["manifests"]}


def fetch(url, **headers):
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30)


def hub_token(repo):
    with fetch(f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull") as response:
        return json.load(response)["token"]


def digest_of(repo, tag):
    """The digest of a Docker Hub tag. Raises when a required architecture is missing."""
    with fetch(f"https://registry-1.docker.io/v2/{repo}/manifests/{tag}", Accept=ACCEPT, Authorization=f"Bearer {hub_token(repo)}") as response:
        index, digest = json.load(response), response.headers["Docker-Content-Digest"]
    if not REQUIRED <= platforms(index):
        raise SystemExit(f"{repo}:{tag} lacks a required architecture.")
    return digest


def tag_names(repo, name_filter):
    with fetch(f"https://hub.docker.com/v2/repositories/{repo}/tags?page_size=100&name={name_filter}") as response:
        return [row["name"] for row in json.load(response)["results"]]


def main():
    dockerfile_path, nvmrc_path = Path("docker/Dockerfile"), Path(".nvmrc")
    source = dockerfile_path.read_text()
    node, nginx = NODE.search(source), NGINX.search(source)
    if not node or not nginx:
        raise SystemExit("Dockerfile: the NODE_IMAGE and NGINX_IMAGE pins were not found.")
    node_series = node[2].split(".")[0] + "."
    nginx_series = ".".join(nginx[2].split(".")[:2]) + "."
    node_version = newest(tag_names("library/node", node_series), node_series, node[2])
    nginx_version = newest(tag_names("nginxinc/nginx-unprivileged", nginx_series), nginx_series, nginx[2])
    source = pin(source, NODE, node_version, digest_of("library/node", f"{node_version}-alpine"))
    source = pin(source, NGINX, nginx_version, digest_of("nginxinc/nginx-unprivileged", f"{nginx_version}-alpine"))
    dockerfile_path.write_text(source, newline="\n")
    nvmrc_path.write_text(node_version + "\n", newline="\n")
    print(f"Node {node_version}, Nginx {nginx_version}")


if __name__ == "__main__":
    main()
