/**
 * `@kolu/surface-nix-host/connection` — the BROWSER-SAFE connection-health
 * cell, composable into any surface mirrored over a `HostSession`.
 *
 * A re-served / mirrored surface (drishti, pulam-web) needs the browser to see
 * the backend↔remote link's health — copying / connecting / connected /
 * disconnected / failed — so a dead mirror renders honestly instead of as a
 * healthy-but-empty surface. That health is `HostSession`'s volatility; this
 * module is its consume-facing projection: a cell schema + a gate-closed
 * default an app spreads into its own `defineSurface` (`cells: { …,
 * connection: connectionCell }`). The node-side pump that drives it from a live
 * session (`projectConnection` / `pipeSessionStateToCell`) lives on the package
 * root — THIS module imports only `zod`, so it can ride the browser bundle (the
 * package root spawns ssh and must not).
 *
 * Parent-only write authority: only the re-serving PARENT writes this cell (off
 * `session.onState`); the agent serves an inert `DEFAULT_CONNECTION` stub. A
 * direct / local consumer thus reads `connecting` forever and simply doesn't
 * gate on it — by design (a local link has no remote to be down).
 */

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

/** The composable cell descriptor — spread into a surface's `cells`
 *  (`cells: { …, connection: connectionCell }`). One source of truth for the
 *  schema AND the gate-closed default, so every composing app inherits both. */
export const connectionCell = {
  schema: ConnectionInfoSchema,
  default: DEFAULT_CONNECTION,
} as const;
