/**
 * `@kolu/surface-nix-host/connection` — the BROWSER-SAFE connection-health
 * cell, composable into any surface mirrored over a `HostSession`.
 *
 * A re-served / mirrored surface (drishti, pulam-web) needs the browser to see
 * the backend↔remote link's health — copying / connecting / connected /
 * disconnected / failed — so a dead mirror renders honestly instead of as a
 * healthy-but-empty surface. That health is `HostSession`'s volatility; this
 * module is its consume-facing projection. THIS module imports only `zod` (and
 * `@kolu/surface/define`), so it can ride the browser bundle; the node-side pump
 * that drives the cell from a live session (`projectConnection` /
 * `pipeSessionStateToCell`) lives on the package root, which spawns ssh and must
 * not.
 *
 * The cell is composed ONLY at the nix-host re-serve seam — via `mirroredSurface`
 * (below), never hand-spread onto a base surface. So the base surface an agent /
 * daemon serves directly (or a one-shot dial reaches) stays connection-FREE: a
 * direct / local link carries no cell at all — NOT an inert stub — because it has
 * no remote to be down. Parent-only write authority follows: the cell is
 * read-only over the wire, and only the re-serving PARENT writes it (off
 * `session.onState`), so a wire client can never forge the host's health.
 */

import {
  defineSurface,
  type Surface,
  type SurfaceSpec,
} from "@kolu/surface/define";
import { z } from "zod";

/** The link phases, mirroring `HostSession`'s lifecycle 1:1 — the runtime
 *  source both the cell's `z.enum` and the `ConnectionState` type derive from,
 *  so the schema and the session type can't drift. `failed` is terminal: the
 *  reconnect loop exhausted its budget on a `"remote"` fault and gave up (a
 *  `"network"` fault never reaches it — it retries forever); `reconnect()`
 *  re-arms it. */
export const CONNECTION_STATES = [
  "copying",
  "connecting",
  "connected",
  "disconnected",
  "failed",
] as const;

/** The session's link phase. Single-sourced from {@link CONNECTION_STATES}. */
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** Why a down link is down — `"network"` (host unreachable; retries forever)
 *  vs `"remote"` (host reached, rejected us; terminal `failed`). Single-sourced
 *  here so the cell schema and `HostSession`'s `FailureCause` can't drift. */
export const FAILURE_CAUSES = ["network", "remote"] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

/** The browser-facing connection-health cell value — the four fields a viewer
 *  renders, projected from the richer `HostSessionState`. */
export const ConnectionInfoSchema = z.object({
  state: z.enum(CONNECTION_STATES),
  /** The terse failure headline when `state` is `disconnected` / `failed`. */
  lastError: z.string().nullable(),
  /** Refines a down link's message (`network` → "unreachable" vs `remote`). */
  failureCause: z.enum(FAILURE_CAUSES).nullable(),
  /** The link log tail — the real "why" behind a `failed`. */
  progressLines: z.array(z.string()).readonly(),
});
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;

/** Gate-closed by default: a freshly-composed cell reads `connecting`, so
 *  "healthy-empty before the first remote frame" is structurally
 *  unrepresentable. The parent overwrites it from the live session; the agent
 *  never does. */
export const DEFAULT_CONNECTION: ConnectionInfo = {
  state: "connecting",
  lastError: null,
  failureCause: null,
  progressLines: [],
};

/** The composable cell descriptor — composed onto a surface ONLY by
 *  {@link mirroredSurface} (the mirror seam), never hand-spread. One source of
 *  truth for the schema AND the gate-closed default, so every mirror inherits both.
 *
 *  Read-only over the wire (`verbs: ["get"]`): the parent host OWNS this cell —
 *  it writes it server-side from `session.onState` (`pipeSessionStateToCell`,
 *  which goes through the server-internal `ctx.cells.connection.set`, NOT a wire
 *  verb). A remote RPC client must never be able to `connection.set` the host's
 *  health to `connected` (or anything) — that would forge the very signal the
 *  stale-health gate trusts. Without this, a cell with no `patchSchema` would
 *  default to `["get", "set"]` and leak `set` onto the browser-facing surface. */
