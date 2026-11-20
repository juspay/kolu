import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { createMemo } from "solid-js";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { toast } from "solid-sonner";
import { deepLinkFocusIntent } from "../deepLinkFocusIntent";
import {
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../hostScope/activeWire";
import { activeScope } from "../hostScope/hostScopes";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import type { UiAction } from "../runAction";
import { activePadiRpc } from "../wire";
import { containingTileOf, descendantsByRoot } from "./terminalTree";
import { useSubPanel } from "./useSubPanel";
import type { TerminalStore } from "./useTerminalStore";

type HydrationEntry = { t: { id: TerminalId }; m: TerminalMetadata };

export const ANSWERED_TILE_DEADLINE_MS = 10_000;

type AnsweredWait =
  | { phase: "idle" }
  | { phase: "armed"; answered: object; timer: ReturnType<typeof setTimeout> }
  | { phase: "expired"; answered: object };

const IDLE_WAIT: AnsweredWait = { phase: "idle" };

export function useSessionRestore(deps: { store: TerminalStore }) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  const savedSession = createMemo(() => {
    if (lifecycle().kind === "restarted") return null;
    return serverSavedSession();
  });
  const [isRestoring, setIsRestoring] = createSignal(false);
  const [isForfeiting, setIsForfeiting] = createSignal(false);

  const [answeredWait, setAnsweredWait] = createSignal<AnsweredWait>(IDLE_WAIT);
  function disarmDeadline() {
    const wait = answeredWait();
    if (wait.phase === "armed") clearTimeout(wait.timer);
    if (wait.phase !== "idle") setAnsweredWait(IDLE_WAIT);
  }
  onCleanup(disarmDeadline);

  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSavedSession();
    const latch = activeScope()?.restore;
    if (!latch) return;
    if (existing === undefined || savedSessionSub.pending()) return;
    if (latch.phase === "pending") {
      latch.markDecided();
      if (store.terminalIds().length === 0) {
        return;
      }
    }
    if (latch.phase === "seeded") return;
    if (isRestoring()) return;
    const joined: HydrationEntry[] = [];
    for (const t of existing) {
      const m = store.getMetadata(t.id);
      if (m === undefined) return;
      joined.push({ t, m });
    }
    if (joined.length === 0) return;
    const restored = latch.restoredActive;
    if (restored?.id != null && !existing.some((t) => t.id === restored.id)) {
      const wait = answeredWait();
      if (wait.phase === "idle" || wait.answered !== restored) {
        disarmDeadline();
        const target = restored;
        const answered = restored.id;
        const timer = setTimeout(() => {
          latch.expireRestoredActive();
          toast.error(
            `Restore reported terminal ${answered} as active, but it never appeared on this host — seeding the view without it`,
          );
          setAnsweredWait({ phase: "expired", answered: target });
        }, ANSWERED_TILE_DEADLINE_MS);
        setAnsweredWait({ phase: "armed", answered: target, timer });
      }
      return;
    }
    disarmDeadline();
    latch.markSeeded();
    hydrateFromTerminals(
      joined,
      restored ? restored.id : (fromServer?.activeTerminalId ?? null),
    );
  });

  function hydrateFromTerminals(
    entries: HydrationEntry[],
    serverActiveId: string | null,
  ) {
    for (const { t, m } of entries) {
      if (m.rightPanel) rightPanel.seedHistory(t.id);
    }

    const byId = new Map(entries.map((e) => [e.t.id, e]));
    const parentEdge = (id: TerminalId) => {
      const e = byId.get(id);
      if (!e) return undefined;
      return e.m.parentId ?? null;
    };

    const byRoot = descendantsByRoot(
      entries.map(({ t }) => t.id),
      parentEdge,
    );
    for (const [rootId, subIds] of byRoot) {
      const activeSubTab = subPanel.paneChrome(rootId).activeSubTab;
      if (!activeSubTab || !subIds.includes(activeSubTab)) {
        subPanel.setActiveSubTab(rootId, subIds[0] ?? null);
      }
    }

    const topIds = entries
      .filter(({ t }) => containingTileOf(t.id, parentEdge) === t.id)
      .map(({ t }) => t.id);
    const intent = deepLinkFocusIntent();
    const intentTile =
      intent !== null ? containingTileOf(intent, parentEdge) : null;
    const picked =
      intentTile && topIds.includes(intentTile as TerminalId)
        ? (intentTile as TerminalId)
        : serverActiveId && topIds.includes(serverActiveId as TerminalId)
          ? (serverActiveId as TerminalId)
          : (topIds[0] ?? null);
    store.reconcileLiveIds(
      picked ? [picked, ...topIds.filter((x) => x !== picked)] : topIds,
    );

    store.setActiveSilently(picked);
  }

  function handleRestoreSession(
    options: { resumeAgents?: boolean; optOutIds?: readonly string[] } = {},
  ): UiAction {
    return Effect.suspend(() => {
      if (isRestoring()) return Effect.void;
      const session = savedSession();
      if (!session) return Effect.void;
      setIsRestoring(true);
      const latch = activeScope()?.restore;
      latch?.reseedForRestore();
      if (session.resumableIds === undefined) {
        setIsRestoring(false);
        return Effect.die(
          new Error(
            "Saved session missing host-stamped resumableIds — padi must stamp membership on every serve",
          ),
        );
      }
      const id = toast.loading(
        `Restoring ${session.terminals.length} terminals…`,
      );
      const resumeAgents = options.resumeAgents ?? true;
      const optOutIds = options.optOutIds ? [...options.optOutIds] : [];
      const hostResumable = session.resumableIds;
      return activePadiRpc.session
        .restore({
          resumeAgents,
          ...(optOutIds.length > 0 && { optOutIds }),
        })
        .pipe(
          Effect.tap((restored) =>
            Effect.sync(() => {
              latch?.reportRestoredActive(restored.activeTerminalId);
              setIsRestoring(false);
              const optOut = new Set(optOutIds);
              const resumed = resumeAgents
                ? hostResumable.filter((tid) => !optOut.has(tid)).length
                : 0;
              toast.success(
                resumed > 0
                  ? `Restored ${session.terminals.length} terminals, resumed ${resumed} agent${
                      resumed > 1 ? "s" : ""
                    }`
                  : "Session restored",
                { id },
              );
            }),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(`Restore failed: ${toError(err).message}`, { id });
            }),
          ),
          Effect.ensuring(Effect.sync(() => setIsRestoring(false))),
        );
    });
  }

  function handleForfeitSession(): UiAction {
    return Effect.suspend(() => {
      if (isForfeiting()) return Effect.void;
      const session = savedSession();
      if (!session) return Effect.void;
      setIsForfeiting(true);
      return activePadiRpc.session.forfeit({}).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to start fresh: ${toError(err).message}`);
          }),
        ),
        Effect.ensuring(Effect.sync(() => setIsForfeiting(false))),
      );
    });
  }

  return {
    isLoading: () =>
      store.listSub.pending() ||
      (store.terminalIds().length === 0 &&
        (store.recordPhases().awaited > 0 || savedSessionSub.pending())),
    savedSession,
    isRestoring,
    isForfeiting,
    handleRestoreSession,
    handleForfeitSession,
  };
}
