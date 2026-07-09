/**
 * `@kolu/surface-remote/connection` — the BROWSER-SAFE connection-health
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
 * The cell is composed ONLY at the remote re-serve seam — via `mirroredSurface`
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
// TYPE-ONLY (erased at runtime): the cell value IS `SessionState<SshProv>`, so this
// module keeps ONE connection-state type family. Neither import pulls the node/server
// code those modules carry — `import type` emits nothing.
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

/** One line of the link's provenance-tagged log tail — the browser mirror of a
 *  session's {@link SessionState.log} entry: `source` is WHERE the line came from
 *  (`"local"` = the parent's own provisioning / lifecycle chatter, `"remote"` =
 *  the far agent's forwarded stderr), a FIELD now rather than an in-band
 *  `[local] `/`[remote] ` string prefix. */
export const LogEntrySchema = z.object({
  source: z.enum(["local", "remote"]),
  line: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

const logSchema = z.array(LogEntrySchema).readonly();

/** The browser-facing connection-health cell value. NOT a separate mirror type: the
 *  cell IS the session sum on the wire — `ConnectionInfo = SessionState<SshProv>`
 *  (below), so there is exactly ONE connection-state type family. This zod schema
 *  must exist (a wire cell needs a concrete browser-safe validator, which a
 *  TS-generic type is not), so it hand-restates the same arms — but the drift risk
 *  is closed by a COMPILE-TIME pin (`connectionInfoIdentity.test-d.ts`) asserting
 *  `z.infer<typeof ConnectionInfoSchema>` ≡ `SessionState<SshProv>`: add a phase or
 *  change an invariant on one and the build fails until the other agrees, rather
 *  than a runtime zod throw. Discriminated on `phase`:
 *
 *   - UP (the ssh connector's `probing`/`copying`/`building` provisioning phases
 *     plus `connecting`/`connected`): carries only the `log` tail + `sinceMs`, no
 *     error FIELDS.
 *   - `disconnected`: `error` + `cause` (`network` unreachable / `remote` refused).
 *   - `failed`: terminal, `cause` is the `"remote"` literal — a `network` fault
 *     never gives up, so `failed`+`network` is unrepresentable (mirroring the pin).
 *
 *  The provisioning phase NAMES are the ssh connector's own vocabulary; the cell is
 *  composed only at the remote re-serve seam ({@link mirroredSurface}), which mirrors
 *  exactly those ssh sessions, so naming them here is honest. */
const upArm = <P extends string>(phase: P) =>
  z.object({ phase: z.literal(phase), log: logSchema, sinceMs: z.number() });

export const ConnectionInfoSchema = z.discriminatedUnion("phase", [
  upArm("probing"),
  upArm("copying"),
  upArm("building"),
  upArm("connecting"),
  upArm("connected"),
  z.object({
    phase: z.literal("disconnected"),
    error: z.string(),
    cause: z.enum(["network", "remote"]),
    log: logSchema,
    sinceMs: z.number(),
  }),
  z.object({
    phase: z.literal("failed"),
    error: z.string(),
    cause: z.literal("remote"),
    log: logSchema,
    sinceMs: z.number(),
  }),
]);

/** The connection cell's value IS the session sum at the ssh connector's `Prov` —
 *  one type family, not a parallel mirror. Kept as a TYPE-ONLY alias (both imports
 *  are `import type`, fully erased, so this browser-safe module still pulls no
 *  node/server code at runtime), with the zod schema above pinned structurally
 *  equal to it. */
export type ConnectionInfo = SessionState<SshProv>;

/** Gate-closed by default: a freshly-composed cell reads `connecting`, so
 *  "healthy-empty before the first remote frame" is structurally
 *  unrepresentable. The parent overwrites it from the live session; the agent
 *  never does. */
export const DEFAULT_CONNECTION: ConnectionInfo = {
  phase: "connecting",
  log: [],
  sinceMs: 0,
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
  // server WRITE. Every surface that composes this cell (drishti, pulam-web, the
  // teaching example, any future viewer) inherits the fold by building a
  // `surfaceClient` over the mirrored surface, so no consumer hand-ANDs
  // `connection.state === "connected"` — they read `health().live`, which already
  // carries the leg. And no SHIPPED widget paints a dot green from the raw cell
  // state: every connection dot is the fact-gated `<HostStatusPip>`, whose green is
  // emitted only from the ready verdict. That last guarantee is by CONVENTION, not
  // construction — nothing structurally stops a NEW widget from reading the raw
  // `.phase` — so the rule for a new one is: paint via `<HostStatusPip>`, never
  // colour a dot from `.phase`. The ssh
  // VOCABULARY (`"connected"`, the phase sum) stays HERE beside the schema;
  // `@kolu/surface` only invokes the predicate (the `resolveCellVerbs`-style
  // mechanism/vocabulary split). `DEFAULT_CONNECTION` is `connecting` — gate-closed
  // — so a freshly-composed cell reads not-live until a genuine `connected` frame.
  liveWhen: (v: ConnectionInfo) => v.phase === "connected",
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
