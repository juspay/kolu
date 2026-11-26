/** THE BOOT PICK IS DERIVED, NOT SEEDED.
 *
 *  The tile a cold boot lands on is a function of the hydration census: the
 *  terminal list, each listed terminal's record, and the persisted saved-session
 *  marker. Seeding it from the hydration EFFECT made that effect read the census
 *  and write the focus signal the app shell, the canvas and the command palette
 *  all read — the relay Solid grades a tear, and one painted boot frame with no
 *  active tile before the seed landed.
 *
 *  So this file watches the ACTIVE TILE through a consumer, across the whole
 *  boot, and demands it take exactly one value: the picked tile, in the same
 *  flush hydration runs in. A seeded pick shows up here as the extra frame —
 *  `null` first, the tile second.
 *
 *  The graph is real from `useSessionRestore` down: the per-host owner
 *  (`hostScopes`), its view state (`createViewState`) and the boot pick
 *  (`createBootPick`). Only the WIRE is a double, so a test can hand the host's
 *  census and saved session over as one snapshot. */

import { Effect } from "effect";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  createEffect,
  createRoot,
  createSignal,
  flush,
  runWithOwner,
} from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The host's wire, as one census a test DELIVERS before the root is built.
 *  Signal-backed (wired up below the imports, since a `vi.hoisted` bag is built
 *  before `solid-js` has loaded): the real cells are live subscriptions, and a
 *  census the derivation reads as a plain object would cache its first answer
 *  for the whole file. */
type SavedBlob = {
  activeTerminalId: string | null;
  /** The card's own fields — only a restore-driving case supplies them. */
  terminals?: unknown[];
  resumableIds?: string[];
  savedAt?: number;
};

const w = vi.hoisted(() => ({
  keys: (() => undefined) as () => TerminalId[] | undefined,
  records: (() => ({})) as () => Record<string, TerminalMetadata>,
  session: (() => null) as () => SavedBlob | null,
  sessionPending: () => false,
  /** Publish a census the way the socket does — detached, then observed. */
  deliver: (_census: {
    keys: TerminalId[];
    records: Record<string, TerminalMetadata>;
    session: SavedBlob | null;
  }) => {},
  reset: () => {},
}));

const spy = vi.hoisted(() => ({
  setActive: vi.fn(),
  /** The id `session.restore` ANSWERS with — the host's "this tile is active
   *  now", which the seed prefers over the consumed blob. */
  restoreAnswer: null as string | null,
  restore: vi.fn(),
}));

vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    groundedActiveHost: mockGroundedActiveHost(() => LOCAL_HOST),
    activeHost: () => ({ kind: "local" }),
    activePadiRpc: {
      session: {
        restore: (arg: unknown) => {
          spy.restore(arg);
          return Effect.succeed({ activeTerminalId: spy.restoreAnswer });
        },
      },
    },
    padiRpcOf: () => ({
      chrome: {
        setActive: (arg: { id: string }) => {
          spy.setActive(arg.id);
          return Effect.void;
        },
      },
    }),
  };
});

// The retained per-host wire, driven by the snapshot above. `createViewState`
// folds focus through `placementOf` and narrows the visit trail to `tileIds`,
// and `createBootPick` reads the keys, the records and the session cell —
// those six reads are the whole surface here.
vi.mock("../hostScope/createHostWire", () => ({
  createHostWire: () => ({
    terminalKeys: Object.assign(() => w.keys(), {
      pending: () => w.keys() === undefined,
    }),
    terminals: { byKey: (id: TerminalId) => () => w.records()[id] },
    session: {
      value: () => w.session() ?? undefined,
      sub: { pending: () => w.sessionPending() },
    },
    roster: { value: () => undefined },
    activityFeed: { value: () => undefined },
    daemonStatus: { byKey: () => undefined },
    placementOf: (id: TerminalId) => {
      const record = w.records()[id];
      if (record === undefined) return { kind: "missing" };
      return record.parentId === undefined || record.parentId === null
        ? { kind: "top-level" }
        : { kind: "split", parentId: record.parentId };
    },
    // This host's live top-level tiles, in census order. A key with no record
    // is parked or not yet arrived, and is no tile.
    tileIds: () =>
      (w.keys() ?? []).filter((id) => {
        const record = w.records()[id];
        return record !== undefined && !record.parentId;
      }),
  }),
}));

vi.mock("../hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => w.sessionPending() },
  savedSession: () => w.session(),
}));
vi.mock("../rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedHistory: () => {} }),
}));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    paneChrome: () => ({ activeSubTab: null }),
    visiblePaneOf: (id: TerminalId) => id,
    setActiveSubTab: () => {},
  }),
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
  }),
}));

