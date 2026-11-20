/**
 * `KOLU_STATE_DIR` is deliberately NOT scrubbed — the unit-test harness sets it
 * to an ephemeral path on purpose (server `test:unit`), and `state.ts` fail-fasts
 * without it. This scrub removes only the daemon *locators*, never the harness's
 * own explicit isolation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The daemon-locator vars that let a test process reach a live daemon. */
export const DAEMON_LOCATOR_ENV = [
  "KAVAL_SOCKET",
  "PADI_SOCKET",
  "KOLU_KAVAL_SOCKET",
  "KOLU_PADI_STATE_DIR",
] as const;

let workerDrawer: string | undefined;

/** Delete every daemon-locator var and pin `XDG_RUNTIME_DIR` to a private
 *  per-worker drawer. Idempotent; safe to call more than once. Returns the
 *  pinned runtime dir so a test can assert the isolation held. */
export function scrubDaemonLocatorEnv(): string {
  for (const key of DAEMON_LOCATOR_ENV) delete process.env[key];
  delete process.env.KOLU_ROLE;
  if (workerDrawer === undefined) {
    workerDrawer = mkdtempSync(join(tmpdir(), "kolu-vitest-xdg-"));
    process.on("exit", () => {
      try {
        rmSync(workerDrawer as string, { recursive: true, force: true });
      } catch {
        // best-effort teardown — a leaked temp dir is harmless, a throw at exit is not.
      }
    });
  }
  process.env.XDG_RUNTIME_DIR = workerDrawer;
  return workerDrawer;
}

scrubDaemonLocatorEnv();
