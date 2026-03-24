/** Terminal session state: manages terminal list, active selection, and per-terminal themes. */

import { createSignal, createResource, createMemo } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import { client } from "./rpc";
import type { TerminalInfo, CwdInfo } from "kolu-common";

/** Lightweight terminal identity — the subset of TerminalInfo that's stable after creation. */
export type TerminalHandle = Pick<TerminalInfo, "id" | "name">;

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminals() {
  const [terminals, setTerminals] = createSignal<TerminalHandle[]>([]);
  const [activeId, setActiveId] = makePersisted(
    createSignal<string | null>(null),
    { name: ACTIVE_TERMINAL_KEY },
  );

  // Per-terminal theme name (terminal ID → theme name).
  // createStore gives fine-grained reactivity per key — changing one terminal's
  // theme doesn't cause other terminals to re-evaluate their theme prop.
  const [terminalThemes, setTerminalThemes] = createStore<
    Record<string, string>
  >({});

  // Per-terminal CWD info (terminal ID → CwdInfo).
  const [terminalCwds, setTerminalCwds] = createStore<Record<string, CwdInfo>>(
    {},
  );

  // Per-terminal activity state (terminal ID → isActive).
  const [terminalActivity, setTerminalActivity] = createStore<
    Record<string, boolean>
  >({});

  /** Derive the ID list for consumers that only need IDs. */
  const terminalIds = createMemo(() => terminals().map((t) => t.id));

  /** Get the theme name for a terminal, falling back to default. */
  function getTerminalThemeName(id: string): string {
    return terminalThemes[id] ?? DEFAULT_THEME_NAME;
  }

  /** Get the CWD info for a terminal (reactive per key via createStore). */
  function getTerminalCwd(id: string): CwdInfo | undefined {
    return terminalCwds[id];
  }

  /** Get the activity state for a terminal (reactive per key via createStore). */
  function getTerminalActive(id: string): boolean {
    return terminalActivity[id] ?? false;
  }

  /** The active terminal's theme name (for header + palette filter). */
  const activeThemeName = createMemo(() => {
    const id = activeId();
    return id ? getTerminalThemeName(id) : DEFAULT_THEME_NAME;
  });

  /** The active terminal's resolved theme (for container background). */
  const activeTheme = createMemo(() => getThemeByName(activeThemeName()));

  /** The active terminal's CWD info (for header display). */
  const activeCwd = createMemo((): CwdInfo | null => {
    const id = activeId();
    return id ? (terminalCwds[id] ?? null) : null;
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
  function subscribeCwd(id: string) {
    return subscribeStream(
      (signal) => client.terminal.onCwdChange({ id }, { signal }),
      (cwd) => setTerminalCwds(id, cwd),
    );
  }

  /** Subscribe to activity state changes for a terminal. */
  function subscribeActivity(id: string) {
    return subscribeStream(
      (signal) => client.terminal.onActivityChange({ id }, { signal }),
      (isActive) => setTerminalActivity(id, isActive),
    );
  }

  /** Subscribe to exit events for a terminal. On exit, remove it and auto-switch. */
  function subscribeExit(id: string) {
    return subscribeStream(
      (signal) => client.terminal.onExit({ id }, { signal }),
      () => removeAndAutoSwitch(id),
    );
  }

  /** Start all per-terminal stream subscriptions (CWD, activity, exit). */
  function subscribeAll(id: string) {
    subscribeCwd(id);
    subscribeActivity(id);
    subscribeExit(id);
  }

  /** Remove a terminal from all state stores. Returns removed index, or -1 if not found. */
  function removeTerminal(id: string): number {
    const current = terminals();
    const idx = current.findIndex((t) => t.id === id);
    if (idx === -1) return -1;
    setTerminals(current.filter((t) => t.id !== id));
    setTerminalCwds(produce((s) => delete s[id]));
    setTerminalActivity(produce((s) => delete s[id]));
    setTerminalThemes(produce((s) => delete s[id]));
    return idx;
  }

  /** Remove a terminal and auto-switch if it was the active one. */
  function removeAndAutoSwitch(id: string) {
    const idx = removeTerminal(id);
    if (idx === -1) return;
    if (activeId() === id) {
      // terminalIds() already reflects the removal; pick the nearest surviving terminal
      const ids = terminalIds();
      setActiveId(ids[Math.min(idx, ids.length - 1)] ?? null);
    }
  }

  // Restore existing terminals on page load (e.g. after browser refresh).
  const [existingTerminals] = createResource<TerminalInfo[]>(async () => {
    const existing = await client.terminal.list();
    if (existing.length > 0) {
      setTerminals(existing.map((t) => ({ id: t.id, name: t.name })));
      // Keep persisted active terminal if it still exists; otherwise pick a running one
      const persisted = activeId();
      if (!persisted || !terminalIds().includes(persisted)) {
        const running = existing.find((t) => t.status === "running");
        setActiveId(running?.id ?? terminalIds()[0] ?? null);
      }
      // Restore per-terminal themes from server (reconcile replaces entire store)
      setTerminalThemes(
        reconcile(
          Object.fromEntries(
            existing
              .filter((t) => t.themeName)
              .map((t) => [t.id, t.themeName!]),
          ),
        ),
      );
      // Set initial activity state and subscribe to changes for running terminals
      for (const t of existing) {
        if (t.status === "running") {
          setTerminalActivity(t.id, t.isActive);
          subscribeAll(t.id);
        }
      }
    }
    return existing;
  });

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate(cwd?: string) {
    const info = await client.terminal.create({ cwd });
    setTerminals((prev) => [...prev, { id: info.id, name: info.name }]);
    setActiveId(info.id);
    // New terminals always start active (server spawns PTY with initial output)
    setTerminalActivity(info.id, true);
    subscribeAll(info.id);
  }

  /** Kill a terminal on the server, then remove + auto-switch locally. */
  async function handleKill(id: string) {
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
    if (!id) return;
    setTerminalThemes(id, themeName);
    void client.terminal.setTheme({ id, themeName });
  }

  /** Command palette entries for terminal + theme actions. */
  const commands = createMemo(
    (): Array<{
      name: string;
      showOnPrefix?: string;
      onSelect: () => void;
    }> => [
      {
        name: "Create new terminal",
        onSelect: () => void handleCreate(),
      },
      ...(activeCwd()
        ? [
            {
              name: "Create terminal in current directory",
              onSelect: () => void handleCreate(activeCwd()!.cwd),
            },
          ]
        : []),
      ...(activeId()
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
            id: "__nonexistent__",
            cols: 1,
            rows: 1,
          }),
      },
      ...terminals().map((t) => ({
        name: `Switch to ${t.name}`,
        onSelect: () => setActiveId(t.id),
      })),
      ...availableThemes
        .filter((t) => t.name !== activeThemeName())
        .map((t) => ({
          name: `Theme: ${t.name}`,
          onSelect: () => void handleSetTheme(t.name),
        })),
    ],
  );

  return {
    terminals,
    terminalIds,
    activeId,
    setActiveId,
    activeThemeName,
    activeTheme,
    activeCwd,
    existingTerminals,
    handleCreate,
    handleKill,
    getTerminalThemeName,
    getTerminalCwd,
    getTerminalActive,
    commands,
  };
}