import { activeScope } from "../hostScope/hostScopes";
import { addHost, resetHosts } from "../hostScope/mockHostMap.testlib";
import { useViewState } from "../useViewState";
import { useSessionRestore } from "./useSessionRestore";
import { planEviction, type TerminalEvictionPorts } from "./useActiveReconcile";
import type { TerminalStore } from "./useTerminalStore";

const A = "a0000000-0000-4000-8000-000000000001" as TerminalId;
const B = "b0000000-0000-4000-8000-000000000002" as TerminalId;
const C = "c0000000-0000-4000-8000-000000000003" as TerminalId;

const tile = (): TerminalMetadata =>
  ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

// The census cells, now that `solid-js` has loaded: the wire double above reads
// them through the hoisted bag.
{
  const [keys, setKeys] = createSignal<TerminalId[] | undefined>(undefined);
  const [records, setRecords] = createSignal<Record<string, TerminalMetadata>>(
    {},
  );
  const [session, setSession] = createSignal<SavedBlob | null>(null);
  w.keys = keys;
  w.records = records;
  w.session = session;
  w.deliver = (census) => {
    // A host's snapshot arrives from the socket, not from inside the app's
    // reactive owner.
    runWithOwner(null, () => {
      setKeys(census.keys);
      setRecords(census.records);
      setSession(census.session);
      flush();
    });
  };
  w.reset = () =>
    runWithOwner(null, () => {
      setKeys(undefined);
      setRecords({});
      setSession(null);
      flush();
    });
}

beforeEach(() => {
  localStorage.clear();
  spy.setActive.mockClear();
  spy.restore.mockClear();
  spy.restoreAnswer = null;
  w.reset();
  // Dispose the previous test's per-host owner (and its view state), then
  // re-add the single host these cases use. The emptying must be OBSERVED for
  // the owner to go — Solid 2 stages the write.
  resetHosts();
  flush();
  addHost(LOCAL_HOST);
  flush();
});

/** The store `useSessionRestore` hydrates through: the real per-host view
 *  facade, plus the census reads the hook makes. `planSetActiveSilently` is the
 *  SEED'S WRITE — a spy over the production landing, so a case can say both
 *  "the active tile is right" and "nothing wrote it". */
function makeStore() {
  const view = useViewState();
  const planSetActiveSilently = vi.fn((id: TerminalId | null) => {
    // Reader half in the compute, writes in the actor — the landing's own
    // contract, so the spy can stand in for it inside the hydration effect.
    const scope = activeScope();
    return () => {
      scope?.view.writeFocus(id === null ? null : { id, tileHint: id });
    };
  });
  const store = {
    ...view,
    listSub: Object.assign(() => w.keys()?.map((id) => ({ id })), {
      pending: () => w.keys() === undefined,
    }),
    // PARKED rows are listed but have no record — the restore card's rows, which
    // the empty-vs-restore decision must read as "no tiles" exactly as the
    // production store's parked filter does.
    terminalIds: () =>
      (w.keys() ?? []).filter((id) => w.records()[id] !== undefined),
    getMetadata: (id: TerminalId) => w.records()[id],
    recordPhases: () => ({
      awaited: 0,
      parked: 0,
      live: w.keys()?.length ?? 0,
    }),
    planSetActiveSilently,
  } as unknown as TerminalStore;
  return { store, planSetActiveSilently };
}

/** Build the graph inside a root, and hand the body's value and the root's
 *  `dispose` to a caller standing OUTSIDE it.
 *
 *  Every `flush()` a case makes runs out here, never in the root body. A flush
 *  inside the body would run the hydration effect with the ROOT as the current
 *  owner, and the latch's `markSeeded` — a plain signal write — would be graded
 *  a write inside an owned scope. Nothing in production flushes from an owner:
 *  a flush is the scheduler's, and the owner during an effect callback is
 *  `null`, so an in-root flush would be grading a harness artefact. */
function mountRoot<T>(build: () => T): [T, () => void] {
  let dispose!: () => void;
  const value = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return build();
  });
  return [value, dispose];
}

