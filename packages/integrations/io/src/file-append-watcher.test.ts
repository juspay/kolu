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
  it("does not fire after unsubscribe, even when a change races teardown", async () => {
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

    // Delete (would drive a zeroed-stats fire + disambiguating stat) then tear
    // down immediately — the closed guard must suppress both the onChange and
    // any late error log.
    fs.rmSync(file);
    unsub();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    // Idempotent unsubscribe never throws.
    expect(() => unsub()).not.toThrow();
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