export const connectionCell = {
  schema: ConnectionInfoSchema,
  default: DEFAULT_CONNECTION,
  verbs: ["get"],
  // The READINESS GATE (round-5 "complete the fact"): the browser's
  // `client.health().live` AND-folds this predicate over the cell's live value,
  // so a mirror reading anything but `connected` flips the fact not-live BY
  // CONSTRUCTION — the client-side symmetry to `pumpRemoteSurface` auto-wiring the
  // server WRITE. Every surface that composes this cell (drishti, pulam-web, any
  // future viewer) inherits the fold by building a `surfaceClient` over the
  // mirrored surface; no consumer hand-ANDs `connection.state === "connected"`,
  // and a widget can no longer paint a dot green from the raw cell state. The ssh
  // VOCABULARY (`"connected"`, the four-state enum) stays HERE beside the schema;
  // `@kolu/surface` only invokes the predicate (the `resolveCellVerbs`-style
  // mechanism/vocabulary split). `DEFAULT_CONNECTION` is `connecting` — gate-closed
  // — so a freshly-composed cell reads not-live until a genuine `connected` frame.
  liveWhen: (v: ConnectionInfo) => v.state === "connected",
} as const;

/** A base spec with the reserved get-only `connection` cell added.
 *
 *  The cell part is taken CONDITIONALLY — `S extends { cells: infer C } ? C : {}`
 *  — so a cell-less base (a valid collection/stream-only surface, where `S["cells"]`
 *  is absent/`undefined`) models its existing cells as exactly `{}`, and the result
 *  is precisely `{ connection: typeof connectionCell }` rather than widening through
 *  `SurfaceSpec`'s `Record<string, CellSpec<...>>` constraint (which `NonNullable`
 *  would resolve to, typing the mirror as carrying arbitrary string-keyed cells). */
export type WithConnection<S extends SurfaceSpec> = Omit<S, "cells"> & {
  cells: (S extends { cells: infer C } ? C : unknown) & {
    connection: typeof connectionCell;
  };
};

/**
 * Augment a base surface with the gate-closed, get-only `connection` cell — the
 * "mirrored over a HostSession" seam's entry ticket.
 *
 * The BROWSER consumes `mirroredSurface(base)` and the re-serving parent serves
 * it; the BASE surface (what an agent/daemon serves directly, or a one-shot dial
 * reaches) stays connection-free, so a direct/local link carries no inert stub
 * and no contract-version dance. Composing link health is then **structurally
 * entailed for `pumpRemoteSurface` consumers** — passing `connection` makes the
 * pump wire `pipeSessionStateToCell` itself, so they can't forget it (the
 * omission that was #1564), exactly as `defineSurface` entails `system.live`. A
 * re-serve that runs its OWN pump (the remote-process-monitor example) is not
 * covered by that guarantee and must call `pipeSessionStateToCell` explicitly.
 *
 * Throws if `base` already declares a `connection` cell: `connection` is a
 * reserved name at this seam (mirroring `defineSurface`'s duplicate-`live` claim),
 * so a collision is loud rather than a silent `{...spread}` overwrite.
 */
export function mirroredSurface<S extends SurfaceSpec>(
  base: Surface<S>,
): Surface<WithConnection<S>> {
  if (base.spec.cells && "connection" in base.spec.cells) {
    throw new Error(
      'mirroredSurface: the base surface already declares a "connection" cell. ' +
        "`connection` is reserved for the mirror seam's link-health cell — rename the base cell.",
    );
  }
  return defineSurface({
    ...base.spec,
    cells: { ...base.spec.cells, connection: connectionCell },
    // The documented cast: `defineSurface`'s const-inference over the spread spec
    // doesn't line up with `WithConnection<S>` structurally, but the runtime IS
    // that surface (base primitives + the connection cell).
  }) as unknown as Surface<WithConnection<S>>;
}
