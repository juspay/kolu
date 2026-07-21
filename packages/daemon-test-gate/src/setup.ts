/**
 * Per-worker env scrub — a vitest `setupFiles` module (`@kolu/daemon-test-gate/setup`).
 *
 * The daemon-locator env vars a production kolu stamps into every terminal it
 * spawns (`KAVAL_SOCKET`, `PADI_SOCKET`, `KOLU_KAVAL_SOCKET`) and the padi
 * state-root override (`KOLU_PADI_STATE_DIR`) are how a flag-less `kaval-tui` /
 * `padi-tui` — or any code that reads them — reaches THIS host's live daemons.
 * A developer runs `vitest` from inside a production kolu terminal, the worker
 * inherits those stamps, and a test (or a helper it calls) can then dial, kill,
 * or adopt the production daemon (juspay/kolu#1334 adversary path). This module
 * DELETES them in every vitest worker before any test runs, so a test process is
 * structurally blind to the production daemons — it can only ever see a daemon it
 * explicitly stood up under its own isolated paths.
 *
 * `XDG_RUNTIME_DIR` is not deleted but PINNED to a fresh per-worker owner-only
 * dir: every digest-keyed socket path a test computes then lands in an isolated
 * runtime drawer, never production's `/run/user/$UID`. (Deleting it would fall
 * back to the shared `/tmp/<app>-$UID`, still collidable; a private drawer is the
 * same isolation the e2e hooks already give each worker.)
 *
 * `KOLU_ROLE` — the host-isolation role marker (juspay/kolu#1334) — is scrubbed too,
 * as forward-looking hygiene: it is not a daemon locator, but WHEN the role-based
 * bind/act refusals land, a leaked `KOLU_ROLE=production` in a worker would make
 * `selfRole()` report production and no-op those refusals — so a test could reach the
 * real default state-root even with the locators gone. Deleting it here keeps the
 * fail-safe default (`dev`) regardless of how the var arrived in the environment; a
 * gated test that needs a production daemon sets the role for that daemon explicitly.
 *
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

/** The per-worker drawer, created once and reused (so repeated calls don't leak a
 *  dir per call). Removed at process exit. */
let workerDrawer: string | undefined;

/** Delete every daemon-locator var and pin `XDG_RUNTIME_DIR` to a private
 *  per-worker drawer. Idempotent; safe to call more than once. Returns the
 *  pinned runtime dir so a test can assert the isolation held. */
export function scrubDaemonLocatorEnv(): string {
  for (const key of DAEMON_LOCATOR_ENV) delete process.env[key];
  // Forward-looking: not a locator, but WHEN the role-based bind/act refusals land a
  // leaked `KOLU_ROLE=production` would no-op them (a worker could reach the real
  // default state-root even with the locators gone). Fail-safe default is `dev`.
  delete process.env.KOLU_ROLE;
  // A FRESH random private drawer (mkdtemp — never a predictable pid path a
  // reused pid could re-enter into a stale socket/gate), created ONCE per worker
  // and removed at exit, so socket paths a test computes never resolve
  // production's runtime dir and no dir leaks.
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

// Side effect on import — this module is referenced from each package's vitest
// `setupFiles`, which vitest evaluates in every worker before the test files.
scrubDaemonLocatorEnv();
