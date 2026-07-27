/**
 * Reaping GARBAGE padis — a daemon whose STATE-ROOT no longer exists on disk.
 *
 * The state-root IS padi's identity ({@link stateRoot}) and the only place it
 * persists anything. When that directory is gone the daemon can no longer do its
 * job: it holds a socket, a kaval, a tree of PTY shells and a few hundred MB of
 * RSS for a chair nobody sits in. Nothing else notices — padi is detached, it
 * OUTLIVES the dev server that spawned it, and it has no idle timeout.
 *
 * Dev manufactures exactly this garbage. Every worktree anchors its padi at
 * `<worktree>/.kolu-dev/padi` (kolu-cli's `pnpm dev`), so the digest — and thus
 * the whole rendezvous — is per-worktree by construction. `git worktree remove`
 * then deletes the state-root and leaves the daemon running forever. On the
 * author's machine that had accumulated 16 padis and 6 kavals (~3.7 GB), six of
 * them anchored at worktrees that no longer existed, the oldest six days old.
 *
 * **One predicate is the whole selector.** `just dev-clean` deliberately does NOT
 * get a second "stop the padi at THIS state-root" verb: it deletes its own
 * `.kolu-dev` and then sweeps, because a deleted state-root IS stale by this
 * definition. One rule, two callers — and the sweep collects any ghost an earlier
 * `git worktree remove` already stranded.
 *
 * Split from `stateRoot.ts` on purpose: that module's discovery documents itself
 * as strictly read-only ("It stats dirs, reads the gate file, and reads the
 * manifest, but NEVER dials, kills, or reaps a daemon") and the info dialogs
 * depend on that. Killing lives here so the guarantee stays true.
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { gatePid, isHolderLive } from "@kolu/surface-daemon";
import { kavalGatePath } from "./ptyHost/localDriver.ts";
import {
  discoverPadiDaemons,
  type PadiDaemon,
  padiKavalSocketPath,
  SUPERVISOR_GATE_FILE,
} from "./stateRoot.ts";

/** How long a holder gets to exit on SIGTERM before the escalation to SIGKILL. */
const TERM_GRACE_MS = 5_000;

/** Liveness poll interval while waiting out {@link TERM_GRACE_MS}. */
const POLL_MS = 100;

/** A discovered padi PROVEN stale — its manifest names a state-root that is gone.
 *  Narrower than {@link PadiDaemon}: `stateRoot` is non-null, because an
 *  unreadable manifest is never classified stale (see {@link stalePadis}). */
export type StalePadi = PadiDaemon & { stateRoot: string };

/** What {@link reapStalePadis} did to one stale daemon. */
export interface ReapedPadi {
  /** The state-root its manifest names — the directory that no longer exists. */
  stateRoot: string;
  /** The padi socket whose runtime dir was cleared. */
  socket: string;
  /** The gate holders stopped; `null` when no gate file named one. */
  supervisorPid: number | null;
  padiPid: number | null;
  kavalPid: number | null;
}

/** Signal `pid`, treating "it already exited" as the outcome we wanted.
 *
 *  ESRCH means the process died between our liveness read and this signal —
 *  success, not an error. Anything else (notably EPERM: another user's pid
 *  squatting a digest we computed) is a genuine failure and MUST surface rather
 *  than collapse into a silent no-op. */
function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

/** SIGTERM a gate holder, wait out the grace window, then SIGKILL. THROWS if the
 *  pid is still alive afterwards.
 *
 *  These are foreign pids (a detached daemon, not our child), so there is no
 *  `child.kill` to reuse — liveness is the same `isHolderLive` probe the gate
 *  mechanism itself uses. A holder that survives SIGKILL means we were wrong about
 *  what we were reaping; that must stop the reap loudly rather than be reported as
 *  a soft outcome the caller might ignore and then delete a live daemon's socket
 *  anyway. An ALREADY-dead pid is a no-op success — a crashed padi's stale
 *  registration is exactly what we are here to clear. */
async function stopPid(pid: number): Promise<void> {
  if (!isHolderLive(pid)) return;
  signalPid(pid, "SIGTERM");
  const deadline = Date.now() + TERM_GRACE_MS;
  while (isHolderLive(pid)) {
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  if (!isHolderLive(pid)) return;
  signalPid(pid, "SIGKILL");
  await sleep(POLL_MS);
  if (isHolderLive(pid)) {
    throw new Error(`padi reap: pid ${pid} survived SIGKILL`);
  }
}

/** Every discovered padi whose state-root is gone.
 *
 *  A daemon whose manifest is unreadable (`stateRoot === null`) is NEVER stale:
 *  reaping requires proof, and "I could not read what this daemon is anchored to"
 *  is the opposite of proof. It is left alone (and stays visible in the info
 *  dialog's raw discovery listing).
 *
 *  `extraRegimes` threads to {@link discoverPadiDaemons} exactly as
 *  `residentPadiSocket` does — the real `/run/user/$UID` guess by default; a test
 *  substitutes a fabricated drawer. */
export function stalePadis(
  extraRegimes?: readonly (string | undefined)[],
): StalePadi[] {
  const discovered =
    extraRegimes === undefined
      ? discoverPadiDaemons()
      : discoverPadiDaemons(extraRegimes);
  return discovered.filter(
    (d): d is StalePadi => d.stateRoot !== null && !existsSync(d.stateRoot),
  );
}

/** Stop ONE stale padi — its supervisor, itself, its kaval — then clear its
 *  runtime rendezvous.
 *
 *  Takes an EXPLICIT target rather than re-running discovery, so the destructive
 *  half never re-scans: a caller reaps exactly the daemons it already decided are
 *  stale. That split is what lets a unit test reap a fabricated daemon without any
 *  chance of collecting a real one that happens to be registered under the `/tmp`
 *  regime discovery always unions in. */
export async function reapPadi(daemon: StalePadi): Promise<ReapedPadi> {
  const runtimeDir = dirname(daemon.socket);
  const kavalSocket = padiKavalSocketPath(daemon.stateRoot);
  const supervisorPid = gatePid(join(runtimeDir, SUPERVISOR_GATE_FILE)) ?? null;
  const kavalPid = gatePid(kavalGatePath(kavalSocket)) ?? null;
  // Strict order, each step justified by what the previous one would otherwise
  // undo:
  //   1. the SUPERVISOR (a kolu-server) — it spawns/adopts/drains this padi, so
  //      killing padi under a live supervisor just gets it respawned. A supervisor
  //      still running against a DELETED state-root is broken anyway: `just
  //      dev-clean` reaches exactly this case, since it removes its own
  //      `.kolu-dev` while its `just dev` may still be up.
  //   2. padi itself.
  //   3. the kaval, which padi does NOT take down on its own way out (SIGTERMing a
  //      padi by hand leaves its kaval — and that kaval's PTY shells — running). A
  //      kaval left behind is the very ghost this sweep exists to collect.
  if (supervisorPid !== null) await stopPid(supervisorPid);
  if (daemon.gatePid !== null) await stopPid(daemon.gatePid);
  if (kavalPid !== null) await stopPid(kavalPid);
  // Reached only once every holder is PROVEN gone (`stopPid` throws otherwise).
  // Removing a LIVE daemon's socket, gate and manifest would strand it — still
  // running, still holding its PTYs, but now undiscoverable and so unreapable.
  rmSync(runtimeDir, { recursive: true, force: true });
  rmSync(dirname(kavalSocket), { recursive: true, force: true });
  return {
    stateRoot: daemon.stateRoot,
    socket: daemon.socket,
    supervisorPid,
    padiPid: daemon.gatePid,
    kavalPid,
  };
}
