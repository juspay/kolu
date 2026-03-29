/** Terminal session state: single store keyed by UUID, using TerminalInfo from common. */

import {
  type Accessor,
  createSignal,
  createEffect,
  on,
  createResource,
  createMemo,
} from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { toast } from "solid-sonner";
import { availableThemes } from "./theme";
import { client } from "./rpc";
import { useSubPanel } from "./useSubPanel";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";
import type { TerminalId, TerminalInfo, TerminalMetadata } from "kolu-common";
import type { useActivity } from "./useActivity";
import type { useActivityAlerts } from "./useActivityAlerts";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";

/** Per-terminal metadata stored client-side. Same shape as TerminalInfo minus the id (used as key),
 *  plus client-only flags. */
type TerminalState = Omit<TerminalInfo, "id" | "activityHistory"> & {
  /** Set when a background terminal's activity session ends. Cleared on visit. */
  notified?: boolean;
};

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminals(deps: {
  randomTheme: Accessor<boolean>;
  activity: ReturnType<typeof useActivity>;
  activityAlerts: ReturnType<typeof useActivityAlerts>;
}) {
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
  const { pushActivity, getActivityHistory, seedActivity, clearActivity } =
    deps.activity;

  const [activeId, setActiveId] = makePersisted(
    createSignal<TerminalId | null>(null),
    {
      name: ACTIVE_TERMINAL_KEY,
      serialize: (v) => (v === null ? "" : v),
      deserialize: (s) => (s === "" ? null : (s as TerminalId)),
    },
  );

  const terminalIds = idOrder;

  // MRU (most-recently-used) order: tracks terminal switch history for quick-switch.
  // Updated whenever activeId changes. Most recent first.
  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  // Track when the user last left each terminal (for suppressing seen-activity alerts)
  const leftAt = new Map<TerminalId, number>();

  createEffect(
    on(activeId, (id, prev) => {
      if (id === null) return;
      // Record when user left the previous terminal
      if (prev) leftAt.set(prev, Date.now());
      // Clear alert highlight when user visits the terminal
      if (meta[id]?.notified) setMeta(id, "notified", false);
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
    }),
  );

  /** Get sub-terminal IDs for a given parent. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  /** Get metadata for a terminal. */
  function getMeta(id: TerminalId): TerminalState | undefined {
    return meta[id];
  }

  /** Set a terminal's theme name locally and on the server. */
  function setThemeName(id: TerminalId, name: string) {
    setMeta(id, "themeName", name);
    void client.terminal.setTheme({ id, themeName: name });
  }

  /** The active terminal's metadata (for header display). */
  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = activeId();
    return id !== null ? (meta[id]?.meta ?? null) : null;
  });

  /** Complete display info per terminal: metadata + colors + activity + sub-count. */
  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      terminalIds(),
      getMeta,
      getActivityHistory,
      getSubTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

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

  /** 1-based display label for toasts/notifications (e.g. "Terminal 3"). */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  /** Subscribe to activity state changes for a terminal. */
  function subscribeActivity(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onActivityChange({ id }, { signal }),
      (isActive) => {
        setMeta(id, "isActive", isActive);
        pushActivity(id, isActive);
        // New activity makes a stale "finished" highlight irrelevant
        if (isActive && meta[id]?.notified) setMeta(id, "notified", false);
      },
    );
  }

  /** Subscribe to coalesced session-end events for activity alerts.
   *  Only alerts if the user hasn't already seen the activity — i.e., they
   *  left the terminal before the last output in the session. */
  function subscribeSessionEnd(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onSessionEnd({ id }, { signal }),
      (event) => {
        if (!deps.activityAlerts.enabled()) return;
        // User is looking at this terminal right now
        if (id === activeId()) return;
        // User was viewing when the last activity happened — they saw it
        const left = leftAt.get(id);
        if (left !== undefined && left >= event.lastActivityAt) return;
        setMeta(id, "notified", true);
        deps.activityAlerts.onSessionEnd(terminalLabel(id), event);
      },
    );
  }

  /** Subscribe to exit events for a terminal. On exit, notify and remove. */
  function subscribeExit(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onExit({ id }, { signal }),
      (code) => {
        const label = terminalLabel(id);
        toast(
          code === 0 ? `${label} exited` : `${label} exited with code ${code}`,
        );
        removeAndAutoSwitch(id);
      },
    );
  }

  /** Start all per-terminal stream subscriptions (metadata, activity, session end, exit). */
  function subscribeAll(id: TerminalId) {
    subscribeMetadata(id);
    subscribeActivity(id);
    subscribeSessionEnd(id);
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
    clearActivity(id);
    setMruOrder((prev) => prev.filter((x) => x !== id));
    if (activeId() === id) {
      setActiveId(remaining[Math.min(idx, remaining.length - 1)] ?? null);
    }
  }

  /** Convert a TerminalInfo (wire type) to store entry (strip id and activityHistory).
   *  Ensures `meta` is always present so SolidJS store tracks it from creation —
   *  without this, setting `meta` later via subscription won't trigger memo re-runs. */
  function infoToState(t: TerminalInfo): TerminalState {
    const { id: _, activityHistory: _history, ...state } = t;
    return { meta: undefined, ...state };
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

      // Seed MRU with all top-level terminals (active first, rest in sidebar order).
      // MRU is in-memory only — without this, Ctrl+Tab after refresh shows only the active terminal.
      const active = activeId();
      setMruOrder(active ? [active, ...ids.filter((x) => x !== active)] : ids);

      // Seed activity history from server (late-joining clients get full sparkline)
      for (const t of existing) {
        if (t.activityHistory?.length) {
          seedActivity(t.id, t.activityHistory);
        }
      }

      // Subscribe to live updates for all terminals
      for (const t of existing) subscribeAll(t.id);
    }
    return existing;
  });

  const { showTipOnce } = useTips();

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate(cwd?: string) {
    // Show worktree tip when creating a terminal while in a git repo
    if (activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

    const info = await client.terminal.create({ cwd });
    const themeName = deps.randomTheme()
      ? availableThemes[Math.floor(Math.random() * availableThemes.length)]!
          .name
      : undefined;
    setMeta(info.id, { ...infoToState(info), ...(themeName && { themeName }) });
    setIdOrder((prev) => [...prev, info.id]);
    setActiveId(info.id);
    subscribeAll(info.id);
    if (themeName) setThemeName(info.id, themeName);
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

  /** Create a git worktree and open a terminal in it. */
  async function handleCreateWorktree(repoPath: string) {
    const result = await client.git.worktreeCreate({ repoPath });
    toast(`Created worktree at ${result.path}`);
    await handleCreate(result.path);
  }

  /** Kill the active terminal (and sub-terminals) and remove its worktree. */
  async function handleKillWorktree() {
    const id = activeId();
    if (!id) return;
    const meta = activeMeta();
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    const subs = getSubTerminalIds(id);
    for (const subId of subs) await handleKill(subId);
    await handleKill(id);
    if (worktreePath) {
      await client.git.worktreeRemove({ worktreePath });
      toast(`Removed worktree at ${worktreePath}`);
    }
  }

  /** Copy the active terminal's buffer as plain text to the clipboard. */
  async function handleCopyTerminalText() {
    const id = activeId();
    if (id === null) return;
    try {
      const text = await client.terminal.screenText({ id });
      await navigator.clipboard.writeText(text);
      toast("Copied terminal text to clipboard");
    } catch (err) {
      console.error("Failed to copy terminal text:", err);
      toast.error("Failed to copy terminal text");
    }
  }

  return {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    getDisplayInfo,
    getActivityHistory,
    setThemeName,
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
    mruOrder,
    handleCopyTerminalText,
    handleCreateWorktree,
    handleKillWorktree,
    /** Debug: simulate a session-end event on a random non-active terminal. */
    simulateSessionEnd: () => {
      const inactive = terminalIds().filter((id) => id !== activeId());
      if (inactive.length === 0) return;
      const id = inactive[Math.floor(Math.random() * inactive.length)]!;
      setMeta(id, "notified", true);
      deps.activityAlerts.onSessionEnd(terminalLabel(id), {
        durationS: 42,
        lastActivityAt: Date.now(),
      });
    },
  };
}
