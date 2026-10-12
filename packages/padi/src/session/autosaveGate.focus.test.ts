/**
 * The FOCUS EDGE — `setActiveTerminalId` → the gate's own active-id debounce (#2286).
 *
 * The regression this file pins is a disk-write one, so it is worth stating in the
 * units it was measured in: focus used to pulse `terminals:dirty`, which armed the
 * 500 ms session-trace throttle, which rewrote EVERY terminal's record. On a
 * 16-terminal padi at a 2.5 s focus cadence that was 120 whole-session persists per
 * 5 min and `write_bytes` 0 → 253 KB/s, because conf amplifies an 11 KB
 * `config.json` ~57x (write-temp-then-rename plus the backup ring) — all of it to
 * change which ONE id a single field names.
 *
 * So the invariants here are: focus pulses NOTHING; the marker still reaches disk,
 * on its own ≥5 s trailing debounce and through an effect that touches only that
 * field; a burst collapses to ONE write; re-reporting a value the gate already
 * holds arms nothing at all; and a shutdown — the one moment the debounce would be
 * a real loss — records the LIVE focus regardless of the pending timer.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { notifyDirty, terminalsDirtyChannel } from "../publisher.ts";
import {
  getActiveTerminalId,
  setActiveTerminalId,
  snapshotSession,
} from "../terminals.ts";
import {
  cancelPendingAutosave,
  captureFinalSession,
  freezeAutosave,
  initAutosaveGate,
  unfreezeAutosave,
} from "./autosaveGate.ts";
import type { SessionSnapshot } from "./session.ts";

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const C_ID = "33333333-3333-4333-8333-333333333333";

/** One saved record, so the snapshot is never the EMPTY one (which the writers
 *  treat as "the user closed everything" — a different code path entirely). */
const savedRecord = {
  id: A_ID,
  title: "t",
  cwd: "/tmp",
} as unknown as SessionSnapshot["terminals"][number];

const activeIdWrites: string[] = [];
/** The marker the modelled blob currently holds — see `persistActiveId` below. */
let diskActiveId: string | undefined;
const traceWrites: SessionSnapshot[] = [];
const finalWrites: SessionSnapshot[] = [];
let restorePending = false;

// Wired ONCE for the file: `initAutosaveGate` starts a `terminals:dirty`
// subscription that lives for the module's lifetime, so re-wiring per test would
// pile up subscribers that all answer the same pulse.
beforeAll(() => {
  initAutosaveGate({
    // The LIVE marker, exactly as `snapshotSession` reads it — that identity is
    // what makes the shutdown edge immune to the debounce window.
    snapshot: () => ({
      terminals: [savedRecord],
      activeTerminalId: getActiveTerminalId(),
    }),
    isRestorePending: () => restorePending,
    persist: (s) => traceWrites.push(s),
    persistFinal: (s) => finalWrites.push(s),
    // Models `saveActiveTerminalId` rather than recording the call: the real
    // writer compares the marker ON THE RECORD and returns before `writeSession`
    // when it is unchanged, so `activeIdWrites` is what reached DISK — which is
    // the property #2286 is about, and the only one worth asserting here. The
    // write then runs the REAL hook the padi `session` cell installs
    // (`servePadi.ts`'s `onWrite: () => cancelPendingAutosave()`); a stub that
    // skipped it proved nothing about a marker patch not disarming an armed
    // trace save.
    persistActiveId: (id) => {
      if (id === diskActiveId) return;
      diskActiveId = id;
      activeIdWrites.push(id);
      cancelPendingAutosave();
    },
  });
});

// Time is DRIVEN, never waited on: every assertion here is about where a 5 s
// window falls, and a real sleep would both slow the file and turn an exact
// boundary ("4999 ms: nothing yet") into a guess. The `…Async` advances are where
// the `terminals:dirty` subscription has to run, so its microtasks flush too.
beforeEach(() => {
  vi.useFakeTimers();
  activeIdWrites.length = 0;
  diskActiveId = undefined;
  traceWrites.length = 0;
  finalWrites.length = 0;
  restorePending = false;
  unfreezeAutosave();
  // Also clears the gate's belief about the marker on disk, so each case starts
  // from "nothing known", not from the previous case's last write.
  cancelPendingAutosave();
});

afterEach(() => {
  // Disarm before handing the clock back: a timer armed under fake time would
  // otherwise be left for the next file's real clock to fire.
  cancelPendingAutosave();
  vi.useRealTimers();
});

describe("focus is not a session-trace dirty source", () => {
  it("emits NO `terminals:dirty` pulse — and the probe proves itself on a real dirty source", async () => {
    const seen: unknown[] = [];
    const ac = new AbortController();
    void (async () => {
      for await (const e of terminalsDirtyChannel.subscribe(ac.signal))
        seen.push(e);
    })();
    await vi.advanceTimersByTimeAsync(0);

    setActiveTerminalId(A_ID);
    setActiveTerminalId(B_ID);
    setActiveTerminalId(C_ID);
    await vi.advanceTimersByTimeAsync(0);
    // Three focus changes, zero pulses: the 500 ms trace throttle is never armed,
    // so no terminal's record is re-serialised.
    expect(seen).toEqual([]);

    // The probe is live — a genuine restore-relevant change still pulses, so the
    // assertion above is about focus, not about a subscription that never ran.
    notifyDirty();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);
    ac.abort();
  });

  it("a null report (client reconnect, no selection yet) persists nothing", () => {
    setActiveTerminalId(null);
    vi.advanceTimersByTime(60_000);
    // Erasing the marker would cost the next boot its centred tile, and a
    // reconnecting client has no opinion about focus to erase it WITH.
    expect(activeIdWrites).toEqual([]);
    expect(getActiveTerminalId()).toBeNull();
  });
});

