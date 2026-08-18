/**
 * A7 (juspay/kolu#1375) — the `daemon` CI node must stay wired.
 *
 * The daemon-forking unit suites are gated OFF by default (`describeDaemon` keys on
 * `KOLU_DAEMON_TESTS`), so the fork-free `unit` node alone would run them as EMPTY
 * with CI still green — the coverage this whole package exists to enforce would
 * silently evaporate in a recipe refactor. `ci/mod.just` therefore carries a distinct
 * `daemon` node that delegates to the canonical `test-daemon` recipe, wired into the
 * `default` DAG. That root recipe sets `KOLU_DAEMON_TESTS=1`. This always-on test (no
 * daemon fork, so it runs in the plain `unit` lane) is the backstop `ci/mod.just`
 * names: it fails loudly if the node is dropped from the DAG, stops delegating, or
 * the canonical recipe stops setting the gate.
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
const ROOT = readFileSync(join(REPO_ROOT, "justfile"), "utf8");
const DEV_SMOKE = readFileSync(
  join(REPO_ROOT, "packages", "tests", "devSmoke.ts"),
  "utf8",
);

function recipeBody(source: string, recipe: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${recipe}:`).test(line));
  expect(start, `must declare a \`${recipe}:\` recipe`).toBeGreaterThanOrEqual(
    0,
  );
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s+\S/.test(line) || line.trim() === "") body.push(line);
    else break;
  }
  return body.join("\n");
}

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

test("the `daemon` node waits for the fork-free `unit` workspace", () => {
  const daemonTarget = CI.split("\n").find((line) =>
    line.startsWith("daemon:"),
  );
  expect(
    daemonTarget,
    "ci/mod.just must declare a `daemon:` DAG target",
  ).toBeDefined();
  expect(
    daemonTarget?.split(/\s+/),
    "`daemon` must not run a second 63-package workspace beside `unit`",
  ).toContain("unit");
});

test("the `daemon` recipe delegates to the canonical daemon-test recipe", () => {
  expect(
    recipeBody(CI, "daemon"),
    "the CI node must reuse the canonical bounded daemon-test recipe",
  ).toContain("just --no-deps test-daemon");
});

test("the canonical daemon-test recipe turns the gate and spawn leash ON", () => {
  const body = recipeBody(ROOT, "test-daemon");
  expect(
    body,
    "`test-daemon` must set KOLU_DAEMON_TESTS=1 so the gated suites actually run",
  ).toContain("KOLU_DAEMON_TESTS=1");
  expect(
    body,
    "`test-daemon` must bind spawned daemon lifetimes to the recipe process",
  ).toContain("KOLU_DAEMON_BIND_PID=$$");
});

test("test-daemon and e2e `test` reap this-run leftovers on EXIT (#2178)", () => {
  for (const recipe of ["test-daemon", "test"] as const) {
    const body = recipeBody(ROOT, recipe);
    expect(
      body,
      `\`${recipe}\` must run the CI janitor even when the suite is signal-killed`,
    ).toContain("trap cleanup EXIT");
    expect(
      body,
      `\`${recipe}\` must invoke the shipped janitor, not a parallel rm`,
    ).toContain("just _reap-ci-run");
    expect(
      body,
      `\`${recipe}\` must tell the janitor this-run bind pid so EXIT can reap while $$ is still alive`,
    ).toContain("KOLU_CI_REAP_BIND_PID=$$");
  }
  const testBody = recipeBody(ROOT, "test");
  expect(
    testBody.indexOf("just _reap-ci-run"),
    "janitor must run before the suite lock is released",
  ).toBeLessThan(testBody.indexOf('rm -rf "$lock"'));
  const quickAt = ROOT.search(/^test-quick \*args:/m);
  expect(quickAt, "must declare a `test-quick` recipe").toBeGreaterThanOrEqual(
    0,
  );
  const quick = ROOT.slice(quickAt, quickAt + 800);
  expect(
    quick,
    "`test-quick` mints the same leftover FIFOs and must reap them on EXIT",
  ).toContain("trap cleanup EXIT");
  expect(quick).toContain("just _reap-ci-run");
});

test("e2e `test` keeps the janitor on EXIT after the suite-lock acquire (#2178)", () => {
  const body = recipeBody(ROOT, "test");
  const traps = [...body.matchAll(/^\s*trap\s+\S.*$/gm)].map((m) =>
    m[0].trim(),
  );
  expect(traps.length, "`test` must arm an EXIT trap").toBeGreaterThan(0);
  expect(
    traps.at(-1),
    "the LAST trap in `test` must still be `cleanup` — a later `trap 'rm -rf \"$lock\"' EXIT` would clobber the janitor on the locked path that creates kolu-scroll-fifo-*",
  ).toBe("trap cleanup EXIT");
  expect(
    body,
    "lock release must live inside cleanup(), not a second EXIT trap",
  ).toMatch(/rm -rf "\$lock"/);
  expect(
    body,
    "a dedicated lock-only EXIT trap replaces cleanup and is the #2178 leak",
  ).not.toMatch(/trap ['"]rm -rf "\$lock"['"] EXIT/);
});

test("e2e `test` assigns lock= only after mkdir owns the suite lock", () => {
  // cleanup() rms `$lock` whenever it is non-empty. Assigning the suite
  // path before mkdir succeeds means a waiter killed on `sleep 15` deletes
  // a live peer's lock. The wait loop must use a different name; `lock=`
  // of the path is allowed only after mkdir.
  const body = recipeBody(ROOT, "test");
  expect(
    body,
    "must not assign the suite-lock path to `lock` before acquire",
  ).not.toMatch(/^\s*lock=\/tmp\/kolu-e2e-suite\.lock/m);
  const mkdirAt = body.search(/mkdir "\$candidate"/);
  const assignAt = body.search(/lock=\$candidate/);
  expect(mkdirAt, 'acquire is `mkdir "$candidate"`').toBeGreaterThanOrEqual(0);
  expect(
    assignAt,
    "`lock=$candidate` is what cleanup() rms — must exist",
  ).toBeGreaterThanOrEqual(0);
  expect(
    assignAt,
    "`lock=$candidate` must come after mkdir succeeds, not before the wait loop",
  ).toBeGreaterThan(mkdirAt);
});

test("create sites import the janitor's leftover prefixes (#2178)", () => {
  const dial = readFileSync(
    join(REPO_ROOT, "packages", "padi", "src", "dial.test.ts"),
    "utf8",
  );
  expect(
    dial,
    "padi-dial runtime roots must come from the janitor's prefix constants",
  ).toMatch(/PADI_DIAL_RT_PREFIX/);
  expect(dial).toMatch(/PADI_DIAL_SR_PREFIX/);
  const steps = readFileSync(
    join(
      REPO_ROOT,
      "packages",
      "tests",
      "step_definitions",
      "scroll_lock_steps.ts",
    ),
    "utf8",
  );
  expect(
    steps,
    "scroll-fifo dirs must come from SCROLL_FIFO_DIR_PREFIX",
  ).toMatch(/SCROLL_FIFO_DIR_PREFIX/);
  const fifo = readFileSync(
    join(REPO_ROOT, "packages", "tests", "support", "scrollFifo.ts"),
    "utf8",
  );
  expect(
    fifo,
    "the FIFO leftover prefix must be the janitor's, not a local copy",
  ).toMatch(/from "@kolu\/daemon-test-gate\/ciReap"/);
});

test("the shipped janitor recipe drives ciReap.cli.ts", () => {
  const body = recipeBody(ROOT, "_reap-ci-run");
  expect(
    body,
    "`_reap-ci-run` must execute the shipped TypeScript janitor",
  ).toContain("ciReap.cli.ts");
  expect(
    body,
    "`_reap-ci-run` must pin the runtime root so nix develop cannot retarget TMPDIR",
  ).toContain("KOLU_CI_REAP_ROOT");
});

test("the dev smoke binds its detached daemon tree to the smoke process", () => {
  expect(
    DEV_SMOKE,
    "`dev-smoke` must not leave its detached padi/kaval tree alive after CI",
  ).toContain("KOLU_DAEMON_BIND_PID: String(process.pid)");
});
