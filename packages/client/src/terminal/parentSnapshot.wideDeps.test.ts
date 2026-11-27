/** THE PARENT SNAPSHOT AT A FLEET'S SIZE — 250 terminals on one host.
 *
 *  Both consumers (the departure reconcile, the arrival adopt) hold this one
 *  memo, and it used to read the parent edge of every listed terminal itself:
 *  two store nodes per id, so Solid's development build judges it
 *  `WIDE_SCOPE_DEPS` at about 100 panes. The edges are folded per id now and
 *  the memo reads the joined list.
 *
 *  Judged on the diagnostics taken whole AND on both consumers' maps, which
 *  are built here from the fixture's own plan — including the two shapes that
 *  differ (a nullable all-ids map, a sub-only one). */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, createStore, flush } from "solid-js";
import { expect, it } from "vitest";
import { createHostScopedParentSnapshot } from "./parentSnapshot";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** 50 tiles, four panes each — two direct splits and a split of each, so the
 *  sub-only map is two thirds of the census and the chain is two deep. */
const TILES = 50;
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;

type Row = { parentId?: TerminalId };

interface Harness {
  readonly all: () => { host: string; map: Map<TerminalId, TerminalId | null> };
  readonly subs: () => { host: string; map: Map<TerminalId, TerminalId> };
  readonly reparent: (id: TerminalId, parentId: TerminalId) => void;
  readonly dropLast: () => void;
  readonly dispose: () => void;
}

const drive = (): Harness => {
  const ids: TerminalId[] = [];
  const rows: Record<string, Row> = {};
  for (let at = 0; at < TILES; at++) {
    const tile = tileAt(at);
    ids.push(tile);
    rows[tile] = {};
    const parents: TerminalId[] = [tile, paneAt(at, 0), tile, paneAt(at, 2)];
    for (let pane = 0; pane < 4; pane++) {
      const id = paneAt(at, pane);
      ids.push(id);
      rows[id] = { parentId: parents[pane] };
    }
  }
  const [list, setList] = createSignal<TerminalId[]>(ids);
  const [state, setState] = createStore<{ rows: Record<string, Row> }>({
    rows,
  });
  // The live parent edge, read exactly as `useTerminalMetadata.parentEdge`
  // hands it over: `undefined` for an id whose record is gone.
  const parentOf = (id: TerminalId): TerminalId | null | undefined => {
    const row = state.rows[id];
    return row === undefined ? undefined : (row.parentId ?? null);
  };
  return createRoot((dispose) => {
    const all = createHostScopedParentSnapshot<TerminalId | null>(
      "reconcileSnapshot",
      list,
      () => "local",
      parentOf,
      (edges) => {
        const m = new Map<TerminalId, TerminalId | null>();
        for (const { id, parent } of edges) m.set(id, parent ?? null);
        return m;
      },
    );
    const subs = createHostScopedParentSnapshot<TerminalId>(
      "adoptSnapshot",
      list,
      () => "local",
      parentOf,
      (edges) => {
        const m = new Map<TerminalId, TerminalId>();
        for (const { id, parent } of edges)
          if (parent != null) m.set(id, parent);
        return m;
      },
    );
    return {
      all,
      subs,
      reparent: (id, parentId) =>
        setState((s) => {
          const row = s.rows[id];
          if (row !== undefined) row.parentId = parentId;
        }),
      dropLast: () => {
        const gone = list()[list().length - 1];
        if (gone === undefined) return;
        setList((held) => held.slice(0, -1));
        setState((s) => {
          delete s.rows[gone];
        });
      },
      dispose,
    };
  });
};

/** The two maps the consumers want, in key order, from the fixture's plan. */
const plan = (): {
  all: [TerminalId, TerminalId | null][];
  subs: [TerminalId, TerminalId][];
} => {
  const all: [TerminalId, TerminalId | null][] = [];
  const subs: [TerminalId, TerminalId][] = [];
  for (let at = 0; at < TILES; at++) {
    all.push([tileAt(at), null]);
    const parents: TerminalId[] = [
      tileAt(at),
      paneAt(at, 0),
      tileAt(at),
      paneAt(at, 2),
    ];
    for (let pane = 0; pane < 4; pane++) {
      const parent = parents[pane] as TerminalId;
      all.push([paneAt(at, pane), parent]);
      subs.push([paneAt(at, pane), parent]);
    }
  }
  return { all, subs };
};

it("snapshots 250 parent edges for both consumers with no wide scope", () => {
  takeSolidDiagnostics();
  const h = drive();
  flush();
  const expected = plan();
  expect(h.all().host).toBe("local");
  expect([...h.all().map]).toEqual(expected.all);
  expect([...h.subs().map]).toEqual(expected.subs);

  // A reparent moves ONE edge in both maps and nothing else.
  const held = h.all();
  h.reparent(paneAt(4, 3), paneAt(4, 0));
  flush();
  expect(h.all()).not.toBe(held);
  expect(h.all().map.get(paneAt(4, 3))).toBe(paneAt(4, 0));
  expect(h.subs().map.get(paneAt(4, 3))).toBe(paneAt(4, 0));
  expect(h.all().map.size).toBe(250);

  // The last pane leaves: it is in neither map, and the rest stand.
  h.dropLast();
  flush();
  expect(h.all().map.size).toBe(249);
  expect(h.all().map.has(paneAt(TILES - 1, 3))).toBe(false);
  expect(h.subs().map.has(paneAt(TILES - 1, 3))).toBe(false);
  expect(h.subs().map.size).toBe(199);
  expect(diagnostics()).toEqual([]);
  h.dispose();
});
