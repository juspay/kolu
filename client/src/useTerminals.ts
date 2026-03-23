/** Terminal session state: manages terminal list, active selection, and per-terminal themes. */

import { createSignal, createResource, createMemo } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_THEME_NAME, availableThemes, getThemeByName } from "./theme";
import { client } from "./rpc";
import type { TerminalInfo, CwdInfo } from "kolu-common";

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminals() {
  const [terminalIds, setTerminalIds] = createSignal<string[]>([]);
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

  /** Remove a terminal from all state stores. Returns the new ID list and removed index. */
  function removeTerminal(
    id: string,
  ): { newIds: string[]; idx: number } | null {
    const ids = terminalIds();
    const idx = ids.indexOf(id);
    if (idx === -1) return null; // already removed
    const newIds = ids.filter((x) => x !== id);
    setTerminalIds(newIds);
    setTerminalCwds(produce((s) => delete s[id]));
    setTerminalActivity(produce((s) => delete s[id]));
    setTerminalThemes(produce((s) => delete s[id]));
    return { newIds, idx };
  }

  /** Remove a terminal and auto-switch if it was the active one. */
  function removeAndAutoSwitch(id: string) {
    const result = removeTerminal(id);
    if (!result) return;
    if (activeId() === id) {
      const next =
        result.newIds[Math.min(result.idx, result.newIds.length - 1)] ?? null;
      setActiveId(next);
    }
  }

  // Restore existing terminals on page load (e.g. after browser refresh).
  const [existingTerminals] = createResource<TerminalInfo[]>(async () => {
    const existing = await client.terminal.list();
    if (existing.length > 0) {
      const ids = existing.map((t) => t.id);
      setTerminalIds(ids);
      // Keep persisted active terminal if it still exists; otherwise pick a running one
      const persisted = activeId();
      if (!persisted || !ids.includes(persisted)) {
        const running = existing.find((t) => t.status === "running");
        setActiveId(running?.id ?? ids[0] ?? null);
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
    setTerminalIds((prev) => [...prev, info.id]);
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
      ...terminalIds().map((id, i) => ({
        name: `Switch to Terminal ${i + 1}`,
        onSelect: () => setActiveId(id),
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
