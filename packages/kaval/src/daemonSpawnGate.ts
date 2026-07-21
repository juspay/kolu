/**
 * The PRODUCTION-safe runtime spawn leash (juspay/kolu#1334 A8 / #1375, F5).
 *
 * The real kolu daemon-spawn funnels — `localKavalDriver` (in `@kolu/padi`) and
 * `localPadiDriver` (in `packages/server`) — wrap their driver's `spawn` with this
 * check so no helper indirection / dynamic import can fork a REAL daemon from a
 * gate-off vitest worker (which is how #1375's fork bomb re-armed and how a test
 * could reach the production daemon spawn path). It reads env ONLY, so it is a
 * strict no-op in production: a real daemon never carries `VITEST`.
 *
 * This lives in `kaval` deliberately: kaval is a PRODUCTION package depended on by
 * BOTH padi (which owns `localKavalDriver`) and server (which owns
 * `localPadiDriver`), so both funnels can reach it without a devDep or a workspace
 * cycle. It is the SAME three-line env read the `@kolu/daemon-test-gate` LEAF
 * carries for the test tier — an INTENTIONAL split across the two dependency tiers
 * (the leaf stays zero-dep test infrastructure; this stays a production module the
 * real drivers can import), not a duplication to dedupe.
 */

/** True in a TEST context. IDENTICAL predicate to the `@kolu/daemon-test-gate` leaf's
 *  `inTestContext` (F18): vitest sets `VITEST=true` in every worker, and an explicit
 *  `NODE_ENV=test` is also a test context — a `NODE_ENV=test` process must NOT reach the
 *  real daemon-spawn funnels with the gate off. A production daemon carries neither, so
 *  this is a strict no-op in production. The two dependency tiers keep separate copies
 *  (the leaf stays zero-dep, this stays a production module), but the SEMANTICS must not
 *  drift — pinned by driver tests on BOTH spellings. */
function inTestContext(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

/**
 * Refuse to spawn a real daemon from a gate-off test worker. THROWS when running in a
 * test context ({@link inTestContext}: `VITEST=true` OR `NODE_ENV=test`) unless the
 * daemon-test gate is explicitly on (`KOLU_DAEMON_TESTS=1`); a strict no-op otherwise
 * (production has neither env). Call it at the exact moment a kolu driver is about to
 * fork its daemon.
 */
export function assertDaemonSpawnAllowed(what = "a real daemon process"): void {
  if (inTestContext() && process.env.KOLU_DAEMON_TESTS !== "1") {
    throw new Error(
      `refusing to spawn ${what} from a test worker while KOLU_DAEMON_TESTS ` +
        `is not set (juspay/kolu#1334/#1375): a bare test run (VITEST or ` +
        `NODE_ENV=test) must never fork a real, long-lived daemon (it OOM-reaped a ` +
        `production kaval on a workstation). Real-daemon suites run only under the ` +
        `CI/pu \`just test-daemon\` recipe, which sets KOLU_DAEMON_TESTS=1.`,
    );
  }
}
