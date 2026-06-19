import v8 from "node:v8";
import type { Logger } from "@kolu/log";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { startHeapDiagnostics } from "./index.ts";

// `writeHeapSnapshot` would actually dump a multi-MB file and block the loop —
// stub it so the baseline-snapshot path is observable without side effects.
vi.mock("node:v8", () => ({
  default: { writeHeapSnapshot: vi.fn(() => "/stub.heapsnapshot") },
}));

const writeHeapSnapshot = v8.writeHeapSnapshot as unknown as Mock;

/** A logger that records every (msg, obj) pair, so a test can assert on the
 *  event-name contract (the whole point of the `logPrefix` split). */
function recordingLogger(): {
  log: Logger;
  events: Array<{ level: "info" | "error"; msg: string; obj: object }>;
} {
  const events: Array<{ level: "info" | "error"; msg: string; obj: object }> =
    [];
  const log: Logger = {
    debug: () => {},
    warn: () => {},
    info: (obj, msg) => events.push({ level: "info", msg, obj }),
    error: (obj, msg) => events.push({ level: "error", msg, obj }),
  };
  return { log, events };
}

const opts = (over: Partial<Parameters<typeof startHeapDiagnostics>[0]> = {}) =>
  ({
    log: recordingLogger().log,
    diagDir: "/tmp/diag",
    snapshotPrefix: "baseline",
    logPrefix: "diag",
    extraColumns: () => ({ terminals: 7 }),
    ...over,
  }) satisfies Parameters<typeof startHeapDiagnostics>[0];

describe("startHeapDiagnostics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeHeapSnapshot.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete process.env.KOLU_DIAG_DIR;
  });

  it("is a no-op when neither diagDir nor KOLU_DIAG_DIR is set", () => {
    const { log, events } = recordingLogger();
    delete process.env.KOLU_DIAG_DIR;
    startHeapDiagnostics({ ...opts(), log, diagDir: undefined });
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(events).toEqual([]);
    expect(writeHeapSnapshot).not.toHaveBeenCalled();
  });

  it("throws on a relative diagDir rather than writing to cwd silently", () => {
    const { log } = recordingLogger();
    // A relative dir would make path.join land the snapshot in the process cwd
    // — the wrong place, no error. Fail fast on the misconfiguration instead.
    expect(() =>
      startHeapDiagnostics({ ...opts(), log, diagDir: "relative/diag" }),
    ).toThrow(/absolute path/);
  });

  it("falls back to KOLU_DIAG_DIR when diagDir is omitted", () => {
    const { log, events } = recordingLogger();
    process.env.KOLU_DIAG_DIR = "/tmp/from-env";
    startHeapDiagnostics({ ...opts(), log, diagDir: undefined });
    expect(events.find((e) => e.msg === "diag_enabled")?.obj).toMatchObject({
      diagDir: "/tmp/from-env",
    });
  });

  it("emits the enabled line and an immediate T+0 sample under logPrefix", () => {
    const { log, events } = recordingLogger();
    startHeapDiagnostics({ ...opts(), log });
    expect(events[0]).toMatchObject({ level: "info", msg: "diag_enabled" });
    // T+0 anchor row uses logPrefix (not snapshotPrefix) and merges memory
    // bands + the host's extra columns.
    const anchor = events[1];
    expect(anchor).toBeDefined();
    expect(anchor?.msg).toBe("diag");
    expect(anchor?.obj).toMatchObject({ terminals: 7 });
    expect(anchor?.obj).toHaveProperty("rss");
    expect(anchor?.obj).toHaveProperty("heapUsed");
  });

  it("decouples the log event name (logPrefix) from the snapshot file (snapshotPrefix)", () => {
    const { log, events } = recordingLogger();
    // server-shaped: file basename "baseline", events stem "diag".
    startHeapDiagnostics({ ...opts(), log });
    const names = events.map((e) => e.msg);
    expect(names).toContain("diag_enabled");
    expect(names).toContain("diag");
    // The file basename must NOT leak into log event names.
    expect(names.some((n) => n.startsWith("baseline"))).toBe(false);
  });

  it("ticks the periodic curve under logPrefix every 5 min", () => {
    const { log, events } = recordingLogger();
    startHeapDiagnostics({ ...opts(), log });
    const curveCount = () => events.filter((e) => e.msg === "diag").length;
    expect(curveCount()).toBe(1); // T+0 anchor
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(curveCount()).toBe(2);
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(curveCount()).toBe(3);
  });

  it("writes one baseline snapshot at T+5min and logs <logPrefix>_baseline_snapshot_written", () => {
    const { log, events } = recordingLogger();
    startHeapDiagnostics({ ...opts(), log });
    expect(writeHeapSnapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(writeHeapSnapshot).toHaveBeenCalledTimes(1);
    // file basename comes from snapshotPrefix; the dir from diagDir.
    expect(writeHeapSnapshot).toHaveBeenCalledWith(
      "/tmp/diag/baseline.heapsnapshot",
    );
    expect(events.map((e) => e.msg)).toContain(
      "diag_baseline_snapshot_written",
    );
  });

  it("logs <logPrefix>_baseline_snapshot_failed at error level when the snapshot throws", () => {
    const { log, events } = recordingLogger();
    writeHeapSnapshot.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    startHeapDiagnostics({ ...opts(), log });
    vi.advanceTimersByTime(5 * 60 * 1000);
    const failure = events.find(
      (e) => e.msg === "diag_baseline_snapshot_failed",
    );
    expect(failure?.level).toBe("error");
    expect(failure?.obj).toHaveProperty("err");
  });

  it("honors a host-specific logPrefix (kaval) without changing the snapshot basename", () => {
    const { log, events } = recordingLogger();
    startHeapDiagnostics({
      ...opts(),
      log,
      snapshotPrefix: "kaval-baseline",
      logPrefix: "kaval_diag",
    });
    expect(events.map((e) => e.msg)).toContain("kaval_diag_enabled");
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(writeHeapSnapshot).toHaveBeenCalledWith(
      "/tmp/diag/kaval-baseline.heapsnapshot",
    );
    expect(events.map((e) => e.msg)).toContain(
      "kaval_diag_baseline_snapshot_written",
    );
  });
});
