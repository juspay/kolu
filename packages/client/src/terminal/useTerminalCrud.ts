import {
  TOPLEVEL_PLACEMENT,
  activeArm,
  sleepingArm,
} from "@kolu/padi-client/surface";
import type { TranscriptHtmlMode } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Data, Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, on } from "solid-js";
import { toast } from "solid-sonner";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import { stackTitle } from "@kolu/agent-distro/landing";
import { restartedLabel } from "@kolu/agent-distro/status";
import { agentLive } from "@kolu/terminal-vocab/agentProjection";
import { createRestartGuard, type RestartGuard } from "../agents/restartGuard";
import { usePendingLayouts } from "../canvas/usePendingLayouts";
import { personInput } from "../conductor/personInput";
import { createSharedRoot } from "../createSharedRoot";
import { exportScrollbackAsPdf } from "../exportScrollbackAsPdf";
import { exportSessionAsHtml } from "../exportSessionAsHtml";
import { refuseIfWarming } from "../kaval/useDaemonStatus";
import { useRightPanel } from "../right-panel/useRightPanel";
import { runAction, runActionPromise, type UiAction } from "../runAction";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { activePadiRpc } from "../wire";
import {
  createEvictionDedup,
  evictTerminal,
  type TerminalEvictionPorts,
} from "./useActiveReconcile";
import { useSubPanel } from "./useSubPanel";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";

export class TerminalCreateRefused extends Data.TaggedError(
  "TerminalCreateRefused",
)<{ readonly reason: "warming" | "failed" }> {}

export class TerminalDiscardFailed extends Data.TaggedError(
  "TerminalDiscardFailed",
)<Record<string, never>> {}

