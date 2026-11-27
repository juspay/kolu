/** THE ACTIVE HOST'S OWNED WORLD, over a REAL wire — what `activeScope()` must
 *  answer for a suite that drives the product's own hooks at fleet size.
 *
 *  Its `wire` is {@link createHostWire} itself, built over
 *  {@link hostWireMirror}: the real `createReactiveSubscription` keys stream and
 *  the real per-key `useCollection` view, each frame held in the
 *  `createStore<{ v }>` the framework holds it in. That is the whole point — a
 *  suite that judges how WIDE a reading is must pay what the browser pays, and
 *  a hand-written `{ keys, byKey }` over plain arrays under-measures the graph
 *  about threefold (`hostWireMirror`'s own header states the arithmetic).
 *
 *  Its `view` and `prefs` are plain signals, because they ARE plain signals in
 *  production (`createViewState`, `createHostPrefs`) — no store, no proxy, one
 *  source each. Only the members a reading under test actually asks for are
 *  present; everything else reads through optional chaining and floors.
 *
 *  A suite using this must mock `@kolu/surface/client`'s `unenrolledStreamCall`
 *  to call the procedure it is handed, `../wire`'s `padiMap.entry` to answer the
 *  mirror's entry, and `../hostScope/hostScopes`'s `activeScope` to answer
 *  {@link FleetScope.scope}; and it must build this inside a `createRoot`. */

import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createProjection, createSignal } from "solid-js";
import type { ActivityWindow } from "../terminal/activityWindow";
import type { DockOrder } from "../terminal/dockOrder";
import { createHostWire } from "./createHostWire";

export interface FleetScope {
  /** What `activeScope()` must answer. */
  readonly scope: unknown;
  /** The tile MRU, most-recent first — what the WebGL budget admits from. */
  setMruOrder(ids: readonly TerminalId[]): void;
  /** The terminals carrying an unread mark. */
  setUnread(ids: readonly TerminalId[]): void;
  setActiveId(id: TerminalId | null): void;
  setActivityWindow(window: ActivityWindow): void;
  setShowSleeping(show: boolean): void;
  setDockOrder(order: DockOrder): void;
}

/** Build the scope. Call inside a `createRoot`: the wire's subscriptions are
 *  owned by whoever builds them, exactly as the per-host owner owns them. */
export function fleetScope(): FleetScope {
  const wire = createHostWire(LOCAL_HOST);
  const [mruOrder, setMruOrder] = createSignal<readonly TerminalId[]>([]);
  // The unread ledger is a keyed PROJECTION in production
  // (`savedAttention.ts`), so a row's `isUnread` is that row's own store leaf —
  // the third source a per-row attention fold pays.
  const [unreadIds, setUnreadIds] = createSignal<readonly TerminalId[]>([]);
  const unread = createProjection<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const id of unreadIds()) next[id] = true;
    return next;
  });
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  const [activityWindow, setActivityWindow] =
    createSignal<ActivityWindow>("all");
  const [showSleeping, setShowSleeping] = createSignal(true);
  const [dockOrder, setDockOrder] = createSignal<DockOrder>([]);
  return {
    scope: {
      wire,
      view: {
        activeId,
        focusedTerminalId: () => null,
        isFocused: () => false,
        isActiveTile: (id: TerminalId) => activeId() === id,
        canvasMaximized: () => false,
        setCanvasMaximized: () => {},
        mruOrder,
        isUnread: (id: TerminalId) => unread[id] === true,
        seedCovers: () => false,
        noteSeededActivation: () => {},
        takeAutoSwitch: () => undefined,
        noteAutoSwitch: () => {},
        reset: () => {},
      },
      prefs: {
        activityWindow,
        setActivityWindow,
        showSleeping,
        setShowSleeping,
        dockOrder,
        setDockOrder,
      },
    },
    setMruOrder: (ids) => setMruOrder([...ids]),
    setUnread: (ids) => setUnreadIds([...ids]),
    setActiveId,
    setActivityWindow,
    setShowSleeping,
    setDockOrder: (order) => setDockOrder(order),
  };
}
