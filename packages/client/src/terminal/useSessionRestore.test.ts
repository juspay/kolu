import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, flush, runWithOwner } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isLoading` is a pure read over three reactive inputs: the terminal list's
// pending flag, the live terminal count, and the saved-session cell's pending
// flag. Drive those three through a plain hoisted bag and stub every module
// `useSessionRestore` pulls at import time so the hook loads under Node without
// a live socket, toast DOM, or the SSR-only `@solidjs/web` build.
const h = vi.hoisted(() => ({
  lifecycleKind: (() => "connected") as () => "connected" | "restarted",
  listPending: true,
  list: undefined as TerminalId[] | undefined,
  terminalIds: [] as TerminalId[],
  // How many listed terminals' records haven't composed yet — the `awaited` arm of
  // the metadata census the gate now reads instead of the session cell as a timing
  // proxy. Non-zero while a reload's live records are in flight.
  awaited: 0,
  sessionPending: true,
  savedSession: null as unknown,
  /** The saved-session cell's reactive version — read by the `activeWire` mock's
   *  accessor, bumped by {@link pushSavedSession}. Wired below the imports (the
   *  hoisted bag is built before `solid-js` is available); an inert stand-in
   *  until then, which is all the pre-mount assignments need. */
  sessionVersion: (() => 0) as () => number,
  /** PUSH a new saved-session snapshot the way the cell does — assign AND
   *  notify, so the hydration effect re-runs. Tests that only need a value
   *  BEFORE mount can still assign `h.savedSession` directly. */
  pushSavedSession: (_value: unknown) => {},
}));

// Spies for every RPC `handleRestoreSession` could conceivably fire. The W1.R6
// contract: restore issues ONLY `session.restore` — the former client respawn
// loop (`lifecycle.create` / `sendInput`) is DELETED, so those must stay at zero.
// (`lifecycle.restoreSleeping` was also part of that dead loop and is now retired
// from the padi surface entirely — see #1784's W12 disposition.)
const rpc = vi.hoisted(() => ({
  // `session.restore` ANSWERS with the active-terminal marker it settled on — the
  // seed's source of truth. `null` is the honest default for the tests that only
  // care that the call was made.
  restore: vi.fn(
    (): Effect.Effect<{ activeTerminalId: string | null }> =>
      Effect.succeed({ activeTerminalId: null }),
  ),
  import: vi.fn(() => Effect.void),
  forfeit: vi.fn(() => Effect.void),
  create: vi.fn(() => Effect.void),
  sendInput: vi.fn(() => Effect.void),
}));

// Spread the REAL (browser-safe) module so every schema kolu-common/surface pulls from
// here — e.g. `HostDaemonInventorySchema` — stays present; override only `activePadiRpc`.
// Keep the REAL (browser-safe) `@kolu/padi-client/surface` — its schemas
// (`HostDaemonInventorySchema`, …) must stay present; the RPC double moved to
// `../wire`'s `activePadiRpc` (production now calls `activePadiRpc.*`).
vi.mock("../wire", async () => {
  // W7: the restore latch is owned by the per-host `scopedByEntry` owner, which
  // reads `padiMap`. Stand up the shared mock map (single static local member —
  // these tests never switch hosts); `beforeEach` resets it so each test's latch
  // starts fresh.
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    // The GROUNDED accessor the per-host scope reads — the shared testlib composition,
    // pinned to the static local host (`beforeEach` adds LOCAL_HOST to membership).
    groundedActiveHost: mockGroundedActiveHost(() => LOCAL_HOST),
    activePadiRpc: {
      session: {
        restore: rpc.restore,
        import: rpc.import,
        forfeit: rpc.forfeit,
      },
      lifecycle: {
        create: rpc.create,
        sendInput: rpc.sendInput,
      },
    },
    // Per-host latch keying (shape B). These tests are single-host — a stable local
    // key keeps the latch behavior identical to the pre-per-host app-lifetime latch.
    activeHost: () => ({ kind: "local" }),
  };
});
// The saved-session facades moved OUT of `wire.ts` into `hostScope/activeWire` at W9
// (to break the `wire ↔ hostScopes` cycle); `useSessionRestore` imports them from there
// now. Drive them through the same hoisted bag.
vi.mock("../hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => h.sessionPending },
  // The saved-session CELL is a live subscription — a host PUSH must re-run the
  // hydration effect. Reading the version signal (created below, once the real
  // `solid-js` import has run) inside the accessor gives the hoisted bag that
  // reactivity, so a test can deliver the terminals and the session snapshot in
  // EITHER order and drive the real wire ordering.
  savedSession: () => {
    h.sessionVersion();
    return h.savedSession;
  },
}));
vi.mock("../rpc/rpc", () => ({
  lifecycle: () => ({ kind: h.lifecycleKind() }),
}));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedHistory: () => {} }),
}));
const subPanelSpy = vi.hoisted(() => ({ setActiveSubTab: vi.fn() }));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    paneChrome: () => ({ activeSubTab: null }),
    // No remembered sub pane in these fixtures: a landing lands on the tile.
    visiblePaneOf: (id: TerminalId) => id,
    setActiveSubTab: subPanelSpy.setActiveSubTab,
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: toastSpy.success,
    error: toastSpy.error,
    warning: () => {},
  }),
}));

import { addHost, resetHosts } from "../hostScope/mockHostMap.testlib";
import { activeScope } from "../hostScope/hostScopes";
import {
  ANSWERED_TILE_DEADLINE_MS,
  useSessionRestore,
} from "./useSessionRestore";
import type { TerminalStore } from "./useTerminalStore";

// Wire the saved-session cell's reactivity now that `solid-js` has loaded (the
// hoisted bag above is built before any import runs).
{
  const [version, bump] = createSignal(0);
  h.sessionVersion = version;
  h.pushSavedSession = (value: unknown) => {
    h.savedSession = value;
    // A host PUSH arrives from the socket, not from inside the app's reactive
    // owner: delivered detached, so a test that pushes while a root is being
    // built is not making an owned-scope write the real cell never makes.
    runWithOwner(null, () => {
      bump((n) => n + 1);
      // …and the frame that push provokes lands with it: Solid 2 stages the
      // write, and a consumer sees the new snapshot on the next flush.
      flush();
    });
  };
}

beforeEach(() => {
  h.lifecycleKind = () => "connected";
  // The restore latch is per-host owner state now: empty membership to DISPOSE
  // the prior test's local owner (and its latch), then re-add the single local
  // host these tests use — so each test's `decided`/`seeded` starts fresh.
  resetHosts();
  // The emptying must be OBSERVED for the owner to go: Solid 2 stages the
  // write, so without this flush the re-add below lands in the same frame and
  // membership never sees empty — the prior test's latch (its pinned
  // `restoredActive` box) would survive into this one.
  flush();
  addHost(LOCAL_HOST);
});

/** A `TerminalStore` whose `listSub`/`terminalIds` read the hoisted bag, so a
 *  test can flip a flag and call `isLoading()` to observe the gate directly. */
function makeStore(): TerminalStore {
  const listSub = Object.assign(() => h.list, { pending: () => h.listPending });
  return {
    listSub,
    terminalIds: () => h.terminalIds,
    recordPhases: () => ({ awaited: h.awaited, parked: 0, live: 0 }),
    getMetadata: () => undefined,
    setActiveSilently: () => {},
    planSetActiveSilently: () => () => {},
    activeId: () => null,
    planReconcileLiveIds: () => () => {},
    // These doubles pin the SEEDED path: the derivation never covers the pick,
    // so hydration writes the focus fact exactly as it always did.
    seedCovers: () => false,
  } as unknown as TerminalStore;
}

const mount = () => useSessionRestore({ store: makeStore() });

describe("useSessionRestore — isLoading gate (cold-launch restore race)", () => {
  it("keeps loading on an empty list until the saved-session cell reports", () => {
    createRoot((dispose) => {
      h.listPending = true;
      h.list = undefined;
      h.terminalIds = [];
      h.awaited = 0; // empty list → no records to await
      h.sessionPending = true;
      const session = mount();

      // Terminal list still pending → loading.
      expect(session.isLoading()).toBe(true);

      // List yields empty (terminals were killed on the previous shutdown) but
      // the session cell hasn't reported yet. The regression: this flipped to
      // NOT loading and rendered the bare empty state, hiding the restore card
      // until a full reload. The gate must stay loading here.
      h.listPending = false;
      h.list = [];
      h.terminalIds = [];
      expect(session.isLoading()).toBe(true);

      // Session cell reports → an honest empty-vs-restore decision can be made.
      h.sessionPending = false;
      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("holds loading while a reload's records are still awaited, even after the session cell resolves", () => {
    // The restore-card-flash fix at the gate level. On a browser reload the list
    // yields its ids and the session cell resolves, but the per-terminal records
    // haven't composed yet — `terminalIds()` is transiently 0 while `awaited` is
    // non-zero. The OLD gate keyed the wait on `savedSessionSub.pending()` (which
    // resolves first), so it dropped here and flashed the restore card. The census
    // term must hold loading until the records settle.
    createRoot((dispose) => {
      h.listPending = false;
      h.list = ["t1", "t2"] as TerminalId[];
      h.terminalIds = []; // records not composed yet
      h.awaited = 2; // ...both still in flight
      h.sessionPending = false; // session cell already resolved (the old trap)
      const session = mount();

      expect(session.isLoading()).toBe(true);

      // Records compose live → tiles appear, gate drops. No card was ever shown.
      h.terminalIds = ["t1" as TerminalId, "t2" as TerminalId];
      h.awaited = 0;
      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("does not wait on the session cell when terminals exist", () => {
    createRoot((dispose) => {
      h.listPending = false;
      h.list = ["t1"] as TerminalId[];
      h.terminalIds = ["t1" as TerminalId];
      h.sessionPending = true; // still in flight — must not delay the canvas
      const session = mount();

      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("shows the restore card at a reboot cold boot with PARKED entries in the list", async () => {
    // Regression (W1.R6): a no-survivor reboot seeds PARKED registry entries per
    // saved active — they DO appear in the raw list (they carry `info`) but are
    // off-canvas restore-card rows, so `terminalIds()` filters them out. The
    // empty-vs-restore decision must key on `terminalIds()`, NOT the raw list —
    // otherwise the parked entries read as "not empty" and the restore card
    // never appears after a real reboot with active terminals (the exact case
    // the card exists for).
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = ["p0"] as TerminalId[]; // parked entry in the raw list
            h.terminalIds = []; // ...excluded from the real (canvas) set
            h.awaited = 0; // parked record has ARRIVED (settled) — not awaited
            h.sessionPending = false;
            h.pushSavedSession({
              terminals: [
                {
                  id: "p0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "p0",
              savedAt: 1,
              resumableIds: [],
            });
            const session = mount();
            // Let the hydration effect flush so the decision runs.
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);
            dispose();
            resolve();
          } catch (e) {
            dispose();
            reject(e);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — restore fires ONLY session.restore (respawn loop deleted)", () => {
  it("issues session.restore with resume intent and ZERO lifecycle.* RPCs", async () => {
    rpc.restore.mockClear();
    rpc.create.mockClear();
    rpc.sendInput.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            // Empty canvas + a saved session on the cell → the restore card's
            // `savedSession` derives it.
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            h.pushSavedSession({
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: ["0"],
            });
            const session = mount();
            // Let the hydration effect flush so `savedSession()` is populated.
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(
              session.handleRestoreSession({
                resumeAgents: true,
                optOutIds: [],
              }),
            );

            // ONE server call — the whole restore. Intent, not a client id list.
            expect(rpc.restore).toHaveBeenCalledTimes(1);
            expect(rpc.restore).toHaveBeenCalledWith({
              resumeAgents: true,
              optOutIds: undefined,
            });
            // The deleted client respawn loop: zero of these fire.
            expect(rpc.create).not.toHaveBeenCalled();
            expect(rpc.sendInput).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });

  it("success toast reports 'Restored N terminals, resumed M agents' counts", async () => {
    // Pre-W1 wording restored (bare "Session restored" was a W1.R6 regression): N =
    // terminals restored, M = host-served resumable set minus opt-outs. Two saved
    // terminals, host stamps both resumable, one opted out → "Restored 2 terminals,
    // resumed 1 agent" (singular).
    toastSpy.success.mockClear();
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            const savedTerminal = (id: string) => ({
              id,
              state: "active" as const,
              cwd: `/${id}`,
              git: { kind: "none" },
              pr: { kind: "absent" as const },
              location: { kind: "local" as const },
              lastActivityAt: 0,
            });
            h.pushSavedSession({
              terminals: [savedTerminal("0"), savedTerminal("1")],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: ["0", "1"],
            });
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(
              session.handleRestoreSession({
                resumeAgents: true,
                optOutIds: ["1"],
              }),
            );

            expect(toastSpy.success).toHaveBeenCalledWith(
              "Restored 2 terminals, resumed 1 agent",
              expect.anything(),
            );

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — forfeit fires session.forfeit; the HOST dismisses the card", () => {
  it("issues session.forfeit({}) and keeps the card until the host pushes null", async () => {
    rpc.forfeit.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            // Empty canvas + a saved session on the cell → the restore card's
            // `savedSession` derives it, so the forfeit path has something to
            // discard.
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            const saved = {
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: [],
            };
            h.pushSavedSession(saved);
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(saved);

            await Effect.runPromise(session.handleForfeitSession());

            // ONE server call — the explicit discard — with the empty input the
            // contract declares.
            expect(rpc.forfeit).toHaveBeenCalledTimes(1);
            expect(rpc.forfeit).toHaveBeenCalledWith({});
            // NOTHING is cleared locally: `savedSession` is the host's cell, and
            // the card is dismissed by the `null` snapshot the forfeit writes.
            expect(session.savedSession()).toEqual(saved);
            expect(session.isForfeiting()).toBe(false);

            // The host's answer lands → the card drops.
            h.pushSavedSession(null);
            expect(session.savedSession()).toBeNull();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });

  it("gates a second forfeit while the first is in flight", async () => {
    rpc.forfeit.mockClear();
    const gate = Promise.withResolvers<void>();
    rpc.forfeit.mockImplementationOnce(
      () => Effect.promise(() => gate.promise) as never,
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            h.pushSavedSession({
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: [],
            });
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            const first = Effect.runPromise(session.handleForfeitSession());
            await new Promise((r) => setTimeout(r, 0));
            expect(session.isForfeiting()).toBe(true);
            // The card is still mounted and its buttons are gated while the write
            // is in flight — a second click is a no-op, not a second discard.
            await Effect.runPromise(session.handleForfeitSession());
            expect(rpc.forfeit).toHaveBeenCalledTimes(1);

            gate.resolve();
            await first;
            expect(session.isForfeiting()).toBe(false);

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — multi-terminal restore seeds the server-active tile", () => {
  // A 2-terminal restore where the server-active is the SECOND-listed terminal
  // (B), not the first (A). `hydrateFromTerminals` must prefer the server's
  // persisted active id, so B is activated + placed first in the MRU.
  //
  // This guards the server-active PREFERENCE with the full restored set present.
  // The incremental-list-delivery race (list arriving [A] then [A,B]) is
  // separately verified NOT to bite: the per-terminal metadata subscription opens
  // reactively off the list (`keys` in useTerminalMetadata), and all restore list
  // frames are published in ONE synchronous server tick (spawnPty is sync), so the
  // full `[A,B]` frame reaches the client before any terminal's metadata
  // round-trip completes — the "wait for all listed metadata" gate can never latch
  // on a partial set with the active id missing.
  function makeMetaStore(opts: {
    list: TerminalId[];
    meta: Record<string, TerminalMetadata>;
  }) {
    let active: string | null = null;
    const setActiveSilently = vi.fn((id: string | null) => {
      active = id;
    });
    const listSub = Object.assign(() => opts.list, { pending: () => false });
    const store = {
      listSub,
      terminalIds: () => opts.list,
      getMetadata: (id: TerminalId) => opts.meta[id],
      setActiveSilently,
      // The landing comes in a PAIR: the plan half is what the hydration
      // compute calls, and the spy fires when its actor RUNS.
      planSetActiveSilently: (id: string | null) => () => setActiveSilently(id),
      activeId: () => active,
      // This double has no view state behind it, so the derived boot pick never
      // covers the seed: every case below asserts the WRITE path.
      seedCovers: () => false,
    } as unknown as TerminalStore;
    return { store, setActiveSilently };
  }

  it("activates the server-active terminal (B), not the first-listed (A)", async () => {
    const activeMeta = (): TerminalMetadata =>
      ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;
    h.sessionPending = false;
    h.pushSavedSession({
      terminals: [],
      activeTerminalId: "B",
      savedAt: 1,
      resumableIds: [],
    });
    const { store, setActiveSilently } = makeMetaStore({
      list: ["A", "B"] as TerminalId[],
      meta: { A: activeMeta(), B: activeMeta() },
    });

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).toHaveBeenCalledWith("B");
            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — the restored active tile does NOT ride the session-cell echo", () => {
  // THE RACE (aarch64-darwin e2e "Restored multi-tile session preserves active
  // terminal", both retries): a restore delivers its result on TWO independently
  // timed channels. `restoreSession` spawns the terminals — publishing the
  // `terminals` collection — and only THEN calls `saveSession`, whose cell write
  // goes through padi's Conf (a synchronous DISK write) before the `session`
  // snapshot is published. On a loaded box that disk write can outlast the
  // client's per-terminal metadata round-trips, so the hydration effect sees the
  // restored set while still holding the blob it CONSUMED. Reading the active tile
  // off that blob instead of off the call's answer fell back to `topIds[0]` and
  // `markSeeded()` latched the wrong tile for the rest of the session: a lost
  // write, not a slow one, which is why the step failed for the full 20 s on every
  // attempt.
  //
  // The fix makes the ordering STRUCTURAL: `session.restore` ANSWERS with the
  // active terminal the host settled on, the hook pins that answer on the host's
  // latch, and the seed waits for the call to answer instead of racing the blob.
  //
  // A restore now re-spawns every terminal under its OWN id (padi's `restoreSpawn`
  // takes the saved id), so the consumed blob and the answer AGREE on which tile is
  // active — the old "the blob names a pre-restore id that no longer exists" arm is
  // gone from the host, and the ordering that is still observable (the answered
  // tile's row arriving after the answer) lives in the sibling describe below. What
  // this one pins is the seed itself: exactly ONE activation, on the tile the host
  // named rather than the first-listed one, and a later session push re-seeding
  // nothing.
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  /** The blob the user clicked Restore on — the same ids the restore brings back,
   *  with `activeTerminalId` naming the SECOND of them. */
  const consumedBlob = {
    terminals: [],
    activeTerminalId: "t-1",
    savedAt: 1,
    resumableIds: [],
  };

  it("seeds the host-reported active tile when the restored terminals beat the session push", async () => {
    h.listPending = false;
    h.sessionPending = false;
    h.pushSavedSession(consumedBlob);
    // The host answers with the id it made active — the saved marker, which is
    // the SECOND tile and comes back under that same id.
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const [list, setList] = createSignal<TerminalId[] | undefined>([]);
            const [meta, setMeta] = createSignal<
              Record<string, TerminalMetadata>
            >({});
            const setActiveSilently = vi.fn();
            const store = {
              listSub: Object.assign(() => list(), { pending: () => false }),
              terminalIds: () => list() ?? [],
              getMetadata: (id: TerminalId) => meta()[id],
              setActiveSilently,
              planSetActiveSilently: (id: string | null) => () =>
                setActiveSilently(id),
              activeId: () => null,
              // THE REAL derivation, not a `() => false` stand-in: this case
              // drives a restore, which is exactly the window the derived boot
              // pick must answer `null` through (`hostScope/createBootPick`), so
              // the pick belongs in this graph. It answers `null` here (the host
              // wire this per-host owner builds has no census behind it), which
              // is what makes the seed's own write the assertion below.
              seedCovers: (id: TerminalId) =>
                activeScope()?.view.seedCovers(id) ?? false,
            } as unknown as TerminalStore;

            // Empty canvas + a saved session → the restore card.
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(consumedBlob);
            // The per-host owner IS built here, so `seedCovers` above is the
            // real derivation and not a silently-floored `false`.
            expect(activeScope()).toBeDefined();

            // The user restores. The host re-spawns both tiles under their own
            // ids and publishes them; its `session` snapshot is still in flight
            // behind the disk write, so the cell keeps serving the CONSUMED blob.
            await Effect.runPromise(session.handleRestoreSession({}));
            setMeta({ "t-0": activeMeta(), "t-1": activeMeta() });
            setList(["t-0", "t-1"] as TerminalId[]);
            await new Promise((r) => setTimeout(r, 0));

            // The SECOND tile is active — the host said so. The `topIds[0]`
            // fallback (what the lost-write path took) would pick `t-0`.
            expect(setActiveSilently).toHaveBeenCalledWith("t-1");
            expect(setActiveSilently).not.toHaveBeenCalledWith("t-0");

            // The late session push is a no-op: the view is already seeded.
            setActiveSilently.mockClear();
            h.pushSavedSession({
              terminals: [],
              activeTerminalId: "t-1",
              savedAt: 2,
              resumableIds: [],
            });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — the seed WAITS for the answered tile to reach the list", () => {
  // The residual channel of the same race. Server-side the restore's collection
  // deltas are emitted BEFORE the answer, but client-side the unary answer's
  // continuation and the collection-delta application are independently scheduled
  // pipelines over one socket — under CPU contention the answer lands first. The
  // old seed then read a list holding only the FIRST restored tile, consumed the
  // answered id (naming the SECOND), failed the membership test in
  // `hydrateFromTerminals`, fell back to `topIds[0]` and `markSeeded()` the wrong
  // tile permanently — the 20 s e2e timeout on "the active canvas tile should
  // match the saved-session second tile". Red when reverted: the seed runs on the
  // partial list and activates `t-0`.
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  it("does not seed while the answered id is absent, then seeds it once its delta lands", async () => {
    h.listPending = false;
    h.sessionPending = false;
    h.pushSavedSession({
      terminals: [],
      activeTerminalId: "t-1",
      savedAt: 1,
      resumableIds: [],
    });
    // The host answers with the SECOND tile — restored under its own saved id,
    // whose collection delta has not been applied on this client yet.
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const [list, setList] = createSignal<TerminalId[] | undefined>([]);
            const [meta, setMeta] = createSignal<
              Record<string, TerminalMetadata>
            >({});
            const setActiveSilently = vi.fn();
            const store = {
              listSub: Object.assign(() => list(), { pending: () => false }),
              terminalIds: () => list() ?? [],
              getMetadata: (id: TerminalId) => meta()[id],
              setActiveSilently,
              planSetActiveSilently: (id: string | null) => () =>
                setActiveSilently(id),
              activeId: () => null,
              seedCovers: () => false,
            } as unknown as TerminalStore;

            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            await Effect.runPromise(session.handleRestoreSession({}));

            // (1) Only the FIRST restored tile's row + record have been applied.
            // The answered id is not in the list, so the seed must NOT run — and
            // must NOT consume the answer.
            setMeta({ "t-0": activeMeta() });
            setList(["t-0"] as TerminalId[]);
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

            // (2) The second tile's delta lands. The seed runs ONCE, on the tile
            // the host named.
            setMeta({ "t-0": activeMeta(), "t-1": activeMeta() });
            setList(["t-0", "t-1"] as TerminalId[]);
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-1");

            // Seeded is latched: a later session push re-seeds nothing.
            setActiveSilently.mockClear();
            h.pushSavedSession({
              terminals: [],
              activeTerminalId: "t-0",
              savedAt: 2,
              resumableIds: [],
            });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — that wait is BOUNDED (the answered tile never arrives)", () => {
  // The wait above defers on a reactive read, so a row that NEVER arrives defers
  // FOREVER: the old bug was the wrong tile, the unbounded wait's failure mode is
  // NO tile. Only a STALE answer can reach that state (the healthy path's delta is
  // already in-process when the answer's continuation runs; a reconnect replays a
  // fresh snapshot which either holds the id or proves it gone), so the deadline
  // seeds conservatively from the blob-fallback path and reports the anomaly.
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  /** The three reactive inputs the deadline arbitrates, plus the seed spy. */
  function deferringHarness() {
    const [list, setList] = createSignal<TerminalId[] | undefined>([]);
    const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
    const setActiveSilently = vi.fn();
    const store = {
      listSub: Object.assign(() => list(), { pending: () => false }),
      terminalIds: () => list() ?? [],
      getMetadata: (id: TerminalId) => meta()[id],
      setActiveSilently,
      planSetActiveSilently: (id: string | null) => () => setActiveSilently(id),
      activeId: () => null,
      seedCovers: () => false,
    } as unknown as TerminalStore;
    /** Deliver a restored tile's row AND its composed record together. */
    const deliver = (...ids: string[]) => {
      setMeta(Object.fromEntries(ids.map((id) => [id, activeMeta()])));
      setList(ids as TerminalId[]);
    };
    return { store, deliver, setActiveSilently };
  }

  /** The saved blob the restore consumed. The answered tile is the one record
   *  whose respawn FAILED and was re-parked, so it never reaches the list — and
   *  the blob names that same id (a restore keeps every id, so the two agree even
   *  when the terminal did not come back), which leaves the fallback path nothing
   *  live to name and lands it on `topIds[0]`. */
  const consumedBlob = {
    terminals: [],
    activeTerminalId: "t-1",
    savedAt: 1,
    resumableIds: [],
  };

  beforeEach(() => {
    toastSpy.error.mockClear();
    h.listPending = false;
    h.sessionPending = false;
    h.pushSavedSession(consumedBlob);
    // The host answers with a tile whose collection row this client must wait for.
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );
  });

  it("seeds via the blob fallback and reports, once the deadline passes with the answered id still absent", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, deliver, setActiveSilently } = deferringHarness();
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));

            // Real timers through the restore call itself — the deadline is armed
            // only once the seed defers, which is strictly after this resolves.
            await Effect.runPromise(session.handleRestoreSession({}));
            vi.useFakeTimers();

            // Only the FIRST restored tile ever lands. `t-1` is stale: the host
            // that answered no longer holds it.
            deliver("t-0");
            await vi.advanceTimersByTimeAsync(0);
            expect(setActiveSilently).not.toHaveBeenCalled();

            // The wait holds for the whole deadline — this is the existing
            // behavior, and the window a healthy delta lands in.
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS - 1);
            expect(setActiveSilently).not.toHaveBeenCalled();
            expect(toastSpy.error).not.toHaveBeenCalled();

            // The deadline fires: EXACTLY one seed, down the blob-fallback path —
            // the consumed blob's `t-1` is in no live set either, so `topIds[0]`.
            await vi.advanceTimersByTimeAsync(1);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-0");
            expect(toastSpy.error).toHaveBeenCalledTimes(1);
            expect(toastSpy.error.mock.calls[0]?.[0]).toContain("t-1");

            // Seeded is latched: a late arrival of the answered id changes nothing
            // (the box was consumed, so it cannot gate or seed a second time).
            deliver("t-0", "t-1");
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(toastSpy.error).toHaveBeenCalledTimes(1);

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          } finally {
            vi.useRealTimers();
          }
        })();
      });
    });
  });

  it("an arrival a tick before the deadline seeds the answered tile and DISARMS the timer", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, deliver, setActiveSilently } = deferringHarness();
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(session.handleRestoreSession({}));
            vi.useFakeTimers();

            deliver("t-0");
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS - 1);
            expect(setActiveSilently).not.toHaveBeenCalled();

            // The delta lands with one millisecond to spare — the ordinary path.
            deliver("t-0", "t-1");
            await vi.advanceTimersByTimeAsync(0);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-1");
            expect(toastSpy.error).not.toHaveBeenCalled();

            // No LATE fire: the seed disarmed the timer, so the deadline's instant
            // (and every instant after) reports nothing and re-seeds nothing.
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS * 2);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(toastSpy.error).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          } finally {
            vi.useRealTimers();
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — an in-session restore RE-SEEDS the view (viewSeeded reset)", () => {
  // FIX 2: `viewSeeded` latches true on the first live load so a reconnect doesn't
  // re-pan/re-seed. But an in-session `recycleKaval` restore (no page reload) tears
  // every tile off the canvas and spawns it a new shell, and IS a re-seed event:
  // the parent comes back under its own id but with nothing seeded for it on this
  // client, because the drain took its sub-panel state with it. Without the reset
  // in `handleRestoreSession`, the hydration effect short-circuits on the stale
  // latch, so a restored parent's active sub-tab is never set and its split comes
  // back HIDDEN. This drives the real sequence — live load (latch) → drain (empty,
  // restore card) → restore click (reset) → restored terminals arrive — and asserts
  // the restored parent's sub-tab IS seeded on the second hydration.
  // Red-when-reverted: without the reset, the second `setActiveSubTab(P, S)` never
  // fires.
  function reactiveStore() {
    const [list, setList] = createSignal<TerminalId[] | undefined>(undefined);
    const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
    let active: string | null = null;
    const listSub = Object.assign(() => list(), { pending: () => false });
    const store = {
      listSub,
      terminalIds: () =>
        (list() ?? []).filter((id) => !meta()[id]?.parentId),
      getMetadata: (id: TerminalId) => meta()[id],
      setActiveSilently: (id: string | null) => {
        active = id;
      },
      planSetActiveSilently: (id: string | null) => () => {
        active = id;
      },
      activeId: () => active,
      seedCovers: () => false,
    } as unknown as TerminalStore;
    return { store, setList, setMeta };
  }

  const splitMeta = (parentId?: string): TerminalMetadata =>
    ({ state: "active", parentId }) as unknown as TerminalMetadata;

  it("re-runs hydrateFromTerminals for the restored terminals (fresh parent gets its sub-tab)", async () => {
    subPanelSpy.setActiveSubTab.mockClear();
    h.sessionPending = false;
    h.pushSavedSession({
      terminals: [],
      activeTerminalId: "P0",
      savedAt: 1,
      resumableIds: [],
    });

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, setList, setMeta } = reactiveStore();
            // The hook is built INSIDE the owner; every delivery below happens
            // after an await, out of the root's synchronous scope — a write
            // made there is a write in an owned scope.
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));

            // 1) FIRST live load — a parent P0 with a split S0. viewSeeded latches.
            setMeta({ P0: splitMeta(), S0: splitMeta("P0") });
            setList(["P0", "S0"] as TerminalId[]);
            await new Promise((r) => setTimeout(r, 0));
            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P0" as TerminalId,
              "S0" as TerminalId,
            );

            // 2) The recycle drains the canvas → the re-fetch effect populates the
            // restore card's saved session (terminalIds is now empty).
            setMeta({});
            setList([]);
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            subPanelSpy.setActiveSubTab.mockClear();

            // 3) The user clicks Restore — `handleRestoreSession` resets the latch.
            await Effect.runPromise(session.handleRestoreSession({}));

            // 4) The restored terminals arrive — the SAME ids they were saved
            // under (padi's restore re-spawns each terminal on its own id). With
            // the latch reset, the hydration effect re-seeds the parent's sub-tab;
            // without it, this second pass never runs.
            setMeta({ P0: splitMeta(), S0: splitMeta("P0") });
            setList(["P0", "S0"] as TerminalId[]);
            await new Promise((r) => setTimeout(r, 0));

            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P0" as TerminalId,
              "S0" as TerminalId,
            );

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — savedSession is the host's cell, never a latched local answer", () => {
  it("adopts a LATER host push after a local action (the Restart-kaval regression)", async () => {
    // A local action must not latch the card away: after Start fresh, a later host
    // push (kaval restarted → parked rows offered) is still adopted. A latched
    // answer hides the offer, and with it the only thing that consumes those rows.
    rpc.forfeit.mockClear();
    h.listPending = false;
    h.list = [];
    h.terminalIds = [];
    h.sessionPending = false;
    const before = {
      terminals: [
        {
          id: "0",
          state: "active",
          cwd: "/before",
          git: { kind: "none" },
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 0,
        },
      ],
      activeTerminalId: "0",
      savedAt: 1,
      resumableIds: [],
    };
    const afterRestart = {
      terminals: [
        {
          id: "1",
          state: "active",
          cwd: "/parked-by-the-restart",
          git: { kind: "none" },
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 0,
        },
      ],
      activeTerminalId: null,
      savedAt: 2,
      resumableIds: [],
    };

    await createRoot(async (dispose) => {
      try {
        h.pushSavedSession(before);
        const session = mount();
        await new Promise((r) => setTimeout(r, 0));
        expect(session.savedSession()).toEqual(before);

        // A local action (Start fresh) — the host answers with its own null.
        await Effect.runPromise(session.handleForfeitSession());
        h.pushSavedSession(null);
        expect(session.savedSession()).toBeNull();

        // …then kaval restarts and padi offers the parked rows. The card must
        // come back: the answer is the host's cell, not a latch.
        h.pushSavedSession(afterRestart);
        expect(session.savedSession()).toEqual(afterRestart);
      } finally {
        dispose();
      }
    });
  });

  it("answers null on a restarted lifecycle, then the cell again once connected", async () => {
    const [kind, setKind] = createSignal<"connected" | "restarted">(
      "connected",
    );
    h.lifecycleKind = kind;
    h.listPending = false;
    h.list = [];
    h.terminalIds = [];
    h.sessionPending = false;
    const saved = {
      terminals: [],
      activeTerminalId: null,
      savedAt: 1,
      resumableIds: [],
    };

    await createRoot(async (dispose) => {
      try {
        h.pushSavedSession(saved);
        const session = mount();
        await new Promise((r) => setTimeout(r, 0));
        expect(session.savedSession()).toEqual(saved);
        // The dim overlay is the rescue UI on a genuine server restart — the
        // restore button must not compete.
        setKind("restarted");
        flush();
        expect(session.savedSession()).toBeNull();
        setKind("connected");
        flush();
        expect(session.savedSession()).toEqual(saved);
      } finally {
        dispose();
      }
    });
  });
});
