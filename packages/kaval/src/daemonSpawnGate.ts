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
