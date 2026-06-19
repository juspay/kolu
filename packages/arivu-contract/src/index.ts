/**
 * `@kolu/arivu-contract` — the one `@kolu/surface` the `arivu` daemon serves,
 * `arivu-tui` reads, and (in P2) a remote kolu-server mirrors. It wraps the
 * generic `AwarenessValue` (owned by `@kolu/terminal-awareness`, where the
 * sensors produce it) in a keyed collection, plus a `version` cell that is the
 * seam for P2's contract-version handshake.
 *
 * Imports `@kolu/terminal-awareness/schema` — the zod-only entry, with no
 * `node:`/kaval runtime — so the contract stays light enough for the eventual
 * browser/remote-kolu consumer to import without dragging in the sensor set.
 * The daemon (which DOES run the sensors) imports both this and the package
 * root; the viewer imports only this.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  AwarenessValueSchema,
  TerminalIdSchema,
} from "@kolu/terminal-awareness/schema";
import { z } from "zod";

/** The wire-shape `major.minor` of the awareness surface this build serves and
 *  expects. Bumped only when `arivuSurface` itself changes shape — additive
 *  (a new optional field) is a minor bump, breaking a major. It exists now so
 *  P2's remote dial can gate an incompatible host into re-provision; P1c serves
 *  the current value and nothing reads it yet. */
export const ARIVU_CONTRACT_VERSION = "0.1";

/** The `version` cell payload — the daemon's self-declared contract version. */
export const VersionSchema = z.object({ contractVersion: z.string() });
export type Version = z.infer<typeof VersionSchema>;

/** The value a fresh `version` subscriber sees before the daemon overrides it
 *  (it never does today — the default IS this build's version). */
export const DEFAULT_VERSION: Version = {
  contractVersion: ARIVU_CONTRACT_VERSION,
};

/** The awareness surface: a keyed `Collection<TerminalId, AwarenessValue>` (one
 *  entry per terminal kaval owns) plus the `version` handshake cell. The value
 *  schema is the GENERIC `AwarenessValue` — no `location`, no kolu UI fields;
 *  kolu's own record is built on top of this, never the other way round. */
export const arivuSurface = defineSurface({
  cells: {
    version: { schema: VersionSchema, default: DEFAULT_VERSION },
  },
  collections: {
    awareness: {
      keySchema: TerminalIdSchema,
      schema: AwarenessValueSchema,
    },
  },
});

type SF = SurfaceTypes<typeof arivuSurface.spec>;

/** The collection's key — a terminal id (same `TerminalId` the sensors use). */
export type AwarenessKey = SF["collections"]["awareness"]["Key"];

// The collection's value is exactly `@kolu/terminal-awareness`'s `AwarenessValue`
// (both are `z.infer<typeof AwarenessValueSchema>`). Re-export the canonical
// names so a consumer of the contract has one import for the surface AND its
// value/key shapes.
export type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-awareness/schema";
