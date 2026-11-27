// @vitest-environment happy-dom

/** THE DOCK AT A FLEET'S SIZE — 250 terminals on one host, in 45 tiles, one of
 *  them holding 29 panes of its own.
 *
 *  The dock is the one always-mounted surface that reads EVERY terminal on the
 *  host, and it reads several facts about each: the metadata slot and its
 *  projected record, the staleness clock, the attention class, the pane tree,
 *  and the display row the sections are grouped by. Folded on one scope that is
 *  five to seven sources per tile, which Solid's development build judges
 *  `WIDE_SCOPE_DEPS` past 200 — about 29 tiles. The SECOND width is inside one
 *  tile: a row that built its whole `subRows` sequence paid those sources per
 *  PANE, so a tile with ~28 panes was wide on its own row. Hence the fleet's
 *  shape here: enough tiles for the first, and one tile deep enough for the
 *  second.
 *
 *  THE METADATA IS THE REAL STORE. Records arrive through the real
 *  `createReactiveSubscription` key stream and the real per-key `useCollection`
 *  view (`hostScope/hostWireMirror.testlib.ts`), read through the real
 *  `useTerminalMetadata` projection, and the attention class comes off the real
 *  `urgency` cell subscription through `useAttentionFacts`. A mock handing back
 *  plain arrays and plain records under-measures that graph about threefold.
 *
 *  What is pinned is the dock's published value: which sections exist, which
 *  rows sit in them and in which order, each tile's indented pane sequence, and
 *  the pinned needs-you strip — before and after one agent starts waiting on
 *  you. */

import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
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

