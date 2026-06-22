/**
 * Fleet vocabulary — the dial-state and per-host snapshot shapes the orchestrator
 * (`fleet.ts`) PRODUCES and the renderer (`render.ts`) merely consumes for a
 * badge. A tiny no-transport, no-render leaf both import, so the dependency arrow
 * points OUT of it: `render.ts` stays a pure projection over an injected
 * vocabulary, and `fleet.ts` no longer reaches back into the renderer for the
 * type that names its own output. `connecting`/`connected`/`skew`/`unreachable`
 * is dial/transport vocabulary, not rendering vocabulary — its home is the
 * concept's generative side, not the module that paints it.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";

/** A host's connection state in the fleet aggregate. `skew` carries both
 *  versions so the header can name the mismatch; `unreachable` carries why (the
 *  no-fallback rule: a dead dial SURFACES as a distinct state, never a silently
 *  vanished group). */
export type FleetHostStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "skew"; localVersion: string; hostVersion: string }
  | { kind: "unreachable"; reason: string };

/** The live aggregate: per host, its status + the terminals mirrored from it.
 *  Keyed by `label` at the top and `TerminalId` within, so two hosts' identical
 *  terminal ids stay distinct — the (host, terminalId) key the plan calls for. */
export interface FleetHostState {
  label: string;
  status: FleetHostStatus;
  terminals: Record<TerminalId, AwarenessValue>;
  /** The terminals on this host moving bytes right now — the `activity` stream's
   *  current frame, replaced whole on each delta. Drives the live green dot;
   *  empty until the first frame (and for a skewed host that can't serve it). */
  live: TerminalId[];
}

/** One host's one-shot snapshot for `fleet --json` — the terminals it served, a
 *  contract-skewed host (its rows kept, plus the version mismatch so a scripter
 *  sees the same skew signal the live board does), or why it couldn't be reached
 *  (kept honest, never dropped). */
export type FleetSnapshot =
  | { label: string; kind: "ok"; entries: Array<[TerminalId, AwarenessValue]> }
  | {
      label: string;
      kind: "skew";
      localVersion: string;
      hostVersion: string;
      entries: Array<[TerminalId, AwarenessValue]>;
    }
  | { label: string; kind: "unreachable"; reason: string };
