/**
 * Drive a browser-facing `connection` cell from a live `HostSession` — the
 * consume-side dual of `pumpRemoteSurface` (which streams the mirror's DATA
 * out; this streams the session's STATE out). A re-serving parent calls
 * `pipeSessionStateToCell(session, set)` once per host so the link's health
 * (copying → … → failed) reaches the browser instead of dying on the backend.
 *
 * Node-side, but free of `node:` imports (pure mapping over the existing
 * `session.onState`), so it sits on the package root beside its volatility
 * owner rather than on the browser-safe `./connection` subpath.
 */

import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { type ConnectionInfo, DEFAULT_CONNECTION } from "./connection";
import type { Session, SessionState } from "./session";
import type { SshProv } from "./sshConnector";

/** The seeded re-serve impl for the `connection` cell — a `CellStore` already at
 *  the gate-closed `DEFAULT_CONNECTION`, ready to spread into `implementSurface`'s
 *  `cells` (`cells: { …, connection: seedConnectionCell() }`). The gate-closed
 *  seed lives here so a re-serve can't accidentally supply a connected-by-default
 *  store; the parent then writes it through the framework-wrapped
 *  `ctx.cells.connection.set` that `pipeSessionStateToCell` drives. */
export function seedConnectionCell(): { store: CellStore<ConnectionInfo> } {
  return { store: inMemoryStore({ ...DEFAULT_CONNECTION }) };
}

/** Project a session frame onto the browser-facing {@link ConnectionInfo}. Now a
 *  PROVABLE IDENTITY, not a re-box: `ConnectionInfo` IS `SessionState<SshProv>`, and
 *  `SessionState<Prov>` for any `Prov extends SshProv` (the ssh arm's `SshProv`, or a
 *  `never` endpoint — `never extends SshProv`) is a subtype by `Prov`-covariance, so
 *  `s` is already a `ConnectionInfo`. No arm-by-arm reconstruction, no casts, no
 *  runtime zod-throw risk — the two sums can't drift (the `connectionInfoIdentity`
 *  type-d pin enforces the schema tracks the type). Kept as a named function (rather
 *  than inlined) so every re-serving consumer names the one projection. */
export function projectConnection<Prov extends SshProv>(
  s: SessionState<Prov>,
): ConnectionInfo {
  return s;
}

/** Subscribe `session.onState` and write each frame — projected — into a cell
 *  via `set`; returns the unsubscribe. The parent's one-liner that carries
 *  mirror health to the browser surface. `Prov extends SshProv` because the
 *  `connection` cell IS the ssh session sum on the wire (a `never` endpoint is
 *  covered — `never extends SshProv`). */
export const pipeSessionStateToCell = <Client, Prov extends SshProv>(
  session: Session<Client, Prov>,
  set: (info: ConnectionInfo) => void,
): (() => void) => session.onState((s) => set(projectConnection(s)));
