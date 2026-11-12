/**
 * `ci/protect`'s APPLY path, driven against a stand-in `gh` that keeps the
 * classic required-checks list in a file. No network, no GitHub, no odu: a
 * fake `nix` stands in for `nix run ./ci#odu`, whose half (the ruleset) is
 * odu's own to test.
 *
 * The two properties under test are the two that failed on master: the classic
 * list must END UP exactly the cache-warm contexts — a stale one dropped, no
 * `ci::*` copy kept — and a second run must succeed and write nothing. The old
 * script appended with POST, so the second run 422'd on a context already there
 * and the stale `build-and-push (ubuntu-latest)` was never removed.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const PROTECT = join(REPO_ROOT, "ci", "protect");
const CLASSIC =
  "repos/acme/widget/branches/main/protection/required_status_checks";

// Every call the script may make is spelled out; anything else fails loudly,
// so a script that starts calling somewhere new is red here rather than
// silently answered.
const FAKE_GH = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/gh.log"
case "$*" in
  "repo view --json nameWithOwner -q .nameWithOwner") echo acme/widget ;;
  "repo view --json defaultBranchRef -q .defaultBranchRef.name") echo main ;;
  "api ${CLASSIC} -q .contexts[]") cat "$FAKE_DIR/classic" ;;
  "api -X PUT ${CLASSIC}/contexts "*)
    shift 4
    : > "$FAKE_DIR/classic.next"
    while [ $# -gt 0 ]; do
      case "$1 $2" in
        "-f contexts[]="*) printf '%s\\n' "\${2#"contexts[]="}" >> "$FAKE_DIR/classic.next"; shift 2 ;;
        *) echo "fake gh: unexpected PUT arg: $1" >&2; exit 1 ;;
      esac
    done
    # A write GitHub acknowledges but does not apply — what the read-back exists for.
    [ -n "$FAKE_GH_DROP_WRITES" ] || mv "$FAKE_DIR/classic.next" "$FAKE_DIR/classic"
    ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
`;

const FAKE_NIX = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/nix.log"
`;

const sandbox = (classic: readonly string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "kolu-ci-protect-"));
  for (const [name, body] of [
    ["gh", FAKE_GH],
    ["nix", FAKE_NIX],
  ] as const) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, "classic"), classic.map((c) => `${c}\n`).join(""));
  const protect = (env: Record<string, string> = {}) => {
    const r = spawnSync("bash", [PROTECT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        FAKE_DIR: dir,
        PATH: `${dir}:${process.env.PATH}`,
      },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const classicNow = () =>
    readFileSync(join(dir, "classic"), "utf8").split("\n").filter(Boolean);
  const puts = () =>
    readFileSync(join(dir, "gh.log"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("api -X PUT")).length;
  return { protect, classicNow, puts };
};

/** The derived set, from the script's own door — not a third copy of it. */
const derived = () => {
  const r = spawnSync("bash", [PROTECT, "--contexts-only"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim().split("\n");
};

test("the classic list is replaced with exactly the derived set, and a second run writes nothing", () => {
  const want = derived();
  // master's classic list on the day this broke, in miniature: a `ci::*` copy
  // of the ruleset's list, the current cache-warm contexts, and one whose job
  // no longer posts it.
  const { protect, classicNow, puts } = sandbox([
    "ci::nix@x86_64-linux",
    "ci::e2e@x86_64-linux",
    ...want,
    "build-and-push (ubuntu-latest)",
  ]);

  const first = protect();
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toContain("  - build-and-push (ubuntu-latest)");
  expect(first.stdout).toContain("  - ci::nix@x86_64-linux");
  expect(classicNow().sort()).toEqual([...want].sort());
  expect(puts()).toBe(1);

  const second = protect();
  expect(second.status, second.stderr).toBe(0);
  expect(second.stdout).toMatch(/already requires exactly/);
  expect(classicNow().sort()).toEqual([...want].sort());
  expect(puts()).toBe(1);
});

test("an empty classic list is filled with the derived set", () => {
  const want = derived();
  const { protect, classicNow } = sandbox([]);
  const r = protect();
  expect(r.status, r.stderr).toBe(0);
  for (const c of want) expect(r.stdout).toContain(`  + ${c}`);
  expect(classicNow().sort()).toEqual([...want].sort());
});

test("a write GitHub accepts but does not apply fails the read-back", () => {
  const { protect } = sandbox(["build-and-push (ubuntu-latest)"]);
  const r = protect({ FAKE_GH_DROP_WRITES: "1" });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/not exactly the nix-cache\.yml contexts/);
  expect(r.stderr).toContain("build-and-push (ubuntu-latest)");
});
