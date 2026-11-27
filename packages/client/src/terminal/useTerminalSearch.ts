/** The find bar, and the one terminal it belongs to — a singleton via
 *  `createSharedRoot` (the same primitive the other domain singletons use, so
 *  the verb object is built once and the `useTerminalStore` dependency is
 *  captured in the shared root rather than re-read per call). The xterm search
 *  overlay is scoped to one terminal at a time, and only the focused tile's
 *  bar is ever drawn (`TerminalContent.tsx` gates `searchOpen` on
 *  `props.focused`), so the whole state is WHICH terminal the bar was last
 *  asked for, and under which active terminal.
 *
 *  Behavior contract (preserved from the pre-refactor App, where a single
 *  `searchOpen` signal was reset on every active-terminal change): the find
 *  bar closes when the active terminal changes — switching away and back does
 *  NOT resurrect a previously-open bar. The bar is a per-session affordance on
 *  the focused terminal, not a sticky per-terminal preference. Sub-terminals
 *  never open search (their leaf always passes `searchOpen={false}`).
 *
 *  DERIVED, NOT RESET. That contract used to be an effect keyed on
 *  `store.activeId()` whose apply arm cleared a per-terminal open-state
 *  record. Two things were wrong with a reset written from an effect:
 *
 *   - the tile a switch lands ON reads both legs in ONE computation —
 *     `props.focused && search.isOpen(id)`, where `focused` is the active-tile
 *     selector (`App.tsx`) — so the clear reached that binding a pass behind
 *     the switch that caused it, which is `EFFECT_RELAY_TEAR`'s shape;
 *   - and the clear ran after every write made in the same turn as the switch.
 *     The tile chrome's find button makes exactly that turn: `TileTitleActions`'
 *     select-first `onTile` selects the tile and then asks for its bar. The
 *     reset ate the ask and the button did nothing at all.
 *
 *  So the switch edge is part of the VALUE: the bar carries the terminal it
 *  was asked under, and {@link inScope} retires it as soon as the active
 *  terminal is someone else. Readers get the retirement in the same flush as
 *  the switch, and no effect writes anything.
 *
 *  AN ASK IS MADE UNDER THE TERMINAL IT NAMES. A write is not visible to a
 *  read in the same turn (a signal publishes at the flush), so `openFor` can
 *  not ask "who is active now?" and get the tile its caller just selected —
 *  it stamps the terminal it is opening on instead. That is the same fact:
 *  every opener makes its terminal the active one in the same turn (the find
 *  button's select-first `onTile`; `Cmd+F` is the active terminal by
 *  definition). An open for a terminal that does NOT become active is retired
 *  by the derivation on sight; the old record kept such an ask until the next
 *  switch instead, and neither one was ever DRAWN, because only the focused
 *  tile draws a bar. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useTerminalStore } from "./useTerminalStore";

/** The find bar: the terminal it is open for (`null` — no bar), and the active
 *  terminal it was asked under, which is what a later switch retires it
 *  against. */
type Bar = {
  readonly id: TerminalId | null;
  readonly scope: TerminalId | null;
};

const SHUT: Bar = { id: null, scope: null };

/** THE SWITCH EDGE: a bar asked under another active terminal is gone, and the
 *  new scope is recorded, so coming back to the old one does not bring it
 *  back. */
function inScope(bar: Bar, active: TerminalId | null): Bar {
  return bar.scope === active ? bar : { id: null, scope: active };
}

export const useTerminalSearch = createSharedRoot(() => {
  const store = useTerminalStore();

  // A writable memo keyed on the active terminal — the idiom `CommandPalette`'s
  // `onOpenEdge` uses for the resets it owes its own open edge. The derivation
  // sees only `prev`, so an ask written since the last switch rides through
  // untouched, and the switch that retires it does so in its own flush.
  const [bar, setBar] = createSignal<Bar>(
    (prev = SHUT): Bar => inScope(prev, store.activeId()),
    { name: "terminalSearchBar" },
  );

  /** Shut the bar when the terminal it belongs to is the one `when` names. */
  const shut = (when: (openFor: TerminalId) => boolean): void => {
    setBar((prev) =>
      prev.id !== null && when(prev.id)
        ? { id: null, scope: prev.scope }
        : prev,
    );
  };

  /** Open the bar for `id`, under `id`. A plain record — what this state was
   *  before it became a composite — drops a write of what it already holds,
   *  and so does this: a second ask on the tile that already has the bar
   *  (the find button pressed twice) writes nothing, so no tile's binding
   *  wakes for the bar it is already drawing (review 64 §6). */
  const show = (id: TerminalId): void => {
    setBar((prev) =>
      prev.id === id && prev.scope === id ? prev : { id, scope: id },
    );
  };

  return {
    /** Is the find bar open for terminal `id`? */
    isOpen(id: TerminalId): boolean {
      return bar().id === id;
    },
    /** Open or close the find bar for terminal `id`. Closing a bar that is not
     *  this terminal's leaves the open one alone. */
    setOpen(id: TerminalId, open: boolean) {
      if (open) show(id);
      else shut((openFor) => openFor === id);
    },
    /** Open the find bar for terminal `id` — the "find in THIS terminal" intent
     *  named once, so the tile's find button doesn't hand-roll `setOpen(id,
     *  true)`. The search singleton owns find-bar state; tile selection stays
     *  with the caller (TileTitleActions' `onTile`). */
    openFor(id: TerminalId) {
      show(id);
    },
    /** Toggle the find bar for the active terminal — the `Cmd+F` action. */
    toggleActive() {
      const id = store.activeId();
      if (id === null) return;
      setBar((prev) =>
        prev.id === id ? { id: null, scope: prev.scope } : { id, scope: id },
      );
    },
    /** Drop a terminal's find-bar state when it's removed. */
    removeTerminal(id: TerminalId) {
      shut((openFor) => openFor === id);
    },
    /** Shut the find bar whoever it belonged to — called by `handleCloseAll`
     *  after `killAll`, which resets the store wholesale instead of routing
     *  each terminal through `removeAndAutoSwitch`, so the per-terminal
     *  eviction never runs. */
    reset() {
      shut(() => true);
    },
  } as const;
});