describe("the first active tile on a cold boot", () => {
  it("is the picked tile in the flush hydration runs in, with no seeding write", () => {
    // The whole census arrives at once — the list, both records, and the saved
    // session naming B. This is a browser reload: one frame, one answer.
    w.deliver({
      keys: [A, B],
      records: { [A]: tile(), [B]: tile() },
      session: { activeTerminalId: B },
    });

    // A consumer of the active tile, exactly like the app shell's and the
    // palette's: it records every value it is ever shown.
    const seen: (TerminalId | null)[] = [];
    const [{ planSetActiveSilently }, dispose] = mountRoot(() => {
      const made = makeStore();
      useSessionRestore({ store: made.store });
      createEffect(
        () => made.store.activeId(),
        (id) => {
          seen.push(id);
        },
      );
      return made;
    });

    flush();
    // The seeded shape shows up as ["…", null, B]: the consumer paints once
    // with no active tile, then the effect's write relays the census into it.
    expect(seen).toEqual([B]);
    // And it settles there — no second frame behind the first.
    flush();
    expect(seen).toEqual([B]);
    expect(planSetActiveSilently).not.toHaveBeenCalled();

    // The activation's SIDE effect that is not derivable still happens once:
    // the host hears which tile is active. The visit trail is NOT one of them
    // — the derived MRU already leads with the pick, so a cold boot writes
    // nothing to the durable trail.
    expect(spy.setActive.mock.calls).toEqual([[B]]);
    expect(localStorage.getItem("kolu-visit-recency")).toBeNull();
    expect(activeScope()?.view.mruOrder()).toEqual([B, A]);

    dispose();
  });

  it("yields to a tile the user picks, and the pick never comes back", () => {
    w.deliver({
      keys: [A, B],
      records: { [A]: tile(), [B]: tile() },
      session: { activeTerminalId: B },
    });

    const [store, dispose] = mountRoot(() => {
      const made = makeStore();
      useSessionRestore({ store: made.store });
      return made.store;
    });
    flush();
    expect(store.activeId()).toBe(B);

    // An ordinary activation — the user clicks A's tile. This body stands
    // outside the root, which is where a DOM handler's write runs.
    activeScope()?.view.writeFocus({ id: A, tileHint: A });
    flush();
    expect(store.activeId()).toBe(A);

    // A close-all clears the selection: an explicit "nothing is selected",
    // which the derivation must not undo while the tiles are still listed.
    activeScope()?.view.reset();
    flush();
    expect(store.activeId()).toBe(null);

    dispose();
  });
});

/** THE RESTORE WINDOW. A restore from the card re-spawns every parked row under
 *  its own id, and those rows come back as the host spawns them — so there are
 *  flushes in which the census is live, complete-looking, and MISSING the tile
 *  the host made active. A pick taken from such a flush names the wrong tile,
 *  and since the pick is answered once, it stays that tile: the camera centres
 *  on it (`TerminalCanvas` re-centres only while `activeId()` is null and a
 *  saved active is expected), and focus and the attention record follow it.
 *
 *  This drives the REAL path: the real `handleRestoreSession`, the real
 *  `session.restore` answer, the real latch, the real per-host view. */
describe("a restore from the card", () => {
  it("shows no tile until the answered one arrives, then only that tile", async () => {
    // A reboot: three PARKED rows (listed, no records — the restore card's rows)
    // and the saved session naming C as the active terminal.
    const blob = {
      activeTerminalId: C,
      terminals: [],
      resumableIds: [],
      savedAt: 1,
    };
    w.deliver({ keys: [A, B, C], records: {}, session: blob });
    // The host will answer the restore with C — the tile it made active.
    spy.restoreAnswer = C;

    // A consumer of the active tile, like the app shell's: it records every
    // value it is ever shown.
    const seen: (TerminalId | null)[] = [];
    const [{ store, planSetActiveSilently, session }, dispose] = mountRoot(
      () => {
        const made = makeStore();
        const session = useSessionRestore({ store: made.store });
        createEffect(
          () => made.store.activeId(),
          (id) => {
            seen.push(id);
          },
        );
        return { ...made, session };
      },
    );
    try {
      flush();
      expect(seen).toEqual([null]);
      expect(session.savedSession()).toEqual(blob);

      // The user clicks Restore — from this body, which stands outside the
      // root, exactly as a DOM handler's run does.
      await Effect.runPromise(session.handleRestoreSession({}));

      // The restored rows come back as the host spawns them: A and B are
      // live, C's row has not arrived yet. This is the flush a census-only
      // pick answers `topIds[0]` — A — in.
      w.deliver({
        keys: [A, B],
        records: { [A]: tile(), [B]: tile() },
        session: blob,
      });
      await new Promise((r) => setTimeout(r, 0));
      flush();
      // THE CAMERA'S INPUTS, asserted rather than the canvas itself: its
      // first-mount centring defers exactly while `activeId()` is null and
      // the saved session names an active terminal, and once it has centred
      // the viewport is no longer at default, so it never centres again.
      // Both inputs hold here, so the restore window is still deferring.
      const midRestore = {
        active: store.activeId(),
        savedActive: session.savedSession()?.activeTerminalId ?? null,
      };

      // C's row lands. The seed spends the host's answer.
      w.deliver({
        keys: [A, B, C],
        records: { [A]: tile(), [B]: tile(), [C]: tile() },
        session: blob,
      });
      await new Promise((r) => setTimeout(r, 0));
      flush();

      expect(midRestore).toEqual({ active: null, savedActive: C });
      // The active tile was NEVER a tile other than C: no wrong tile for
      // the camera to latch on, and the one value the consumer is shown
      // after `null` is C.
      expect(seen).toEqual([null, C]);
      expect(store.activeId()).toBe(C);
      // The seed's own write — the derivation does not cover a restore's
      // answered tile — and the host hears about C exactly once.
      expect(planSetActiveSilently.mock.calls).toEqual([[C]]);
      expect(spy.setActive.mock.calls).toEqual([[C]]);
    } finally {
      dispose();
    }
  });
});

