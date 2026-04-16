/** Canvas layout state — singleton store for tile positions/sizes.
 *  Reported to server for session snapshots; seeded from server on restore.
 *  Shared between TerminalCanvas (rendering) and useSessionRestore (seeding). */

import { createStore } from "solid-js/store";
import type { CanvasLayout } from "kolu-common";
import { client } from "../rpc/rpc";

export type TileLayout = CanvasLayout;

const [layouts, setLayouts] = createStore<Record<string, TileLayout>>({});

/** Report a tile's layout to the server for session persistence. */
function reportLayout(id: string) {
  const l = layouts[id];
  if (!l) return;
  void client.terminal.setCanvasLayout({ id, layout: l }).catch(() => {
    // Best-effort — layout is also in localStorage as fallback
  });
}

export function useCanvasLayouts() {
  return { layouts, setLayouts, reportLayout } as const;
}
