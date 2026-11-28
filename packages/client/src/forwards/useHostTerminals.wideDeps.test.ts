/** THE PORT SURFACES' PANE WALK AT FLEET SIZE — 250 panes on one host.
 *
 *  `useHostTerminals` holds the ONE walk of "every pane of every tile" that the
 *  Ports section and the printed-URL card read, and it used to make that walk
 *  on two memos of its own:
 *
 *   - the candidate list read each pane's composed record — a slot leaf, the
 *     projected record, `state` and `ports`, four sources a pane;
 *   - the whole-host printed set read the printed-port index per pane.
 *
 *  A host with a few hundred panes therefore put every one of them on one
 *  scope, which Solid's development build judges `WIDE_SCOPE_DEPS` past 200
 *  sources.
 *
 *  THE RECORDS ARE THE REAL STORE: they arrive through the real per-key
 *  `useCollection` view over real subscription stores
 *  (`../hostScope/hostWireMirror.testlib.ts`) and are read through the real
 *  `useTerminalMetadata` projection, so one pane's reading costs what it costs
 *  in the browser — which a mocked record under-measures about threefold. The
 *  printed ports are written by the real `trackPrintedPorts` scanner into the
 *  real index store, so that half is the production writer too.
 *
 *  The fleet is 50 tiles of five panes each in server order, with the serving
 *  panes spread across both arms (a tile that serves its own port, and splits
 *  that serve their tile's), so every published list is a strict subset in a
 *  non-trivial order and a test that merely counted rows could not pass. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { PortInfo, TerminalId } from "kolu-common/surface";
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({
  /** The active host's scope, as `useTerminalMetadata` reads it. */
  scope: undefined as unknown,
  /** The terminal store face `useHostTerminals` asks — the real metadata
   *  projection, plus the one act it hands a serving link. */
  store: undefined as unknown,
  /** Every id `activate` was called with, newest last. */
  activated: [] as TerminalId[],
}));

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  // The host's clock, which the metadata projection reprojects through.
  padiMap: { entry: () => ({ clock: { toLocal: (at: number) => at } }) },
}));
vi.mock("../hostScope/hostScopes", () => ({ activeScope: () => held.scope }));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => held.store,
}));

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import {
  printingTerminal,
  runScans,
  stopScans,
} from "../terminal/printedPortsScan.testlib";
import { useTerminalMetadata } from "../terminal/useTerminalMetadata";
import { useHostTerminals } from "./useHostTerminals";

const PANES = 250;
/** The tile itself and four splits. */
const PANES_PER_TILE = 5;

const ids = Array.from({ length: PANES }, (_, n) => `p${n}` as TerminalId);
const tileOf = (n: number): TerminalId =>
  ids[n - (n % PANES_PER_TILE)] as TerminalId;
const parentAt = (n: number): TerminalId | null =>
  n % PANES_PER_TILE === 0 ? null : tileOf(n);

/** Panes that serve a port — spread across both arms: `p10` and `p45` are
 *  tiles serving their own port, the rest are splits serving their tile's. */
const SERVES = (n: number): boolean => n % 7 === 3;
/** The pane whose scan has never landed: it serves nothing a reader may name,
 *  and that is NOT the same as serving nothing. */
const BLIND = 45;
/** The pane with no live arm — a sleeping split holds no listener. */
const ASLEEP = 38;

const portAt = (n: number): PortInfo => ({
  port: 20_000 + n,
  name: "node",
  command: `node server.js --pane ${n}`,
  scope: "loopback",
  family: "v4",
});

/** A composed record as this fleet serves one — the fields the pane walk and
 *  the serving link narrow on, at exactly that width. */
const recordAt = (
  n: number,
  over: { ports?: readonly PortInfo[]; asleep?: boolean } = {},
): PadiTerminal =>
  ({
    state: over.asleep === true || n === ASLEEP ? "sleeping" : "active",
    parentId: parentAt(n),
    cwd: `/srv/pane-${n}`,
    git: { kind: "none" },
    lastActivityAt: n,
    ports:
      n === BLIND && over.ports === undefined
        ? { status: "unknown" }
        : {
            status: "known",
            list: over.ports ?? (SERVES(n) ? [portAt(n)] : []),
          },
  }) as unknown as PadiTerminal;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let disposeReader: (() => void) | undefined;
afterEach(() => {
  stopScans();
  disposeReader?.();
  dispose?.();
  disposeReader = undefined;
  dispose = undefined;
  flush();
});

/** One host's pane walk over a 250-pane mirror. */
async function fleet() {
  const mirror = hostWireMirror();
  const entry = mirror.entry as {
    collections: {
      terminals: { use: (options: { keys: () => TerminalId[] }) => unknown };
    };
  };
  takeSolidDiagnostics();
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    held.scope = {
      wire: {
        terminals: entry.collections.terminals.use({ keys: () => [...ids] }),
      },
      prefs: {
        activityWindow: () => "all" as const,
        setActivityWindow: () => {},
      },
    };
    const metadata = useTerminalMetadata({ list: () => ids });
    held.store = {
      terminalIds: metadata.terminalIds,
      getTilePaneIds: metadata.getTilePaneIds,
      getMetadata: metadata.getMetadata,
      activate: (id: TerminalId) => held.activated.push(id),
    };
    return { metadata, terminals: useHostTerminals() };
  });
  for (const [n, id] of ids.entries()) mirror.pushRecord(id, recordAt(n));
  // The projection is PULLED: reading one slot builds the table and opens
  // every key's subscription, and the frames queued above land on the settle
  // after that read.
  built.metadata.getMetadata(ids[0] as TerminalId);
  await settle();
  flush();
  return { ...built, mirror };
}

