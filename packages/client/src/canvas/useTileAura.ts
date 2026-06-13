/** Reactive receptacle around `tileAura` — turns a terminal id into its aura
 *  tier. Closes over the terminal store and ONE `useStaleCheck()` instance,
 *  then gathers the agent bucket, unread flag, and staleness band in one place
 *  so the canvas tile (`TerminalCanvas`) and the minimap marker
 *  (`CanvasMinimap`) both plug into a single socket instead of hand-wiring the
 *  same three classifiers. The pure `tileAura` core stays in `tileAura.ts`
 *  (unit-tested without a Solid render harness); this is the reactive wiring
 *  that hides it — kept in its own module so the pure core never has to import
 *  the store/wire graph. */

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
    return tileAura(
      agentBucket(meta?.agent),
      store.isUnread(id),
      isStale(meta?.lastActivityAt ?? 0),
    );
  };
}
