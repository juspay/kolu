/** THE FIND BAR ACROSS A TILE SWITCH, THROUGH THE REAL BINDING.
 *
 *  `TerminalContent.tsx:266` draws the bar from ONE computation —
 *  `props.focused && search.isOpen(props.terminalId)` — and `focused` is the
 *  canvas's `tileStore.isActiveTile(id)` (`App.tsx:317`), a key selector over
 *  the very `activeId` the find bar's reset was keyed to. So the binding of
 *  the tile a switch lands on folds BOTH legs, and a reset written from an
 *  effect's apply arm reaches it one pass behind the switch that caused it.
 *
 *  Both gestures the product has are driven here, three rounds each (a relay
 *  warns at the third sighting), and every round asserts WHICH TILE'S BAR IS
 *  DRAWN as well as an empty diagnostics drain:
 *
 *   - the tile chrome's find button on a tile that is NOT the active one —
 *     `TileTitleActions.tsx:272` selects the tile and then asks for the bar,
 *     both in one turn, so the switch and the open land in the same flush;
 *   - Cmd+F on the active tile, then switching away, then back — the contract
 *     the module's header states: a switch closes the bar, and returning does
 *     not resurrect it. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  OBSERVE,
} from "solid-js";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  activeId: (): TerminalId | null => null,
  setActiveId: (_id: TerminalId | null) => {},
}));

// The terminal store is mocked down to the one fact this root reads: a
// dynamic import is the only way a hoisted `vi.mock` factory can reach Solid.
vi.mock("./useTerminalStore", async () => {
  const { createSignal } = await import("solid-js");
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  bag.activeId = activeId;
  bag.setActiveId = (id: TerminalId | null) => {
    setActiveId(id);
  };
  return { useTerminalStore: () => ({ activeId }) };
});

import { createKeySelector } from "../createKeySelector";
import { useTerminalSearch } from "./useTerminalSearch";

const TILES = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as TerminalId[];

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** HOW MANY TIMES EACH NAMED BINDING HAS RUN — the engine's own `rerun`
 *  record. Subscribed at module load, so no run is missed. */
const runs = new Map<string, number>();
if (OBSERVE === undefined)
  throw new Error("this file needs Solid's development build");
OBSERVE.records.subscribe("rerun", (event) => {
  runs.set(event.nodeName, (runs.get(event.nodeName) ?? 0) + 1);
});
/** The runs every tile's find-bar binding has had between them. */
const barBindingRuns = (): number =>
  TILES.reduce(
    (sum, id) => sum + (runs.get(`TerminalContent.searchOpen.${id}`) ?? 0),
    0,
  );

/** THE VICTIM, as the canvas mounts it: every tile's find-bar binding, folded
 *  from the active-tile selector and the search root in one computation, each
 *  one standing (a binding nobody reads can never be torn). Answers which
 *  tile's bar is on screen. */
function mountedCanvas(): Accessor<TerminalId[]> {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const search = useTerminalSearch();
    const isActiveTile = createKeySelector(bag.activeId);
    const bars = TILES.map((id) =>
      createMemo(() => isActiveTile(id) && search.isOpen(id), {
        name: `TerminalContent.searchOpen.${id}`,
      }),
    );
    for (const bar of bars) createEffect(bar, () => {}, { name: "SearchBar" });
    return () => TILES.filter((_, i) => bars[i]?.() === true);
  });
}

it("opens the bar the find button of a non-active tile asks for, three rounds", () => {
  const shown = mountedCanvas();
  const search = useTerminalSearch();
  // The root is an app-lifetime singleton, so each case states its own start.
  bag.setActiveId(TILES[0] as TerminalId);
  search.reset();
  flush();
  // The boot switch is not this case's subject.
  diagnostics();
  expect(shown()).toEqual([]);

  for (let round = 0; round < 3; round++) {
    const target = TILES[(round + 1) % TILES.length] as TerminalId;
    // `TileTitleActions`' select-first `onTile`: the tile becomes active and
    // the bar is asked for in ONE turn.
    bag.setActiveId(target);
    search.openFor(target);
    flush();

    // SHOWN STATE: the tile whose find button was pressed has the bar, and it
    // is the only one — the switch in the same turn must not eat the ask.
    expect(shown()).toEqual([target]);
    expect(diagnostics()).toEqual([]);
  }
});

