"""Tests for the release helpers: semantic ordering, `latest` eligibility and idempotent publishing."""
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import automatic  # noqa: E402


class VersionTests(unittest.TestCase):
    def test_versions_compare_numerically_not_lexicographically(self):
        tags = ["v1.9.0", "v1.10.0", "v1.2.0", "v2.0.0", "v1.10.1"]
        self.assertEqual(max(tags, key=automatic.version), "v2.0.0")
        self.assertEqual(sorted(tags, key=automatic.version),
                         ["v1.2.0", "v1.9.0", "v1.10.0", "v1.10.1", "v2.0.0"])

    def test_choose_tag_bumps_patch_and_reuses_reserved_tag(self):
        tags = {"v1.1.0": "a" * 40, "v1.10.0": "b" * 40}
        self.assertEqual(automatic.choose_tag(tags, "c" * 40), "v1.10.1")
        self.assertEqual(automatic.choose_tag(tags, "b" * 40), "v1.10.0")

    def test_the_first_version_is_the_declared_one_or_0_0_1(self):
        self.assertEqual(automatic.choose_tag({}, "c" * 40, (0, 1, 0)), "v0.1.0")
        self.assertEqual(automatic.choose_tag({}, "c" * 40), "v0.0.1")

    def test_a_higher_declared_version_wins_and_a_lower_one_is_ignored(self):
        tags = {"v0.1.0": "a" * 40}
        self.assertEqual(automatic.choose_tag(tags, "c" * 40, (0, 2, 0)), "v0.2.0")
        self.assertEqual(automatic.choose_tag(tags, "c" * 40, (0, 0, 5)), "v0.1.1")
        self.assertEqual(automatic.choose_tag(tags, "c" * 40, (0, 1, 1)), "v0.1.1")

    def test_a_reserved_tag_is_kept_even_when_a_higher_version_is_declared(self):
        self.assertEqual(automatic.choose_tag({"v0.1.0": "b" * 40}, "b" * 40, (0, 9, 0)), "v0.1.0")

    def test_two_tags_on_one_commit_are_refused(self):
        with self.assertRaises(SystemExit):
            automatic.choose_tag({"v0.1.0": "b" * 40, "v0.1.1": "b" * 40}, "b" * 40)

    def test_declared_version_reads_the_highest_released_heading_only(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "CHANGELOG.md"
            path.write_text("# Changelog\n\n## [Unreleased]\n\n## [0.2.0]\n\n## [0.10.0]\n\n## [0.9.9]\n")
            self.assertEqual(automatic.declared_version(str(path)), (0, 10, 0))
            path.write_text("## [Unreleased]\n## [v1.0.0]\n")
            self.assertIsNone(automatic.declared_version(str(path)))
            self.assertIsNone(automatic.declared_version(str(Path(tmp) / "missing.md")))

    def test_release_tag_accepts_prereleases_but_version_does_not(self):
        self.assertTrue(automatic.RELEASE_TAG.fullmatch("v1.2.0-rc.1"))
        self.assertIsNone(automatic.VERSION.fullmatch("v1.2.0-rc.1"))
        for bad in ("1.2.0", "v1.2", "v01.2.3", "v1.2.3-", "v1.2.3+meta", "latest"):
            self.assertIsNone(automatic.RELEASE_TAG.fullmatch(bad), bad)


class LatestTests(unittest.TestCase):
    PUBLISHED = ["v1.0.0", "v1.1.0", "v1.9.0"]

    def test_latest_moves_only_to_the_highest_stable_version(self):
        cases = [
            ("v1.10.0", True),   # numeric, not lexicographic: 1.10 > 1.9
            ("v1.9.0", True),    # rerun of the current newest keeps latest
            ("v1.9.1", True),
            ("v1.1.0", False),   # an older release must never take latest back
            ("v1.8.0", False),
            ("v2.0.0-rc.1", False),  # prereleases never move latest
            ("v1.10.0-rc.1", False),
        ]
        for tag, expected in cases:
            with self.subTest(tag=tag):
                self.assertEqual(automatic.should_update_latest(tag, self.PUBLISHED), expected)

    def test_first_release_takes_latest(self):
        self.assertTrue(automatic.should_update_latest("v1.0.0", []))

    def test_update_latest_command(self):
        env = {"RELEASE_TAG": "v1.10.0", "GITHUB_REPOSITORY": "o/r", "AIW_PUBLISHED_TAGS": "v1.9.0 v1.1.0"}
        for tag, expected in (("v1.10.0", "true"), ("v1.1.0", "false"), ("v1.10.0-rc.1", "false")):
            with self.subTest(tag=tag), mock.patch.dict(os.environ, {**env, "RELEASE_TAG": tag}), \
                    redirect_stdout(io.StringIO()) as out:
                automatic.update_latest()
                self.assertEqual(out.getvalue().strip(), expected)
        with mock.patch.dict(os.environ, {**env, "RELEASE_TAG": "latest"}), self.assertRaises(SystemExit):
            automatic.update_latest()


class QualifiesTests(unittest.TestCase):
    def test_app_image_and_dependency_files_trigger_a_release(self):
        for path in ("src/app/core/api/parse.ts", "src/styles.scss", "public/theme-init.js", "docker/Dockerfile",
                     "docker/nginx/site.conf", "docker/entrypoint.sh", "package.json", "package-lock.json",
                     "angular.json", "tsconfig.json", "tsconfig.app.json", "compose.yaml",
                     ".dockerignore", "deploy/ai-watch-web-deploy/compose.yaml"):
            with self.subTest(path=path):
                self.assertTrue(automatic.qualifies([path]))

    def test_docs_tests_ci_and_tooling_do_not(self):
        for path in ("README.md", "docs/API.md", "src/app/core/api/parse.spec.ts", "src/app/testing/fixtures.ts",
                     "docker/test/entrypoint.test.sh", "e2e/dashboard.spec.ts", "tests/proxy/proxy.test.mjs",
                     ".github/workflows/ci.yml", "release/automatic.py", "security/smoke.sh", "compose.test.yaml",
                     "playwright.config.ts", "sonar-project.properties", "tsconfig.spec.json", "CHANGELOG.md", ".nvmrc",
                     "deploy/ai-watch-web-deploy/README.md", "eslint.config.js"):
            with self.subTest(path=path):
                self.assertFalse(automatic.qualifies([path]))

    def test_one_shipped_file_among_others_is_enough(self):
        self.assertTrue(automatic.qualifies(["README.md", "docs/x.md", "src/app/app.ts"]))
        self.assertFalse(automatic.qualifies([]))


class PublishTests(unittest.TestCase):
    def run_publish(self, exists, have=()):
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(argv)
            return mock.Mock(returncode=0 if (argv[1:3] != ["release", "view"] or exists) else 1)

        listing = '{"assets": [%s]}' % ",".join('{"name": "%s"}' % name for name in have)
        with TemporaryDirectory() as tmp:
            for name in ("a.zip", "b.bin", "SHA256SUMS"):
                (Path(tmp) / name).write_text("x")
            env = {"GITHUB_REPOSITORY": "o/r", "RELEASE_TAG": "v1.2.3", "PREVIOUS_TAG": "v1.2.2", "ASSETS_DIR": tmp}
            with mock.patch.dict(os.environ, env), mock.patch.object(automatic.subprocess, "run", fake_run), \
                    mock.patch.object(automatic, "command", return_value=listing), redirect_stdout(io.StringIO()):
                automatic.publish()
        return calls

    def test_creates_release_with_all_assets_when_missing(self):
        calls = self.run_publish(exists=False)
        create = [c for c in calls if c[1:3] == ["release", "create"]]
        self.assertEqual(len(create), 1)
        for name in ("a.zip", "b.bin", "SHA256SUMS"):
            self.assertTrue(any(arg.endswith(name) for arg in create[0]), name)
        self.assertIn("--verify-tag", create[0])
        self.assertIn("--notes-start-tag", create[0])

    def test_rerun_never_recreates_and_only_uploads_missing_assets(self):
        calls = self.run_publish(exists=True, have=["a.zip"])
        self.assertFalse([c for c in calls if c[1:3] == ["release", "create"]])
        upload = [c for c in calls if c[1:3] == ["release", "upload"]]
        self.assertEqual(len(upload), 1)
        self.assertFalse(any(arg.endswith("a.zip") for arg in upload[0]))
        self.assertTrue(any(arg.endswith("b.bin") for arg in upload[0]))
        self.assertNotIn("--clobber", upload[0])

    def test_rerun_with_everything_present_does_nothing(self):
        calls = self.run_publish(exists=True, have=["a.zip", "b.bin", "SHA256SUMS"])
        self.assertFalse([c for c in calls if c[1:3] in (["release", "create"], ["release", "upload"])])


if __name__ == "__main__":
    unittest.main()
