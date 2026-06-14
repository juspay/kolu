/** Reactive socket: turns a terminal id into its canvas aura tier, reusing the
 *  same upstream classifiers the dock reads (`agentBucket`, the unread flag,
 *  `useStaleCheck`) so the canvas border and the dock can't drift. Called once;
 *  the returned resolver is read per-tile inside a tracking context (JSX /
 *  `createMemo`) by both the canvas tile and the minimap marker, so they share
 *  one tier and the 60s staleness tick re-runs them together. No new state, no
 *  new clock — just a fold of the three existing inputs into `tileAura`. */

import type { TerminalId } from "kolu-common/surface";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { agentBucket } from "./dockModel";
import { type TileAura, tileAura } from "./tileAura";

export function useTileAura(): (id: TerminalId) => TileAura {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  return (id) => {
    const meta = store.getMetadata(id);
    if (!meta) return "none";
    return tileAura(
      agentBucket(meta.agent),
      store.isUnread(id),
      isStale(meta.lastActivityAt),
    );
  };
}
