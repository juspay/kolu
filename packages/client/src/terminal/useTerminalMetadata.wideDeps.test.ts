// @vitest-environment happy-dom

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
 *  THE RECORDS ARE THE REAL STORE. The keys arrive on the real
 *  `createReactiveSubscription` stream and each record through the real
 *  per-key `useCollection` view (`hostScope/hostWireMirror.testlib.ts`),
 *  reached the way production reaches them: `createHostWire` over that mirror
 *  (`hostScope/fleetScope.testlib.ts`), read through `terminalListSub` — the
 *  same facade `useTerminalStore` hands this hook. A fixture of plain arrays
 *  and plain records under-measures that graph about threefold, so it could
 *  only ever judge an imitation of the scope the browser builds.
 *
 *  Each test here judges BOTH halves: the diagnostics Solid raised (taken
 *  whole, `info` included) and the published value, computed from the
 *  fleet's own plan rather than from the fold under test. Then the realistic
 *  changes — a tile's cwd moving, a pane leaving the key list — and both
 *  again, so a narrower graph that stops answering is no fix. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { identityColor } from "@kolu/solid-dockrow/rowValues";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  entry: (() => undefined) as () => unknown,
  scope: undefined as unknown,
}));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  encActiveHost: () => "local",
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
  activePadiRpc: { chrome: { setSubPanel: async () => {} } },
}));
vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => held.scope,
  hostScopeOf: () => held.scope,
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import { terminalListSub } from "../hostScope/activeWire";
import { fleetScope } from "../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
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

/** p0 and p2 hang off the tile; p1 hangs off p0 and p3 off p2. */
const parentOfPane = (at: number, pane: number): TerminalId =>
  pane === 1 ? paneAt(at, 0) : pane === 3 ? paneAt(at, 2) : tileAt(at);

/** The server's order: each tile, then its own panes. */
const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < 4; pane++) ids.push(paneAt(at, pane));
}

/** A composed record as this fleet serves one — a live shell with a clock, so
 *  nothing is parked and nothing is awaited once it has landed. */
const recordOf = (
  cwd: string,
  parentId: TerminalId | null,
  lastActivityAt: number,
): PadiTerminal =>
  ({
    state: "active",
    parentId,
    lastActivityAt,
    cwd,
    git: { kind: "none" },
  }) as unknown as PadiTerminal;

/** This id's place in the fleet, so a record can be re-pushed by id alone. */
const placeOf = (id: TerminalId): { at: number; pane: number | null } => {
  const at = Number(/^t(\d+)/.exec(id)?.[1] ?? 0);
  const pane = /p(\d+)$/.exec(id);
  return { at, pane: pane === null ? null : Number(pane[1]) };
};

const recordFor = (id: TerminalId, n: number, cwd?: string): PadiTerminal => {
  const { at, pane } = placeOf(id);
  return recordOf(
    cwd ?? (pane === null ? cwdOfTile(at) : `/w/p${at}/pane${pane}`),
    pane === null ? null : parentOfPane(at, pane),
    n,
  );
};

interface Harness {
  readonly hook: ReturnType<typeof useTerminalMetadata>;
  /** One record lands again with a new cwd — a frame on a live key. */
  readonly setCwd: (id: TerminalId, cwd: string) => void;
  /** The last id leaves the host's key list — the whole of a departure. */
  readonly dropLast: () => void;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The fleet, landed: the real keys stream, the real per-key collection, and
 *  the hook reading them through the facade production hands it. */
const drive = async (): Promise<Harness> => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  const hook = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = fleetScope().scope;
    return useTerminalMetadata({ list: terminalListSub });
  });
  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordFor(id, n));
  await settle();
  flush();
  return {
    hook,
    setCwd: (id, cwd) =>
      mirror.pushRecord(id, recordFor(id, ids.indexOf(id), cwd)),
    dropLast: () => mirror.pushKeys(ids.slice(0, -1)),
  };
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

it("counts the record phases of 250 terminals with no wide scope", async () => {
  const h = await drive();
  expect(h.hook.recordPhases()).toEqual({ awaited: 0, parked: 0, live: 250 });
  expect(diagnostics()).toEqual([]);

  // One pane leaves: the census is one shorter and nothing else moves.
  h.dropLast();
  await settle();
  flush();
  expect(h.hook.recordPhases()).toEqual({ awaited: 0, parked: 0, live: 249 });
  expect(diagnostics()).toEqual([]);
});

it("orders 50 tiles and indexes their 200 panes with no wide scope", async () => {
  const h = await drive();
  const tiles = Array.from({ length: TILES }, (_, at) => tileAt(at));
  expect(h.hook.terminalIds()).toEqual(tiles);
  for (let at = 0; at < TILES; at++) {
    expect(h.hook.getSplitPaneIds(tileAt(at))).toEqual(flatPanesOf(at));
    expect(h.hook.getPaneTree(tileAt(at))).toEqual(paneTreeAt(at));
  }
  expect(diagnostics()).toEqual([]);

  // A pane's own leaf moving changes neither index.
  const held3 = h.hook.getSplitPaneIds(tileAt(3));
  h.setCwd(paneAt(3, 1), "/w/p3/moved");
  await settle();
  flush();
  expect(h.hook.getSplitPaneIds(tileAt(3))).toBe(held3);
  expect(diagnostics()).toEqual([]);

  // The last tile's deepest pane leaves: its strip and its tree lose it.
  h.dropLast();
  await settle();
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
});

it("builds the display table for 50 tiles with no wide scope", async () => {
  const h = await drive();
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
  expect(diagnostics()).toEqual([]);

  // One tile moves to a fresh cwd — its own row re-keys, its neighbours stand.
  const neighbour = h.hook.getDisplayInfo(tileAt(1));
  h.setCwd(tileAt(0), "/w/elsewhere");
  await settle();
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
  expect(diagnostics()).toEqual([]);

  // A pane leaving drops its tile's split badge by one.
  h.dropLast();
  await settle();
  flush();
  expect(h.hook.getDisplayInfo(tileAt(TILES - 1))?.subCount).toBe(3);
  expect(diagnostics()).toEqual([]);
});
