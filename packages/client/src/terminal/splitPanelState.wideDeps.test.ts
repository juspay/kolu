// @vitest-environment happy-dom

/** THE SETTLE RULE AT A FLEET'S SIZE — 250 tiles, every one carrying a saved
 *  split.
 *
 *  The rule is a writable derivation, so it must SUBSCRIBE to the leaves it
 *  compares — otherwise an entry armed after its last run would watch nothing
 *  and never settle. Subscribing by reading every live record's two leaves on
 *  the rule's own scope costs two nodes per tile, which Solid's development
 *  build judges `WIDE_SCOPE_DEPS` past 200 sources — about 33 tiles. The
 *  leaves are folded per id now and the rule reads the joined list.
 *
 *  Judged on the diagnostics taken whole AND on what the rule answers: a
 *  gesture still shows at once, a foreign write to ANOTHER tile does not end
 *  it, and the record landing on our value does. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { writeWrappedValue } from "@kolu/surface/solid";
import { Deferred } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, createRoot, createStore, flush } from "solid-js";
import { expect, it, vi } from "vitest";

type Saved = { collapsed: boolean; panelSize: number };

const TILES = 250;
const tileAt = (at: number) => `wide-tile-${at}` as TerminalId;

const h = vi.hoisted(() => ({
  setSubPanel: vi.fn(),
  toastError: vi.fn(),
}));
h.setSubPanel.mockImplementation(() => Deferred.await(Deferred.makeUnsafe()));

/** THE MIRROR, SHAPED AS THE FRAMEWORK SHAPES IT. A per-key collection holds
 *  each value in `createStore<{ v }>` and serves `() => store.v`, and its
 *  `keys()` is a store-proxy array too — so one record read costs the per-key
 *  lookup plus `store.v`, and a loop over the keys pays an index leaf per id.
 *  Counting anything less would under-measure the graph this test judges. */
const records = createRoot(() => {
  const ids = Array.from({ length: TILES }, (_, at) => tileAt(at));
  const [keyStore] = createStore<{ v: TerminalId[] }>({ v: ids });
  const bag = new Map<
    TerminalId,
    {
      /** The per-key lookup the collection memoizes, then `store.v`. */
      read: () => () => { subPanel?: Saved } | undefined;
      setValue: (next: { subPanel?: Saved } | undefined) => void;
    }
  >();
  for (const [at, id] of ids.entries()) {
    const [store, setStore] = createStore<{
      v: { subPanel?: Saved } | undefined;
    }>({ v: { subPanel: { collapsed: false, panelSize: 0.3 + at / 1000 } } });
    const value = () => store.v;
    const lookup = createMemo(() => value);
    bag.set(id, {
      read: lookup,
      setValue: (next) => writeWrappedValue(setStore, next),
    });
  }
  return { keys: () => keyStore.v, bag };
});

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: {
      terminals: {
        byKey: (id: TerminalId) => records.bag.get(id)?.read(),
      },
      terminalKeys: records.keys,
    },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

import { useSplitPanelState } from "./splitPanelState";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

const savedAt = (at: number): Saved => ({
  collapsed: false,
  panelSize: 0.3 + at / 1000,
});

it("watches 250 tiles' saved splits with no wide scope", () => {
  takeSolidDiagnostics();
  const split = useSplitPanelState();
  // Every tile reads its own record through the rule.
  for (let at = 0; at < TILES; at++)
    expect(split.state(tileAt(at))).toEqual(savedAt(at));

  // A gesture on one tile shows at once and leaves the others alone.
  const gesture = { collapsed: true, panelSize: 0.3 };
  split.write(tileAt(9), gesture);
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(split.state(tileAt(10))).toEqual(savedAt(10));

  // A foreign write to ANOTHER tile wakes the rule and settles nothing: our
  // entry is still owed a write, and its own record has not moved.
  records.bag
    .get(tileAt(200))
    ?.setValue({ subPanel: { collapsed: true, panelSize: 0.9 } });
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(split.state(tileAt(200))).toEqual({
    collapsed: true,
    panelSize: 0.9,
  });

  // The record lands on our value: the entry ends and the record speaks.
  records.bag.get(tileAt(9))?.setValue({ subPanel: { ...gesture } });
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  split.forget(tileAt(9));
  flush();
  expect(split.state(tileAt(9))).toEqual(gesture);
  expect(diagnostics()).toEqual([]);
});
