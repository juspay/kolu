import { dirname, join } from "node:path";
import { padiSocketPath, residentPadiSocket } from "@kolu/padi/assembly";
import {
  acquirePidGate,
  type GateAcquisition,
  type ProcessIdentity,
  type ReadProcessIdentity,
} from "@kolu/surface-daemon";
import { processIdentityFromEnv } from "osfacts-client";

export const SUPERVISOR_GATE_FILE = "supervisor.pid";

function padiRuntimeDrawer(stateRoot: string): string {
  return dirname(residentPadiSocket(stateRoot) ?? padiSocketPath(stateRoot));
}

export function supervisorGatePath(stateRoot: string): string {
  return join(padiRuntimeDrawer(stateRoot), SUPERVISOR_GATE_FILE);
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

export interface SupervisorClaimTestDeps {
  acquire?: (
    gatePath: string,
    self: ProcessIdentity,
    readProcessIdentity: ReadProcessIdentity,
  ) => GateAcquisition;
  resolveGatePath?: (stateRoot: string) => string;
  readProcessIdentity?: ReadProcessIdentity;
  /** Optional self identity for tests. Default: osfacts of `process.pid`. */
  processIdentity?: ProcessIdentity;
}

export function claimLocalSupervisor(
  stateRoot: string,
  deps: SupervisorClaimTestDeps = {},
): SupervisorClaim {
  const acquire = deps.acquire ?? acquirePidGate;
  const gatePath = (deps.resolveGatePath ?? supervisorGatePath)(stateRoot);
  const readIdentity =
    deps.readProcessIdentity ??
    ((pid: number) => processIdentityFromEnv("KOLU_OSFACTS_BIN", pid));
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

export class SupervisorConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupervisorConflictError";
  }
}

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
