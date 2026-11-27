/** THE METADATA WINDOW AT A FLEET'S SIZE — 50 tiles, four panes each, 250
 *  terminals on one host.
 *
 *  Every reading this hook publishes used to walk the whole census on ONE
 *  scope: the tri-state record phases, the top-level order, the two pane
 *  indexes and the display table each read two store nodes per terminal
 *  before any field. Solid's development build judges a scope subscribed to
 *  more than 200 sources (`WIDE_SCOPE_DEPS`), and a terminal read costs two
 *  before a single field, so these cross at ~30–100 panes — reachable in a
 *  heavy session.
 *
 *  Each test here judges BOTH halves: the diagnostics Solid raised (taken
 *  whole, `info` included) and the published value, computed from the
 *  fixture's own plan rather than from the fold under test. Then one
 *  realistic change — a pane's cwd moving, a pane leaving — and both again,
 *  so a narrower graph that stops answering is no fix. */

import type { TerminalInfo } from "@kolu/padi-client/surface";
import { identityColor } from "@kolu/solid-dockrow/rowValues";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { Stream } from "effect";
import { decodeHostKey, encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, createStore, flush } from "solid-js";
import { expect, it, vi } from "vitest";

/** A composed record as the per-key collection serves it — the store row
 *  `byKey` hands back whole, so a field read is that field's own node. */
type TestRecord = {
  state: "active";
  git: { kind: "none" };
  cwd: string;
  parentId?: TerminalId;
};

const bag = vi.hoisted(() => ({
  keys: (() => [] as TerminalId[]) as () => TerminalId[],
  recordOf: (() => undefined) as (id: TerminalId) => TestRecord | undefined,
}));

// The ONE per-key collection this hook reads, driven from the store below —
// the same mirror shape `useTerminalMetadata.test.ts` uses, so the hook runs
// its real graph over a real store rather than a stub of itself.
vi.mock("../wire", () => {
  const terminals = {
    use: () => ({
      keys: () => bag.keys(),
      byKey: (id: TerminalId) =>
        bag.recordOf(id) === undefined ? undefined : () => bag.recordOf(id),
    }),
    unenrolledKeys: () => Stream.never,
  };
  const stubCell = {
    use: () => ({
      value: () => undefined,
      sub: Object.assign(() => undefined, {
        pending: () => false,
        error: () => undefined,
        complete: () => false,
      }),
    }),
  };
  const stubCollection = {
    use: () => ({ keys: () => [], byKey: () => undefined }),
  };
  const entry = () => ({
    clock: { toLocal: (ms: number) => ms },
    collections: { terminals, daemonStatus: stubCollection },
    cells: { session: stubCell, roster: stubCell, activityFeed: stubCell },
    procedures: { chrome: { setActive: async () => {} } },
  });
  return {
    padiMap: {
      entries: {
        use: () => ({ keys: () => [LOCAL_HOST], byKey: () => undefined }),
      },
      codec: { encode: encodeHostKey, decode: decodeHostKey },
      live: () => true,
      entry,
      useEntry: entry,
    },
    activeHost: () => LOCAL_HOST,
    groundedActiveHost: () => LOCAL_HOST,
  };
});
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import type { PaneNode } from "./terminalTree";
import { useTerminalMetadata } from "./useTerminalMetadata";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** THE FLEET: 50 tiles, each with four panes — two direct splits and a split
 *  of each of those — so the flat strip and the indented tree are different
 *  shapes over the same 250 terminals. Server order is tile-then-its-panes,
 *  which is what every published order below is measured against. */
const TILES = 50;
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;

/** Two tiles share one cwd, so the collision suffix is exercised at size. */
const DUPLICATE = "/w/shared";
const cwdOfTile = (at: number): string =>
  at === 7 || at === 31 ? DUPLICATE : `/w/p${at}`;

interface Fleet {
  readonly ids: TerminalId[];
  readonly records: Record<string, TestRecord>;
}

const fleet = (): Fleet => {
  const ids: TerminalId[] = [];
  const records: Record<string, TestRecord> = {};
  const record = (cwd: string, parentId?: TerminalId): TestRecord => ({
    state: "active",
    git: { kind: "none" },
    cwd,
    parentId,
  });
  for (let at = 0; at < TILES; at++) {
    const tile = tileAt(at);
    ids.push(tile);
    records[tile] = record(cwdOfTile(at));
    // p0 and p2 hang off the tile; p1 hangs off p0 and p3 off p2.
    const parents: TerminalId[] = [tile, paneAt(at, 0), tile, paneAt(at, 2)];
    for (let pane = 0; pane < 4; pane++) {
      const id = paneAt(at, pane);
      ids.push(id);
      records[id] = record(`/w/p${at}/pane${pane}`, parents[pane]);
    }
  }
  return { ids, records };
};

interface Harness {
  readonly hook: ReturnType<typeof useTerminalMetadata>;
  readonly setCwd: (id: TerminalId, cwd: string) => void;
  readonly dropLast: () => void;
  readonly dispose: () => void;
}

/** The membership list is a PLAIN array behind a signal, as the terminal-keys
 *  stream publishes it; only the RECORDS are a store, which is where the
 *  collection's per-key leaves actually live. */
