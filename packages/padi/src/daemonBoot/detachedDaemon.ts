/**
 * The ONE way a `padi --stdio` front re-execs its durable daemon.
 *
 * Both spawn sites — the relay's adopt-or-spawn (`stdioBridge.ts`) and the
 * converge pre-step's takeover driver (`convergeFront.ts`) — come through here,
 * because they must agree on two things that are easy to get subtly wrong in two
 * places:
 *
 *   - **`SSH_AUTH_SOCK` is scrubbed.** The daemon owns no ssh session, so it
 *     carries no link's socket; the one authority for a live agent is the stable
 *     link (`stdioBridge.ts`, #2313).
 *   - **the crash-catcher stderr log** (`padi.stderr.log`), mandatory for a
 *     detaching spawn whose stderr nobody will hold.
 *
 * The re-exec itself (`stripArgs: ["--stdio"]`) is the `reExecAsDetachedDaemon`
 * invariant: the single-process `node --import` form, so SIGTERM reaches the
 * daemon rather than a swallowing `tsx` fork.
 */

import { reExecAsDetachedDaemon } from "@kolu/surface-daemon";
import { padiStderrLogPath } from "../stateRoot.ts";

/** The env a detached padi daemon boots with: this process's env, minus
 *  `SSH_AUTH_SOCK` — one authority per fact (`stdioBridge.ts`, #2313). */
export function detachedPadiDaemonEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const { SSH_AUTH_SOCK: _linkOwnedSocket, ...rest } = env;
  return rest;
}

/** Re-exec THIS padi binary as the detached daemon for `stateRoot`. */
export function spawnDetachedPadi(stateRoot: string): void {
  reExecAsDetachedDaemon({
    stripArgs: ["--stdio"],
    env: detachedPadiDaemonEnv(),
    stderrLog: padiStderrLogPath(stateRoot),
  });
}
