import type { TerminalId } from "kolu-common/surface";
import { useTileStore } from "../../tile/useTileStore";

export function isActiveRow(id: TerminalId): boolean {
  const tileStore = useTileStore();
  return tileStore.isActiveTile(id) || tileStore.isFocused(id);
}
