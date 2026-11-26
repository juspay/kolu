/** The dock's unread marks are this browser's memory of what it announced and
 *  you have not opened — and a reload must not forget them. Each "page" below
 *  is a fresh module graph over the same `localStorage`, which is what a
 *  reload is. */

import { Effect } from "effect";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionRecord } from "../attention/savedAttention";
import type { HostViewState } from "./createViewState";

// Focusing reports the active terminal to the host; nothing here is about that.
vi.mock("../wire", () => ({
  padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
}));

// STATIC, unlike `loadPage`'s dynamic ones: a `resetModules` graph brings its
// OWN solid-js, whose diagnostics nothing is subscribed to. The derivation
// cases below are judged by `@kolu/solid-test-setup`, so they must run on the
// engine this worker installed.
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import {
  defaultSelectionIndex,
  filterAndRankPaletteItems,
} from "../palette/rootIndex";
import type { LivePlacement } from "../terminal/focusedTerminal";
import {
  useVisitRecency,
  VISIT_MRU_CAP,
  visitedAtOf,
  type VisitRecencyApi,
} from "../terminal/visitRecency";
import { createViewState } from "./createViewState";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B = "22222222-2222-4222-8222-222222222222" as TerminalId;
const C = "33333333-3333-4333-8333-333333333333" as TerminalId;
// Three warm strangers for the palette's Recent band, below.
const D = "44444444-4444-4444-8444-444444444444" as TerminalId;
const E = "55555555-5555-4555-8555-555555555555" as TerminalId;
const F = "66666666-6666-4666-8666-666666666666" as TerminalId;

/** Load the page: a fresh module graph, this host's view state in it, the
 *  host's attention record the engine raises marks on, and the visit trail
 *  that graph parsed out of `localStorage`. The dynamic imports after
 *  `resetModules` ARE the reload — static imports would share one in-memory
 *  record across every "page" (and Solid itself is part of the graph being
 *  reloaded, so its owner — and the `flush` that drains THAT graph's staged
 *  writes — must come from the same one).
 *
 *  `pick` is this page's boot pick and `tiles` its opening census; a case that
 *  is only about the unread marks passes neither. */
async function loadPage(
  opts: { pick?: TerminalId; tiles?: readonly TerminalId[] } = {},
): Promise<{
  view: HostViewState;
  marks: AttentionRecord;
  visits: VisitRecencyApi;
  setTiles: (ids: readonly TerminalId[]) => void;
  flush: () => void;
}> {
  vi.resetModules();
  const { createRoot, createSignal, flush } = await import("solid-js");
  const { createViewState } = await import("./createViewState");
  const { attentionRecordOf } = await import("../attention/savedAttention");
  const { useVisitRecency } = await import("../terminal/visitRecency");
  const [tiles, setTiles] = createSignal<readonly TerminalId[]>(
    opts.tiles ?? [],
  );
  return {
    view: createRoot(() =>
      createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => opts.pick ?? null,
        tiles,
        tiles,
      ),
    ),
    marks: attentionRecordOf(encodeHostKey(LOCAL_HOST)),
    visits: useVisitRecency(),
    setTiles,
    flush,
  };
}

// Load once at collection, before any test's clock starts: a worker's first
// import costs one round trip to vitest's main process per module, and while
// the suite is starting those add up to seconds. Each page then re-evaluates.
await loadPage();

describe("a host's unread marks across a reload", () => {
  beforeEach(() => localStorage.clear());

  it("a mark you had not opened is there again on the next page", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    // A write is staged: the mark is what the dock reads on the next flush.
    page.flush();
    expect(page.view.isUnread(A)).toBe(true);
    expect((await loadPage()).view.isUnread(A)).toBe(true);
  });

  it("opening the terminal takes the mark off for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.writeFocus({ id: A, tileHint: A });
    page.flush();
    expect(page.view.isUnread(A)).toBe(false);
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });

  it("closing every tile clears the marks for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.reset();
    page.flush();
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });
});

