/**
 * kolu-server's LOCAL-supervisor ownership gate — the P0 "never two supervisors
 * on one padi state root" fence.
 *
 * kolu-server is the SUPERVISOR of the local padi (it spawns / adopts / drains
 * it). A SECOND kolu-server pointed at the SAME state root would ALSO supervise
 * that one padi — and two supervisors that each drain-and-respawn the daemon
 * livelock it (the "two-local-kolu war": A drains to run its build, B drains to
 * run ITS build, forever). This gate makes that unconstructible at boot: the
 * FIRST supervisor CLAIMS a `supervisor.pid` gate beside the padi it supervises;
 * a second supervisor that finds a LIVE holder fails fast with a remedy
 * (isolate via `KOLU_STATE_DIR` / `KOLU_PADI_STATE_DIR`) rather than
 * co-supervising — "being able to override" is never a feature.
 *
 * REUSES the daemon pid-gate mechanism verbatim ({@link acquirePidGate} from
 * `@kolu/surface-daemon`) — the SAME atomic `link(2)` claim + stale-holder
 * liveness reap + owner-only-dir guard padi's own `padi.pid` uses — keyed at a
 * SIBLING `supervisor.pid` in the ephemeral runtime dir (boot-wiped, so a
 * crashed supervisor's stale pid never outlives it, and a same-boot crash is
 * reaped by the liveness probe). The pid-gate module's own doc names exactly this
 * composition: "the supervisor (kolu-server, from B2) composes these same
 * primitives where it lives."
 *
 * A SAME-LINEAGE restart still drains: a supervisor whose predecessor pid is DEAD
 * (a crash / restart of the one supervisor) finds a stale gate, reaps it, and
 * claims — then adopts / drains its padi normally. Only a LIVE foreign holder
 * blocks. (The REMOTE arm's twin of this gate is `remotePadiBinding.ts`'s
 * anti-livelock fight-detection → `cross-supervisor` cause, D3.)
 */

import { dirname, join } from "node:path";
// Reach padi ONLY through its `/assembly` barrel — the package-boundary seal
// (`seal.test.ts`) forbids a deep `@kolu/padi/stateRoot` import from kolu-server.
import { padiSocketPath, residentPadiSocket } from "@kolu/padi/assembly";
import {
  acquirePidGate,
  type GateAcquisition,
  type ProcessIdentity,
  type ReadProcessIdentity,
} from "@kolu/surface-daemon";
import { processIdentity } from "osfacts-client";

/** The supervisor gate filename — sits BESIDE padi's own `padi.pid` in the
 *  ephemeral `$XDG_RUNTIME_DIR/padi-<digest>/` runtime dir, so it is boot-wiped
 *  the same way (a stale supervisor pid never outlives its process) and is keyed
 *  by the SAME state-root digest padi is (two supervisors at one state root
 *  contend for the one gate). */
export const SUPERVISOR_GATE_FILE = "supervisor.pid";

/** The `supervisor.pid` path for a state root — co-located with the padi it
 *  guards. Uses the SAME `residentPadiSocket(stateRoot) ?? padiSocketPath(...)`
 *  resolution {@link ensurePadiBinding} uses to pick its socket, so the gate sits
 *  literally beside the `padi.sock` / `padi.pid` of the padi this supervisor
 *  binds — including the cross-`$XDG_RUNTIME_DIR` adopt case (#1713) where a
 *  resident padi lives in a different drawer than this process's own env would
 *  compute. */
export function supervisorGatePath(stateRoot: string): string {
  const socket = residentPadiSocket(stateRoot) ?? padiSocketPath(stateRoot);
  return join(dirname(socket), SUPERVISOR_GATE_FILE);
}

/** The verdict of trying to become the local padi's supervisor.
 *   - `self`    — we claimed the gate (hold `release` until teardown); proceed.
 *   - `foreign` — a DIFFERENT live kolu-server already supervises this state
 *                 root; boot must fail fast (see {@link supervisorConflictError}).
 *   - `dir-not-private` — the gate's runtime dir is not an owner-only 0700 dir we
 *                 own (another local user could pre-seed a gate); refuse. */
