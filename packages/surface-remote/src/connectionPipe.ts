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
import type { DownSessionState, Session, SessionState } from "./session";

/** The seeded re-serve impl for the `connection` cell — a `CellStore` already at
 *  the gate-closed `DEFAULT_CONNECTION`, ready to spread into `implementSurface`'s
 *  `cells` (`cells: { …, connection: seedConnectionCell() }`). The gate-closed
 *  seed lives here so a re-serve can't accidentally supply a connected-by-default
 *  store; the parent then writes it through the framework-wrapped
 *  `ctx.cells.connection.set` that `pipeSessionStateToCell` drives. */
export function seedConnectionCell(): { store: CellStore<ConnectionInfo> } {
  return { store: inMemoryStore({ ...DEFAULT_CONNECTION }) };
}

/** Project a `SessionState` onto the browser-facing {@link ConnectionInfo} — the
 *  discriminated MIRROR of the session sum (same `phase` arms, same `error`/`cause`
 *  on the down arms, same `log` tail). Pure; the one mapping every re-serving
 *  consumer would otherwise hand-roll.
 *
 *  Generic over the session's `Prov` so any connector's session projects (ssh's
 *  `copying`/`building`, a `never` endpoint). A generic `Prov` defeats TS's
 *  discriminated-union narrowing on the down arm, so the down arm is picked via
 *  `Extract` (its `error`/`cause` are then plain reads) and the up arm is passed
 *  through — an up `phase` outside the cell's enum would be rejected loudly at the
 *  cell's zod write, never silently. */
export function projectConnection<Prov extends string>(
  s: SessionState<Prov>,
): ConnectionInfo {
  const log = [...s.log];
  if (s.phase === "disconnected" || s.phase === "failed") {
    const down = s as DownSessionState;
    return down.phase === "failed"
      ? { phase: "failed", error: down.error, cause: "remote", log }
      : { phase: "disconnected", error: down.error, cause: down.cause, log };
  }
  // Up arm — every up phase (connecting/connected/the connector's provisioning
  // phases) carries only `log`; the cell's up members share that shape.
  return { phase: s.phase, log } as ConnectionInfo;
}

/** Subscribe `session.onState` and write each frame — projected — into a cell
 *  via `set`; returns the unsubscribe. The parent's one-liner that carries
 *  mirror health to the browser surface. */
export const pipeSessionStateToCell = <Client, Prov extends string>(
  session: Session<Client, Prov>,
  set: (info: ConnectionInfo) => void,
): (() => void) => session.onState((s) => set(projectConnection(s)));
