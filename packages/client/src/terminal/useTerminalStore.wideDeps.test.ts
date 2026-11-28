// @vitest-environment happy-dom

/** THE WEBGL BUDGET AT A FLEET'S SIZE — 250 terminals on one host, 50 tiles
 *  with four panes each, eight of the tiles asleep.
 *
 *  The budget admits the most-recently-active LIVE tiles that fit under
 *  `WEBGL_CONTEXT_CAP`. Its tail is capped — `admitWebglTiles` stops at the cap
 *  — but the set it admits FROM is not: narrowing every tile to its active arm
 *  read the metadata slot and its projected record per tile, which Solid's
 *  development build judges `WIDE_SCOPE_DEPS` past 200 sources, about 66 tiles.
 *
 *  The records are the REAL store: the real `createReactiveSubscription` key
 *  stream and the real per-key `useCollection` view
 *  (`hostScope/hostWireMirror.testlib.ts`), read through the real
 *  `useTerminalMetadata` projection, so one tile's reading costs what it costs
 *  in the browser.
 *
 *  What is pinned is the published budget: which tiles are alive, and which of
 *  them hold a renderer — before and after you switch to a tile that was not in
 *  the working set. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

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

import { fleetScope } from "../hostScope/fleetScope.testlib";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { useTerminalStore } from "./useTerminalStore";
import { WEBGL_CONTEXT_CAP } from "./webglBudget";

const TILES = 50;
const PANES = 4;
const tileAt = (at: number) => `t${at}` as TerminalId;
const paneAt = (at: number, pane: number) => `t${at}p${pane}` as TerminalId;

/** Every seventh tile is asleep: a full canvas citizen that holds no live
 *  resource, so it must never claim a context. */
const asleep = (at: number): boolean => at % 7 === 0;

const ids: TerminalId[] = [];
for (let at = 0; at < TILES; at++) {
  ids.push(tileAt(at));
  for (let pane = 0; pane < PANES; pane++) ids.push(paneAt(at, pane));
}

const tiles = Array.from({ length: TILES }, (_, at) => tileAt(at));
const liveTiles = tiles.filter((_, at) => !asleep(at));

const parentOfPane = (at: number, pane: number): TerminalId =>
  pane === 1 ? paneAt(at, 0) : pane === 3 ? paneAt(at, 2) : tileAt(at);

const recordOf = (
  parentId: TerminalId | null,
  lastActivityAt: number,
  sleeping: boolean,
): PadiTerminal =>
  ({
    ...(sleeping
      ? { state: "sleeping", sleptAt: lastActivityAt }
      : { state: "active" }),
    parentId,
    lastActivityAt,
    cwd: "/w/one",
    git: { kind: "none" },
  }) as unknown as PadiTerminal;

/** The tile you switch to — outside the working set, and awake. */
const SWITCHED_TO = tileAt(3);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("budgets WebGL over 50 tiles of a 250-terminal host with no wide scope", async () => {
  const mirror = hostWireMirror();
  held.entry = () => ({
    clock: { toLocal: (at: number) => at },
    ...(mirror.entry as object),
  });
  takeSolidDiagnostics();
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const fleet = fleetScope();
    held.scope = fleet.scope;
    return { fleet, store: useTerminalStore() };
  });

  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) {
    const at = Number(/^t(\d+)/.exec(id)?.[1] ?? 0);
    const pane = /p(\d+)$/.exec(id);
    mirror.pushRecord(
      id,
      recordOf(
        pane === null ? null : parentOfPane(at, Number(pane[1])),
        n,
        pane === null && asleep(at),
      ),
    );
  }
  // Most recently active first — the reverse of creation order.
  const coldestFirst = [...tiles].reverse();
  built.fleet.setMruOrder(coldestFirst);
  await settle();
  flush();

  // THE LIVE SET: every awake tile, in the census's own order. A sleeping tile
  // is listed and placed, and holds nothing.
  expect(built.store.liveTileIds()).toEqual(liveTiles);

  /** The tiles the budget should hold, for one MRU — stated here rather than
   *  through the product's fold, in the census order the reading below answers
   *  in. Each tile costs one context (none has an expanded active split), so
   *  the cap is a count. */
  const expectedFor = (mru: readonly TerminalId[]): TerminalId[] => {
    const admitted = mru
      .filter((id) => liveTiles.includes(id))
      .slice(0, WEBGL_CONTEXT_CAP);
    return tiles.filter((id) => admitted.includes(id));
  };
  const budgeted = (): TerminalId[] =>
    tiles.filter((id) => built.store.holdsWebgl(id));

  expect(budgeted()).toEqual(expectedFor(coldestFirst));
  expect(budgeted().length).toBe(WEBGL_CONTEXT_CAP);
  expect(diagnostics()).toEqual([]);

  // YOU SWITCH TO A TILE OUTSIDE THE WORKING SET: it joins the budget and the
  // oldest admitted tile falls out — exactly two tiles cross the line.
  const switched = [
    SWITCHED_TO,
    ...coldestFirst.filter((id) => id !== SWITCHED_TO),
  ];
  built.fleet.setMruOrder(switched);
  flush();

  expect(budgeted()).toEqual(expectedFor(switched));
  expect(budgeted()).toContain(SWITCHED_TO);
  expect(budgeted()).not.toContain(
    coldestFirst.filter((id) => liveTiles.includes(id))[WEBGL_CONTEXT_CAP - 1],
  );
  expect(diagnostics()).toEqual([]);
});
