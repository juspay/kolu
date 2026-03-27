/** Terminal session state: single store keyed by UUID, using TerminalInfo from common. */

import { createSignal, createResource, createMemo, batch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { toast } from "solid-sonner";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import { client } from "./rpc";
import { useSubPanel } from "./useSubPanel";
import { SHORTCUTS } from "./keyboard";
import type { PaletteCommand } from "./CommandPalette";
import type { TerminalId, TerminalInfo, TerminalMetadata } from "kolu-common";

/** Per-terminal metadata stored client-side. Same shape as TerminalInfo minus the id (used as key). */
type TerminalState = Omit<TerminalInfo, "id">;

/** A timestamped activity transition: [epochMs, isActive]. */
export type ActivitySample = [time: number, active: boolean];

/** Rolling window for activity history (shared with ActivityGraph for rendering). */
export const ACTIVITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";
const RANDOM_THEME_KEY = "kolu-random-theme";
const SCROLL_LOCK_KEY = "kolu-scroll-lock";

export function useTerminals() {
  // Single store: all per-terminal metadata keyed by ID.
  // Fine-grained reactivity — updating one terminal's metadata doesn't re-render others.
  const [meta, setMeta] = createStore<Record<TerminalId, TerminalState>>({});
  // Explicit ordering — UUIDs don't sort chronologically, so track insertion order.
  // Only top-level terminals (no parentId) live here.
  const [idOrder, setIdOrder] = createSignal<TerminalId[]>([]);
  // Sub-terminal ordering per parent.
  const [subOrder, setSubOrder] = createSignal<
    Record<TerminalId, TerminalId[]>
  >({});

  const subPanel = useSubPanel();

  // Activity history: array of transitions per terminal for sparkline rendering.
  const [activityHistory, setActivityHistory] = createStore<
    Record<TerminalId, ActivitySample[]>
  >({});

  /** Append an activity sample and trim old entries beyond the rolling window. */
  function pushActivity(id: TerminalId, active: boolean) {
    const now = Date.now();
    const cutoff = now - ACTIVITY_WINDOW_MS;
    setActivityHistory(id, (prev) => [
      ...(prev ?? []).filter(([t]) => t >= cutoff),
      [now, active],
    ]);
  }

  /** Get activity history for a terminal (for sparkline rendering). */
  function getActivityHistory(id: TerminalId): ActivitySample[] {
    return activityHistory[id] ?? [];
  }

  const [randomTheme, setRandomTheme] = makePersisted(createSignal(true), {
    name: RANDOM_THEME_KEY,
    serialize: String,
    deserialize: (s) => s !== "false",
  });

  const [scrollLock, setScrollLock] = makePersisted(createSignal(true), {
    name: SCROLL_LOCK_KEY,
    serialize: String,
    deserialize: (s) => s !== "false",
  });

  const [activeId, setActiveId] = makePersisted(
    createSignal<TerminalId | null>(null),
    {
      name: ACTIVE_TERMINAL_KEY,
      serialize: (v) => (v === null ? "" : v),
      deserialize: (s) => (s === "" ? null : (s as TerminalId)),
    },
  );

  const terminalIds = idOrder;

  /** Get sub-terminal IDs for a given parent. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  /** Get metadata for a terminal. */
  function getMeta(id: TerminalId): TerminalState | undefined {
    return meta[id];
  }

  /** The active terminal's committed theme name (for palette filter — not affected by preview). */
  const committedThemeName = createMemo(() => {
    const id = activeId();
    return (id !== null && meta[id]?.themeName) || DEFAULT_THEME_NAME;
  });

  /** Temporary preview override while navigating the theme palette. */
  const [previewThemeName, setPreviewThemeName] = createSignal<
    string | undefined
  >(undefined);

  /** The displayed theme name: preview if active, otherwise committed. */
  const activeThemeName = createMemo(
    () => previewThemeName() ?? committedThemeName(),
  );

  /** The active terminal's resolved theme (for container background). */
  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  /** Resolve the display theme for a terminal, applying preview override for the active one. */
  function getTerminalTheme(id: TerminalId): ITheme {
    const preview = activeId() === id ? previewThemeName() : undefined;
    return getThemeByName(preview ?? meta[id]?.themeName);
  }

  /** The active terminal's metadata (for header display). */
  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = activeId();
    return id !== null ? (meta[id]?.meta ?? null) : null;
  });

  /** Fire-and-forget stream subscription with AbortController cleanup. */
  function subscribeStream<T>(
    startStream: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
    onValue: (value: T) => void,
  ): () => void {
    const controller = new AbortController();
    (async () => {
      try {
        const stream = await startStream(controller.signal);
        for await (const value of stream) onValue(value);
      } catch {
        // Stream aborted or terminal gone — expected on cleanup
      }
    })();
    return () => controller.abort();
  }

  /** Subscribe to metadata changes for a terminal. Called when terminal is created or restored. */
  function subscribeMetadata(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onMetadataChange({ id }, { signal }),
      (metadata) => setMeta(id, "meta", metadata),
    );
  }

  /** Subscribe to activity state changes for a terminal. */
  function subscribeActivity(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onActivityChange({ id }, { signal }),
      (isActive) => {
        setMeta(id, "isActive", isActive);
        pushActivity(id, isActive);
      },
    );
  }

  /** Subscribe to exit events for a terminal. On exit, notify and remove. */
  function subscribeExit(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onExit({ id }, { signal }),
      (code) => {
        const pos = terminalIds().indexOf(id) + 1;
        const label = pos > 0 ? `Terminal ${pos}` : "Terminal";
        toast(
          code === 0 ? `${label} exited` : `${label} exited with code ${code}`,
        );
        removeAndAutoSwitch(id);
      },
    );
  }

  /** Start all per-terminal stream subscriptions (metadata, activity, exit). */
  function subscribeAll(id: TerminalId) {
    subscribeMetadata(id);
    subscribeActivity(id);
    subscribeExit(id);
  }

  /** Remove a terminal from the store and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const parentId = meta[id]?.parentId;

    if (parentId) {
      // This is a sub-terminal — remove from parent's sub-order
      setSubOrder((prev) => {
        const subs = (prev[parentId] ?? []).filter((x) => x !== id);
        const next = { ...prev };
        if (subs.length === 0) {
          delete next[parentId];
          subPanel.collapsePanel(parentId);
        } else {
          next[parentId] = subs;
          // If this was the active sub-tab, switch to neighbor
          const panel = subPanel.getSubPanel(parentId);
          if (panel.activeSubTab === id) {
            subPanel.setActiveSubTab(parentId, subs[0] ?? null);
          }
        }
        return next;
      });
      setMeta(produce((s) => delete s[id]));
      return;
    }

    // Top-level terminal — promote any sub-terminals to top-level (orphans)
    const orphanIds = getSubTerminalIds(id);
    for (const subId of orphanIds) {
      setMeta(subId, "parentId", undefined);
      void client.terminal.setParent({ id: subId, parentId: null });
    }

    const ids = terminalIds();
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const remaining = ids.filter((x) => x !== id);
    // Insert orphans at the position of the killed parent
    remaining.splice(idx, 0, ...orphanIds);
    setIdOrder(remaining);
    setMeta(produce((s) => delete s[id]));
    subPanel.removePanel(id);
    setSubOrder((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setActivityHistory(produce((s) => delete s[id]));
    if (activeId() === id) {
      setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  /** Convert a TerminalInfo (wire type) to store entry (strip id, used as key). */
  function infoToState(t: TerminalInfo): TerminalState {
    const { id: _, ...state } = t;
    return state;
  }

  // Restore existing terminals on page load (e.g. after browser refresh).
  const [existingTerminals] = createResource<TerminalInfo[]>(async () => {
    const existing = await client.terminal.list();
    if (existing.length > 0) {
      // Build initial metadata store from server state (preserving server order)
      const initial: Record<TerminalId, TerminalState> = {};
      for (const t of existing) initial[t.id] = infoToState(t);
      setMeta(reconcile(initial));

      // Partition into top-level and sub-terminals
      const topLevel: TerminalId[] = [];
      const subs: Record<TerminalId, TerminalId[]> = {};
      for (const t of existing) {
        if (t.parentId) {
          (subs[t.parentId] ??= []).push(t.id);
        } else {
          topLevel.push(t.id);
        }
      }
      setIdOrder(topLevel);
      setSubOrder(subs);

      // Initialize sub-panel active tabs for parents that have sub-terminals
      for (const [parentId, subIds] of Object.entries(subs)) {
        const panel = subPanel.getSubPanel(parentId);
        if (!panel.activeSubTab || !subIds.includes(panel.activeSubTab)) {
          subPanel.setActiveSubTab(parentId, subIds[0] ?? null);
        }
      }

      // Keep persisted active terminal if it still exists; otherwise pick first
      const persisted = activeId();
      const ids = terminalIds();
      if (persisted === null || !ids.includes(persisted)) {
        setActiveId(ids[0] ?? null);
      }

      // Subscribe to live updates for all terminals
      for (const t of existing) subscribeAll(t.id);
    }
    return existing;
  });

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate(cwd?: string) {
    const info = await client.terminal.create({ cwd });
    const themeName = randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    setMeta(info.id, { ...infoToState(info), ...(themeName && { themeName }) });
    setIdOrder((prev) => [...prev, info.id]);
    setActiveId(info.id);
    subscribeAll(info.id);
    if (themeName) void client.terminal.setTheme({ id: info.id, themeName });
  }

  /** Create a sub-terminal under a parent. */
  async function handleCreateSubTerminal(parentId: TerminalId, cwd?: string) {
    const info = await client.terminal.create({ cwd, parentId });
    setMeta(info.id, infoToState(info));
    setSubOrder((prev) => ({
      ...prev,
      [parentId]: [...(prev[parentId] ?? []), info.id],
    }));
    subPanel.setActiveSubTab(parentId, info.id);
    subPanel.expandPanel(parentId);
    subscribeAll(info.id);
  }

  /** Kill a terminal on the server, then remove + auto-switch locally. */
  async function handleKill(id: TerminalId) {
    try {
      await client.terminal.kill({ id });
    } catch {
      // Terminal may already be gone
    }
    removeAndAutoSwitch(id);
  }

  /** Set the theme for the active terminal, persisting to server. */
  async function handleSetTheme(themeName: string) {
    const id = activeId();
    if (id === null) return;
    setMeta(id, "themeName", themeName);
    void client.terminal.setTheme({ id, themeName });
  }

  /** Command palette entries: leaf actions + nested groups for terminals and themes. */
  const commands = createMemo((): PaletteCommand[] => [
    {
      name: "Create new terminal",
      keybind: SHORTCUTS.createTerminal.keybind,
      onSelect: () => void handleCreate(),
    },
    ...(activeMeta()
      ? [
          {
            name: "Create terminal in current directory",
            keybind: SHORTCUTS.createTerminalInCwd.keybind,
            onSelect: () => void handleCreate(activeMeta()!.cwd),
          },
        ]
      : []),
    ...(activeId() !== null
      ? [
          {
            name: "Close terminal",
            onSelect: () => void handleKill(activeId()!),
          },
          {
            name: "Toggle sub-panel",
            keybind: SHORTCUTS.toggleSubPanel.keybind,
            onSelect: () => {
              const id = activeId()!;
              if (getSubTerminalIds(id).length === 0) {
                void handleCreateSubTerminal(id, activeMeta()?.cwd);
              } else {
                subPanel.togglePanel(id);
              }
            },
          },
          {
            name: "New sub-terminal",
            keybind: SHORTCUTS.createSubTerminal.keybind,
            onSelect: () =>
              void handleCreateSubTerminal(activeId()!, activeMeta()?.cwd),
          },
        ]
      : []),
    {
      name: "Debug",
      children: [
        {
          name: "Trigger server error",
          onSelect: () =>
            // Request a nonexistent terminal to trigger TerminalNotFoundError on the server
            void client.terminal.resize({
              id: "00000000-0000-0000-0000-000000000000",
              cols: 1,
              rows: 1,
            }),
        },
      ],
    },
    ...(terminalIds().length > 0
      ? [
          {
            name: "Switch terminal",
            children: () =>
              terminalIds().map((id, i) => ({
                name: `Switch to terminal ${i + 1}`,
                keybind:
                  i < 9
                    ? SHORTCUTS[
                        `switchTo${(i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
                      ].keybind
                    : undefined,
                onSelect: () => setActiveId(id),
              })),
          },
        ]
      : []),
    {
      name: "Theme",
      onCancel: () => setPreviewThemeName(undefined),
      children: () =>
        availableThemes
          .filter((t) => t.name !== committedThemeName())
          .map((t) => ({
            name: t.name,
            onHighlight: () => setPreviewThemeName(t.name),
            onSelect: () =>
              batch(() => {
                setPreviewThemeName(undefined);
                void handleSetTheme(t.name);
              }),
          })),
    },
  ]);

  return {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    getActivityHistory,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme: () => previewThemeName() !== undefined,
    activeMeta,
    existingTerminals,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    getSubTerminalIds,
    reorderTerminals: (ids: TerminalId[]) => {
      setIdOrder(ids);
      void client.terminal.reorder({ ids });
    },
    commands,
    randomTheme,
    setRandomTheme,
    scrollLock,
    setScrollLock,
  };
}
