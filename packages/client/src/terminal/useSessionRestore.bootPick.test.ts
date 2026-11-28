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
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  createEffect,
  createMemo,
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
    // The parent edge of every record that has ARRIVED, in census order —
    // what the boot pick reads instead of walking the records itself.
    tileParents: () =>
      new Map(
        (w.keys() ?? []).flatMap((id) => {
          const record = w.records()[id];
          return record === undefined
            ? []
            : [[id, record.parentId ?? null] as const];
        }),
      ),
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
import { useVisitRecency } from "./visitRecency";
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
    listSub: Object.assign(() => w.keys(), {
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
    // The seeded shape shows up as ["…", null, B]: the consumer runs once
    // with no active tile, then the effect's write relays the census into it.
    expect(seen).toEqual([B]);
    // And it settles there — no second value behind the first.
    flush();
    expect(seen).toEqual([B]);
    expect(planSetActiveSilently).not.toHaveBeenCalled();

    // The activation's SIDE effects, which are not derivable, happen ONCE
    // each: the host hears which tile is active, and the trail records the
    // tile this boot landed on. The in-session MRU would lead with the pick
    // either way; the stamp is for the NEXT boot, where it is the only
    // memory of where this browser was — what the palette's no-query Enter
    // and the Recent band's reserved seat rank by.
    expect(spy.setActive.mock.calls).toEqual([[B]]);
    expect(
      JSON.parse(localStorage.getItem("kolu-visit-recency") ?? "[]"),
    ).toEqual([
      { hostKey: "local", terminalId: B, visitedAt: expect.any(Number) },
    ]);
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
    takeAutoSwitch: (from: TerminalId) =>
      activeScope()?.view.takeAutoSwitch(from),
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

/** THE VISIT A DERIVED LANDING RECORDS, UNDER THE JUDGE.
 *
 *  The boot pick's seed and an auto-switch are both performed from an effect's
 *  APPLY ARM — hydration's and the removal reconcile's — and both record a
 *  visit, because becoming the active tile is what the trail records. That
 *  trail is read by this host's `mruOrder`, by the command palette's two
 *  biggest memos (`commands.tsx`'s rows and `CommandPalette`'s `partitioned`)
 *  and by the WebGL budget, every one of which reads the TERMINAL CENSUS too —
 *  the same census those arms' computes had just read. Written from the arm,
 *  the visit re-runs all of them inside that effect's frame:
 *  `EFFECT_RELAY_TEAR`, advisory on the first sighting and `warn` from the
 *  third against the same (effect, signal), which is why the auto-switch case
 *  below drives five from ONE effect.
 *
 *  The victim is shaped like those readers and nothing else: one memo over the
 *  census AND the trail, counting its own runs. So each case says both halves
 *  — the judge saw nothing, and the reader ran once per change rather than
 *  twice. */
describe("the visit a derived landing records", () => {
  const tiles = Array.from(
    { length: 6 },
    (_, i) =>
      `0000000${i}-0000-4000-8000-00000000000${i}` as unknown as TerminalId,
  );
  const census = (live: readonly TerminalId[]) => ({
    keys: [...live],
    records: Object.fromEntries(live.map((id) => [id, tile()])),
  });

  /** The palette's shape: the census and the trail in one derivation. A
   *  scalar, so an equal answer publishes nothing and the count is the
   *  reader's own work. */
  function censusAndTrailReader(store: TerminalStore, bump: () => void): void {
    const reader = createMemo(
      () => {
        bump();
        return `${store.terminalIds().length}:${useVisitRecency().visits().length}`;
      },
      { name: "censusAndTrail" },
    );
    createEffect(reader, () => {});
  }

  const raised = () =>
    takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

  it("stamps the boot pick on five cold boots with no tear on that reader", () => {
    let runs = 0;
    for (const pick of tiles.slice(0, 5)) {
      // A fresh page: no census, then a new per-host owner and a new latch.
      // The order matters — a scope born beside the PREVIOUS boot's census
      // would answer that boot's pick, since the pick is answered once.
      w.reset();
      resetHosts();
      flush();
      addHost(LOCAL_HOST);
      flush();
      // A reboot: the rows are LISTED first and their records land a flush
      // later, which is how a real one arrives (and the only shape in which
      // the seed can relay: a seed inside the create flush is initial sync,
      // which the judge does not grade). The trail is `localStorage`, so it
      // carries over exactly as it does between real boots.
      const saved = { activeTerminalId: pick };
      w.deliver({ keys: [...tiles], records: {}, session: saved });
      const [made, dispose] = mountRoot(() => {
        const built = makeStore();
        useSessionRestore({ store: built.store });
        censusAndTrailReader(built.store, () => {
          runs++;
        });
        return built;
      });
      try {
        flush();
        const before = runs;
        // The records arrive: the pick is answered and hydration seeds, in
        // this flush and out of its arm's frame.
        w.deliver({ ...census(tiles), session: saved });
        flush();
        expect(made.store.activeId()).toBe(pick);
        // The seed is the DERIVATION'S — the pick already stands, so the only
        // writes are its side effects. (A landing written through the
        // ordinary focus path is the restore case above.)
        expect(made.planSetActiveSilently).not.toHaveBeenCalled();
        expect(useVisitRecency().mruForHost(LOCAL_HOST)[0]).toBe(pick);
        // Woken by the census, and again by the seed's visit — never twice
        // for the census alone.
        expect(runs - before).toBe(2);
      } finally {
        dispose();
      }
    }
    expect(raised()).toEqual([]);
  });

  it("stamps five auto-switches from one effect's apply arm, likewise", () => {
    // The removal reconcile in miniature, and the part that matters is its
    // SHAPE: the census in the compute, the auto-switch's imperative half in
    // the apply arm. Five departures through one effect is five sightings of
    // the same (effect, signal) pair — the key the judge escalates on.
    const saved = { activeTerminalId: tiles[0]! };
    w.deliver({ ...census(tiles), session: saved });
    let runs = 0;
    const landed: TerminalId[] = [];
    const [, dispose] = mountRoot(() => {
      const made = makeStore();
      useSessionRestore({ store: made.store });
      censusAndTrailReader(made.store, () => {
        runs++;
      });
      createEffect(
        () => made.store.terminalIds(),
        (live) => {
          const survivor = live.at(-1);
          if (survivor === undefined || landed.at(-1) === survivor) return;
          landed.push(survivor);
          made.store.noteAutoSwitch(survivor);
        },
      );
      return made.store;
    });
    try {
      flush();
      const before = runs;
      const live = [...tiles];
      for (let i = 0; i < 5; i++) {
        live.pop();
        // The SAME saved blob every time: a cell that reconciles in place is
        // what the app has, and a fresh equal object would publish a new
        // reference for the session memo on every delivery.
        w.deliver({ ...census(live), session: saved });
        flush();
      }
      // Each departure handed the slot to the last survivor, and each landing
      // left its stamp. The trail keeps only what is live: every tile but the
      // first died, and each visit prunes the host's dead ids.
      expect(landed).toEqual([...tiles].reverse());
      expect(useVisitRecency().mruForHost(LOCAL_HOST)).toEqual([tiles[0]]);
      expect(spy.setActive.mock.calls.at(-1)).toEqual([tiles[0]]);
      // One census move plus one visit per departure — never a third run for
      // a tile that had already landed.
      expect(runs - before).toBe(10);
      expect(raised()).toEqual([]);
    } finally {
      dispose();
    }
  });
});