const drive = (): Harness => {
  const { ids, records } = fleet();
  const [keys, setKeys] = createSignal<TerminalId[]>(ids);
  const [state, setState] = createStore<{
    records: Record<string, TestRecord>;
  }>({ records });
  bag.keys = keys;
  bag.recordOf = (id) => state.records[id];
  return createRoot((dispose) => {
    const hook = useTerminalMetadata({
      list: () => keys().map((id) => ({ id }) as TerminalInfo),
    });
    return {
      hook,
      setCwd: (id, cwd) =>
        setState((s) => {
          const row = s.records[id];
          if (row !== undefined) row.cwd = cwd;
        }),
      dropLast: () => {
        const gone = keys()[keys().length - 1];
        if (gone === undefined) return;
        setKeys((held) => held.slice(0, -1));
        setState((s) => {
          delete s.records[gone];
        });
      },
      dispose,
    };
  });
};

/** The flat strip the canvas paints for one tile, in server order. */
const flatPanesOf = (at: number): TerminalId[] => [
  paneAt(at, 0),
  paneAt(at, 1),
  paneAt(at, 2),
  paneAt(at, 3),
];

/** The same panes, indented by their true parent edge. */
const paneTreeAt = (at: number): PaneNode[] => [
  { id: paneAt(at, 0), children: [{ id: paneAt(at, 1), children: [] }] },
  { id: paneAt(at, 2), children: [{ id: paneAt(at, 3), children: [] }] },
];

it("counts the record phases of 250 terminals with no wide scope", () => {
  takeSolidDiagnostics();
  const h = drive();
  flush();
  expect(h.hook.recordPhases()).toEqual({ awaited: 0, parked: 0, live: 250 });

  // One pane leaves: the census is one shorter and nothing else moves.
  h.dropLast();
  flush();
  expect(h.hook.recordPhases()).toEqual({ awaited: 0, parked: 0, live: 249 });
  expect(diagnostics()).toEqual([]);
  h.dispose();
});

it("orders 50 tiles and indexes their 200 panes with no wide scope", () => {
  takeSolidDiagnostics();
  const h = drive();
  flush();
  const tiles = Array.from({ length: TILES }, (_, at) => tileAt(at));
  expect(h.hook.terminalIds()).toEqual(tiles);
  for (let at = 0; at < TILES; at++) {
    expect(h.hook.getSplitPaneIds(tileAt(at))).toEqual(flatPanesOf(at));
    expect(h.hook.getPaneTree(tileAt(at))).toEqual(paneTreeAt(at));
  }
  // A pane's own leaf moving changes neither index.
  const held = h.hook.getSplitPaneIds(tileAt(3));
  h.setCwd(paneAt(3, 1), "/w/p3/moved");
  flush();
  expect(h.hook.getSplitPaneIds(tileAt(3))).toBe(held);

  // The last tile's deepest pane leaves: its strip and its tree lose it.
  h.dropLast();
  flush();
  const last = TILES - 1;
  expect(h.hook.terminalIds()).toEqual(tiles);
  expect(h.hook.getSplitPaneIds(tileAt(last))).toEqual(
    flatPanesOf(last).slice(0, 3),
  );
  expect(h.hook.getPaneTree(tileAt(last))).toEqual([
    { id: paneAt(last, 0), children: [{ id: paneAt(last, 1), children: [] }] },
    { id: paneAt(last, 2), children: [] },
  ]);
  expect(diagnostics()).toEqual([]);
  h.dispose();
});

it("builds the display table for 50 tiles with no wide scope", () => {
  takeSolidDiagnostics();
  const h = drive();
  flush();
  const expected = (at: number, subCount: number) => {
    const cwd = cwdOfTile(at);
    const { group, label } = terminalKey({ git: { kind: "none" }, cwd });
    return {
      repoColor: identityColor(group),
      annotationColor: identityColor(label),
      subCount,
      key: {
        group,
        label,
        suffix: cwd === DUPLICATE ? `#${tileAt(at).slice(0, 4)}` : undefined,
      },
    };
  };
  for (let at = 0; at < TILES; at++)
    expect(h.hook.getDisplayInfo(tileAt(at))).toEqual(expected(at, 4));
  // Only tiles are display rows; a pane has none.
  expect(h.hook.getDisplayInfo(paneAt(0, 0))).toBeUndefined();

  // One tile moves to a fresh cwd — its own row re-keys, its neighbours stand.
  const neighbour = h.hook.getDisplayInfo(tileAt(1));
  h.setCwd(tileAt(0), "/w/elsewhere");
  flush();
  const moved = h.hook.getDisplayInfo(tileAt(0));
  const { group, label } = terminalKey({
    git: { kind: "none" },
    cwd: "/w/elsewhere",
  });
  expect(moved).toEqual({
    repoColor: identityColor(group),
    annotationColor: identityColor(label),
    subCount: 4,
    key: { group, label, suffix: undefined },
  });
  expect(h.hook.getDisplayInfo(tileAt(1))).toBe(neighbour);

  // A pane leaving drops its tile's split badge by one.
  h.dropLast();
  flush();
  expect(h.hook.getDisplayInfo(tileAt(TILES - 1))?.subCount).toBe(3);
  expect(diagnostics()).toEqual([]);
  h.dispose();
});
