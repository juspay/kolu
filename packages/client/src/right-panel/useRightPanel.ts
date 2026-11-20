import {
  type CodeTabView,
  DEFAULT_RIGHT_PANEL_PER_TERMINAL,
  type RightPanelPerTerminalState,
  type RightPanelTab,
  rightPanelView,
} from "@kolu/padi-client/surface";
import {
  type Browser,
  createBrowser,
  DEFAULT_MAX_ENTRIES,
} from "@kolu/solid-browser";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import { isDesktop } from "../useMobile";
import {
  activeHost,
  activePadiRpc,
  padiRpcOf,
  preferences,
  updatePreferences,
} from "../wire";
import { codeLister } from "./codeLister";

export type BrowserLocation = {
  mode: CodeTabView;
  path: string | null;
  ref?: { startLine: number; endLine: number };
};

const SAME_LOCATION = (a: BrowserLocation, b: BrowserLocation): boolean =>
  a.mode === b.mode && a.path === b.path;

const MIN_PANEL_SIZE = 0.05;
const MIN_TREE_SIZE = 0.1;
const MAX_TREE_SIZE = 0.9;
const SIZE_EPSILON = 1e-6;

const isEchoOf = (stored: number, next: number): boolean =>
  Math.abs(next - stored) <= SIZE_EPSILON;

const [perTerminal, setPerTerminal] = createStore<
  Record<TerminalId, RightPanelPerTerminalState>
>({});

const [drawerOpen, setDrawerOpen] = createSignal(false);

type TerminalHistory = {
  browser: Browser<BrowserLocation>;
  lastRepo: string | null | undefined;
};
const history = new Map<TerminalId, TerminalHistory>();

function newBrowserFor(): Browser<BrowserLocation> {
  return createBrowser<BrowserLocation>({
    isSameEntry: SAME_LOCATION,
    maxEntries: DEFAULT_MAX_ENTRIES,
  });
}

function historyFor(id: TerminalId): TerminalHistory {
  let h = history.get(id);
  if (!h) {
    h = { browser: newBrowserFor(), lastRepo: undefined };
    history.set(id, h);
  }
  return h;
}

function browserFor(id: TerminalId): Browser<BrowserLocation> {
  return historyFor(id).browser;
}

function freshPerTerminalState(): RightPanelPerTerminalState {
  return {
    ...DEFAULT_RIGHT_PANEL_PER_TERMINAL,
    collapsed: preferences().newTerminalCollapsed,
  };
}

