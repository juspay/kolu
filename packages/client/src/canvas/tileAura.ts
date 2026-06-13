/** Canvas-surface state aura — the top-edge bar a canvas tile and its
 *  minimap marker paint to show their agent state at a glance. A sibling of
 *  the dock's `pipVariant`: it reuses the same upstream classifiers
 *  (`agentBucket`, the `isUnread` flag, the `useStaleCheck` staleness signal)
 *  but maps to the canvas's own vocabulary — a top bar, where "waiting" splits
 *  by staleness into a loud fresh tier and a cooled ember. Extracted as a pure
 *  function so the rule is unit-testable without a Solid render harness, the
 *  way `pipVariant` is. The reactive receptacle that gathers its three inputs
 *  once — so both surfaces plug into one socket — lives in `useTileAura.ts`,
 *  kept separate so this pure module stays free of the store/wire import graph.
 *
 *  The loudness order, brightest → quiet: alert ▸ waiting ▸ working ▸
 *  waiting-stale ▸ none. Motion (in the CSS) is reserved for the rungs that
 *  want you — alert blinks, fresh-waiting pulses; working is a steady hum. A
 *  working tile that has gone stale is parked, not loud: it drops to `none`,
 *  matching the dock (`parked` bucket) and the minimap (ghost, no bar). */

import type { AgentBucketKind } from "./dockModel";

export type TileAura =
  | "alert" // unread: fresh + missed — fast blink, brightest
  | "waiting" // awaiting + fresh: gentle pulse, wants you
  | "waiting-stale" // awaiting + stale (parked): dim ember, cooled below the hum
  | "working" // thinking / tool_use / running_background: steady hum
  | "none"; // idle / no agent — no bar

/** Map a tile's live state to its aura tier. `bucket` is `agentBucket()`'s
 *  output (awaiting | working | none). `unread` dominates — a missed alert
 *  outlives the bucket transition until the user activates the tile. Otherwise
 *  loudness depends on whether the tile has gone stale past the user's activity
 *  window:
 *
 *    - an awaiting tile cools from the loud `waiting` pulse to a static
 *      `waiting-stale` ember (it still wants you, just less urgently);
 *    - a working tile that has gone stale is *parked* — the agent stopped
 *      reporting progress before the activity window elapsed — so it drops to
 *      `none`. This keeps the canvas honest with the other surfaces: the dock's
 *      `rankDockRows` routes a stale row to its `parked` bucket (dim, pushed
 *      down) and the minimap renders parked tiles as recessive ghosts with no
 *      aura bar. Without this a stale agent would read quiet/parked in the dock
 *      and minimap while still advertising a bright rust working hum on the
 *      full canvas. */
export function tileAura(
  bucket: Exclude<AgentBucketKind, "idle">,
  unread: boolean,
  stale: boolean,
): TileAura {
  if (unread) return "alert";
  if (bucket === "awaiting") return stale ? "waiting-stale" : "waiting";
  if (bucket === "working") return stale ? "none" : "working";
  bucket satisfies "none";
  return "none";
}
