/**
 * `@kolu/daemon-test-gate` — the test-infrastructure leaf that makes it
 * *structurally impossible* for a bare `vitest` run to fork real daemons and
 * OOM the workstation (juspay/kolu#1375), or for a test to reach the live
 * production daemons through inherited env (juspay/kolu#1334).
 *
 * A **zero-production-dependency leaf**, consumed as a **devDependency only** by
 * every package whose tests fork real OS processes. That placement is deliberate
 * and load-bearing: the real-spawner set spans ten packages both above and below
 * the daemon stack (kaval, kaval-tui, padi, server, surface, surface-daemon,
 * surface-daemon-supervisor, surface-remote, kolu-cli), so no
 * domain-package home is legal without a workspace cycle — but a devDep arrow
 * creates no production dependency, so every one of them can reach this leaf and
 * no layer-ladder question is even expressible. It is test infrastructure (a
 * bounded gate), never a volatility receptacle (electricity.mdx's leaf tier).
 *
 * Three primitives:
 *   - {@link describeDaemon} — a `describe` block that only runs under
 *     `KOLU_DAEMON_TESTS=1` (default OFF), applied at every real-spawn test site.
 *   - {@link assertDaemonSpawnAllowed} — the RUNTIME leash the test helpers call
 *     at the moment of a real fork; throws in a test context when the gate is
 *     OFF, so helper indirection / a dynamic import / a runner the meta-lint
 *     never sees cannot smuggle a fork past the gate (the enumerative pattern
 *     scan alone was proven defeatable via `*.testlib.ts` indirection).
 *   - the `./setup` module — the per-worker env scrub (see `setup.ts`).
 */

import { describe } from "vitest";

/** True only when the operator has opted into forking real daemons — the CI/pu
 *  recipe (`just test-daemon`) sets it; a bare `vitest` / `pnpm test:unit` does
 *  not. Default OFF is the whole safety property. */
export function daemonTestsEnabled(): boolean {
  return process.env.KOLU_DAEMON_TESTS === "1";
}

/** True when running under vitest (or an explicit `NODE_ENV=test`). vitest sets
 *  `VITEST=true` in every worker; a production daemon never carries it, so the
 *  spawn leash below is a strict no-op in production. */
function inTestContext(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * A `describe` block that forks real OS processes (daemons, PTYs, ssh). Runs
 * ONLY under `KOLU_DAEMON_TESTS=1`; otherwise it is `describe.skip`, so a bare
 * `vitest run` on the package forks nothing. Apply it at every real-spawn test
 * site — the deny-by-default inventory test (`no-ungated-forks.test.ts`, F4) FAILS
 * if any file carrying a real-spawn signature is left without this gate or the
 * {@link assertDaemonSpawnAllowed} leash.
 *
 * This is the *ergonomic* gate (a skipped block reads cleanly in the reporter);
 * {@link assertDaemonSpawnAllowed} is the *structural* backstop for a fork that
 * somehow runs outside such a block.
 */
export function describeDaemon(name: string, fn: () => void): void {
  (daemonTestsEnabled() ? describe : describe.skip)(name, fn);
}

/**
 * The runtime leash: call this at the exact point a test path is about to fork a
 * real, long-lived OS process (a `kaval` daemon, a PTY, an `ssh`/`nix` child).
 * In a test context with the gate OFF it THROWS — so no helper, dynamic import,
 * or future test can smuggle a real fork past the gate, and a bare `vitest` can
 * never re-arm the #1375 fork bomb. Outside a test context (production) it is a
 * no-op: `VITEST` is unset, so the daemon spawn path is never touched.
 *
 * This is the TEST-INFRASTRUCTURE twin of kaval's PRODUCTION `assertDaemonSpawnAllowed`
 * (`kaval/src/daemonSpawnGate.ts`, F5): the same three-line env read, one in each
 * dependency tier — the leaf stays zero-dep so any test package can reach it; kaval's
 * is a production module the real daemon-spawn funnels (`localKavalDriver` /
 * `localPadiDriver`) wrap their spawn with. The split is intentional, not a duplication
 * to dedupe (deduping would drag a production dep into this devDep-only leaf, or a
 * test-only concept into kaval).
 */
export function assertDaemonSpawnAllowed(what = "a real OS process"): void {
  if (inTestContext() && !daemonTestsEnabled()) {
    throw new Error(
      `daemon-test-gate: refusing to fork ${what} in a test process while ` +
        `KOLU_DAEMON_TESTS is not set. Real-daemon test suites fork long-lived ` +
        `processes that OOM-reaped a production kaval on a workstation ` +
        `(juspay/kolu#1375); they run only under the CI/pu-only \`just ` +
        `test-daemon\` recipe (which sets KOLU_DAEMON_TESTS=1 plus a run-bind + ` +
        `bounded workers). Never run them on a machine hosting a live kolu. ` +
        `Wrap the block in \`describeDaemon(...)\` so a bare \`vitest\` skips it.`,
    );
  }
}
