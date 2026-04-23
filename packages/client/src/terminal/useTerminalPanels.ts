/** Per-terminal panels — singleton hook. Each terminal can carry up to
 *  three slots (left/right/bottom); each slot is a tabbed list of
 *  `PanelContent` (Inspector / Code / Terminal / Browser).
 *
 *  Source of truth is `meta.panels` on `TerminalMetadata`, streamed from the
 *  server. Mutations call `client.terminal.setPanels` and flow back through
 *  the metadata subscription — no local optimistic mirror. The only
 *  client-only state is `focusEdge`, which tracks the last-focused region
 *  per tile so re-selecting the tile restores keyboard focus to the right
 *  place.
 *
 *  Replaces the prior `useRightPanel` (canvas-level singleton) and
 *  `useSubPanel` (per-parent split state) — both folded into this primitive
 *  per the lowy verdict that they encoded the same volatility. */

import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import {
  ALL_PANEL_EDGES,
  panelContentKey,
  type PanelContent,
  type PanelEdge,
  type PanelSlot,
  type TerminalId,
  type TerminalPanels,
} from "kolu-common";
import { DEFAULT_PANEL_SIZE } from "kolu-common/config";
import { client } from "../rpc/rpc";
import { useTerminalStore } from "./useTerminalStore";

/** Where this terminal's keyboard focus lives. `"main"` = the terminal's own
 *  xterm; an edge means the active tab in that slot. Restored on tile re-select. */
type FocusEdge = "main" | PanelEdge;

interface RuntimeState {
  /** Trailing-edge debounce timer for size writes — drag fires per-frame
   *  but the server only needs the settled value. */
  sizeDebounce?: number;
  focus: FocusEdge;
}

const SIZE_DEBOUNCE_MS = 200;

const [runtime, setRuntime] = createStore<Record<TerminalId, RuntimeState>>({});

function ensureRuntime(id: TerminalId): RuntimeState {
  if (!runtime[id]) setRuntime(id, { focus: "main" });
  return runtime[id]!;
}

function emptySlot(content: PanelContent): PanelSlot {
  return {
    tabs: [content],
    active: 0,
    size: DEFAULT_PANEL_SIZE,
    collapsed: false,
  };
}

function hasAnySlot(p: TerminalPanels): boolean {
  return Boolean(p.left || p.right || p.bottom);
}

/** Locate a content occurrence anywhere in a tile's panels. Used to enforce
 *  the per-tile uniqueness rule on insert: an Inspector belongs in at most
 *  one slot, Code+local in at most one slot, terminal+id in at most one.
 *  Identity is via the shared `panelContentKey` helper so the client and
 *  server agree on what "duplicate" means. */
function findContent(
  panels: TerminalPanels,
  needle: PanelContent,
): { edge: PanelEdge; tabIdx: number } | null {
  const needleKey = panelContentKey(needle);
  for (const edge of ALL_PANEL_EDGES) {
    const slot = panels[edge];
    if (!slot) continue;
    const idx = slot.tabs.findIndex((t) => panelContentKey(t) === needleKey);
    if (idx >= 0) return { edge, tabIdx: idx };
  }
  return null;
}

