/** A HOST'S WIRE READINGS AT FLEET SIZE — the census, the roster check and the
 *  boot pick over 250 terminals.
 *
 *  Each of the three used to read every terminal on one memo: the tile census
 *  walked each key's composed record, the roster check walked the standing's id
 *  list against the key list, and the boot pick walked the records again. A
 *  host with a few hundred panes therefore put every one of them on one scope,
 *  which Solid's development build judges `WIDE_SCOPE_DEPS` past 200 sources.
 *
 *  THE MIRROR IS THE REAL ONE (`./hostWireMirror.testlib.ts`): the real keys
 *  stream, the real per-key `useCollection` view and real subscription stores,
 *  so `terminalKeys()` is a store array and a record read costs what it costs
 *  in the browser — five sources per pane on a scope that walks the list.
 *
 *  The fleet is 250 terminals in server order — one tile in four, the other
 *  three its splits — so the published census is a strict subset in a
 *  non-trivial order, and a test that merely counted rows could not pass. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { HostKey } from "kolu-common/hostKey";
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

const held = vi.hoisted(() => ({ entry: (() => undefined) as () => unknown }));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  interpretClientError: () => {},
}));

import { createBootPick } from "./createBootPick";
import { createHostWire } from "./createHostWire";
import { hostWireMirror } from "./hostWireMirror.testlib";

const HOST: HostKey = { kind: "local" };
const TERMINALS = 250;
/** Every fourth terminal is a tile; the three after it are its splits. */
const TILE_EVERY = 4;

const ids = Array.from(
  { length: TERMINALS },
  (_, n) => `t${n}` as TerminalId,
) as TerminalId[];
const parentAt = (n: number): TerminalId | null =>
  n % TILE_EVERY === 0 ? null : (ids[n - (n % TILE_EVERY)] as TerminalId);

/** A composed record as this fleet serves it — the fields every reading under
 *  test narrows on. The wire union's other members play no part in any of
 *  them, so the record is stated at exactly that width. */
const recordAt = (
  n: number,
  over: { state?: string; parentId?: TerminalId | null } = {},
): PadiTerminal =>
  ({
    state: over.state ?? "active",
    parentId: "parentId" in over ? over.parentId : parentAt(n),
    lastActivityAt: n,
  }) as unknown as PadiTerminal;

/** The tiles the census should publish, listed here rather than through the
 *  product's fold. */
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

/** One host's retained wire over a 250-terminal mirror, plus its boot pick.
 *  `inFlight` is a listed id whose record is never served. */
async function fleet(
  options: { saved?: TerminalId; inFlight?: TerminalId } = {},
) {
  const mirror = hostWireMirror();
  held.entry = () => mirror.entry;
  takeSolidDiagnostics();
  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const wire = createHostWire(HOST);
    return { wire, pick: createBootPick(wire, () => false) };
  });
  mirror.pushKeys(ids);
  for (const [n, id] of ids.entries())
    if (id !== options.inFlight) mirror.pushRecord(id, recordAt(n));
  mirror.pushRoster({ kind: "established", at: 0, ids: [...ids] });
  mirror.pushSession(
    options.saved === undefined ? {} : { activeTerminalId: options.saved },
  );
  await settle();
  flush();
  return { ...built, mirror };
}

it("publishes a 250-terminal host's tile census with no wide memo", async () => {
  const { wire, mirror } = await fleet();

  expect(wire.tileIds()).toEqual(TILES);
  expect(diagnostics()).toEqual([]);

  // One split is re-parented to the canvas: it joins the census in its own
  // place in the server's order, and nothing else moves.
  mirror.pushRecord("t1" as TerminalId, recordAt(1, { parentId: null }));
  await settle();
  flush();
  expect(wire.tileIds()).toEqual(
    ids.filter((_, n) => n % TILE_EVERY === 0 || n === 1),
  );
  expect(diagnostics()).toEqual([]);
});

it("drops a parked row and a record still in flight from the census", async () => {
  const { wire, mirror } = await fleet({ inFlight: "t8" as TerminalId });
  takeSolidDiagnostics();

  mirror.pushRecord("t4" as TerminalId, recordAt(4, { state: "parked" }));
  await settle();
  flush();

  // Both tiles leave the census — and their splits, whose parent is now
  // unresolvable, are painted top-level, exactly as an orphan always is.
  const orphans = ["t5", "t6", "t7", "t9", "t10", "t11"];
  expect(wire.tileIds()).toEqual(
    ids.filter(
      (id, n) =>
        (n % TILE_EVERY === 0 || orphans.includes(id)) &&
        id !== "t4" &&
        id !== "t8",
    ),
  );
  expect(diagnostics()).toEqual([]);
});

it("reads a 250-id roster against the key list with no wide memo", async () => {
  const { wire, mirror } = await fleet();

  expect(wire.listIsCensus()).toBe(true);
  expect(diagnostics()).toEqual([]);

  // The standing names an id the list has not delivered: not a census yet.
  mirror.pushKeys(ids.slice(0, TERMINALS - 1));
  await settle();
  flush();
  expect(wire.listIsCensus()).toBe(false);
  expect(diagnostics()).toEqual([]);

  // A roster that is still settling is never a census, however long the list.
  mirror.pushKeys(ids);
  mirror.pushRoster({ kind: "settling" });
  await settle();
  flush();
  expect(wire.listIsCensus()).toBe(false);
  expect(diagnostics()).toEqual([]);
});

it("picks the saved tile out of a 250-terminal census with no wide memo", async () => {
  const saved = "t100" as TerminalId;
  const { pick, mirror } = await fleet({ saved });

  expect(pick()).toBe(saved);
  expect(diagnostics()).toEqual([]);

  // Answered once: a later census move cannot re-point the booted tile.
  mirror.pushRecord("t1" as TerminalId, recordAt(1, { parentId: null }));
  await settle();
  flush();
  expect(pick()).toBe(saved);
  expect(diagnostics()).toEqual([]);
});

it("holds the pick back until every listed record has arrived", async () => {
  const inFlight = "t200" as TerminalId;
  const { pick, mirror } = await fleet({
    saved: "t100" as TerminalId,
    inFlight,
  });
  expect(pick()).toBeNull();
  expect(diagnostics()).toEqual([]);

  mirror.pushRecord(inFlight, recordAt(200));
  await settle();
  flush();
  expect(pick()).toBe("t100");
  expect(diagnostics()).toEqual([]);
});

/** A roster shorter than the list, and a record for a key the list dropped:
 *  the census is the LIST's, and the standing is only the qualifier. */
it("answers a census when the standing names a subset of the list", async () => {
  const { wire, mirror } = await fleet();
  mirror.pushRoster({
    kind: "established",
    at: 1,
    ids: ids.slice(0, 10),
  });
  await settle();
  flush();
  expect(wire.listIsCensus()).toBe(true);
  expect(diagnostics()).toEqual([]);
});
