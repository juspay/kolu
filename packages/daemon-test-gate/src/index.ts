import { describe } from "vitest";

export {
  PADI_DIAL_RT_PREFIX,
  PADI_DIAL_SR_PREFIX,
  SCROLL_FIFO_DIR_PREFIX,
} from "./ciReap.ts";

/** True only when the operator has opted into forking real daemons — the CI/pu
 *  recipe (`just test-daemon`) sets it; a bare `vitest` / `pnpm test:unit` does
 *  not. Default OFF is the whole safety property. */
export function daemonTestsEnabled(): boolean {
  return process.env.KOLU_DAEMON_TESTS === "1";
}

function inTestContext(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * A `describe` block that forks real OS processes (daemons, PTYs, ssh). Runs
 * ONLY under `KOLU_DAEMON_TESTS=1`; otherwise it is `describe.skip`, so a bare
 * `vitest run` on the package forks nothing. Apply it at every real-spawn test
 * site — the deny-by-default inventory test (`no-ungated-forks.test.ts`) FAILS
 * if any file carrying a real-spawn signature is left without this gate or the
 * {@link assertDaemonSpawnAllowed} leash.
 */
export function describeDaemon(name: string, fn: () => void): void {
  (daemonTestsEnabled() ? describe : describe.skip)(name, fn);
}

/**
 * The runtime leash: call this at the exact point a test path is about to fork a
 * real, long-lived OS process (a `kaval` daemon, a PTY, an `ssh`/`nix` child).
 * In a test context with the gate OFF it THROWS; outside a test context
 * (production) it is a no-op, since `VITEST` is unset.
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
