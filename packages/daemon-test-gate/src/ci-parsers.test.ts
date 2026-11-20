import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const run = (script: string, ...args: string[]) => {
  const r = spawnSync("bash", [join(REPO_ROOT, "ci", script), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

test("`ci/protect --contexts-only` derives the GitHub contexts from the real workflow", () => {
  const r = run("protect", "--contexts-only");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim().split("\n")).toEqual([
    "build-and-push (macos-latest)",
    "publish-closures (ubuntu-latest)",
    "publish-closures (macos-latest)",
  ]);
});

test("a push-only job contributes no context, and any other `if:` is refused", () => {
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
  const r = run("flake-build", "--help");
  expect(r.status).toBe(2);
  expect(r.stdout).toContain("--kinds KIND");
  expect(r.stdout).toContain("--link");
  expect(r.stdout).toContain("ci/flake-build [options] FLAKE");
});
