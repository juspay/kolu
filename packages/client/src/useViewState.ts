import type { HostViewState } from "./hostScope/createViewState";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { activeScope } from "./hostScope/hostScopes";

export type Camera = { panX: number; panY: number; zoom: number };

type ActiveView = Omit<HostViewState, "setCanvasMaximized"> & {
  setCanvasMaximized: (next: (prev: boolean) => boolean) => void;
};

const EMPTY_VIEW: ActiveView = {
  focusedTerminalId: () => null,
  activeId: () => null,
  isFocused: () => false,
  isActiveTile: () => false,
  mruOrder: () => [],
  writeFocus: () => {},
  reconcileLiveIds: () => {},
  forgetFromMru: () => {},
  isUnread: () => false,
  canvasMaximized: () => false,
  setCanvasMaximized: () => {},
  reset: () => {},
};

export function useViewState() {
  const view = (): ActiveView => activeScope()?.view ?? EMPTY_VIEW;

  const focusedTerminalId = () => view().focusedTerminalId();
  const activeId = () => view().activeId();
  const isFocused = (id: TerminalId): boolean => view().isFocused(id);
  const isActiveTile = (id: TerminalId): boolean => view().isActiveTile(id);
  const mruOrder = () => view().mruOrder();

  const canvasMaximized = (): boolean => view().canvasMaximized();

  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  function requestCenterActive(): void {
    const id = activeId();
    if (id !== null) setCenterActiveRequest(id);
  }

  const reconcileLiveIds = (liveIds: readonly TerminalId[]): void =>
    view().reconcileLiveIds(liveIds);

  const forgetFromMru = (id: TerminalId): void => view().forgetFromMru(id);

  function toggleCanvasMaximized() {
    view().setCanvasMaximized((prev) => !prev);
  }

  const isUnread = (id: TerminalId): boolean => view().isUnread(id);

  function reset() {
    view()?.reset();
  }

  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    canvasMaximized,
    toggleCanvasMaximized,
    mruOrder,
    reconcileLiveIds,
    forgetFromMru,
    centerActiveRequest,
    requestCenterActive,
    isUnread,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
