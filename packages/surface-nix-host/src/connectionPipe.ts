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
import type { AnyContractRouter } from "@orpc/contract";
import { type ConnectionInfo, DEFAULT_CONNECTION } from "./connection";
import type { HostSession, HostSessionState } from "./hostSession";

/** The seeded re-serve impl for the `connection` cell — a `CellStore` already at
 *  the gate-closed `DEFAULT_CONNECTION`, ready to spread into `implementSurface`'s
 *  `cells` (`cells: { …, connection: seedConnectionCell() }`). The gate-closed
 *  seed lives here so a re-serve can't accidentally supply a connected-by-default
 *  store; the parent then writes it through the framework-wrapped
 *  `ctx.cells.connection.set` that `pipeSessionStateToCell` drives. */
export function seedConnectionCell(): { store: CellStore<ConnectionInfo> } {
  return { store: inMemoryStore({ ...DEFAULT_CONNECTION }) };
}

/** Project a `HostSessionState` onto the browser-facing {@link ConnectionInfo}
 *  — the four fields a viewer renders. Pure; the one mapping every re-serving
 *  consumer would otherwise hand-roll. */
export const projectConnection = (s: HostSessionState): ConnectionInfo => ({
  state: s.connection,
  lastError: s.lastError,
  failureCause: s.failureCause,
  progressLines: [...s.progressLines],
});

/** Subscribe `session.onState` and write each frame — projected — into a cell
 *  via `set`; returns the unsubscribe. The parent's one-liner that carries
 *  mirror health to the browser surface. */
export const pipeSessionStateToCell = <C extends AnyContractRouter>(
  session: HostSession<C>,
  set: (info: ConnectionInfo) => void,
): (() => void) => session.onState((s) => set(projectConnection(s)));