export const useTerminalCrud = createSharedRoot(() => {
  const store = useTerminalStore();
  const subPanel = useSubPanel();
  const terminalSearch = useTerminalSearch();
  const rightPanel = useRightPanel();
  const pendingLayouts = usePendingLayouts();
  const { showTipOnce } = useTips();

  const toastFailure =
    (prefix: string) =>
    <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A | undefined, never> =>
      Effect.catch(self, (err) =>
        Effect.sync(() => {
          toast.error(`${prefix}: ${toError(err).message}`);
          return undefined;
        }),
      );

  function setThemeName(id: TerminalId, name: string): UiAction {
    return activePadiRpc.chrome
      .setTheme({ id, themeName: name })
      .pipe(toastFailure("Failed to set theme"));
  }

  const setParent = (
    subId: TerminalId,
    parentId: TerminalId | null,
    settled?: (applied: boolean) => void,
  ): void => {
    runAction(
      "re-home split",
      activePadiRpc.chrome.setParent({ id: subId, parentId }).pipe(
        Effect.tap(() => Effect.sync(() => settled?.(true))),
        Effect.tapError(() => Effect.sync(() => settled?.(false))),
        toastFailure("Failed to set parent"),
      ),
    );
  };

  function promoteToTopLevel(
    subId: TerminalId,
    fromTile: TerminalId,
    settled?: (applied: boolean) => void,
  ): void {
    rightPanel.adoptTileCollapsed(fromTile)(subId);
    setParent(subId, null, settled);
  }

  const evictionPorts: TerminalEvictionPorts = {
    activeId: store.activeId,
    focusedTerminalId: store.focusedTerminalId,
    activate: store.activate,
    dropFromMru: (id) => store.forgetFromMru(id),
    promoteToTopLevel,
    rehomeUnder: (subId, newParentId) => setParent(subId, newParentId),
    subPanel,
    removeRightPanel: rightPanel.removePanel,
    removeSearch: terminalSearch.removeTerminal,
  };

  function liveRemovalGraph() {
    const ids = store.listSub()?.map((t) => t.id) ?? [];
    return {
      ids,
      parentOf: (x: TerminalId) => {
        const m = store.getMetadata(x);
        if (m === undefined) return undefined;
        return m.parentId ?? null;
      },
    };
  }

  const eviction = createEvictionDedup(
    (id, parentId, topLevelBefore, departing, removal) =>
      evictTerminal(
        evictionPorts,
        id,
        parentId,
        topLevelBefore,
        departing,
        removal,
      ),
  );

  function removeAndAutoSwitch(id: TerminalId) {
    eviction.evictImperatively(
      id,
      store.getMetadata(id)?.parentId ?? null,
      store.terminalIds(),
      store.getMetadata(id) !== undefined,
      liveRemovalGraph(),
    );
  }

  function handleCreate(
    cwd?: string,
  ): Effect.Effect<TerminalId, TerminalCreateRefused> {
    return Effect.gen(function* () {
      if (refuseIfWarming())
        return yield* new TerminalCreateRefused({ reason: "warming" });
      if (store.activeMeta()?.git.kind === "repo")
        showTipOnce(CONTEXTUAL_TIPS.worktree);

      const { id: activeId, meta } = store.active();
      const initializePanel = rightPanel.adoptTileCollapsed(activeId);
      const activeLayout = activeId
        ? pendingLayouts.resolveLayout(activeId, meta?.canvasLayout)
        : undefined;
      pendingLayouts.setNextDefaultSize(
        activeLayout ? { w: activeLayout.w, h: activeLayout.h } : null,
      );
      const info = yield* activePadiRpc.lifecycle
        .create({
          placement: TOPLEVEL_PLACEMENT,
          ...(cwd !== undefined && { cwd }),
        })
        .pipe(
          Effect.tapError((err) =>
            Effect.sync(() => {
              pendingLayouts.setNextDefaultSize(null);
              toast.error(`Failed to create terminal: ${toError(err).message}`);
            }),
          ),
          Effect.mapError(
            () => new TerminalCreateRefused({ reason: "failed" }),
          ),
        );
      initializePanel(info.id);
      store.setActiveSilently(info.id);
      showTipOnce(CONTEXTUAL_TIPS.themeSwitch);
      return info.id;
    });
  }

  function handleCreateSubTerminal(
    parentId: TerminalId,
    cwd?: string,
  ): Effect.Effect<void, TerminalCreateRefused> {
    return Effect.gen(function* () {
      if (refuseIfWarming()) return;
      const initializePaneTab = rightPanel.seedSplitTab(
        store.focusedTerminalId(),
      );
      const info = yield* activePadiRpc.lifecycle
        .create({
          placement: { kind: "child-of", parentId },
          ...(cwd !== undefined && { cwd }),
        })
        .pipe(
          Effect.tapError((err) =>
            Effect.sync(() => {
              toast.error(`Failed to create terminal: ${toError(err).message}`);
            }),
          ),
          Effect.mapError(
            () => new TerminalCreateRefused({ reason: "failed" }),
          ),
        );
      initializePaneTab(info.id);
      subPanel.focusSubTab(parentId, info.id);
    });
  }

  function toggleSubPanel(parentId: TerminalId): UiAction {
    if (store.getSplitPaneIds(parentId).length === 0) {
      return handleCreateSubTerminal(
        parentId,
        store.activeMeta()?.cwd ?? undefined,
      ).pipe(Effect.ignore);
    }
    return Effect.sync(() => subPanel.togglePanel(parentId));
  }

  function handleKill(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle.kill({ id }).pipe(
      Effect.ignore,
      Effect.andThen(() => Effect.sync(() => removeAndAutoSwitch(id))),
    );
  }

  function splitsDeepestFirst(id: TerminalId): TerminalId[] {
    const depthOf = (x: TerminalId): number => {
      let depth = 0;
      let cur = store.getMetadata(x)?.parentId ?? null;
      while (cur !== null) {
        depth++;
        cur = store.getMetadata(cur)?.parentId ?? null;
      }
      return depth;
    };
    return [...store.getSplitPaneIds(id)].sort(
      (a, b) => depthOf(b) - depthOf(a),
    );
  }

  function handleKillWithSubs(id: TerminalId): UiAction {
    return Effect.gen(function* () {
      for (const subId of splitsDeepestFirst(id)) yield* closeOne(subId);
      yield* closeOne(id);
    });
  }

  function closeOne(id: TerminalId): UiAction {
    return sleepingArm(store.getMetadata(id))
      ? handleDiscard(id).pipe(Effect.ignore)
      : handleKill(id);
  }

  function requestSleep(id: TerminalId): UiAction {
    return Effect.suspend(() => {
      showTipOnce(CONTEXTUAL_TIPS.sleepTerminal);
      return handleSleep(id);
    });
  }

  function handleSleep(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle
      .sleep({ id })
      .pipe(toastFailure("Failed to sleep terminal"));
  }

  function handleWake(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle
      .wake({ id })
      .pipe(toastFailure("Failed to wake terminal"));
  }

  function handleRestart(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle.restart({ id }).pipe(
      Effect.tap((restarted) =>
        Effect.sync(() =>
          toast.success(
            restartedLabel({
              agents:
                restarted.agents === undefined
                  ? undefined
                  : stackTitle(restarted.agents.profiles),
              resumed: restarted.resumed,
            }),
            { icon: AgentDistroLogo({ size: 16 }) },
          ),
        ),
      ),
      toastFailure("Failed to restart terminal"),
    );
  }

  const restartGuards = new Map<
    TerminalId,
    RestartGuard & { readonly dispose: () => void }
  >();

  function liveAgentOf(id: TerminalId): boolean {
    const agent = activeArm(store.getMetadata(id))?.agent;
    return agent != null && agentLive(agent.state);
  }

  function restartGuard(id: TerminalId) {
    const existing = restartGuards.get(id);
    if (existing !== undefined) return existing;
    const guard = createRoot((dispose) => {
      const created = {
        ...createRestartGuard({
          guarded: () => liveAgentOf(id),
          restart: () => runActionPromise(handleRestart(id)),
        }),
        dispose,
      };
      createEffect(
        on(
          () => store.getMetadata(id) === undefined,
          (gone) => {
            if (gone) forgetRestartGuard(id);
          },
          { defer: true },
        ),
      );
      return created;
    });
    restartGuards.set(id, guard);
    return guard;
  }

  function forgetRestartGuard(id: TerminalId): void {
    restartGuards.get(id)?.dispose();
    restartGuards.delete(id);
  }

  function requestRestart(id: TerminalId): void {
    restartGuard(id).press();
  }

  const restartArmed = (id: TerminalId): boolean => restartGuard(id).armed();

  const restartBusy = (id: TerminalId): boolean => restartGuard(id).busy();

  function handleDiscard(
    id: TerminalId,
  ): Effect.Effect<void, TerminalDiscardFailed> {
    return activePadiRpc.lifecycle.discardSleeping({ id }).pipe(
      Effect.tapError((err) =>
        Effect.sync(() => {
          toast.error(`Failed to discard terminal: ${toError(err).message}`);
        }),
      ),
      Effect.mapError(() => new TerminalDiscardFailed({})),
      Effect.tap(() =>
        Effect.sync(() => {
          for (const subId of splitsDeepestFirst(id))
            if (store.getMetadata(subId) !== undefined)
              removeAndAutoSwitch(subId);
          removeAndAutoSwitch(id);
        }),
      ),
    );
  }

  function handleCopyTerminalText(): UiAction {
    return Effect.gen(function* () {
      const id = store.focusedId();
      if (id === null) return;
      const text = yield* activePadiRpc.screen.text({ id }).pipe(
        Effect.catch((err) =>
          Effect.sync((): string | undefined => {
            console.error("Failed to read terminal text:", err);
            toast.error(
              `Failed to read terminal text: ${toError(err).message}`,
            );
            return undefined;
          }),
        ),
      );
      if (text === undefined) return;
      yield* writeTextToClipboard(text).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Copied terminal text to clipboard")),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            console.error("Failed to copy terminal text:", err);
            toast.error(
              `Failed to copy terminal text: ${toError(err).message}`,
            );
          }),
        ),
      );
    });
  }

  function handleCopyTerminalId(): UiAction {
    return Effect.suspend(() => {
      const id = store.focusedId();
      if (id === null) return Effect.void;
      return writeTextToClipboard(id).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Copied terminal ID to clipboard")),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            console.error("Failed to copy terminal ID:", err);
            toast.error(`Failed to copy terminal ID: ${toError(err).message}`);
          }),
        ),
      );
    });
  }

  function handleRunInActiveTerminal(command: string): UiAction {
    return Effect.suspend(() => {
      const id = store.focusedId();
      if (id === null) return Effect.void;
      if (!personInput(id)) return Effect.void;
      return activePadiRpc.lifecycle
        .sendInput({ id, data: command })
        .pipe(toastFailure("Failed to prefill command"));
    });
  }

  function handleTypeInto(
    id: TerminalId,
    text: string,
    enter: boolean,
  ): UiAction {
    return Effect.suspend(() => {
      if (!personInput(id)) return Effect.void;
      return activePadiRpc.lifecycle
        .sendInput({ id, data: enter ? `${text}\r` : text })
        .pipe(toastFailure("Failed to type into the terminal"));
    });
  }

  function handleCloseAll(): UiAction {
    return activePadiRpc.lifecycle.killAll().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          store.reset();
          terminalSearch.reset();
        }),
      ),
      toastFailure("Failed to close all terminals"),
    );
  }

  function exportScrollbackPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportScrollbackAsPdf(id, store.getMetadata(id));
  }

  function exportSessionHtml(
    modes: [TranscriptHtmlMode, ...TranscriptHtmlMode[]],
  ): UiAction {
    return Effect.suspend(() => {
      const id = store.activeId();
      if (id === null) return Effect.void;
      return exportSessionAsHtml(id, modes);
    });
  }

  return {
    setThemeName,
    removeAndAutoSwitch,
    evictDeparted: eviction.evictDeparted,
    handleCreate,
    handleCreateSubTerminal,
    reparent: (id: TerminalId, parentId: TerminalId | null) =>
      new Promise<boolean>((resolve) => setParent(id, parentId, resolve)),
    toggleSubPanel,
    promoteToTopLevel,
    handleKill,
    handleKillWithSubs,
    closeOne,
    requestSleep,
    handleSleep,
    handleWake,
    handleRestart,
    requestRestart,
    restartArmed,
    restartBusy,
    liveAgentOf,
    handleDiscard,
    handleCopyTerminalText,
    handleCopyTerminalId,
    handleRunInActiveTerminal,
    handleTypeInto,
    handleCloseAll,
    exportScrollbackPdf,
    exportSessionHtml,
  };
});