it("closes the bar on a switch and does not bring it back, three rounds", () => {
  const shown = mountedCanvas();
  const search = useTerminalSearch();
  bag.setActiveId(TILES[0] as TerminalId);
  search.reset();
  flush();
  diagnostics();

  for (let round = 0; round < 3; round++) {
    const here = TILES[round % TILES.length] as TerminalId;
    const away = TILES[(round + 1) % TILES.length] as TerminalId;
    bag.setActiveId(here);
    flush();
    expect(shown()).toEqual([]);

    // Cmd+F on the active tile.
    search.toggleActive();
    flush();
    expect(shown()).toEqual([here]);

    // Switch away: the bar is a per-session affordance on the focused
    // terminal, so it goes.
    bag.setActiveId(away);
    flush();
    expect(shown()).toEqual([]);

    // And back: it does NOT resurrect.
    bag.setActiveId(here);
    flush();
    expect(shown()).toEqual([]);

    // Cmd+F here opens it again, and a second Cmd+F shuts it.
    search.toggleActive();
    flush();
    expect(shown()).toEqual([here]);
    search.toggleActive();
    flush();
    expect(shown()).toEqual([]);

    expect(diagnostics()).toEqual([]);
  }
});

it("shuts the bar the SearchBar closes, and the one whose terminal goes", () => {
  const shown = mountedCanvas();
  const search = useTerminalSearch();
  bag.setActiveId(TILES[0] as TerminalId);
  search.reset();
  flush();
  diagnostics();

  for (let round = 0; round < 3; round++) {
    const here = TILES[round % TILES.length] as TerminalId;
    bag.setActiveId(here);
    flush();

    // The find button on the tile that is ALREADY active — no switch in the
    // turn, so nothing else is in play.
    search.openFor(here);
    flush();
    expect(shown()).toEqual([here]);

    // The bar's own close (`Terminal`'s `onSearchOpenChange(false)`).
    search.setOpen(here, false);
    flush();
    expect(shown()).toEqual([]);

    // The terminal that owns the bar is removed (`removeAndAutoSwitch`).
    search.openFor(here);
    flush();
    expect(shown()).toEqual([here]);
    search.removeTerminal(here);
    flush();
    expect(shown()).toEqual([]);

    // Kill-all's wholesale reset.
    search.openFor(here);
    flush();
    expect(shown()).toEqual([here]);
    search.reset();
    flush();
    expect(shown()).toEqual([]);

    expect(diagnostics()).toEqual([]);
  }
});

/** THE FIND BUTTON PRESSED TWICE ON ONE TILE. The bar is a composite — the
 *  terminal it is open for and the one it was asked under — and its opener
 *  minted a state object per ask, so a second ask on the tile that already
 *  has the bar woke every tile's binding with the bar they already saw.
 *  Master held the open-state in a plain record and dropped such a write;
 *  the composite compares by value and does the same (review 64 §6). */
it("wakes no binding when the find button asks for the bar already open", () => {
  const shown = mountedCanvas();
  const search = useTerminalSearch();
  const here = TILES[0] as TerminalId;
  bag.setActiveId(here);
  search.reset();
  search.openFor(here);
  flush();
  expect(shown()).toEqual([here]);
  diagnostics();

  const before = barBindingRuns();
  // The same tile's find button again — `TileTitleActions`' `onTile` selects
  // the tile it is already on and asks for the bar it already has.
  bag.setActiveId(here);
  search.openFor(here);
  flush();

  expect(barBindingRuns() - before, "the tiles' find-bar bindings").toBe(0);
  expect(shown(), "the same tile still has the bar").toEqual([here]);
  expect(diagnostics(), "the equal ask").toEqual([]);
});
