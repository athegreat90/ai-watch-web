"""Fail when the Nginx configuration enables a feature the accepted CVEs need.

The accepted risks in accepted-risks.json are only acceptable while none of these is on: the mail
proxy, HTTP/2, HTTP/3 (QUIC), TLS, a stream block, SSI, `mirror` subrequests, or dynamic modules.
check_findings.py calls violations() and drops the exceptions when it returns anything.

Usage: python3 security/check_nginx_features.py [conf-dir]   (default docker/nginx)
"""
import re
import sys
from pathlib import Path

# (what it enables, pattern on one directive line)
FORBIDDEN = [
    ("HTTP/2", re.compile(r"\bhttp2\b")),
    ("HTTP/3 or QUIC", re.compile(r"\b(http3|quic)\b|\bquic_")),
    ("TLS", re.compile(r"\bssl\b|\bssl_\w+|\bproxy_ssl_\w+")),
    ("mail proxy", re.compile(r"\bmail\b")),
    ("a stream block", re.compile(r"^\s*stream\s*\{")),
    ("SSI", re.compile(r"\bssi\b|\bssi_\w+")),
    ("mirror subrequests", re.compile(r"\bmirror(_request_body)?\b")),
    ("dynamic modules", re.compile(r"\bload_module\b")),
]
LISTEN = re.compile(r"^\s*listen\s+([^;]*);")
PLAIN_LISTEN = re.compile(r"^\d+$")


def violations(conf_dir):
    """Return a list of "file:line: what" for every forbidden directive under conf_dir."""
    found = []
    for path in sorted(Path(conf_dir).rglob("*.conf")):
        for number, raw in enumerate(path.read_text().splitlines(), 1):
            line = raw.split("#", 1)[0]
            if not line.strip():
                continue
            for label, pattern in FORBIDDEN:
                if pattern.search(line):
                    found.append(f"{path}:{number}: {label}")
            listen = LISTEN.match(line)
            if listen and not PLAIN_LISTEN.match(listen[1].strip()):
                found.append(f"{path}:{number}: a listen directive with options ({listen[1].strip()})")
    return found


def main(argv):
    found = violations(argv[1] if len(argv) > 1 else "docker/nginx")
    for item in found:
        print(item)
    if found:
        print("The accepted Nginx risks no longer apply.")
        return 1
    print("No feature needed by the accepted Nginx risks is enabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
