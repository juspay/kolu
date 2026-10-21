/**
 * The ONE way a `padi --stdio` front re-execs its durable daemon.
 *
 * Both spawn sites — the relay's adopt-or-spawn (`stdioBridge.ts`) and the
 * converge pre-step's takeover driver (`convergeFront.ts`) — come through here,
 * because they must agree on two things that are easy to get subtly wrong in two
 * places:
 *
 *   - **the link's `SSH_AUTH_SOCK` is SCRUBBED.** The front is exec'd by sshd, so
 *     its env names that link's forwarded-agent socket (`/tmp/ssh-XXXX/agent.NNN`)
 *     — a path sshd deletes when the session closes. The daemon outlives every
 *     session, so it must never carry one link's socket as its own fact; the one
 *     authority for "which agent socket is live" is the stable link in its runtime
 *     home, repointed by each bridge (`padiSshAuthSockPath`, `stdioBridge.ts`).
 *     Handing the daemon the first link's socket is exactly the bug this fixes
 *     (juspay/kolu#2313): every terminal kept a path that no longer existed.
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
 *  `SSH_AUTH_SOCK`.
 *
 *  `SSH_AUTH_SOCK` is deliberately absent rather than rewritten: the daemon owns
 *  no ssh session, so it has no live agent socket of its own to name. Terminals
 *  get the runtime-home LINK (`padiSshAuthSockPath`) when a bridge has registered
 *  one; on a local host, where no bridge ever runs, there is no link and none is
 *  stamped. One authority per fact. */
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
