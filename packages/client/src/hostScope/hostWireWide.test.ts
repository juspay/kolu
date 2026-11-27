/** A HOST'S WIRE READINGS AT FLEET SIZE — the census, the roster check and the
 *  boot pick over 250 terminals.
 *
 *  Each of the three used to read every terminal on one memo: the tile census
 *  walked each key's composed record, the roster check walked the standing's id
 *  list against the key list, and the boot pick walked the records again. A
 *  host with a few hundred panes therefore put every one of them on one scope,
 *  which Solid's development build judges `WIDE_SCOPE_DEPS` past 200 sources.
 *
 *  The fleet here is 250 terminals in server order — one tile in four, the
 *  other three its splits — so the published census is a strict subset in a
 *  non-trivial order, and a test that merely counted rows could not pass. */

import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createStore, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

const mirror = vi.hoisted(() => ({
  /** The host's key list, read off this file's store. */
  keys: (() => []) as () => TerminalId[],
  /** One terminal's composed record — the collection's per-key accessor. */
  record: ((_id: TerminalId) => undefined) as (
    id: TerminalId,
  ) => PadiTerminal | undefined,
  roster: (() => undefined) as () => PadiRoster | undefined,
  session: (() => undefined) as () => { activeTerminalId: string } | undefined,
  sessionPending: (() => false) as () => boolean,
}));

// The padi map entry `createHostWire` opens its members through. Values come
// off a real store, so every read costs what the live subscription's costs.
vi.mock("../wire", () => {
  const cell = (value: () => unknown, pending: () => boolean) => ({
    use: () => ({ value, sub: { pending } }),
  });
  return {
    padiMap: {
      entry: () => ({
        collections: {
          terminals: {
            unenrolledKeys: {},
            use: () => ({
              keys: () => mirror.keys(),
              byKey: (id: TerminalId) => () => mirror.record(id),
            }),
          },
          daemonStatus: {
            use: () => ({ keys: () => [], byKey: () => undefined }),
          },
        },
        cells: {
          session: cell(
            () => mirror.session(),
            () => mirror.sessionPending(),
          ),
          roster: cell(
            () => mirror.roster(),
            () => false,
          ),
          activityFeed: cell(
            () => undefined,
            () => false,
          ),
        },
      }),
    },
    interpretClientError: () => {},
  };
});

// The keys STREAM: the real one publishes its value into a store, which is
// what this stub hands back — the list reads below cost what they cost live.
vi.mock("@kolu/surface/solid", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createReactiveSubscription: () =>
    Object.assign(() => mirror.keys(), { pending: () => false }),
}));

import { createBootPick } from "./createBootPick";
import { createHostWire } from "./createHostWire";

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

/** A composed record as this fleet carries it — the three fields every
 *  reading under test narrows on, held in a shape a leaf write can move. */
interface FixtureTerminal {
  state: "active" | "sleeping" | "parked";
  parentId: TerminalId | null;
  lastActivityAt: number;
}
const recordAt = (n: number): FixtureTerminal => ({
  state: "active",
  parentId: parentAt(n),
  lastActivityAt: n,
});

/** The tiles the census should publish, listed here rather than through the
 *  product's fold. */
const TILES = ids.filter((_, n) => n % TILE_EVERY === 0);

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

interface Fleet {
  keys: TerminalId[];
  records: Record<string, FixtureTerminal>;
  roster: PadiRoster | undefined;
  session: { activeTerminalId: string } | undefined;
  pending: boolean;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

/** One host's retained wire over a 250-terminal store, plus its boot pick.
 *  `inFlight` is a listed id whose record has not arrived — the state the
 *  wire is BUILT in, since the pick is answered on its first run. */
function fleet(options: { saved?: TerminalId; inFlight?: TerminalId } = {}) {
  const [state, setState] = createStore<Fleet>({
    keys: [...ids],
    records: Object.fromEntries(
      ids
        .map((id, n) => [id, recordAt(n)] as const)
        .filter(([id]) => id !== options.inFlight),
    ),
    roster: { kind: "established", at: 0, ids: [...ids] },
    session:
      options.saved === undefined
        ? undefined
        : { activeTerminalId: options.saved },
    pending: false,
  });
  mirror.keys = () => state.keys;
  // The fixture record carries exactly the fields the narrows read; the wire
  // union's other arms play no part in any reading under test.
  mirror.record = (id) =>
    state.records[id] as unknown as PadiTerminal | undefined;
  mirror.roster = () => state.roster;
  mirror.session = () => state.session;
  mirror.sessionPending = () => state.pending;
  takeSolidDiagnostics();
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const wire = createHostWire(HOST);
    const pick = createBootPick(wire, () => false);
    return { wire, pick, state, setState };
  });
}

it("publishes a 250-terminal host's tile census with no wide memo", () => {
  const { wire, setState } = fleet();
  flush();

  expect(wire.tileIds()).toEqual(TILES);
  expect(diagnostics()).toEqual([]);

  // One split is re-parented to the canvas: it joins the census in its own
  // place in the server's order, and nothing else moves.
  setState((s) => {
    const row = s.records.t1;
    if (row !== undefined) row.parentId = null;
  });
  flush();
  expect(wire.tileIds()).toEqual(
    ids.filter((_, n) => n % TILE_EVERY === 0 || n === 1),
  );
  expect(diagnostics()).toEqual([]);
});

it("drops a parked row and a record still in flight from the census", () => {
  const { wire, setState } = fleet();
  flush();
  takeSolidDiagnostics();

  setState((s) => {
    const row = s.records.t4;
    if (row !== undefined) row.state = "parked";
  });
  setState((s) => {
    delete s.records.t8;
  });
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

it("reads a 250-id roster against the key list with no wide memo", () => {
  const { wire, setState } = fleet();
  flush();

  expect(wire.listIsCensus()).toBe(true);
  expect(diagnostics()).toEqual([]);

  // The standing names an id the list has not delivered: not a census yet.
  setState((s) => {
    s.keys.splice(TERMINALS - 1, 1);
  });
  flush();
  expect(wire.listIsCensus()).toBe(false);
  expect(diagnostics()).toEqual([]);

  // A roster that is still settling is never a census, however long the list.
  setState((s) => {
    s.keys.push(ids[TERMINALS - 1] as TerminalId);
    s.roster = { kind: "settling" };
  });
  flush();
  expect(wire.listIsCensus()).toBe(false);
  expect(diagnostics()).toEqual([]);
});

it("picks the saved tile out of a 250-terminal census with no wide memo", () => {
  const saved = "t100" as TerminalId;
  const { pick, setState } = fleet({ saved });
  flush();

  expect(pick()).toBe(saved);
  expect(diagnostics()).toEqual([]);

  // Answered once: a later census move cannot re-point the booted tile.
  setState((s) => {
    const row = s.records.t1;
    if (row !== undefined) row.parentId = null;
  });
  flush();
  expect(pick()).toBe(saved);
  expect(diagnostics()).toEqual([]);
});

it("holds the pick back until every listed record has arrived", () => {
  const inFlight = "t200" as TerminalId;
  const { pick, setState } = fleet({ saved: "t100" as TerminalId, inFlight });
  // A record still in flight: there is no honest pick yet.
  flush();
  expect(pick()).toBeNull();
  expect(diagnostics()).toEqual([]);

  setState((s) => {
    s.records.t200 = recordAt(200);
  });
  flush();
  expect(pick()).toBe("t100");
  expect(diagnostics()).toEqual([]);
});
