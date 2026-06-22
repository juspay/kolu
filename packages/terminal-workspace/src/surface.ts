/**
 * `@kolu/terminal-workspace/surface` — the ONE `@kolu/surface` the `arivu`
 * daemon serves, `arivu-tui` reads, and (in R8) a remote kolu-server mirrors.
 * It is the consume-facing dual of the host-side workspace the library owns: a
 * keyed `AwarenessValue` collection (one entry per terminal a kaval owns), the
 * `version` handshake cell, and the `activity` flow stream. R6 grows it to also
 * serve the Code tab's fs/git reads (procedures + watcher streams).
 *
 * This module is the BROWSER-SAFE face of the package: it imports only
 * `@kolu/surface/define` (its own doc notes it pulls just `@orpc/contract` +
 * `zod`), this package's zod-only `./schema`, and `zod`. It does NOT import the
 * package root (the sensors), so a viewer or remote-kolu consumer imports the
 * surface without dragging in any `node:`/kaval runtime — the same discipline
 * `./schema` keeps today.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { AwarenessValueSchema, TerminalIdSchema } from "./schema.ts";

/** The wire-shape `major.minor` of the workspace surface this build serves and
 *  expects. Bumped only when `terminalWorkspaceSurface` itself changes shape —
 *  additive (a new optional field / a new stream) is a minor bump, breaking a
 *  major. The remote dial gates an incompatible host into re-provision via
 *  `isContractVersionCompatible`. */
export const TERMINAL_WORKSPACE_CONTRACT_VERSION = "0.2";

/** The `version` cell payload — the daemon's self-declared contract version. */
export const VersionSchema = z.object({ contractVersion: z.string() });
export type Version = z.infer<typeof VersionSchema>;

/** The value a fresh `version` subscriber sees before the daemon overrides it
 *  (it never does today — the default IS this build's version). */
export const DEFAULT_VERSION: Version = {
  contractVersion: TERMINAL_WORKSPACE_CONTRACT_VERSION,
};

/** The terminal-workspace surface: a keyed `Collection<TerminalId,
 *  AwarenessValue>` (one entry per terminal kaval owns), the `version`
 *  handshake cell, and the `activity` stream. The value schema is the GENERIC
 *  `AwarenessValue` — no `location`, no kolu UI fields; kolu's own record is
 *  built on top of this, never the other way round.
 *
 *  The three primitive kinds are deliberate: the collection (keyed current
 *  state) and the cell (a single current value) are the *stateful* primitives;
 *  `activity` is the *flow* primitive. Terminal-output activity — the live
 *  "bytes moving right now" the Dock paints as a green dot — has no persisted
 *  current value (it's distinct from `AwarenessValue.lastActivityAt`, the slow
 *  agent staleness clock), so it can't be a collection field: it's a stream the
 *  daemon derives from kaval's raw byte tap and the viewer reflects live. */
export const terminalWorkspaceSurface = defineSurface({
  cells: {
    version: { schema: VersionSchema, default: DEFAULT_VERSION },
  },
  collections: {
    awareness: {
      keySchema: TerminalIdSchema,
      schema: AwarenessValueSchema,
    },
  },
  streams: {
    /** The set of terminals producing output *right now* — snapshot-then-deltas,
     *  each frame the full current live set. The daemon taps kaval's raw output
     *  per terminal and debounces it (~1s trailing window, mirroring kolu's local
     *  `useTerminalActivity`); the viewer paints a live terminal's row with a
     *  green dot. Takes no input (it spans the whole host's terminal set), so a
     *  consumer subscribes once. A pure liveness signal: it carries no bytes. */
    activity: {
      inputSchema: z.object({}),
      outputSchema: z.array(TerminalIdSchema),
    },
  },
});

type SF = SurfaceTypes<typeof terminalWorkspaceSurface.spec>;

/** The collection's key — a terminal id (same `TerminalId` the sensors use). */
export type AwarenessKey = SF["collections"]["awareness"]["Key"];

/** The `activity` stream frame — the set of terminal ids producing output right
 *  now (the whole current live set, snapshot-then-deltas). */
export type ActivitySet = SF["streams"]["activity"]["Output"];

// The collection's value is exactly `@kolu/terminal-workspace`'s `AwarenessValue`
// (both are `z.infer<typeof AwarenessValueSchema>`). Re-export the canonical
// names so a consumer of the surface has one import for the surface AND its
// value/key shapes.
export type { AwarenessValue, TerminalId } from "./schema.ts";