it("folds 250 panes into one serving census with no wide memo", async () => {
  held.activated = [];
  const { terminals, mirror } = await fleet();

  // The tile whose SPLIT serves, and the tile that serves its own port.
  expect(terminals.tilePorts(ids[0] as TerminalId)).toEqual([portAt(3)]);
  expect(terminals.tilePorts(ids[10] as TerminalId)).toEqual([portAt(10)]);
  // A tile none of whose panes serves anything.
  expect(terminals.tilePorts(ids[5] as TerminalId)).toEqual([]);
  // The pane whose scan never landed says nothing, and the sleeping one holds
  // no listener — neither may be read as "serves nothing in particular".
  expect(terminals.tilePorts(ids[BLIND] as TerminalId)).toEqual([]);
  expect(terminals.tilePorts(ids[35] as TerminalId)).toEqual([]);

  // The link back to the TILE the user can activate — a split's port names its
  // TILE and jumps there, never the pane the scanner attributed it to.
  const serving = terminals.servingFor(20_003);
  expect(serving?.name).toBe("/srv/pane-0");
  serving?.jump();
  expect(held.activated).toEqual([ids[0]]);
  // A tile serving its own port names itself.
  expect(terminals.servingFor(20_010)?.name).toBe("/srv/pane-10");
  expect(terminals.servingFor(20_000 + BLIND)).toBeUndefined();
  expect(terminals.servingFor(20_000 + ASLEEP)).toBeUndefined();
  expect(terminals.servingFor(9_999)).toBeUndefined();
  expect(diagnostics()).toEqual([]);

  // One pane starts serving a second port: its tile publishes both, in port
  // order, and no other tile moves.
  mirror.pushRecord(
    ids[3] as TerminalId,
    recordAt(3, { ports: [portAt(3), portAt(1)] }),
  );
  await settle();
  flush();
  expect(terminals.tilePorts(ids[0] as TerminalId)).toEqual([
    portAt(1),
    portAt(3),
  ]);
  expect(terminals.servingFor(20_001)?.name).toBe("/srv/pane-0");
  expect(terminals.tilePorts(ids[10] as TerminalId)).toEqual([portAt(10)]);
  expect(diagnostics()).toEqual([]);
});

it("folds the printed ports of 250 panes into one set with no wide memo", async () => {
  const { terminals } = await fleet();
  const printed = (): number[] =>
    [...terminals.printedOnHost()].sort((a, b) => a - b);

  const atTwo = printingTerminal(ids[2] as TerminalId);
  const atHundredOne = printingTerminal(ids[101] as TerminalId);
  const atTwoHundred = printingTerminal(ids[200] as TerminalId);
  atTwo(3000);
  atHundredOne(4100);
  atHundredOne(4101);
  atTwoHundred(5000);
  runScans();

  expect(printed()).toEqual([3000, 4100, 4101, 5000]);
  // Per TILE, the same index read through the panes of one tile only.
  expect(
    [...terminals.printedBy(ids[100] as TerminalId)].sort((a, b) => a - b),
  ).toEqual([4100, 4101]);
  expect([...terminals.printedBy(ids[0] as TerminalId)]).toEqual([3000]);
  expect(diagnostics()).toEqual([]);

  // Another pane prints a server's URL: the whole-host set grows by it and no
  // other pane's entry moves.
  const atLast = printingTerminal(ids[249] as TerminalId);
  atLast(6000);
  runScans();
  expect(printed()).toEqual([3000, 4100, 4101, 5000, 6000]);
  expect([...terminals.printedBy(ids[0] as TerminalId)]).toEqual([3000]);
  expect(
    [...terminals.printedBy(ids[100] as TerminalId)].sort((a, b) => a - b),
  ).toEqual([4100, 4101]);
  expect(diagnostics()).toEqual([]);
});

it("answers servingFor inside a tracked computation with no wide memo", async () => {
  held.activated = [];
  const { terminals, mirror } = await fleet();

  // READ FROM INSIDE A COMPUTATION, which is where every consumer reads it:
  // `PortRow`'s `<Show when={props.serving}>` memo asks this per elsewhere row.
  // Asked from a test body the walk is untracked and the judge sees nothing;
  // asked here, every source the join touches lands on THIS memo's scope.
  const link = createRoot((disposeRoot) => {
    disposeReader = disposeRoot;
    return createMemo(() => terminals.servingFor(20_003), {
      name: "wideDeps.servingReader",
    });
  });

  expect(link()?.name).toBe("/srv/pane-0");
  link()?.jump();
  expect(held.activated).toEqual([ids[0]]);
  expect(diagnostics()).toEqual([]);

  // A MISS is the normal case for a row on a busy host, and it is the dearest
  // one: nothing matches, so the join walks every pane before it answers.
  const miss = createRoot((disposeRoot) => {
    const memo = createMemo(() => terminals.servingFor(9_999), {
      name: "wideDeps.missingServingReader",
    });
    const value = memo();
    disposeRoot();
    return value;
  });
  expect(miss).toBeUndefined();
  expect(diagnostics()).toEqual([]);

  // The serving pane hands its port to a sibling split of the SAME tile: the
  // tracked reader re-runs and still names the tile, which is what the user
  // can activate.
  mirror.pushRecord(ids[3] as TerminalId, recordAt(3, { ports: [] }));
  mirror.pushRecord(ids[4] as TerminalId, recordAt(4, { ports: [portAt(3)] }));
  await settle();
  flush();
  expect(link()?.name).toBe("/srv/pane-0");
  held.activated = [];
  link()?.jump();
  expect(held.activated).toEqual([ids[0]]);
  expect(diagnostics()).toEqual([]);
});
