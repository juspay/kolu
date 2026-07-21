/**
 * A7 (juspay/kolu#1375) — the `daemon` CI node must stay wired.
 *
 * The daemon-forking unit suites are gated OFF by default (`describeDaemon` keys on
 * `KOLU_DAEMON_TESTS`), so the fork-free `unit` node alone would run them as EMPTY
 * with CI still green — the coverage this whole package exists to enforce would
 * silently evaporate in a recipe refactor. `ci/mod.just` therefore carries a distinct
 * `daemon` node that sets `KOLU_DAEMON_TESTS=1`, wired into the `default` DAG. This
 * always-on test (no daemon fork, so it runs in the plain `unit` lane) is the backstop
 * `ci/mod.just` names: it fails loudly if the node is dropped from the DAG or stops
 * setting the gate, rather than letting daemon coverage vanish unnoticed.
 */

import { readFileSync } from "node:fs";
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
const CI = readFileSync(join(REPO_ROOT, "ci", "mod.just"), "utf8");

test("ci/mod.just wires `daemon` into the default DAG", () => {
  // The `default` target lists every node the runner expands `depends_on` from.
  const defaultTarget = CI.split("\n").find((l) => l.startsWith("default:"));
  expect(
    defaultTarget,
    "ci/mod.just must declare a `default:` DAG target",
  ).toBeDefined();
  expect(
    (defaultTarget as string).split(/\s+/),
    "`daemon` must be a node in the `default` DAG (else the daemon suites never run in CI)",
  ).toContain("daemon");
});

test("the `daemon` recipe turns the gate ON (KOLU_DAEMON_TESTS=1)", () => {
  // The recipe body is the indented line(s) after the `daemon:` target header.
  const lines = CI.split("\n");
  const start = lines.findIndex((l) => /^daemon:/.test(l));
  expect(
    start,
    "ci/mod.just must declare a `daemon:` recipe",
  ).toBeGreaterThanOrEqual(0);
  // The recipe body is the CONSECUTIVE indented lines after the header; it ends at the
  // first line that is neither indented nor blank (the next recipe/comment). Collect
  // only those so an unrelated later recipe's `KOLU_DAEMON_TESTS` can't satisfy this.
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s+\S/.test(line) || line.trim() === "") body.push(line);
    else break;
  }
  expect(
    body.join("\n"),
    "the `daemon` recipe must set KOLU_DAEMON_TESTS=1 so the gated suites actually run",
  ).toContain("KOLU_DAEMON_TESTS=1");
});