/** THE VIEW-STATE DERIVATIONS are value-stable by construction: the focus fact
 *  is two ids, this host's MRU is one cross-host trail narrowed to this host's
 *  census. Both are rebuilt from upstream state that moves for unrelated
 *  reasons, so without an equality gate they republish an equal value —
 *  Solid's `UNSTABLE_MEMO_OUTPUT`, which `@kolu/solid-test-setup` fails the
 *  test on. */
describe("a host's view-state derivations", () => {
  beforeEach(() => localStorage.clear());

  it("holds the focus fact still while the same boot pick is re-derived", () => {
    // `{ equals: false }` is the census: the pick is re-derived on every move,
    // and lands on the same tile.
    const [pick, setPick] = createSignal<TerminalId | null>(A, {
      equals: false,
    });
    let seen: TerminalId | null = null;
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        pick,
        () => [A],
        () => [A],
      );
      createEffect(view.focusedTerminalId, (id) => {
        seen = id;
      });
      return { dispose, view };
    });
    flush();
    for (let i = 0; i < 4; i++) {
      setPick(A);
      flush();
    }
    expect(seen).toBe(A);
    expect(held.view.activeId()).toBe(A);
    held.dispose();
  });

  it("answers the census with no write to the trail — the boot pick leading it", () => {
    // A host whose durable trail is empty: every id here is one the trail has
    // never seen, so the whole answer is a fold over the census.
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => B,
        () => [A, B, C],
        () => [A, B, C],
      );
      return { dispose, view, visits: useVisitRecency() };
    });
    flush();
    // The boot pick is the active tile, so it leads; the rest keep the
    // server's order.
    expect(held.view.mruOrder()).toEqual([B, A, C]);
    // And nothing was written to make that true: the trail records GESTURES,
    // and this boot was not one.
    expect(held.visits.visits()).toEqual([]);
    expect(localStorage.getItem("kolu-visit-recency")).toBeNull();
    // A real activation does write, and then leads the trail itself.
    held.view.writeFocus({ id: C, tileHint: C });
    flush();
    expect(held.view.mruOrder()).toEqual([C, A, B]);
    held.dispose();
  });

  it("holds this host's MRU still while another host's trail moves", () => {
    const other = { kind: "remote", target: "box-1" } as const;
    let seen: TerminalId[] = [];
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
        () => [A],
        () => [A],
      );
      createEffect(view.mruOrder, (ids) => {
        seen = ids;
      });
      return { dispose, visits: useVisitRecency() };
    });
    flush();
    // Four visits on ANOTHER host rewrite the one trail; this host's slice
    // comes back the same list every time.
    for (let i = 1; i <= 4; i++) {
      held.visits.noteVisit(other, A, { at: i });
      flush();
    }
    expect(seen).toEqual([A]);
    held.dispose();
  });

  it("drops a landing that re-states the pane already focused", () => {
    // The canvas's placement pass is an effect: its compute reads the census,
    // and its apply arm re-lands the active tile it just placed. A landing
    // mints a fresh `{ id, tileHint }` every time, so an ungated focus signal
    // turned that into a write RELAYED out of an effect that had just read the
    // census. `focus` carries `equals: sameFocus`, so `activeId` never re-ran
    // for it — the counter below says so with the gate and without it. What
    // bites is the activation's side effects, which the gate also drops: the
    // re-landing's `noteVisit` writes the trail from that apply arm, and
    // `mruOrder` — which read the same census — runs again for it. Solid
    // grades that `EFFECT_RELAY_TEAR`, `warn` on the third sighting, and
    // `@kolu/solid-test-setup` fails the test on it. The counter pins the
    // other half of the claim: the selection itself never moves.
    const [census, setCensus] = createSignal<TerminalId[]>([A, B], {
      equals: false,
    });
    let seen = 0;
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
        census,
        census,
      );
      // The placement pass, in miniature: the census in the compute, the
      // landing in the apply arm.
      createEffect(census, (live) => {
        view.writeFocus({ id: live[0]!, tileHint: live[0]! });
      });
      createEffect(view.activeId, () => {
        seen++;
      });
      return { dispose, view };
    });
    // The first landing, from out here where a real gesture makes it.
    held.view.writeFocus({ id: A, tileHint: A });
    flush();
    const settled = seen;
    for (let i = 0; i < 4; i++) {
      setCensus([A, B]);
      flush();
    }
    // The pane never moved, so no reader of the selection was ever told it did.
    expect(held.view.activeId()).toBe(A);
    expect(seen).toBe(settled);
    held.dispose();
  });

  it("hands the departed tile's slot to its survivor in the same flush", () => {
    // The removal reconcile used to write this answer from its apply arm, one
    // flush after the list its compute had read — so the canvas, the dock and
    // the palette each ran against the departed tile before the repair.
    // It is a function of the census and the pre-removal order, which this
    // fact keeps as its own memory, so it arrives with the census.
    const [census, setCensus] = createSignal<TerminalId[]>([A, B, C]);
    const held = createRoot((dispose) => ({
      dispose,
      view: createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
        census,
        census,
      ),
    }));
    held.view.writeFocus({ id: B, tileHint: B });
    flush();
    expect(held.view.activeId()).toBe(B);
    // B leaves. Its slot is the middle one, so C takes it — and the MRU leads
    // with the tile that is active now, with no write to the trail.
    setCensus([A, C]);
    flush();
    expect(held.view.activeId()).toBe(C);
    expect(held.view.mruOrder()).toEqual([C, A]);
    // The activation's imperative half is taken ONCE, by the reconcile — and
    // only by the eviction of the tile whose departure produced it. An
    // eviction of some other tile is not what this answer is about.
    expect(held.view.takeAutoSwitch(A)).toBeUndefined();
    expect(held.view.takeAutoSwitch(B)).toBe(C);
    expect(held.view.takeAutoSwitch(B)).toBeUndefined();
    // The last tile leaving clears the selection rather than naming a ghost.
    setCensus([]);
    flush();
    expect(held.view.activeId()).toBeNull();
    expect(held.view.takeAutoSwitch(C)).toBeNull();
    held.dispose();
  });

  it("needs no kill-time write — a dead id leaves the MRU with the census", () => {
    // The kill path used to write the trail (`forgetVisit`) from the eviction
    // effect's apply arm. It is dead weight now: the MRU is READ narrowed to
    // the host's live tiles, so a killed tile leaves it on the census move
    // that killed it. What it leaves BEHIND, in storage, is pruned by the
    // next activation on this host (the case below) — no write of its own.
    const [census, setCensus] = createSignal<TerminalId[]>([A, B]);
    const held = createRoot((dispose) => ({
      dispose,
      view: createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
        census,
        census,
      ),
      visits: useVisitRecency(),
    }));
    held.view.writeFocus({ id: B, tileHint: B });
    held.view.writeFocus({ id: A, tileHint: A });
    flush();
    expect(held.view.mruOrder()).toEqual([A, B]);
    // B is killed. Nobody prunes anything.
    setCensus([A]);
    flush();
    expect(held.view.mruOrder()).toEqual([A]);
    // The stored trail still remembers B — and that is invisible, which is
    // the point: the reading is the same as if it had been pruned, and B
    // comes back ranked where it was if its id ever returns.
    expect(held.visits.mruForHost(LOCAL_HOST)).toContain(B);
    setCensus([A, B]);
    flush();
    expect(held.view.mruOrder()).toEqual([A, B]);
    held.dispose();
  });

  it("keeps a live tile's stamp and its rank through fifty kills", () => {
    // The cap is 50 slots of HISTORY. A killed terminal's entry is the most
    // recent visit, so without a prune each kill holds a slot ahead of older
    // live ones and about fifty open-visit-kill cycles — the ordinary
    // agent-terminal rhythm, and the trail is `localStorage`, so it
    // accumulates across reloads — push every long-lived tile's stamp out.
    // A tile with no stamp is one Ctrl+Tab orders by the census, the palette
    // ranks at zero, and neither the no-query Enter target nor the Recent
    // band's reserved seat will have.
    const live = new Set<TerminalId>([A, B]);
    const [census, setCensus] = createSignal<TerminalId[]>([B, A]);
    const held = createRoot((dispose) => ({
      dispose,
      view: createViewState(
        LOCAL_HOST,
        (id): LivePlacement =>
          live.has(id) ? { kind: "top-level" } : { kind: "missing" },
        () => null,
        census,
        census,
      ),
      visits: useVisitRecency(),
    }));
    // The two long-lived tiles, visited once each and then left alone.
    held.view.writeFocus({ id: B, tileHint: B });
    held.view.writeFocus({ id: A, tileHint: A });
    flush();
    // Fifty scratch terminals: opened, visited, killed.
    for (let i = 0; i < VISIT_MRU_CAP; i++) {
      const scratch =
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as TerminalId;
      live.add(scratch);
      setCensus([B, A, scratch]);
      held.view.writeFocus({ id: scratch, tileHint: scratch });
      flush();
      live.delete(scratch);
      setCensus([B, A]);
      flush();
    }
    // Both tiles still carry the stamp their one visit wrote, in the order
    // they were visited in — the basis every ranking rule reads.
    const trail = held.visits.visits();
    const local = encodeHostKey(LOCAL_HOST);
    expect(visitedAtOf(trail, local, A)).toBeGreaterThan(0);
    expect(visitedAtOf(trail, local, B)).toBeGreaterThan(0);
    expect(visitedAtOf(trail, local, A)).toBeGreaterThan(
      visitedAtOf(trail, local, B),
    );
    expect(
      held.visits.mruForHost(LOCAL_HOST).filter((id) => live.has(id)),
    ).toEqual([A, B]);
    held.dispose();
  });

  it("keeps the saved trail of a host whose records have not arrived", () => {
    // THE FIRST CROSS-HOST PALETTE JUMP. A host scope is built lazily on first
    // activation, and `selectFleetTerminal` switches and activates in one
    // click — so this activation lands a daemon round trip before the host's
    // first record, and before its key list has answered at all. Every id the
    // trail remembers for this host reads `missing` in that window, which is
    // ALSO how a killed id reads: judged by records, the one activation would
    // erase this host's whole saved history from storage.
    // The static trail store outlives one case (`localStorage` is cleared,
    // the in-memory one is not), so this host starts from nothing.
    const visits = useVisitRecency();
    visits.clearHost(LOCAL_HOST);
    flush();
    visits.noteVisit(LOCAL_HOST, A, { at: 1 });
    visits.noteVisit(LOCAL_HOST, B, { at: 2 });
    flush();
    const held = createRoot((dispose) => ({
      dispose,
      view: createViewState(
        LOCAL_HOST,
        // No record has arrived for anything.
        () => ({ kind: "missing" }),
        () => null,
        // …so the tile census is empty, and the key list has said nothing.
        () => [],
        () => undefined,
      ),
    }));
    held.view.writeFocus({ id: C, tileHint: C });
    flush();
    // The clicked tile is stamped, and both saved entries are still there.
    expect(visits.mruForHost(LOCAL_HOST)).toEqual([C, B, A]);
    held.dispose();
  });

  it("prunes by the key list — the one fact a kill moves", () => {
    // Once the list HAS answered, an id it does not name is gone for real:
    // that is the kill the trail's slot cap depends on. A record arriving (or
    // not) never moves this answer.
    const visits = useVisitRecency();
    visits.clearHost(LOCAL_HOST);
    flush();
    visits.noteVisit(LOCAL_HOST, A, { at: 1 });
    visits.noteVisit(LOCAL_HOST, B, { at: 2 });
    flush();
    const [keys, setKeys] = createSignal<readonly TerminalId[] | undefined>([
      A,
      B,
      C,
    ]);
    const held = createRoot((dispose) => ({
      dispose,
      view: createViewState(
        LOCAL_HOST,
        () => ({ kind: "missing" }),
        () => null,
        () => [],
        keys,
      ),
    }));
    // A is killed: the host stops listing it.
    setKeys([B, C]);
    flush();
    held.view.writeFocus({ id: C, tileHint: C });
    flush();
    expect(visits.mruForHost(LOCAL_HOST)).toEqual([C, B]);
    held.dispose();
  });
});

