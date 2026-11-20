import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createMemo,
  createSelector,
  createSignal,
  type Setter,
} from "solid-js";
import { attentionRecordOf } from "../attention/savedAttention";
import { perHostBoolPref } from "../persistedPref";
import { runAction } from "../runAction";
import {
  activeTileOf,
  type TerminalFocus,
  type LivePlacement,
} from "../terminal/focusedTerminal";
import { useVisitRecency } from "../terminal/visitRecency";
import { padiRpcOf } from "../wire";

export interface HostViewState {
  focusedTerminalId: Accessor<TerminalId | null>;
  activeId: Accessor<TerminalId | null>;
  isFocused: (id: TerminalId) => boolean;
  isActiveTile: (id: TerminalId) => boolean;
  mruOrder: Accessor<TerminalId[]>;
  writeFocus: (focus: TerminalFocus | null) => void;
  reconcileLiveIds: (liveIds: readonly TerminalId[]) => void;
  forgetFromMru: (id: TerminalId) => void;
  isUnread: (id: TerminalId) => boolean;
  canvasMaximized: Accessor<boolean>;
  setCanvasMaximized: Setter<boolean>;
  reset: () => void;
}

export function createViewState(
  host: HostKey,
  placementOf: (id: TerminalId) => LivePlacement,
): HostViewState {
  const [focus, setFocus] = createSignal<TerminalFocus | null>(null);
  const focusedTerminalId = createMemo(() => focus()?.id ?? null);
  const activeId = createMemo(() => activeTileOf(focus(), placementOf));
  const isFocused = createSelector(focusedTerminalId);
  const isActiveTile = createSelector(activeId);
  const visits = useVisitRecency();

  const encoded = encodeHostKey(host);
  const attention = attentionRecordOf(encoded);

  const mruOrder = createMemo(() => visits.mruForHost(host));

  const [canvasMaximized, setCanvasMaximized] = perHostBoolPref({
    host,
    base: "kolu-canvasMaximized",
    fallback: false,
  });

  function reportActiveTileBestEffort(tileId: TerminalId): void {
    runAction(
      "report active terminal",
      padiRpcOf(host)
        .chrome.setActive({ id: tileId })
        .pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              console.error(
                `hostScope: failed to report active terminal ${tileId} to ${encoded}: ${toError(err).message}`,
              );
            }),
          ),
        ),
    );
  }

  function writeFocus(next: TerminalFocus | null): void {
    setFocus(next);
    if (next) attention.clearUnread(next.id);
    const tileId = activeTileOf(next, placementOf);
    if (tileId === null) return;
    visits.noteVisit(host, tileId);
    reportActiveTileBestEffort(tileId);
  }

  function reconcileLiveIds(liveIds: readonly TerminalId[]): void {
    visits.applyLiveIds(host, liveIds);
  }

  function forgetFromMru(id: TerminalId): void {
    visits.forgetVisit(host, id);
  }

  function reset(): void {
    setFocus(null);
    visits.clearHost(host);
    attention.clearAllUnread();
    setCanvasMaximized(false);
  }

  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    mruOrder,
    writeFocus,
    reconcileLiveIds,
    forgetFromMru,
    isUnread: attention.isUnread,
    canvasMaximized,
    setCanvasMaximized,
    reset,
  };
}
