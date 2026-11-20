import type { SavedSession } from "@kolu/padi-client/surface";
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
  onSavedSessionWrite,
  unfreezeAutosave,
} from "./autosaveGate.ts";
import type { SessionSnapshot } from "./session.ts";

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const C_ID = "33333333-3333-4333-8333-333333333333";

const savedRecord = {
  id: A_ID,
  title: "t",
  cwd: "/tmp",
} as unknown as SessionSnapshot["terminals"][number];

const activeIdWrites: string[] = [];
let diskActiveId: string | undefined;
const SAVED_AT = 1_700_000_000_000;
const freshDiskBlob = (): SavedSession => ({
  terminals: [savedRecord],
  activeTerminalId: null,
  savedAt: SAVED_AT,
});
let diskBlob: SavedSession = freshDiskBlob();
const traceWrites: SessionSnapshot[] = [];
const finalWrites: SessionSnapshot[] = [];
let restorePending = false;

beforeAll(() => {
  initAutosaveGate({
    snapshot: () => ({
      terminals: [savedRecord],
      activeTerminalId: getActiveTerminalId(),
    }),
    isRestorePending: () => restorePending,
    orphanedParkedIds: () => [],
    persist: (s) => traceWrites.push(s),
    persistFinal: (s) => finalWrites.push(s),
    persistActiveId: (id) => {
      if (id === diskActiveId) return;
      diskActiveId = id;
      activeIdWrites.push(id);
      const previous = diskBlob;
      diskBlob = { ...previous, activeTerminalId: id };
      onSavedSessionWrite(previous, diskBlob);
    },
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  activeIdWrites.length = 0;
  diskActiveId = undefined;
  diskBlob = freshDiskBlob();
  traceWrites.length = 0;
  finalWrites.length = 0;
  restorePending = false;
  unfreezeAutosave();
  cancelPendingAutosave();
});

afterEach(() => {
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
    expect(seen).toEqual([]);

    notifyDirty();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);
    ac.abort();
  });

  it("a null report (client reconnect, no selection yet) persists nothing", () => {
    setActiveTerminalId(null);
    vi.advanceTimersByTime(60_000);
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
    expect(activeIdWrites).toEqual([]);

    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([C_ID]);
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
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(1_000);
    expect(activeIdWrites).toEqual([A_ID]);

    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(60_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("switching BACK to the written id after a pending change still costs one write", () => {
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([A_ID]);

    setActiveTerminalId(B_ID);
    setActiveTerminalId(A_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("REFUSES to stamp the marker while a restore is pending, and re-arms afterwards", () => {
    restorePending = true;
    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(5_000);
    expect(activeIdWrites).toEqual([]);

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
    expect(activeIdWrites).toEqual([]);
  });

  it("a trace save armed INSIDE the window survives the marker write", async () => {
    setActiveTerminalId(A_ID);
    await vi.advanceTimersByTimeAsync(4_800);
    notifyDirty();
    await vi.advanceTimersByTimeAsync(200);
    expect(activeIdWrites).toEqual([A_ID]);

    await vi.advanceTimersByTimeAsync(500);
    expect(traceWrites).toHaveLength(1);
  });

  it("re-asserting the written id reaches disk once, however often it is reported", async () => {
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

    setActiveTerminalId(B_ID);
    vi.advanceTimersByTime(1);
    expect(captureFinalSession("signal")).toEqual({ kind: "persist" });

    expect(finalWrites.map((s) => s.activeTerminalId)).toEqual([B_ID]);

    vi.advanceTimersByTime(60_000);
    expect(activeIdWrites).toEqual([A_ID]);
  });

  it("`snapshotSession` is the same live read the capture relies on", () => {
    setActiveTerminalId(C_ID);
    expect(snapshotSession().activeTerminalId).toBe(C_ID);
  });
});
