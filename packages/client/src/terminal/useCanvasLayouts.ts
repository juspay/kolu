/** Canvas layout state — singleton store for tile positions/sizes.
 *  Persisted to localStorage, also reported to server for session snapshots.
 *  Shared between TerminalCanvas (rendering) and useSessionRestore (seeding). */

import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { CanvasLayout, TerminalId } from "kolu-common";
import { client } from "../rpc/rpc";

export type TileLayout = CanvasLayout;

const [layouts, setLayouts] = makePersisted(
  createStore<Record<string, TileLayout>>({}),
  { name: "kolu-canvas-layouts" },
);

/** Report a tile's layout to the server for session persistence. */
function reportLayout(id: TerminalId) {
  const l = layouts[id];
  if (!l) return;
  void client.terminal.setCanvasLayout({ id, layout: l }).catch(() => {
    // Best-effort — layout is also in localStorage as fallback
  });
}

export function useCanvasLayouts() {
  return { layouts, setLayouts, reportLayout } as const;
}
