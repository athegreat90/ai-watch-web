"""Tests for the security scripts. Run: python3 -m unittest discover -s security -p "test_*.py"."""
import contextlib
import datetime
import io
import json
import tempfile
import unittest
from pathlib import Path

import check_findings
import check_nginx_features
import check_version
import refresh_base

DIGEST = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


def report(*results):
    return {"Results": list(results)}


def vuln(fixed, severity="HIGH", pkg="nginx"):
    return {"VulnerabilityID": "CVE-1", "PkgName": pkg, "FixedVersion": fixed, "Severity": severity}


class CheckFindings(unittest.TestCase):
    def test_a_fixable_vulnerability_blocks(self):
        self.assertTrue(check_findings.blocking(report({"Vulnerabilities": [vuln("1.2.3")]})))

    def test_a_vulnerability_without_a_fix_is_listed_but_does_not_block(self):
        data = report({"Vulnerabilities": [vuln("")]})
        self.assertFalse(check_findings.blocking(data))
        self.assertEqual(check_findings.collect(data)[0], {("CVE-1", "nginx", "")})

    def test_a_missing_fixed_version_counts_as_no_fix(self):
        self.assertFalse(check_findings.blocking(report({"Vulnerabilities": [{"VulnerabilityID": "CVE-2", "PkgName": "x"}]})))

    def test_any_secret_blocks(self):
        self.assertTrue(check_findings.blocking(report({"Target": "f", "Secrets": [{"RuleID": "aws", "StartLine": 3}]})))

    def test_a_high_misconfiguration_blocks_and_a_low_one_does_not(self):
        high = {"Target": "Dockerfile", "Misconfigurations": [{"ID": "DS002", "Severity": "HIGH", "Status": "FAIL"}]}
        low = {"Target": "Dockerfile", "Misconfigurations": [{"ID": "DS999", "Severity": "LOW", "Status": "FAIL"}]}
        passed = {"Target": "Dockerfile", "Misconfigurations": [{"ID": "DS002", "Severity": "HIGH", "Status": "PASS"}]}
        self.assertTrue(check_findings.blocking(report(high)))
        self.assertFalse(check_findings.blocking(report(low)))
        self.assertFalse(check_findings.blocking(report(passed)))

    def test_an_empty_report_passes(self):
        self.assertFalse(check_findings.blocking({}))
        self.assertFalse(check_findings.blocking(report({"Target": "x", "Vulnerabilities": None})))

    def test_the_same_finding_on_two_results_is_counted_once(self):
        data = report({"Vulnerabilities": [vuln("1")]}, {"Vulnerabilities": [vuln("1")]})
        self.assertEqual(len(check_findings.collect(data)[0]), 1)


GOOD = f"""ARG NODE_IMAGE=node:26.13.1-alpine@{DIGEST}
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine@{OTHER}
FROM --platform=$BUILDPLATFORM ${{NODE_IMAGE}} AS build
FROM ${{NGINX_IMAGE}}
"""


class CheckVersion(unittest.TestCase):
    def test_consistent_files_have_no_problems(self):
        self.assertEqual(check_version.problems(GOOD, "26.13.1\n", "v26.13.1\n"), [])

    def test_a_tag_without_a_digest_is_refused(self):
        bad = GOOD.replace(f"@{DIGEST}", "")
        self.assertTrue(any("NODE_IMAGE" in p for p in check_version.problems(bad, "26.13.1")))

    def test_a_short_digest_is_refused(self):
        bad = GOOD.replace(OTHER, "sha256:abc")
        self.assertTrue(any("NGINX_IMAGE" in p for p in check_version.problems(bad, "26.13.1")))

    def test_a_digest_must_be_64_hex_characters_for_both_images(self):
        for digest, key in ((DIGEST, "NODE_IMAGE"), (OTHER, "NGINX_IMAGE")):
            for bad in ("sha256:abc", "sha256:" + "g" * 64, "sha256:" + "a" * 65, "sha256:" + "A" * 64):
                with self.subTest(image=key, digest=bad[:14]):
                    problems = check_version.problems(GOOD.replace(digest, bad), "26.13.1")
                    self.assertTrue(any(key in p for p in problems), problems)

    def test_nvmrc_must_match_the_dockerfile(self):
        self.assertTrue(any(".nvmrc" in p for p in check_version.problems(GOOD, "26.12.0")))

    def test_the_running_node_must_match(self):
        self.assertTrue(any("found" in p for p in check_version.problems(GOOD, "26.13.1", "v24.1.0")))
        self.assertTrue(any("no Node" in p for p in check_version.problems(GOOD, "26.13.1", "")))

    def test_the_stages_must_use_the_pinned_arguments(self):
        bad = GOOD.replace("FROM ${NGINX_IMAGE}", "FROM nginx:latest")
        self.assertTrue(any("runtime stage" in p for p in check_version.problems(bad, "26.13.1")))
        bad = GOOD.replace("FROM --platform=$BUILDPLATFORM ", "FROM ")
        self.assertTrue(any("build stage" in p for p in check_version.problems(bad, "26.13.1")))