export function useTerminalPanels() {
  const store = useTerminalStore();

  function getPanels(id: TerminalId): TerminalPanels {
    return store.getMetadata(id)?.panels ?? {};
  }

  function getSlot(id: TerminalId, edge: PanelEdge): PanelSlot | undefined {
    return getPanels(id)[edge];
  }

  /** Persist the new panels shape. Empty `{}` is dropped server-side, which
   *  matters because the server prunes terminal-id references on close —
   *  the resulting empty object should round-trip cleanly. */
  function writePanels(id: TerminalId, panels: TerminalPanels): void {
    void client.terminal
      .setPanels({ id, panels })
      .catch((err: Error) =>
        toast.error(`Failed to update panels: ${err.message}`),
      );
  }

  function mutate(
    id: TerminalId,
    fn: (p: TerminalPanels) => TerminalPanels,
  ): void {
    writePanels(id, fn(getPanels(id)));
  }

  function setSlot(
    id: TerminalId,
    edge: PanelEdge,
    slot: PanelSlot | undefined,
  ): void {
    mutate(id, (p) => ({ ...p, [edge]: slot }));
  }

  function updateSlot(
    id: TerminalId,
    edge: PanelEdge,
    fn: (slot: PanelSlot) => PanelSlot,
  ): void {
    const current = getSlot(id, edge);
    if (!current) return;
    setSlot(id, edge, fn(current));
  }

  /** Open `edge` if it doesn't exist yet, else just expand (un-collapse).
   *  If the desired content already lives in a different slot of this tile,
   *  do nothing — the uniqueness rule wins over a duplicate insert. */
  function openSlot(
    id: TerminalId,
    edge: PanelEdge,
    content: PanelContent,
  ): void {
    const panels = getPanels(id);
    const existing = panels[edge];
    if (existing) {
      setSlot(id, edge, { ...existing, collapsed: false });
      return;
    }
    const dupe = findContent(panels, content);
    if (dupe) {
      // Expand the slot that already owns it instead of failing silently.
      setSlot(id, dupe.edge, {
        ...panels[dupe.edge]!,
        active: dupe.tabIdx,
        collapsed: false,
      });
      return;
    }
    setSlot(id, edge, emptySlot(content));
  }

  function closeSlot(id: TerminalId, edge: PanelEdge): void {
    setSlot(id, edge, undefined);
  }

  function toggleSlot(id: TerminalId, edge: PanelEdge): void {
    updateSlot(id, edge, (slot) => ({ ...slot, collapsed: !slot.collapsed }));
  }

  function setActiveTab(id: TerminalId, edge: PanelEdge, tabIdx: number): void {
    updateSlot(id, edge, (slot) => ({
      ...slot,
      active: Math.max(0, Math.min(tabIdx, slot.tabs.length - 1)),
      collapsed: false,
    }));
  }

  /** Trailing-edge debounce — Resizable fires per-frame during drag, but
   *  the server only needs the settled value. */
  function setSize(id: TerminalId, edge: PanelEdge, size: number): void {
    const rt = ensureRuntime(id);
    if (rt.sizeDebounce !== undefined) clearTimeout(rt.sizeDebounce);
    const handle = window.setTimeout(() => {
      setRuntime(id, "sizeDebounce", undefined);
      updateSlot(id, edge, (slot) => ({ ...slot, size }));
    }, SIZE_DEBOUNCE_MS);
    setRuntime(id, "sizeDebounce", handle);
  }

  function addTab(
    id: TerminalId,
    edge: PanelEdge,
    content: PanelContent,
  ): void {
    const panels = getPanels(id);
    const dupe = findContent(panels, content);
    if (dupe) {
      setSlot(id, dupe.edge, {
        ...panels[dupe.edge]!,
        active: dupe.tabIdx,
        collapsed: false,
      });
      return;
    }
    const slot = panels[edge];
    if (!slot) {
      setSlot(id, edge, emptySlot(content));
      return;
    }
    const tabs = [...slot.tabs, content];
    setSlot(id, edge, {
      ...slot,
      tabs,
      active: tabs.length - 1,
      collapsed: false,
    });
  }

  /** Drop a tab. If it was the slot's last tab, the slot itself is removed.
   *  Caller is responsible for any side effects (e.g. killing the underlying
   *  terminal when closing a `kind: "terminal"` tab). */
  function closeTab(id: TerminalId, edge: PanelEdge, tabIdx: number): void {
    const slot = getSlot(id, edge);
    if (!slot) return;
    const tabs = slot.tabs.filter((_, i) => i !== tabIdx);
    if (tabs.length === 0) {
      closeSlot(id, edge);
      return;
    }
    const active =
      tabIdx < slot.active
        ? slot.active - 1
        : Math.min(slot.active, tabs.length - 1);
    setSlot(id, edge, { ...slot, tabs, active });
  }

  /** Replace the content of an existing tab in place. Used by the Code-tab
   *  mode switch — the tab stays at its same index, only the discriminator
   *  payload changes. Drops a duplicate tab elsewhere if the new content
   *  collides with another slot's tab (uniqueness rule). */
  function setTabContent(
    id: TerminalId,
    edge: PanelEdge,
    tabIdx: number,
    content: PanelContent,
  ): void {
    const panels = getPanels(id);
    const slot = panels[edge];
    if (!slot || tabIdx < 0 || tabIdx >= slot.tabs.length) return;
    const next: TerminalPanels = { ...panels };
    const contentKey = panelContentKey(content);
    // First pass: drop any other tab anywhere that collides with the new
    // content, so the result respects per-tile uniqueness.
    for (const e of ALL_PANEL_EDGES) {
      const s = next[e];
      if (!s) continue;
      const filtered = s.tabs.filter((t, i) => {
        if (e === edge && i === tabIdx) return true; // keep the slot we're editing
        return panelContentKey(t) !== contentKey;
      });
      if (filtered.length === s.tabs.length) continue;
      if (filtered.length === 0) {
        next[e] = undefined;
      } else {
        const active = Math.min(s.active, filtered.length - 1);
        next[e] = { ...s, tabs: filtered, active };
      }
    }
    const targetSlot = next[edge];
    if (!targetSlot) return;
    const adjustedIdx = Math.min(tabIdx, targetSlot.tabs.length - 1);
    const tabs = targetSlot.tabs.map((t, i) =>
      i === adjustedIdx ? content : t,
    );
    next[edge] = { ...targetSlot, tabs, active: adjustedIdx };
    writePanels(id, next);
  }

  function moveTabToEdge(
    id: TerminalId,
    fromEdge: PanelEdge,
    tabIdx: number,
    toEdge: PanelEdge,
  ): void {
    if (fromEdge === toEdge) return;
    const panels = getPanels(id);
    const fromSlot = panels[fromEdge];
    if (!fromSlot) return;
    const moving = fromSlot.tabs[tabIdx];
    if (!moving) return;
    const remaining = fromSlot.tabs.filter((_, i) => i !== tabIdx);
    const next: TerminalPanels = { ...panels };
    next[fromEdge] =
      remaining.length === 0
        ? undefined
        : {
            ...fromSlot,
            tabs: remaining,
            active:
              tabIdx < fromSlot.active
                ? fromSlot.active - 1
                : Math.min(fromSlot.active, remaining.length - 1),
          };
    const toSlot = panels[toEdge];
    next[toEdge] = toSlot
      ? {
          ...toSlot,
          tabs: [...toSlot.tabs, moving],
          active: toSlot.tabs.length,
          collapsed: false,
        }
      : emptySlot(moving);
    writePanels(id, next);
  }

  function getFocusEdge(id: TerminalId): FocusEdge {
    return ensureRuntime(id).focus;
  }

  function setFocusEdge(id: TerminalId, edge: FocusEdge): void {
    ensureRuntime(id);
    setRuntime(id, "focus", edge);
  }

  function removeTerminalRuntime(id: TerminalId): void {
    // Clear the pending size-debounce timer before dropping the entry —
    // otherwise the queued `setPanels` fires against a deleted terminal
    // and surfaces a spurious "terminal not found" toast to the user.
    const rt = runtime[id];
    if (rt?.sizeDebounce !== undefined) clearTimeout(rt.sizeDebounce);
    setRuntime(produce((s) => delete s[id]));
  }

  /** Drop every terminal's runtime state. Used by the "Close all"
   *  command, which kills every PTY in one server call rather than walking
   *  per-terminal — the per-terminal cleanup hooks would otherwise be
   *  bypassed and the runtime map would leak entries. */
  function resetAllRuntime(): void {
    for (const id of Object.keys(runtime)) {
      const rt = runtime[id];
      if (rt?.sizeDebounce !== undefined) clearTimeout(rt.sizeDebounce);
    }
    setRuntime(
      produce((s) => {
        for (const k of Object.keys(s)) delete s[k];
      }),
    );
  }

  return {
    getPanels,
    getSlot,
    openSlot,
    closeSlot,
    toggleSlot,
    setActiveTab,
    setSize,
    addTab,
    closeTab,
    setTabContent,
    moveTabToEdge,
    getFocusEdge,
    setFocusEdge,
    removeTerminalRuntime,
    resetAllRuntime,
  } as const;
}