vi.mock("../../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  encActiveHost: () => "local",
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
  activePadiRpc: { chrome: { setSubPanel: async () => {} } },
}));
vi.mock("../../hostScope/hostScopes", () => ({
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

import { fleetScope } from "../../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../../hostScope/hostWireMirror.testlib";
import { useDockOrder } from "./useDockOrder";

/** 42 tiles. Tile 0 is the DEEP one — 44 panes, twenty-two hanging off the
 *  tile and twenty-two hanging off those — and the other 41 carry four panes
 *  each in the ordinary two-by-two shape (two splits, each with a split of its
 *  own). 45 + 41 × 5 = 250 terminals. Tile 0 is deep enough that its row ALONE
 *  is wide when a row builds its own `subRows`: 44 panes at the six or seven
 *  sources a pane costs is past the 200-source judge on that one row. */
const DEEP_PANES = 44;
const DEEP_TOPS = 22;
const PLAIN_TILES = 41;
const PLAIN_PANES = 4;

const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;

/** Three repo sections, by tile. The cwd IS the group (its basename), so tiles
 *  sharing one are one section with one branch cluster. */
const cwdOfTile = (at: number): string => `/w/g${at % 3}`;

/** Each pane's parent, by tile and pane index. */
const parentOfPane = (at: number, pane: number): TerminalId =>
  at === 0
    ? pane < DEEP_TOPS
      ? tileAt(0)
      : paneAt(0, pane - DEEP_TOPS)
    : pane === 1
      ? paneAt(at, 0)
      : pane === 3
        ? paneAt(at, 2)
        : tileAt(at);

const panesOfTile = (at: number): number =>
  at === 0 ? DEEP_PANES : PLAIN_PANES;

/** The server's order: each tile, then its own panes. */
const ids: TerminalId[] = [];
for (let at = 0; at <= PLAIN_TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < panesOfTile(at); pane++) ids.push(paneAt(at, pane));
}

/** A composed record as this fleet serves one. Every terminal is a live shell
 *  with a clock, so the activity window keeps them all and nothing is parked. */
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

const emptyUrgency: PadiUrgency = {
  awaitingIds: [],
  workingIds: [],
  lingerIds: [],
  finishedIds: [],
  settled: true,
} as unknown as PadiUrgency;

/** The pane the agent starts waiting in — a depth-2 pane of the deep tile, so
 *  the strip's entry has to carry the tile AND the blocked row apart. */
const BLOCKED = paneAt(0, DEEP_TOPS + 3);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The deep tile's panes in the order the dock indents them: each pane
 *  immediately followed by its own, depth-first. */
const deepSequence: { id: TerminalId; depth: number }[] = [];
for (let pane = 0; pane < DEEP_TOPS; pane++) {
  deepSequence.push({ id: paneAt(0, pane), depth: 1 });
  const child = pane + DEEP_TOPS;
  if (child < DEEP_PANES) deepSequence.push({ id: paneAt(0, child), depth: 2 });
}

it("orders 42 tiles and 208 panes with no wide scope", async () => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  const tree = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = fleetScope().scope;
    return useDockOrder();
  });

  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) {
    const at = Number(/^t(\d+)/.exec(id)?.[1] ?? 0);
    const pane = /p(\d+)$/.exec(id);
    mirror.pushRecord(
      id,
      recordOf(
        cwdOfTile(at),
        pane === null ? null : parentOfPane(at, Number(pane[1])),
        n,
      ),
    );
  }
  mirror.pushUrgency(emptyUrgency);
  mirror.pushActivity([]);
  await settle();
  flush();

  // THREE SECTIONS, in first-appearance order, holding every tile whose cwd
  // names them — one branch cluster each, since the cwd is also the label.
  expect(tree().groups.map((g) => g.name)).toEqual(["g0", "g1", "g2"]);
  expect(tree().groups.map((g) => g.clusters.length)).toEqual([1, 1, 1]);
  expect(tree().flatShortcutRows.map((r) => r.id)).toEqual(
    [
      ...Array.from({ length: PLAIN_TILES + 1 }, (_, at) => at).filter(
        (at) => at % 3 === 0,
      ),
      ...Array.from({ length: PLAIN_TILES + 1 }, (_, at) => at).filter(
        (at) => at % 3 === 1,
      ),
      ...Array.from({ length: PLAIN_TILES + 1 }, (_, at) => at).filter(
        (at) => at % 3 === 2,
      ),
    ].map(tileAt),
  );

  // The deep tile's whole family, indented by its true parent edge.
  const deep = tree().groups[0]?.topRows[0];
  expect(deep?.id).toBe(tileAt(0));
  expect(deep?.subRows.map((s) => ({ id: s.id, depth: s.depth }))).toEqual(
    deepSequence,
  );
  // An ordinary tile: two splits, each followed by its own.
  const plain = tree().groups[1]?.topRows[0];
  expect(plain?.id).toBe(tileAt(1));
  expect(
    plain?.subRows.map((s) => ({
      id: s.id,
      parentId: s.parentId,
      depth: s.depth,
    })),
  ).toEqual([
    { id: paneAt(1, 0), parentId: tileAt(1), depth: 1 },
    { id: paneAt(1, 1), parentId: paneAt(1, 0), depth: 2 },
    { id: paneAt(1, 2), parentId: tileAt(1), depth: 1 },
    { id: paneAt(1, 3), parentId: paneAt(1, 2), depth: 2 },
  ]);

  expect(tree().needsYou).toEqual([]);
  expect(tree().parkedCount).toBe(0);
  expect(tree().sleepingCount).toBe(0);
  expect(tree().hasContent).toBe(true);
  expect(diagnostics()).toEqual([]);

  // ONE AGENT STARTS WAITING ON YOU, in a depth-2 pane of the deep tile. Its
  // row's class moves, the pinned strip gains exactly that pane — carried with
  // the tile that holds its display identity — and nothing else moves.
  mirror.pushUrgency({
    ...emptyUrgency,
    awaitingIds: [BLOCKED],
  } as unknown as PadiUrgency);
  await settle();
  flush();

  expect(
    tree().needsYou.map((e) => ({
      tile: e.tile.id,
      blocked: e.blocked.id,
      hidden: e.hiddenByFilter,
    })),
  ).toEqual([{ tile: tileAt(0), blocked: BLOCKED, hidden: false }]);
  const blockedRow = tree().groups[0]?.topRows[0]?.subRows.find(
    (s) => s.id === BLOCKED,
  );
  expect(blockedRow?.asking).toBe(true);
  expect(blockedRow?.pip).toBe("awaiting");
  expect(tree().groups.map((g) => g.name)).toEqual(["g0", "g1", "g2"]);
  expect(tree().groups[0]?.topRows[0]?.subRows.map((s) => s.id)).toEqual(
    deepSequence.map((s) => s.id),
  );
  expect(diagnostics()).toEqual([]);
});
