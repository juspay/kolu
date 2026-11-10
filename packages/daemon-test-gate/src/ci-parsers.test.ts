/**
 * The two awk programs in `ci/` are EXECUTED here, not read.
 *
 * Both live inside single-quoted shell strings, so one apostrophe in a comment
 * closes the program and the script dies with a syntax error. That is not a
 * hypothetical: it happened while writing the comment that now sits above
 * `gha_contexts`'s platform-family check, and it was caught by running the
 * parser rather than by reading it.
 *
 * Neither had a caller any automated check reaches. `ci/protect` runs only when
 * an operator edits branch protection — which `ci/protect`'s own header calls
 * the worst possible place for an unexercised parser ("an untested parser
 * guarding a merge gate is worse than no parser at all") — and
 * `ci/flake-build --help` runs only when a human asks for help. Same class of
 * backstop as `daemon-node.test.ts` beside it: cheap, always-on, and red the
 * moment the thing it names stops working.
 *
 * Both commands are pure bash + awk + sed. No nix, no network.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

// packages/daemon-test-gate/src → the repo root (…/kolu or a worktree).
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** The script's own exit status and streams — `--help` exits 2 by design. */
const run = (script: string, ...args: string[]) => {
  const r = spawnSync("bash", [join(REPO_ROOT, "ci", script), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("`ci/protect --contexts-only` derives the GitHub contexts from the real workflow", () => {
  // The exact strings GitHub posts as check-run names, and therefore the exact
  // strings branch protection must require. `build-and-push` is darwin-only
  // because the odu lane warms and verifies x86_64-linux; `publish-closures`
  // stays on both because nothing in the DAG posts the closure index.
  // `linux-pin` is absent on purpose: it runs on master pushes only, so a
  // pull request never gets a check-run from it.
  const r = run("protect", "--contexts-only");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim().split("\n")).toEqual([
    "build-and-push (macos-latest)",
    "publish-closures (ubuntu-latest)",
    "publish-closures (macos-latest)",
  ]);
});

test("a push-only job contributes no context, and any other `if:` is refused", () => {
  // The one exemption from "every job carries a matrix": a job that cannot run
  // on a pull request posts no check-run there, so requiring it would block
  // every merge. Anything else conditional is a hard failure rather than a
  // guess about when GitHub reports a status.
  const dir = mkdtempSync(join(tmpdir(), "kolu-ci-parsers-"));
  const matrixJobs = [
    "  build-and-push:",
    "    strategy:",
    "      matrix:",
    "        os: [macos-latest]",
    "  publish-closures:",
    "    strategy:",
    "      matrix:",
    "        os: [ubuntu-latest, macos-latest]",
  ];

  const exempt = join(dir, "exempt.yml");
  writeFileSync(
    exempt,
    [
      "jobs:",
      ...matrixJobs,
      "  linux-pin:",
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/master'",
      "    runs-on: ubuntu-latest",
      "",
    ].join("\n"),
  );
  const ok = run("protect", "--contexts-only", exempt);
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout.trim().split("\n")).toEqual([
    "build-and-push (macos-latest)",
    "publish-closures (ubuntu-latest)",
    "publish-closures (macos-latest)",
  ]);

  const unknown = join(dir, "unknown.yml");
  writeFileSync(
    unknown,
    [
      "jobs:",
      ...matrixJobs,
      "  linux-pin:",
      "    if: github.actor != 'dependabot[bot]'",
      "    runs-on: ubuntu-latest",
      "",
    ].join("\n"),
  );
  const bad = run("protect", "--contexts-only", unknown);
  expect(bad.status).not.toBe(0);
  expect(bad.stderr).toMatch(/cannot reason about/);
});

test("the contexts parser refuses a workflow that gates only one platform family", () => {
  // The invariant that replaced the old per-job "at least 2 contexts" floor:
  // across the whole workflow both families must stay gated. Asserted against
  // a workflow the parser must REJECT, so the check above cannot rot into a
  // tautology that passes whatever it is handed.
  const fixture = join(
    mkdtempSync(join(tmpdir(), "kolu-ci-parsers-")),
    "w.yml",
  );
  writeFileSync(
    fixture,
    [
      "jobs:",
      "  build-and-push:",
      "    strategy:",
      "      matrix:",
      "        os: [macos-latest]",
      "  publish-closures:",
      "    strategy:",
      "      matrix:",
      "        os: [macos-latest]",
      "",
    ].join("\n"),
  );
  const r = run("protect", "--contexts-only", fixture);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/only one platform family/);
});

test("`ci/flake-build --help` prints its options", () => {
  // `usage()` derives the help text from the file's own header comment with a
  // second awk program; a quoting slip there turns --help into an error.
  const r = run("flake-build", "--help");
  expect(r.status).toBe(2);
  expect(r.stdout).toContain("--kinds KIND");
  expect(r.stdout).toContain("--link");
  expect(r.stdout).toContain("ci/flake-build [options] FLAKE");
});