export type SupervisorClaim =
  | { kind: "self"; release: () => void }
  | { kind: "foreign"; pid: number }
  | { kind: "dir-not-private"; dir: string };

/** Injection seam for tests — a fake gate acquirer and/or gate-path resolver so a
 *  two-supervisor war can be exercised without a real padi runtime dir. Defaults
 *  are the real {@link acquirePidGate} / {@link supervisorGatePath}. */
export interface SupervisorClaimDeps {
  acquire?: (
    gatePath: string,
    self: ProcessIdentity,
    readProcessIdentity: ReadProcessIdentity,
  ) => GateAcquisition;
  resolveGatePath?: (stateRoot: string) => string;
  /** Test-only identity inject. Production reads via osfacts. */
  readProcessIdentity?: ReadProcessIdentity;
  processIdentity?: ProcessIdentity;
}

function osfactsBinPath(): string {
  const path = process.env.KOLU_OSFACTS_BIN;
  if (!path) {
    throw new Error(
      "KOLU_OSFACTS_BIN is not set — supervisor ownership requires the baked osfacts binary",
    );
  }
  return path;
}

/** Claim the local supervisor gate for `stateRoot`. A thin, total mapping over
 *  {@link acquirePidGate}'s outcome — no policy of its own beyond naming the three
 *  verdicts a supervisor cares about. */
export function claimLocalSupervisor(
  stateRoot: string,
  deps: SupervisorClaimDeps = {},
): SupervisorClaim {
  const acquire = deps.acquire ?? acquirePidGate;
  const gatePath = (deps.resolveGatePath ?? supervisorGatePath)(stateRoot);
  const readIdentity =
    deps.readProcessIdentity ??
    ((pid: number) => processIdentity(osfactsBinPath(), pid));
  const self =
    deps.processIdentity ??
    (() => {
      const identity = readIdentity(process.pid);
      if (identity === undefined) {
        throw new Error(
          `osfacts could not resolve kolu-server pid ${process.pid}`,
        );
      }
      return identity;
    })();
  const acq = acquire(gatePath, self, readIdentity);
  switch (acq.kind) {
    case "acquired":
      return { kind: "self", release: acq.release };
    case "held":
      return { kind: "foreign", pid: acq.pid };
    case "dir-not-private":
      return { kind: "dir-not-private", dir: acq.dir };
  }
}

/** The fatal boot error a non-`self` claim raises — a distinguished class the
 *  composition root logs `fatal` + `exit(1)` on, exactly like
 *  {@link PadiAdoptionRefusedError}: a second supervisor / an untrusted gate dir
 *  is structurally unresolvable (retrying can't make a live foreign holder go
 *  away), so it must fail loud with the remedy, never spin behind a silent UI. */
export class SupervisorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorConflictError";
  }
}

/** Build the {@link SupervisorConflictError} for a non-`self` claim — the message
 *  names the conflict AND the remedy (isolate the second instance's state), so a
 *  human hitting the two-local-kolu war knows exactly how to run a second instance
 *  on purpose. Extracted (not thrown inline) so the message is unit-testable. */
export function supervisorConflictError(
  claim: Extract<SupervisorClaim, { kind: "foreign" | "dir-not-private" }>,
  stateRoot: string,
): SupervisorConflictError {
  if (claim.kind === "foreign") {
    return new SupervisorConflictError(
      `another kolu-server (pid ${claim.pid}) is already supervising the padi at this ` +
        `workspace (state dir: ${stateRoot}) — two supervisors would drain-and-respawn the ` +
        `same padi in a livelock, so this boot is refused ("being able to override" is never ` +
        `a feature). If that kolu is the one you want, use it. To run a SECOND, independent ` +
        `instance here, isolate its state: set KOLU_STATE_DIR=<dir> (and KOLU_PADI_STATE_DIR=<dir> ` +
        `for an isolated padi too).`,
    );
  }
  return new SupervisorConflictError(
    `refusing to claim the local supervisor gate: its directory ${claim.dir} is not an ` +
      `owner-only private directory (another local user could pre-seed a gate there), so ` +
      `kolu-server will not supervise a padi behind a gate it cannot trust. Ensure ` +
      `$XDG_RUNTIME_DIR is your own 0700 runtime directory.`,
  );
}