/** A visit is what a tile becoming the ACTIVE tile leaves behind, and the two
 *  landings the derivation makes — the boot pick and the auto-switch — are
 *  activations like any other. In session nothing shows it: the derived MRU
 *  leads with the active tile whether or not the trail has heard of it. A
 *  reload is where the difference is the whole answer, because the trail is
 *  then the only memory this browser has of where it was. */
describe("the trail the next boot reads", () => {
  beforeEach(() => localStorage.clear());

  it("ranks the tile an auto-switch handed the slot to, a reload later", async () => {
    // PAGE ONE. A cold boot lands on A — an activation, so it leaves a visit
    // behind like any other.
    const page = await loadPage({ pick: A, tiles: [A, B, C] });
    page.view.noteSeededActivation(A);
    page.flush();
    expect(page.visits.mruForHost(LOCAL_HOST)).toEqual([A]);

    // The user clicks C; C then exits, and the derivation hands its slot to
    // B — a tile this browser has never been on — whose imperative half the
    // removal reconcile takes.
    page.view.writeFocus({ id: C, tileHint: C });
    page.flush();
    page.setTiles([A, B]);
    page.flush();
    expect(page.view.takeAutoSwitch(C)).toBe(B);
    page.view.noteAutoSwitch(B);
    page.flush();

    // Then the user clicks A — the one landing that was always a gesture.
    page.view.writeFocus({ id: A, tileHint: A });
    page.flush();

    // PAGE TWO: a reload, with A restored as the active tile. The trail came
    // back off the disk, and B — the tile the auto-switch had put you on
    // before you clicked A — is the one visit behind the live census.
    const next = await loadPage({ pick: A, tiles: [A, B] });
    const local = encodeHostKey(LOCAL_HOST);
    const stampOf = (id: TerminalId) =>
      visitedAtOf(next.visits.visits(), local, id);
    expect(stampOf(A)).toBeGreaterThan(stampOf(B));
    expect(stampOf(B)).toBeGreaterThan(0);

    // And that is what ⌘K ranks by. Three background agents have printed
    // since you left B, so all three outrank it on warmth and the band's cap
    // of three would drop it — the reserved seat is what keeps it, and the
    // highlight is what points at it. With no visit behind B both fall back
    // to warmth, and Enter lands on the chattiest stranger instead of where
    // you were.
    const printedAt = stampOf(A);
    const row = (id: TerminalId, recencyAt: number) => ({
      name: id,
      row: {
        kind: "terminal" as const,
        hostKey: local,
        terminalId: id,
        recencyAt,
        visitedAt: stampOf(id),
      },
    });
    const current = { hostKey: local, terminalId: A };
    const rows = [
      row(A, 0),
      row(D, printedAt + 3_000),
      row(E, printedAt + 2_000),
      row(F, printedAt + 1_000),
      // Silent since you left it: its only claim is your visit.
      row(B, 0),
    ];
    const shown = filterAndRankPaletteItems(rows, {
      query: "",
      atRoot: true,
      current,
    });
    expect(shown.map((item) => item.name)).toEqual([D, E, B]);
    expect(defaultSelectionIndex(shown, current, "")).toBe(2);
  });
});
