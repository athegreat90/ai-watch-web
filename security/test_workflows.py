"""Policy tests for the GitHub Actions workflows (no YAML library: the rules are line based).

Run: python3 -m unittest discover -s security -p "test_*.py"
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = {path.name: path.read_text() for path in sorted((ROOT / ".github" / "workflows").glob("*.yml"))}
USES = re.compile(r"^\s*-?\s*uses:\s*(\S+)", re.M)


def job_block(text, job):
    """The text of one job, from its `  name:` line to the next job or the end."""
    match = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text, re.M | re.S)
    assert match, f"job {job} not found"
    return match[1]


class Pinning(unittest.TestCase):
    def test_there_are_workflows(self):
        self.assertTrue({"ci.yml", "automatic-release.yml", "publish-image.yml", "remediate.yml"} <= set(WORKFLOWS))

    def test_every_action_is_pinned_to_a_full_commit_sha(self):
        for name, text in WORKFLOWS.items():
            for ref in USES.findall(text):
                with self.subTest(workflow=name, uses=ref):
                    self.assertRegex(ref, r"@[0-9a-f]{40}$")

    def test_every_pinned_action_says_which_version_it_is(self):
        for name, text in WORKFLOWS.items():
            for line in text.splitlines():
                if USES.match(line) and "docker/setup-qemu" not in line:
                    with self.subTest(workflow=name, line=line.strip()):
                        self.assertRegex(line, r"# v?\d+\.\d+\.\d+")

    def test_dependabot_keeps_the_pins_current(self):
        text = (ROOT / ".github" / "dependabot.yml").read_text()
        self.assertIn("package-ecosystem: github-actions", text)

    def test_the_actionlint_image_is_pinned_by_digest(self):
        self.assertRegex(WORKFLOWS["ci.yml"], r"rhysd/actionlint@sha256:[0-9a-f]{64}")


class Permissions(unittest.TestCase):
    def test_every_workflow_starts_with_read_only_contents(self):
        for name, text in WORKFLOWS.items():
            with self.subTest(workflow=name):
                self.assertRegex(text, r"(?m)^permissions:\n  contents: read\n")

    def test_pull_request_target_is_never_used(self):
        for name, text in WORKFLOWS.items():
            with self.subTest(workflow=name):
                self.assertNotIn("pull_request_target", text)

    def test_write_permissions_only_where_a_release_is_made(self):
        for name, text in WORKFLOWS.items():
            writes = re.findall(r"^\s+(contents|packages|id-token|security-events): write", text, re.M)
            with self.subTest(workflow=name):
                if name in ("automatic-release.yml", "publish-image.yml"):
                    self.assertEqual(sorted(writes), ["contents", "packages"])
                elif name == "ci.yml":
                    self.assertEqual(writes, ["id-token"])
                elif name == "codeql.yml":
                    self.assertEqual(writes, ["security-events"])
                else:
                    self.assertEqual(writes, [])

    def test_the_oidc_token_only_exists_in_the_sonar_job_and_never_for_pull_requests(self):
        sonar = job_block(WORKFLOWS["ci.yml"], "sonar")
        self.assertIn("id-token: write", sonar)
        self.assertIn("if: github.event_name != 'pull_request'", sonar)
        others = WORKFLOWS["ci.yml"].replace(sonar, "")
        self.assertNotIn("id-token", others)

    def test_secrets_never_reach_a_job_that_runs_for_pull_requests(self):
        ci = WORKFLOWS["ci.yml"]
        sonar = job_block(ci, "sonar")
        self.assertNotIn("secrets.", ci.replace(sonar, ""))
        for name in ("automatic-release.yml", "publish-image.yml"):
            self.assertNotIn("secrets.", WORKFLOWS[name].replace("${{ secrets.GITHUB_TOKEN }}", ""))

    def test_checkouts_do_not_keep_the_token(self):
        for name, text in WORKFLOWS.items():
            checkouts = len(re.findall(r"uses: actions/checkout@", text))
            kept = len(re.findall(r"persist-credentials: false", text))
            with self.subTest(workflow=name):
                self.assertEqual(checkouts, kept)


class Release(unittest.TestCase):
    def test_the_automatic_release_follows_a_successful_ci_run_on_main_of_this_repository(self):
        text = WORKFLOWS["automatic-release.yml"]
        self.assertRegex(text, r"workflows: \[CI\]")
        self.assertIn("types: [completed]", text)
        self.assertIn("branches: [main]", text)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", text)
        self.assertIn("github.event.workflow_run.event == 'push'", text)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", text)

    def test_it_releases_the_commit_that_was_tested_not_the_branch_tip(self):
        text = WORKFLOWS["automatic-release.yml"]
        self.assertIn("ref: ${{ github.event.workflow_run.head_sha }}", text)
        self.assertIn("TESTED_SHA: ${{ github.event.workflow_run.head_sha }}", text)

    def test_both_publication_paths_share_one_serial_queue(self):
        for name in ("automatic-release.yml", "publish-image.yml"):
            with self.subTest(workflow=name):
                self.assertRegex(WORKFLOWS[name], r"concurrency:\n(  #.*\n)*  group: publish-release\n  queue: max\n")

    def test_the_manual_path_requires_a_green_ci_run_for_the_commit(self):
        self.assertIn("release/require-ci.sh", WORKFLOWS["publish-image.yml"])

    def test_every_publishing_step_is_skipped_when_no_tag_was_reserved(self):
        text = WORKFLOWS["automatic-release.yml"]
        steps = text.split("      - ")[1:]
        for step in steps:
            if any(word in step for word in ("check-image", "assets.sh", "push-image", "automatic.py publish", "setup-qemu")):
                with self.subTest(step=step.splitlines()[0]):
                    self.assertIn("steps.version.outputs.tag != ''", step)

    def test_a_release_rescans_both_architectures_before_it_publishes(self):
        text = WORKFLOWS["automatic-release.yml"]
        self.assertLess(text.index("check-image.sh amd64"), text.index("push-image.sh"))
        self.assertLess(text.index("check-image.sh arm64"), text.index("push-image.sh"))

    def test_sonar_is_a_required_part_of_ci_and_waits_for_the_gate(self):
        sonar = job_block(WORKFLOWS["ci.yml"], "sonar")
        self.assertIn("-Dsonar.qualitygate.wait=true", sonar)

    def test_ci_covers_both_architectures_and_the_browser_tests(self):
        ci = WORKFLOWS["ci.yml"]
        self.assertIn("arch: [amd64, arm64]", ci)
        self.assertIn("npm run e2e", ci)
        self.assertIn("npm run test:proxy", ci)

    def test_ci_tries_the_publication_script_against_a_registry(self):
        block = job_block(WORKFLOWS["ci.yml"], "release-script")
        self.assertIn("bash release/test_push_image.sh", block)
        self.assertIn("docker/setup-qemu-action", block)

    def test_ci_runs_the_installer_test_on_linux(self):
        block = job_block(WORKFLOWS["ci.yml"], "deploy")
        self.assertIn("bash deploy/test_install.sh", block)
        self.assertIn("docker build", block)

    def test_a_run_on_main_is_never_cancelled(self):
        ci = WORKFLOWS["ci.yml"]
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", ci)
        # GitHub cancels an older pending run of the same group even without cancel-in-progress, so a
        # run on main must have a group of its own or a release can be lost.
        self.assertIn("group: ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}", ci)

    def test_a_candidate_is_tested_on_the_node_version_it_brings(self):
        text = WORKFLOWS["remediate.yml"]
        tests = text.index("name: Tests on the candidate")
        second_setup = text.rindex("actions/setup-node")
        self.assertNotEqual(second_setup, text.index("actions/setup-node"), "needs a second setup-node")
        self.assertLess(second_setup, tests)
        self.assertLess(text.index("security/remediate.sh"), second_setup)


if __name__ == "__main__":
    unittest.main()
