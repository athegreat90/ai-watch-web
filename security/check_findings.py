"""Read a Trivy JSON report and fail on what the project does not accept.

Blocking: a HIGH or CRITICAL vulnerability that has a fixed version, any secret, and any HIGH or
CRITICAL misconfiguration. A vulnerability with no fix yet is printed but does not block.

A vulnerability can be accepted for a limited time in security/accepted-risks.json. An exception
covers one advisory of one package at one fixed version, stops on its date, and stops when
check_nginx_features.py finds a feature the advisory needs. Secrets and misconfigurations can never
be accepted.

Usage: python3 security/check_findings.py <report.json> [accepted-risks.json]
"""
import datetime
import json
import sys
from pathlib import Path

import check_nginx_features

DEFAULT_ACCEPTED = Path(__file__).with_name("accepted-risks.json")


def collect(report):
    """Return (vulnerabilities, secrets, misconfigurations) found in a Trivy report."""
    vulnerabilities, secrets, misconfigs = set(), set(), set()
    for result in report.get("Results") or []:
        for v in result.get("Vulnerabilities") or []:
            vulnerabilities.add((v["VulnerabilityID"], v["PkgName"], v.get("FixedVersion") or ""))
        for s in result.get("Secrets") or []:
            secrets.add((s.get("RuleID", "?"), result.get("Target", "?"), s.get("StartLine", 0)))
        for m in result.get("Misconfigurations") or []:
            if m.get("Severity") in ("HIGH", "CRITICAL") and m.get("Status", "FAIL") == "FAIL":
                misconfigs.add((m.get("ID", "?"), result.get("Target", "?"), m.get("Title", "")))
    return vulnerabilities, secrets, misconfigs


def apply_accepted(vulnerabilities, accepted, today, features_ok):
    """Split findings into (still blocking, accepted, why an exception was not used).

    `accepted` is the list of entries of accepted-risks.json. Only a vulnerability that has a fix
    can be accepted, because one without a fix does not block anyway.
    """
    remaining, used, notes = set(), {}, []
    for finding in vulnerabilities:
        advisory, package, fix = finding
        entry = next((a for a in accepted if a["id"] == advisory and a["package"] == package and a["fixed"] == fix), None)
        if not fix or entry is None:
            remaining.add(finding)
        elif datetime.date.fromisoformat(entry["expires"]) < today:
            remaining.add(finding)
            notes.append(f"{advisory}: the exception expired on {entry['expires']}")
        elif not features_ok:
            remaining.add(finding)
            notes.append(f"{advisory}: the exception no longer applies, the Nginx configuration enables a feature it needs")
        else:
            used[finding] = entry
    return remaining, used, notes


def blocking(report, accepted=(), today=None, features_ok=True):
    """True when the report holds something that must stop a release."""
    vulnerabilities, secrets, misconfigs = collect(report)
    remaining, _, _ = apply_accepted(vulnerabilities, accepted, today or datetime.date.today(), features_ok)
    return any(fix for _, _, fix in remaining) or bool(secrets) or bool(misconfigs)


def main(argv):
    report = json.loads(Path(argv[1]).read_text())
    accepted_path = Path(argv[2]) if len(argv) > 2 else DEFAULT_ACCEPTED
    accepted = json.loads(accepted_path.read_text())["accepted"] if accepted_path.exists() else []
    today = datetime.date.today()
    features_ok = not check_nginx_features.violations(Path(__file__).parent.parent / "docker" / "nginx")
    vulnerabilities, secrets, misconfigs = collect(report)
    remaining, used, notes = apply_accepted(vulnerabilities, accepted, today, features_ok)
    for advisory, package, fix in sorted(remaining):
        print(f"{advisory} {package}: {fix or 'no fix available'}")
    for (advisory, package, fix), entry in sorted(used.items()):
        print(f"ACCEPTED {advisory} {package} (fix {fix}) until {entry['expires']}: {entry['reason']}")
    for note in notes:
        print(f"NOTE {note}")
    reported = {advisory for advisory, _, _ in vulnerabilities}
    for entry in accepted:
        if entry["id"] not in reported:
            print(f"NOTE {entry['id']} is no longer reported: remove it from {accepted_path.name}")
    for rule, target, line in sorted(secrets):
        print(f"SECRET {rule} in {target}:{line}")
    for rule, target, title in sorted(misconfigs):
        print(f"MISCONFIG {rule} in {target}: {title}")
    return 1 if blocking(report, accepted, today, features_ok) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
