/** Reactive socket: turns a terminal id into its canvas aura tier, reusing the
 *  same upstream classifiers the dock reads (`paintBucket`, the unread flag,
 *  `useStaleCheck`) so the canvas border and the dock can't drift. Called once;
 *  the returned resolver is read per-tile inside a tracking context (JSX /
 *  `createMemo`) by the canvas tile border, and the 60s staleness tick re-runs
 *  it. The minimap is NOT a consumer — it derives its marker independently via
 *  `bucketDescriptor` (and its own `isParked` staleness). No new state, no new
 *  clock — just a fold of the three existing inputs into `tileAura`. */

import type { TerminalId } from "kolu-common/surface";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { metaBucket } from "./dockModel";
import { type TileAura, tileAura } from "./tileAura";

export function useTileAura(): (id: TerminalId) => TileAura {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  return (id) => {
    const meta = store.getMetadata(id);
    if (!meta) return "none";
    return tileAura(
      metaBucket(meta),
      store.isUnread(id),
      isStale(meta.lastActivityAt),
    );
  };
}
