// @vitest-environment happy-dom
/** ONE HOST'S SWITCHER ROWS AT FLEET SIZE — 250 terminals through the real
 *  per-key collection view.
 *
 *  `createFleetHostRows` already mints a memo per key. What it did NOT have was
 *  a bounded JOIN: the published list read every one of those row memos on one
 *  scope, so a host with a few hundred panes put a source per pane on it and
 *  Solid's development build judged it `WIDE_SCOPE_DEPS` past 200.
 *
 *  THE INPUTS ARE THE REAL STORES (`../hostScope/hostWireMirror.testlib`): the
 *  real keys stream, so `keys()` is a store-proxy array, and the real per-key
 *  `useCollection` view, so one record costs the per-key memo plus `store.v`
 *  before any field. That is also what pins the OTHER half of the shape — the
 *  `mapArray` over those keys stays a flat two sources at any fleet size, which
 *  is the only reason a per-key row memo is affordable at all.
 *
 *  Every fourth terminal is a tile and the three after it are its splits, so
 *  the published list is a strict subset in a non-trivial order: a fold that
 *  merely counted rows could not pass. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import type { Stream } from "effect";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({ entry: (() => undefined) as () => unknown }));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  hostKeys: () => [{ kind: "local" }],
  interpretClientError: () => {},
}));

import { createReactiveSubscription } from "@kolu/surface/solid";
import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { createFleetHostRows } from "./fleetTerminals";

const TERMINALS = 250;
/** Every fourth terminal is a tile; the three after it are its splits. */
const TILE_EVERY = 4;

const ids = Array.from(
  { length: TERMINALS },
  (_, n) => `t${n}` as TerminalId,
) as TerminalId[];
const parentAt = (n: number): TerminalId | null =>
  n % TILE_EVERY === 0 ? null : (ids[n - (n % TILE_EVERY)] as TerminalId);

/** A composed record as this fleet serves it, at exactly the width the row
 *  fold narrows on. `lastActivityAt` descends with the index, so the ranking
 *  below is the server's order. */
const recordAt = (
  n: number,
  over: { state?: string; parentId?: TerminalId | null } = {},
): PadiTerminal =>
  ({
    id: ids[n],
    state: over.state ?? "active",
    parentId: "parentId" in over ? over.parentId : parentAt(n),
    lastActivityAt: TERMINALS - n,
    cwd: `/w/r${n % 3}`,
  }) as unknown as PadiTerminal;

/** The tiles the row list should publish, listed here rather than through the
 *  product's own fold. */
const TILES = ids.filter((_, n) => n % TILE_EVERY === 0);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** One host's fleet rows over a 250-terminal mirror, built the way
 *  `useFleetHosts` builds them: a real keys subscription, the real per-key
 *  collection view over it, and the clock inputs as the plain signals they are
 *  in production. */
async function fleet() {
  const mirror = hostWireMirror();
  held.entry = () => mirror.entry;
  const entry = mirror.entry as {
    collections: {
      terminals: {
        unenrolledKeys: (input: undefined) => Stream.Stream<TerminalId[]>;
        use: (options: { keys: () => TerminalId[] }) => {
          byKey: (id: TerminalId) => (() => PadiTerminal) | undefined;
        };
      };
    };
  };
  const [now, setNow] = createSignal(0);
  const [thresholdMs, setThresholdMs] = createSignal<number | null>(null);
  takeSolidDiagnostics();
  const rows = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const terminalKeys = createReactiveSubscription(
      () => LOCAL_HOST,
      () => entry.collections.terminals.unenrolledKeys(undefined),
    );
    const keys = createMemo<TerminalId[]>(() => terminalKeys() ?? []);
    const terminals = entry.collections.terminals.use({ keys });
    return createFleetHostRows({
      host: LOCAL_HOST,
      keys,
      recordOf: (id) => terminals.byKey(id)?.(),
      project: (record) => record,
      now,
      thresholdMs,
    });
  });
  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordAt(n));
  await settle();
  flush();
  return { rows, mirror, setNow, setThresholdMs };
}

it("publishes a 250-terminal host's switcher rows with no wide memo", async () => {
  const { rows, mirror } = await fleet();

  expect(rows().map((row) => row.id)).toEqual(TILES);
  expect(diagnostics()).toEqual([]);

  // One split is re-parented to the canvas: it becomes a row of its own, in
  // its own place in the server's order, and nothing else moves.
  mirror.pushRecord("t1" as TerminalId, recordAt(1, { parentId: null }));
  await settle();
  flush();
  expect(rows().map((row) => row.id)).toEqual(
    ids.filter((_, n) => n % TILE_EVERY === 0 || n === 1),
  );
  expect(diagnostics()).toEqual([]);
});

it("drops a parked row and holds the rest still", async () => {
  const { rows, mirror } = await fleet();
  const before = rows();
  takeSolidDiagnostics();

  mirror.pushRecord("t4" as TerminalId, recordAt(4, { state: "parked" }));
  await settle();
  flush();

  // The parked tile leaves; its three splits, whose parent is now
  // unresolvable, are rows of their own, exactly as an orphan always is.
  expect(rows().map((row) => row.id)).toEqual(
    ids.filter(
      (id, n) =>
        (n % TILE_EVERY === 0 || ["t5", "t6", "t7"].includes(id)) &&
        id !== "t4",
    ),
  );
  // Every row the change did not touch is the SAME row object: the join
  // republishes the list, it does not reproject the fleet.
  const byId = new Map(before.map((row) => [row.id, row]));
  for (const row of rows())
    if (byId.has(row.id)) expect(row).toBe(byId.get(row.id));
  expect(diagnostics()).toEqual([]);
});

it("drops the rows outside the activity window with no wide memo", async () => {
  const { rows, setNow, setThresholdMs } = await fleet();
  takeSolidDiagnostics();

  // The window admits every terminal whose last activity is within 40 ms of
  // `now`; `lastActivityAt` descends with the index, so that is the first
  // eleven tiles (`t40` is exactly at the edge, and the edge is admitted).
  setNow(TERMINALS);
  setThresholdMs(40);
  flush();

  expect(rows().map((row) => row.id)).toEqual(TILES.slice(0, 11));
  expect(diagnostics()).toEqual([]);
});