function reportToServer(
  id: TerminalId,
  rpc: ReturnType<typeof padiRpcOf>,
): void {
  const s = perTerminal[id];
  if (!s) return;
  runAction(
    "save panel state",
    rpc.chrome
      .setRightPanel({
        id,
        collapsed: s.collapsed,
        activeTab: s.activeTab,
        codeMode: s.codeMode,
        ...(s.selectedFileByMode !== undefined && {
          selectedFileByMode: s.selectedFileByMode,
        }),
      })
      .pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to save panel state: ${toError(err).message}`, {
              id: "right-panel-report-failed",
            });
          }),
        ),
      ),
  );
}

export function useRightPanel() {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const rp = () => preferences().rightPanel;

  const hasTerminals = () => tileStore.tileCount() > 0;

  function stateOf(id: TerminalId | null): RightPanelPerTerminalState {
    if (id === null) return freshPerTerminalState();
    return (
      perTerminal[id] ??
      store.getMetadata(id)?.rightPanel ??
      freshPerTerminalState()
    );
  }

  const collapsed = (): boolean => stateOf(store.activeId()).collapsed;

  function paneState(): RightPanelPerTerminalState {
    return stateOf(store.focusedTerminalId());
  }

  function paneCodeMode(): CodeTabView {
    const id = store.focusedTerminalId();
    const git = id === null ? undefined : store.getMetadata(id)?.git;
    return codeLister(git) === "disk" ? "browse" : paneState().codeMode;
  }

  function mutatePanel(
    id: TerminalId,
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
    rpc: ReturnType<typeof padiRpcOf>,
  ): void {
    if (!perTerminal[id]) setPerTerminal(id, { ...stateOf(id) });
    if (typeof update === "function") {
      setPerTerminal(id, produce(update));
    } else {
      setPerTerminal(id, update);
    }
    reportToServer(id, rpc);
  }

  function mutateTile(
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
  ): void {
    const id = store.activeId();
    if (id !== null) mutatePanel(id, update, activePadiRpc);
  }

  function mutatePane(
    update:
      | Partial<RightPanelPerTerminalState>
      | ((s: RightPanelPerTerminalState) => void),
  ): void {
    const id = store.focusedTerminalId();
    if (id !== null) mutatePanel(id, update, activePadiRpc);
  }

  const setCollapsed = (next: boolean) => {
    mutateTile({ collapsed: next });
  };

  function pinSeedAndHost(seed: Partial<RightPanelPerTerminalState>) {
    const rpc = padiRpcOf(activeHost());
    return (id: TerminalId) => mutatePanel(id, seed, rpc);
  }

  function seedHistory(id: TerminalId): void {
    const state = stateOf(id);
    const path = state.selectedFileByMode?.[state.codeMode] ?? null;
    const h = historyFor(id);
    h.browser.reset(path !== null ? { mode: state.codeMode, path } : undefined);
    h.lastRepo = undefined;
  }

  return {
    collapsed,
    panelSize: () => rp().size,
    hasTerminals,
    panelOpen: () => hasTerminals() && !collapsed(),
    togglePanel: () => setCollapsed(!collapsed()),
    collapsePanel: () => setCollapsed(true),
    expandPanel: () => setCollapsed(false),
    setPanelSize: (size: number) => {
      if (size > MIN_PANEL_SIZE && !isEchoOf(rp().size, size))
        updatePreferences({ rightPanel: { size } }, { coalesce: true });
    },
    codeTabTreeSize: () => rp().codeTabTreeSize,
    setCodeTabTreeSize: (size: number) => {
      if (
        size >= MIN_TREE_SIZE &&
        size <= MAX_TREE_SIZE &&
        !isEchoOf(rp().codeTabTreeSize, size)
      ) {
        updatePreferences(
          { rightPanel: { codeTabTreeSize: size } },
          { coalesce: true },
        );
      }
    },

    drawerOpen,
    setDrawerOpen,
    reveal: () => {
      if (!isDesktop()) setDrawerOpen(true);
      else if (collapsed()) setCollapsed(false);
    },

    activeTab: (): RightPanelTab =>
      rightPanelView({
        activeTab: paneState().activeTab,
        codeMode: paneCodeMode(),
      }),
    codeMode: (): CodeTabView => paneCodeMode(),
    showInspector: () => mutatePane({ activeTab: "inspector" }),
    showCode: (mode?: CodeTabView) =>
      mutatePane({
        activeTab: "code",
        ...(mode !== undefined && { codeMode: mode }),
      }),
    openCodeAt: (mode: CodeTabView) => {
      const cur = paneState();
      if (cur.activeTab === "code" && cur.codeMode === mode) return;
      mutatePane({ activeTab: "code", codeMode: mode });
    },
    setCodeMode: (mode: CodeTabView) => mutatePane({ codeMode: mode }),

    selectedFile: (mode: CodeTabView): string | null =>
      paneState().selectedFileByMode?.[mode] ?? null,
    setSelectedFile: (mode: CodeTabView, path: string | null) => {
      const cur = paneState().selectedFileByMode ?? {};
      if (path === null) {
        if (!(mode in cur)) return;
        const { [mode]: _dropped, ...rest } = cur;
        mutatePane({
          selectedFileByMode: Object.keys(rest).length > 0 ? rest : undefined,
        });
      } else {
        if (cur[mode] === path) return;
        mutatePane({ selectedFileByMode: { ...cur, [mode]: path } });
      }
    },

    recordNavigation: (loc: BrowserLocation) => {
      const id = store.focusedTerminalId();
      if (id !== null) browserFor(id).navigate(loc);
    },
    navigateBack: (): BrowserLocation | null => {
      const id = store.focusedTerminalId();
      return id === null ? null : browserFor(id).back();
    },
    navigateForward: (): BrowserLocation | null => {
      const id = store.focusedTerminalId();
      return id === null ? null : browserFor(id).forward();
    },
    canNavigateBack: (): boolean => {
      const id = store.focusedTerminalId();
      return id === null ? false : browserFor(id).canBack();
    },
    canNavigateForward: (): boolean => {
      const id = store.focusedTerminalId();
      return id === null ? false : browserFor(id).canForward();
    },
    syncRepo: (id: TerminalId, repo: string | null) => {
      const h = historyFor(id);
      const prevRepo = h.lastRepo;
      h.lastRepo = repo;
      if (prevRepo !== undefined && repo !== prevRepo) {
        h.browser.reset();
      }
    },

    adoptTileCollapsed: (fromTile: TerminalId | null) => {
      const apply = pinSeedAndHost({
        collapsed: stateOf(fromTile).collapsed,
      });
      return (id: TerminalId) => {
        if (id === fromTile) return;
        apply(id);
      };
    },

    seedSplitTab: (fromId: TerminalId | null) => {
      const apply = pinSeedAndHost({ activeTab: stateOf(fromId).activeTab });
      return (id: TerminalId) => {
        if (perTerminal[id]) return;
        if (store.getMetadata(id)?.rightPanel) {
          seedHistory(id);
          return;
        }
        apply(id);
      };
    },

    seedHistory,
    removePanel: (id: TerminalId) => {
      setPerTerminal(produce((s) => delete s[id]));
      history.delete(id);
    },
  } as const;
}
