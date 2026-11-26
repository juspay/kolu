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

import type { TerminalInfo, TerminalMetadata } from "@kolu/padi-client/surface";
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
const w = vi.hoisted(() => ({
  keys: (() => undefined) as () => TerminalId[] | undefined,
  records: (() => ({})) as () => Record<string, TerminalMetadata>,
  session: (() => null) as () => { activeTerminalId: string | null } | null,
  sessionPending: () => false,
  /** Publish a census the way the socket does — detached, then observed. */
  deliver: (_census: {
    keys: TerminalId[];
    records: Record<string, TerminalMetadata>;
    session: { activeTerminalId: string | null } | null;
  }) => {},
  reset: () => {},
}));

const spy = vi.hoisted(() => ({ setActive: vi.fn() }));

vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    groundedActiveHost: mockGroundedActiveHost(() => LOCAL_HOST),
    activeHost: () => ({ kind: "local" }),
    activePadiRpc: { session: { restore: () => Effect.void } },
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
// folds focus through `placementOf`, and `createBootPick` reads the keys, the
// records and the session cell — those five reads are the whole surface here.
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
import type { TerminalStore } from "./useTerminalStore";

const A = "a0000000-0000-4000-8000-000000000001" as TerminalId;
const B = "b0000000-0000-4000-8000-000000000002" as TerminalId;

const tile = (): TerminalMetadata =>
  ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

// The census cells, now that `solid-js` has loaded: the wire double above reads
// them through the hoisted bag.
{
  const [keys, setKeys] = createSignal<TerminalId[] | undefined>(undefined);
  const [records, setRecords] = createSignal<Record<string, TerminalMetadata>>(
    {},
  );
  const [session, setSession] = createSignal<{
    activeTerminalId: string | null;
  } | null>(null);
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
    // DETACHED, so a seeded write shows up here as the FRAME it costs rather
    // than as the owned-scope write an effect's write also is: the subject is
    // what the consumer is shown, not how the runtime grades the write.
    const scope = activeScope();
    return () =>
      runWithOwner(null, () => {
        scope?.view.writeFocus(id === null ? null : { id, tileHint: id });
      });
  });
  const planReconcileLiveIds = vi.fn(view.planReconcileLiveIds);
  const store = {
    ...view,
    planReconcileLiveIds,
    listSub: Object.assign(() => w.keys()?.map((id) => ({ id })), {
      pending: () => w.keys() === undefined,
    }),
    terminalIds: () => w.keys() ?? [],
    getMetadata: (id: TerminalId) => w.records()[id],
    recordPhases: () => ({
      awaited: 0,
      parked: 0,
      live: w.keys()?.length ?? 0,
    }),
    planSetActiveSilently,
  } as unknown as TerminalStore;
  return { store, planSetActiveSilently, planReconcileLiveIds };
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

    createRoot((dispose) => {
      const { store, planSetActiveSilently, planReconcileLiveIds } =
        makeStore();
      useSessionRestore({ store });
      // A consumer of the active tile, exactly like the app shell's and the
      // palette's: it records every value it is ever shown.
      const seen: (TerminalId | null)[] = [];
      createEffect(
        () => store.activeId(),
        (id) => {
          seen.push(id);
        },
      );

      flush();
      // The seeded shape shows up as ["…", null, B]: the consumer paints once
      // with no active tile, then the effect's write relays the census into it.
      expect(seen).toEqual([B]);
      // And it settles there — no second frame behind the first.
      flush();
      expect(seen).toEqual([B]);
      expect(planSetActiveSilently).not.toHaveBeenCalled();

      // The activation's SIDE effects are not derivable and still happen once:
      // the host hears which tile is active, and the visit trail is seeded with
      // the pick at its head.
      expect(spy.setActive.mock.calls).toEqual([[B]]);
      expect(planReconcileLiveIds.mock.calls).toEqual([[[B, A]]]);
      expect(activeScope()?.view.mruOrder()).toEqual([B, A]);

      dispose();
    });
  });

  it("yields to a tile the user picks, and the pick never comes back", () => {
    w.deliver({
      keys: [A, B],
      records: { [A]: tile(), [B]: tile() },
      session: { activeTerminalId: B },
    });

    createRoot((dispose) => {
      const { store } = makeStore();
      useSessionRestore({ store });
      flush();
      expect(store.activeId()).toBe(B);

      // An ordinary activation — the user clicks A's tile. Detached, the way a
      // DOM handler's write is: a root body is an owned scope.
      runWithOwner(null, () => {
        activeScope()?.view.writeFocus({ id: A, tileHint: A });
      });
      flush();
      expect(store.activeId()).toBe(A);

      // A close-all clears the selection: an explicit "nothing is selected",
      // which the derivation must not undo while the tiles are still listed.
      runWithOwner(null, () => activeScope()?.view.reset());
      flush();
      expect(store.activeId()).toBe(null);

      dispose();
    });
  });
});
