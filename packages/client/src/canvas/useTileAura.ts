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