class RefreshBase(unittest.TestCase):
    def test_newest_picks_the_highest_patch_of_the_series(self):
        names = ["26.9.0-alpine", "26.13.1-alpine", "26.13.0-alpine", "26.13.1-alpine3.24", "26-alpine", "26.13.1"]
        self.assertEqual(refresh_base.newest(names, "26.", "26.12.0"), "26.13.1")

    def test_newest_compares_numbers_not_text(self):
        self.assertEqual(refresh_base.newest(["1.30.9-alpine", "1.30.10-alpine"], "1.30.", "1.30.6"), "1.30.10")

    def test_newest_keeps_the_current_version_when_nothing_is_newer(self):
        self.assertEqual(refresh_base.newest(["1.30.2-alpine"], "1.30.", "1.30.6"), "1.30.6")

    def test_newest_ignores_another_series(self):
        self.assertEqual(refresh_base.newest(["1.31.0-alpine", "1.29.9-alpine"], "1.30.", "1.30.6"), "1.30.6")

    def test_pin_rewrites_only_the_matching_line(self):
        new = "sha256:" + "c" * 64
        result = refresh_base.pin(GOOD, refresh_base.NGINX, "1.30.7", new)
        self.assertIn(f"nginx-unprivileged:1.30.7-alpine@{new}", result)
        self.assertIn(f"node:26.13.1-alpine@{DIGEST}", result)
        self.assertEqual(check_version.problems(result, "26.13.1"), [])

    def test_platforms_reads_the_manifest_index(self):
        index = {"manifests": [{"platform": {"os": "linux", "architecture": "amd64"}}, {"platform": {"os": "unknown", "architecture": "unknown"}}]}
        self.assertEqual(refresh_base.platforms(index), {("linux", "amd64"), ("unknown", "unknown")})
        self.assertFalse(refresh_base.REQUIRED <= refresh_base.platforms(index))

D = datetime.date
ENTRY = {"id": "CVE-1", "package": "nginx", "fixed": "1.30.7-r0", "expires": "2026-12-27", "reason": "not reachable"}
FIXABLE = report({"Vulnerabilities": [vuln("1.30.7-r0")]})


