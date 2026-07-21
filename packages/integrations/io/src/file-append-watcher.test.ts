/**
 * Unit matrix for `subscribeFileAppends` (juspay/kolu#1754).
 *
 * The point of the primitive is that the `fs.watchFile` FLOOR recovers a change
 * even when the `fs.watch` EDGE never fires. To test the floor in isolation we
 * shim `fs.watch` to a no-op that never delivers an edge (modeling the OS
 * dropping/coalescing it, exactly the #1754 failure), leaving the real
 * `fs.watchFile` to do the recovery. Timing uses a short REAL interval — never
 * fake timers, which cannot drive libuv's real stat (the ruling's Q2 note).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeFileAppends } from "./file-append-watcher.ts";

const INTERVAL = 80;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ~3 poll intervals — enough for the floor to observe a change. */
const settle = () => sleep(INTERVAL * 3 + 60);

let tmp: string;
let realWatch: typeof fs.watch;

/** Replace `fs.watch` with a no-op so the EDGE never fires — only the
 *  `fs.watchFile` floor can recover. Returns nothing; restored in afterEach. */
function suppressEdge(): void {
  realWatch = fs.watch;
  fs.watch = (() => ({
    close: () => {},
    on() {
      return this;
    },
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  })) as unknown as typeof fs.watch;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-append-watch-"));
  realWatch = fs.watch;
});

afterEach(() => {
  fs.watch = realWatch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("subscribeFileAppends — the floor recovers a dropped edge", () => {
  it("recovers an append when the fs.watch edge never fires (#1754 core)", async () => {
    suppressEdge();
    const file = path.join(tmp, "events.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });

    fs.appendFileSync(file, "b\n"); // the dropped-edge append
    await settle();

    expect(onChange).toHaveBeenCalled();
    unsub();
  });

  it("stays silent on an idle existing file (no churn — constraint 5)", async () => {
    suppressEdge();
    const file = path.join(tmp, "idle.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });

    await settle();

    expect(onChange).not.toHaveBeenCalled();
    unsub();
  });

  it("fires on appearance of a not-yet-existing file (Q7 unconditional / B4)", async () => {
    suppressEdge();
    const file = path.join(tmp, "late.jsonl"); // absent at subscribe
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });

    await settle();
    onChange.mockClear(); // ignore the initial absent observation
    fs.writeFileSync(file, "hello\n"); // the file appears
    await settle();

    expect(onChange).toHaveBeenCalled(); // the appearance reconcile
    unsub();
  });

  it("recovers an append that lands in the fs.watchFile startup-baseline window (#1754 F1)", async () => {
    suppressEdge();
    const file = path.join(tmp, "startup.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });
    // Append SYNCHRONOUSLY, before fs.watchFile's asynchronous first stat can
    // establish its comparison baseline — the losing ordering, where the floor
    // folds this write into its baseline and would never fire it. With the edge
    // suppressed, ONLY the startup reconciliation (at intervalMs) can recover
    // this, so a green assertion here proves it does.
    fs.appendFileSync(file, "b\n");
    await settle();

    expect(onChange).toHaveBeenCalled();
    unsub();
  });
});

describe("subscribeFileAppends — the edge fast path", () => {
  it("delivers via the edge well before the (long) poll interval", async () => {
    // Real fs.watch; a long floor interval so a prompt fire can only be the edge.
    const file = path.join(tmp, "fast.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: 5000,
      label: "test",
    });

    await sleep(30);
    fs.appendFileSync(file, "b\n");
    await sleep(400); // « 5000ms floor interval

    expect(onChange).toHaveBeenCalled();
    unsub();
  });
});

describe("subscribeFileAppends — teardown (B3)", () => {
  it("does not fire after an immediate unsubscribe", async () => {
    suppressEdge();
    const file = path.join(tmp, "torn.jsonl");
    fs.writeFileSync(file, "a\n");
    const log = makeLog();
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      log,
      label: "test",
    });

    fs.rmSync(file);
    unsub();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it("suppresses a late disambiguating stat that resolves AFTER unsubscribe (the real B3 race)", async () => {
    suppressEdge();
    // Hold the disambiguating fs.stat so its callback lands AFTER unsubscribe —
    // the exact in-flight-async-stat race the closed guard must survive.
    type StatCb = (err: NodeJS.ErrnoException | null) => void;
    const realStat = fs.stat;
    const held: { cb: StatCb | null } = { cb: null };
    fs.stat = ((_p: fs.PathLike, cb: StatCb) => {
      held.cb = cb;
    }) as unknown as typeof fs.stat;

    try {
      const file = path.join(tmp, "held.jsonl");
      fs.writeFileSync(file, "a\n");
      const log = makeLog();
      const onChange = vi.fn();
      const unsub = subscribeFileAppends(file, onChange, {
        intervalMs: INTERVAL,
        log,
        label: "test",
      });

      // Delete → the floor fires with zeroed stats → the listener launches the
      // (held) disambiguating fs.stat and emits the deletion transition once.
      fs.rmSync(file);
      await sleep(INTERVAL * 3 + 60);
      expect(held.cb).not.toBeNull(); // the async stat is genuinely in flight
      const onChangeAtTeardown = onChange.mock.calls.length;

      // Tear down WHILE the stat is in flight, then let it resolve with a hard
      // (non-ENOENT) errno — the closed guard must swallow both the late log and
      // any late onChange.
      unsub();
      held.cb?.({ code: "EACCES" } as NodeJS.ErrnoException);
      await sleep(60);

      expect(log.error).not.toHaveBeenCalled(); // closed guard beat the late stat
      expect(onChange.mock.calls.length).toBe(onChangeAtTeardown); // no post-teardown fire
    } finally {
      fs.stat = realStat;
    }
  });
});

describe("subscribeFileAppends — a deletion is expected-absent, not an error", () => {
  it("does not log an error when the file is deleted mid-session (ENOENT silent)", async () => {
    suppressEdge();
    const file = path.join(tmp, "gone.jsonl");
    fs.writeFileSync(file, "a\n");
    const log = makeLog();
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      log,
      label: "test",
    });

    fs.rmSync(file); // present → absent: a zeroed-stats fire, ENOENT on restat
    await settle();

    // The consumer is told to re-read (a real transition), but ENOENT is
    // expected-absent — no error log (caught-error-must-not-collapse still holds
    // for a REAL errno, which is probe-proven EACCES → zeroed stats → error).
    expect(onChange).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    unsub();
  });
});