/** THE TILE THE BOOT LANDED ON EXITS. Nothing has been clicked — the normal
 *  state after a cold boot — so the focus fact is still the derivation's. When
 *  that tile's row leaves the census, the eviction must still see it as the
 *  ACTIVE tile (`ports.activeId() === id`), or the auto-switch it gates — the
 *  pan to the survivor, the host's active-terminal report, the visit — never
 *  fires and the host keeps naming a dead terminal. A pick that re-answers from
 *  the shrunken census reads as the survivor and silences all three. */
describe("the booted tile exits", () => {
  it("is the active tile the eviction sees, so the auto-switch fires", () => {
    w.deliver({
      keys: [A, B],
      records: { [A]: tile(), [B]: tile() },
      session: { activeTerminalId: B },
    });

    const [store, dispose] = mountRoot(() => {
      const made = makeStore();
      useSessionRestore({ store: made.store });
      return made.store;
    });
    flush();
    expect(store.activeId()).toBe(B);
    expect(spy.setActive.mock.calls).toEqual([[B]]);

    // `exit` in B: its row leaves the census.
    w.deliver({
      keys: [A],
      records: { [A]: tile() },
      session: { activeTerminalId: B },
    });
    flush();

    // The list-driven reconcile plans the eviction over the pre-removal order.
    const panned: (TerminalId | null)[] = [];
    planEviction(evictionPorts(store, panned), B, null, [A, B], new Set([B]), {
      ids: [A, B],
      parentOf: (id) => (id === A || id === B ? null : undefined),
    })();
    flush();

    // The survivor took the slot: the canvas panned to it, the host was told,
    // and the visit trail puts it at the head.
    expect(panned).toEqual([A]);
    expect(spy.setActive.mock.calls).toEqual([[B], [A]]);
    expect(activeScope()?.view.mruOrder()[0]).toBe(A);
    expect(store.activeId()).toBe(A);

    dispose();
  });
});

/** The eviction's seams over the REAL per-host view: `activeId` is the fact
 *  under test, and `planActivate` is production's pan-and-activate — it records
 *  the pan target and performs the activation through the one focus write path.
 *  The rest are inert: this case is about the auto-switch, not the chrome. */
function evictionPorts(
  store: TerminalStore,
  panned: (TerminalId | null)[],
): TerminalEvictionPorts {
  return {
    activeId: () => store.activeId(),
    focusedTerminalId: () => store.focusedTerminalId(),
    takeAutoSwitch: () => activeScope()?.view.takeAutoSwitch(),
    noteAutoSwitch: (id: TerminalId) => {
      panned.push(id);
      runWithOwner(null, () => activeScope()?.view.noteAutoSwitch(id));
    },
    planActivate: (id: TerminalId | null) => () => {
      panned.push(id);
      runWithOwner(null, () => {
        activeScope()?.view.writeFocus(
          id === null ? null : { id, tileHint: id },
        );
      });
    },
    planDropFromMru: (id: TerminalId) => () => {
      activeScope()?.view.forgetFromMru(id);
    },
    planPromoteToTopLevel: () => () => {},
    rehomeUnder: () => {},
    subPanel: {
      planCollapsePanel: () => () => {},
      planCollapsePanelChrome: () => () => {},
      paneChrome: () => ({ activeSubTab: null }),
      setActiveSubTab: () => {},
      planSelectSubTab: () => () => {},
      requestRefocus: () => {},
      removePanel: () => {},
    },
    removeRightPanel: () => {},
    removeSearch: () => {},
  };
}
