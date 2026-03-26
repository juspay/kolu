/** Terminal session state: single store keyed by UUID, using TerminalInfo from common. */

import { createSignal, createResource, createMemo } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { toast } from "solid-sonner";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import { client } from "./rpc";
import { SHORTCUTS } from "./keyboard";
import type { PaletteCommand } from "./CommandPalette";
import type { TerminalId, TerminalInfo, CwdInfo } from "kolu-common";

/** Per-terminal metadata stored client-side. Same shape as TerminalInfo minus the id (used as key). */
type TerminalState = Omit<TerminalInfo, "id">;

/** A timestamped activity transition: [epochMs, isActive]. */
export type ActivitySample = [time: number, active: boolean];

/** Rolling window for activity history (shared with ActivityGraph for rendering). */
export const ACTIVITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";
const RANDOM_THEME_KEY = "kolu-random-theme";

export function useTerminals() {
  // Single store: all per-terminal metadata keyed by ID.
  // Fine-grained reactivity — updating one terminal's CWD doesn't re-render others.
  const [meta, setMeta] = createStore<Record<TerminalId, TerminalState>>({});
  // Explicit ordering — UUIDs don't sort chronologically, so track insertion order.
  const [idOrder, setIdOrder] = createSignal<TerminalId[]>([]);

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

  const [activeId, setActiveId] = makePersisted(
    createSignal<TerminalId | null>(null),
    {
      name: ACTIVE_TERMINAL_KEY,
      serialize: (v) => (v === null ? "" : v),
      deserialize: (s) => (s === "" ? null : (s as TerminalId)),
    },
  );

  const terminalIds = idOrder;

  /** Get metadata for a terminal. */
  function getMeta(id: TerminalId): TerminalState | undefined {
    return meta[id];
  }

  /** The active terminal's theme name (for header + palette filter). */
  const activeThemeName = createMemo(() => {
    const id = activeId();
    return (id !== null && meta[id]?.themeName) || DEFAULT_THEME_NAME;
  });

  /** The active terminal's resolved theme (for container background). */
  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  /** The active terminal's CWD info (for header display). */
  const activeCwd = createMemo((): CwdInfo | null => {
    const id = activeId();
    return id !== null ? (meta[id]?.cwd ?? null) : null;
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

  /** Subscribe to CWD changes for a terminal. Called when terminal is created or restored. */
  function subscribeCwd(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onCwdChange({ id }, { signal }),
      (cwd) => setMeta(id, "cwd", cwd),
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

  /** Start all per-terminal stream subscriptions (CWD, activity, exit). */
  function subscribeAll(id: TerminalId) {
    subscribeCwd(id);
    subscribeActivity(id);
    subscribeExit(id);
  }

  /** Remove a terminal from the store and auto-switch if it was active. */
  function removeAndAutoSwitch(id: TerminalId) {
    const ids = terminalIds();
    const idx = ids.indexOf(id);
    if (idx === -1) return;
    const remaining = ids.filter((x) => x !== id);
    setIdOrder(remaining);
    setMeta(produce((s) => delete s[id]));
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
      setIdOrder(existing.map((t) => t.id));

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

  /** Command palette entries for terminal + theme actions. */
  const commands = createMemo((): PaletteCommand[] => [
    {
      name: "Create new terminal",
      keybind: SHORTCUTS.createTerminal.keybind,
      onSelect: () => void handleCreate(),
    },
    ...(activeCwd()
      ? [
          {
            name: "Create terminal in current directory",
            keybind: SHORTCUTS.createTerminalInCwd.keybind,
            onSelect: () => void handleCreate(activeCwd()!.cwd),
          },
        ]
      : []),
    ...(activeId() !== null
      ? [
          {
            name: "Close terminal",
            onSelect: () => void handleKill(activeId()!),
          },
        ]
      : []),
    {
      name: "Debug: trigger server error",
      showOnPrefix: "debug",
      onSelect: () =>
        // Request a nonexistent terminal to trigger TerminalNotFoundError on the server
        void client.terminal.resize({
          id: "00000000-0000-0000-0000-000000000000",
          cols: 1,
          rows: 1,
        }),
    },
    ...terminalIds().map((id, i) => ({
      name: `Switch to terminal ${i + 1}`,
      keybind:
        i < 9
          ? SHORTCUTS[`switchTo${(i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`]
              .keybind
          : undefined,
      onSelect: () => setActiveId(id),
    })),
    ...availableThemes
      .filter((t) => t.name !== activeThemeName())
      .map((t) => ({
        name: `Theme: ${t.name}`,
        onSelect: () => void handleSetTheme(t.name),
      })),
  ]);

  return {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    getActivityHistory,
    activeThemeName,
    activeTheme,
    activeCwd,
    existingTerminals,
    handleCreate,
    handleKill,
    reorderTerminals: (ids: TerminalId[]) => {
      setIdOrder(ids);
      void client.terminal.reorder({ ids });
    },
    commands,
    randomTheme,
    setRandomTheme,
  };
}