class AcceptedRisks(unittest.TestCase):
    def blocks(self, data=FIXABLE, accepted=(ENTRY,), today=D(2026, 12, 1), features_ok=True):
        return check_findings.blocking(data, accepted, today, features_ok)

    def test_an_accepted_finding_does_not_block(self):
        self.assertFalse(self.blocks())

    def test_without_the_exception_it_blocks(self):
        self.assertTrue(self.blocks(accepted=()))

    def test_the_last_day_still_counts_and_the_next_does_not(self):
        self.assertFalse(self.blocks(today=D(2026, 12, 27)))
        self.assertTrue(self.blocks(today=D(2026, 12, 28)))

    def test_it_does_not_cover_a_different_fixed_version(self):
        self.assertTrue(self.blocks(data=report({"Vulnerabilities": [vuln("1.30.8-r0")]})))

    def test_it_does_not_cover_another_package_or_advisory(self):
        self.assertTrue(self.blocks(data=report({"Vulnerabilities": [vuln("1.30.7-r0", pkg="curl")]})))
        other = {"Vulnerabilities": [{**vuln("1.30.7-r0"), "VulnerabilityID": "CVE-2"}]}
        self.assertTrue(self.blocks(data=report(other)))

    def test_a_feature_it_needs_being_on_voids_it(self):
        self.assertTrue(self.blocks(features_ok=False))

    def test_a_secret_or_misconfiguration_can_never_be_accepted(self):
        secret = report({"Target": "f", "Secrets": [{"RuleID": "x", "StartLine": 1}]})
        misconfig = report({"Target": "D", "Misconfigurations": [{"ID": "DS002", "Severity": "HIGH", "Status": "FAIL"}]})
        self.assertTrue(self.blocks(data=secret))
        self.assertTrue(self.blocks(data=misconfig))

    def test_the_reasons_it_was_not_used_are_reported(self):
        found = check_findings.collect(FIXABLE)[0]
        _, _, notes = check_findings.apply_accepted(found, [ENTRY], D(2027, 1, 1), True)
        self.assertIn("expired on 2026-12-27", notes[0])
        _, _, notes = check_findings.apply_accepted(found, [ENTRY], D(2026, 12, 1), False)
        self.assertIn("no longer applies", notes[0])

    def test_main_prints_what_is_accepted_and_what_is_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, accepted = Path(tmp, "r.json"), Path(tmp, "a.json")
            data.write_text(json.dumps(FIXABLE))
            stale = {**ENTRY, "id": "CVE-OLD", "expires": "2999-01-01"}
            accepted.write_text(json.dumps({"accepted": [{**ENTRY, "expires": "2999-01-01"}, stale]}))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = check_findings.main(["x", str(data), str(accepted)])
        self.assertEqual(code, 0)
        self.assertIn("ACCEPTED CVE-1 nginx (fix 1.30.7-r0) until 2999-01-01", out.getvalue())
        self.assertIn("NOTE CVE-OLD is no longer reported", out.getvalue())

    def test_main_blocks_once_the_exception_has_expired(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, accepted = Path(tmp, "r.json"), Path(tmp, "a.json")
            data.write_text(json.dumps(FIXABLE))
            accepted.write_text(json.dumps({"accepted": [{**ENTRY, "expires": "2020-01-01"}]}))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(check_findings.main(["x", str(data), str(accepted)]), 1)

    def test_the_shipped_file_is_well_formed(self):
        entries = json.loads(check_findings.DEFAULT_ACCEPTED.read_text())["accepted"]
        self.assertEqual(len({e["id"] for e in entries}), len(entries))
        for e in entries:
            self.assertEqual(set(e), {"id", "package", "fixed", "expires", "reason"})
            D.fromisoformat(e["expires"])
            self.assertTrue(e["reason"].strip())


def conf(text):
    tmp = tempfile.TemporaryDirectory()
    Path(tmp.name, "site.conf").write_text(text)
    return tmp


class NginxFeatureGuard(unittest.TestCase):
    def test_the_real_configuration_has_none_of_them(self):
        root = Path(__file__).resolve().parent.parent / "docker" / "nginx"
        self.assertEqual(check_nginx_features.violations(root), [])

    def test_each_forbidden_feature_is_found(self):
        cases = {
            "HTTP/2": "listen 8080 http2;",
            "HTTP/3": "listen 8443 quic;",
            "TLS": "ssl_certificate /x.pem;",
            "mail": "mail { server { } }",
            "stream": "stream { }",
            "SSI": "ssi on;",
            "mirror": "mirror /m;",
            "modules": "load_module modules/x.so;",
            "proxy TLS": "proxy_ssl_verify on;",
        }
        for name, text in cases.items():
            with self.subTest(feature=name), conf(text) as tmp:
                self.assertTrue(check_nginx_features.violations(tmp), name)

    def test_a_listen_with_any_option_is_found_and_a_plain_one_is_not(self):
        with conf("listen 8080 ssl;") as tmp:
            self.assertTrue(check_nginx_features.violations(tmp))
        with conf("listen 8080;") as tmp:
            self.assertEqual(check_nginx_features.violations(tmp), [])

    def test_any_change_to_the_listener_is_flagged_even_when_no_known_feature_is_named(self):
        # Strict on purpose: a new listener (address, option, IPv6) must make someone reread the exception.
        for text in ("listen 8080 default_server;", "listen 127.0.0.1:8080;", "listen [::]:8080;", "listen 8080 reuseport;"):
            with self.subTest(text=text), conf(text) as tmp:
                self.assertEqual(len(check_nginx_features.violations(tmp)), 1)

    def test_a_comment_does_not_count(self):
        with conf("# ssl and http2 and mirror are off\nlisten 8080; # ssl later\n") as tmp:
            self.assertEqual(check_nginx_features.violations(tmp), [])

    def test_files_in_subdirectories_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "snippets").mkdir()
            Path(tmp, "snippets", "x.conf").write_text("http2 on;")
            self.assertTrue(check_nginx_features.violations(tmp))


if __name__ == "__main__":
    unittest.main()
