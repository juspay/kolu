// @vitest-environment happy-dom

/** THE PARENT SNAPSHOT AT A FLEET'S SIZE — 250 terminals on one host.
 *
 *  Both consumers (the departure reconcile, the arrival adopt) hold this one
 *  memo, and it used to read the parent edge of every listed terminal itself:
 *  two store nodes per id, so Solid's development build judges it
 *  `WIDE_SCOPE_DEPS` at about 100 panes. The edges are folded per id now and
 *  the memo reads the joined list.
 *
 *  THE EDGE IS THE REAL ONE. The list is `terminalListSub` over the real
 *  `createReactiveSubscription` keys stream, and `parentOf` is
 *  `useTerminalMetadata`'s own `parentEdge` — the metadata slot's `parent`
 *  memo over the real per-key `useCollection` record
 *  (`hostScope/fleetScope.testlib.ts`, `hostScope/hostWireMirror.testlib.ts`)
 *  — exactly the pair `useActiveReconcile` and `useAdoptNewSplit` hand in. A
 *  fixture of plain rows under-measures that graph about threefold.
 *
 *  Judged on the diagnostics taken whole AND on both consumers' maps, which
 *  are built here from the fleet's own plan — including the two shapes that
 *  differ (a nullable all-ids map, a sub-only one). */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createRoot, flush } from "solid-js";
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
import { encActiveHost } from "../wire";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { useTerminalMetadata } from "./useTerminalMetadata";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

/** 50 tiles, four panes each — two direct splits and a split of each, so the
 *  sub-only map is two thirds of the census and the chain is two deep. */
const TILES = 50;
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;

/** p0 and p2 hang off the tile; p1 hangs off p0 and p3 off p2. */
const parentOfPane = (at: number, pane: number): TerminalId =>
  pane === 1 ? paneAt(at, 0) : pane === 3 ? paneAt(at, 2) : tileAt(at);

/** The server's order: each tile, then its own panes. */
const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < 4; pane++) ids.push(paneAt(at, pane));
}

const recordOf = (
  parentId: TerminalId | null,
  lastActivityAt: number,
): PadiTerminal =>
  ({
    state: "active",
    parentId,
    lastActivityAt,
    cwd: "/w/one",
    git: { kind: "none" },
  }) as unknown as PadiTerminal;

const recordFor = (
  id: TerminalId,
  n: number,
  parentId?: TerminalId,
): PadiTerminal => {
  const at = Number(/^t(\d+)/.exec(id)?.[1] ?? 0);
  const pane = /p(\d+)$/.exec(id);
  return recordOf(
    parentId ?? (pane === null ? null : parentOfPane(at, Number(pane[1]))),
    n,
  );
};

interface Harness {
  readonly all: Accessor<{
    host: string;
    map: Map<TerminalId, TerminalId | null>;
  }>;
  readonly subs: Accessor<{ host: string; map: Map<TerminalId, TerminalId> }>;
  /** One pane's record lands again under a different parent. */
  readonly reparent: (id: TerminalId, parentId: TerminalId) => void;
  /** The last id leaves the host's key list. */
  readonly dropLast: () => void;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** The two snapshots, over the live edge their consumers read. */
const drive = async (): Promise<Harness> => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = fleetScope().scope;
    const { parentEdge } = useTerminalMetadata({ list: terminalListSub });
    const all = createHostScopedParentSnapshot<TerminalId | null>(
      "reconcileSnapshot",
      () => terminalListSub() ?? [],
      encActiveHost,
      parentEdge,
      (edges) => {
        const m = new Map<TerminalId, TerminalId | null>();
        for (const { id, parent } of edges) m.set(id, parent ?? null);
        return m;
      },
    );
    const subs = createHostScopedParentSnapshot<TerminalId>(
      "adoptSnapshot",
      () => terminalListSub() ?? [],
      encActiveHost,
      parentEdge,
      (edges) => {
        const m = new Map<TerminalId, TerminalId>();
        for (const { id, parent } of edges)
          if (parent != null) m.set(id, parent);
        return m;
      },
    );
    return { all, subs };
  });
  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordFor(id, n));
  await settle();
  flush();
  return {
    all: built.all,
    subs: built.subs,
    reparent: (id, parentId) =>
      mirror.pushRecord(id, recordFor(id, ids.indexOf(id), parentId)),
    dropLast: () => mirror.pushKeys(ids.slice(0, -1)),
  };
};

/** The two maps the consumers want, in key order, from the fleet's plan. */
const plan = (): {
  all: [TerminalId, TerminalId | null][];
  subs: [TerminalId, TerminalId][];
} => {
  const all: [TerminalId, TerminalId | null][] = [];
  const subs: [TerminalId, TerminalId][] = [];
  for (let at = 0; at < TILES; at++) {
    all.push([tileAt(at), null]);
    for (let pane = 0; pane < 4; pane++) {
      const parent = parentOfPane(at, pane);
      all.push([paneAt(at, pane), parent]);
      subs.push([paneAt(at, pane), parent]);
    }
  }
  return { all, subs };
};

it("snapshots 250 parent edges for both consumers with no wide scope", async () => {
  const h = await drive();
  const expected = plan();
  expect(h.all().host).toBe("local");
  expect([...h.all().map]).toEqual(expected.all);
  expect([...h.subs().map]).toEqual(expected.subs);
  expect(diagnostics()).toEqual([]);

  // A reparent moves ONE edge in both maps and nothing else.
  const heldSnapshot = h.all();
  h.reparent(paneAt(4, 3), paneAt(4, 0));
  await settle();
  flush();
  expect(h.all()).not.toBe(heldSnapshot);
  expect(h.all().map.get(paneAt(4, 3))).toBe(paneAt(4, 0));
  expect(h.subs().map.get(paneAt(4, 3))).toBe(paneAt(4, 0));
  expect(h.all().map.size).toBe(250);
  expect(diagnostics()).toEqual([]);

  // The last pane leaves: it is in neither map, and the rest stand.
  h.dropLast();
  await settle();
  flush();
  expect(h.all().map.size).toBe(249);
  expect(h.all().map.has(paneAt(TILES - 1, 3))).toBe(false);
  expect(h.subs().map.has(paneAt(TILES - 1, 3))).toBe(false);
  expect(h.subs().map.size).toBe(199);
  expect(diagnostics()).toEqual([]);
});