describe("the active-id trailing debounce", () => {
  it("a BURST of focus changes produces exactly ONE write, of the LAST id", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(2_000);
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(2_000);
    setActiveTerminalId(C_ID);
    // Trailing: 4 s of switching has written nothing, because nobody restores to
    // a terminal the user already switched away from.
    expect(activeIdWrites).toEqual([]);

    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([C_ID]);
    // …and never through the session-trace writer.
    expect(traceWrites).toEqual([]);
  });

  it("does not write before the 5 s window closes", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(4_999);
    expect(activeIdWrites).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("a repeated report of the SAME id re-arms NOTHING", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(4_000);
    // The client re-asserts focus on reconnect and on every switcher re-render.
    // If that re-armed, a chatty client would hold the write off forever.
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(1_000);
    expect(activeIdWrites).toEqual([A_ID]);

    // And once written, the same id is inert — no second write, ever.
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(60_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("switching BACK to the written id after a pending change still costs one write", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([A_ID]);

    setActiveTerminalId(B_ID);
    setActiveTerminalId(A_ID); // changed its mind inside the window
    vi.advanceTimersByTime(5_000);
    // One timer fires, carrying the LAST id — which is the one already on the
    // record, so the writer elides it. The user never left A; the disk never
    // learns that B was briefly focused.
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("REFUSES to stamp the marker while a restore is pending, and re-arms afterwards", () => {
    restorePending = true;
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(5_000);
    // Parked entries stand in for the blob; the live focus names the half-built
    // set, not the session on disk.
    expect(activeIdWrites).toEqual([]);

    // The suppressed id was NOT recorded as written, so the next report of it is
    // not swallowed by the equality guard.
    restorePending = false;
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([B_ID]);
  });

  it("REFUSES to stamp the marker while a freeze lease is held", () => {
    const lease = freezeAutosave("restart capture");
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([]);
    unfreezeAutosave(lease);
  });

  it("`cancelPendingAutosave` disarms the pending write — the process-exit path", () => {
    setActiveTerminalId(B_ID);
    cancelPendingAutosave();
    vi.advanceTimersByTime(60_000);
    // A pending write patches whatever blob is on disk at FIRE time, so every
    // caller that is about to replace the blob (restore, restart capture,
    // `test__set`) must be able to drop it.
    expect(activeIdWrites).toEqual([]);
  });

  it("a trace save armed INSIDE the window survives the marker write", async () => {
    // The #2286 review's B1. The marker patch goes through the padi `session`
    // cell, whose `onWrite` cancels pending autosaves — a hook that is right
    // about every writer that REPLACES the blob and wrong about this one, which
    // rewrites a single field and leaves the trace alone. Unfenced, a layout
    // change made moments before the focus write was silently dropped.
    setActiveTerminalId(A_ID);
    await vi.advanceTimersByTimeAsync(4_800);
    notifyDirty(); // a real restore-relevant change: arms the 500 ms trace save
    await vi.advanceTimersByTimeAsync(200); // t+5 s — the marker write fires here
    expect(activeIdWrites).toEqual([A_ID]);

    await vi.advanceTimersByTimeAsync(500);
    expect(traceWrites).toHaveLength(1);
  });

  it("re-asserting the written id reaches disk once, however often it is reported", async () => {
    // The client re-reports focus on reconnect, on every switcher re-render and
    // after each restore convergence. What must not grow is DISK traffic, which
    // is #2286's whole subject — the dedup lives in `saveActiveTerminalId`,
    // against the record, and this models it.
    setActiveTerminalId(A_ID);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(activeIdWrites).toEqual([A_ID]);

    for (let i = 0; i < 5; i += 1) setActiveTerminalId(A_ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });
});

describe("the shutdown edge still records focus", () => {
  it("a capture immediately after a focus change carries the NEW id", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([A_ID]);

    // Focus moves and padi is signalled 1 ms later — four seconds inside the
    // debounce window, with the timer still armed.
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(1);
    expect(captureFinalSession("signal")).toEqual({ kind: "persist" });

    // The final blob carries the LIVE marker, because the snapshot reads it off
    // the registry rather than waiting for the debounce.
    expect(finalWrites.map((s) => s.activeTerminalId)).toEqual([B_ID]);

    // …and the capture disarmed the pending write, so nothing lands mid-teardown.
    vi.advanceTimersByTime(60_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("`snapshotSession` is the same live read the capture relies on", () => {
    setActiveTerminalId(C_ID);
    expect(snapshotSession().activeTerminalId).toBe(C_ID);
  });
});
