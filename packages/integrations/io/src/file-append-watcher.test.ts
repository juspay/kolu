/**
 * Unit matrix for `subscribeFileAppends` (juspay/kolu#1754).
 *
 * The point of the primitive is that the hand-rolled `statSync` FLOOR recovers a
 * change even when the `fs.watch` EDGE never fires. To test the floor in
 * isolation we shim `fs.watch` to a no-op that never delivers an edge (modeling
 * the OS dropping/coalescing it, exactly the #1754 failure), leaving the real
 * poll to do the recovery. Timing uses a short REAL interval — never fake
 * timers, which cannot drive the real `statSync`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeFileAppends } from "./file-append-watcher.ts";
import { suppressFsWatchEdges } from "./suppress-fs-watch.testlib.ts";

const INTERVAL = 80;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ~3 poll intervals — enough for the floor to observe a change. */
const settle = () => sleep(INTERVAL * 3 + 60);

let tmp: string;
let restoreWatch: (() => void) | null = null;

function suppressEdge(): void {
  restoreWatch = suppressFsWatchEdges();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-append-watch-"));
});

afterEach(() => {
  restoreWatch?.();
  restoreWatch = null;
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

    fs.writeFileSync(file, "hello\n"); // the file appears (absent→present)
    await settle();

    expect(onChange).toHaveBeenCalled(); // the appearance reconcile
    unsub();
  });

  it("recovers an append that lands in the attach→baseline window (#1754 F1)", async () => {
    suppressEdge();
    const file = path.join(tmp, "startup.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });
    // Append SYNCHRONOUSLY right after subscribe — the losing ordering that a
    // baseline captured on an async first stat (fs.watchFile) would fold in and
    // never fire. The hand-rolled floor captures its baseline SYNCHRONOUSLY at
    // subscribe, so this window does not exist and the poll recovers it.
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
  it("does not fire after unsubscribe, even with a change pending", async () => {
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

    // A change lands, then teardown races the very next poll tick — clearTimeout
    // + the closed guard must beat it, so nothing fires and nothing logs.
    fs.appendFileSync(file, "b\n");
    unsub();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow(); // idempotent
  });
});

describe("subscribeFileAppends — a deletion is expected-absent, not an error", () => {
  it("emits the deletion transition but logs no error (ENOENT stays silent)", async () => {
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

    fs.rmSync(file); // present → absent: statSync throws ENOENT → key becomes null
    await settle();

    // The poll sees the key move (present→absent) and emits so the consumer
    // re-reads; but ENOENT is expected-absent, so nothing is logged.
    expect(onChange).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    unsub();
  });

  it("logs a hard stat error (EACCES) but does NOT emit a false transition (F6)", async () => {
    // Root bypasses directory permissions, so EACCES can't be provoked there.
    if (process.getuid?.() === 0) return;
    suppressEdge();
    const subdir = path.join(tmp, "noaccess");
    fs.mkdirSync(subdir);
    const file = path.join(subdir, "f.jsonl");
    fs.writeFileSync(file, "a\n");
    const log = makeLog();
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      log,
      label: "test",
    });

    fs.chmodSync(subdir, 0o000); // now statSync(file) throws EACCES (no dir x-bit)
    await settle();
    fs.chmodSync(subdir, 0o755); // restore so afterEach cleanup succeeds
    await settle(); // let a recovery tick run too

    // The errno surfaces (never collapses to a silent "absent")...
    expect(log.error).toHaveBeenCalled();
    // ...but it must NOT read as a state change: an unreadable file is not
    // evidence the state moved, so the consumer is never told to re-derive it
    // (which through grok would flip a waiting tile to `thinking`). Nothing
    // changed across the whole window, so no emit at all.
    expect(onChange).not.toHaveBeenCalled();
    unsub();
  });
});

describe("subscribeFileAppends — reentrant unsubscribe (F7)", () => {
  it("does not re-arm the poll when onChange unsubscribes reentrantly", async () => {
    suppressEdge();
    const file = path.join(tmp, "reentrant.jsonl");
    fs.writeFileSync(file, "a\n");
    let unsub = (): void => {};
    let calls = 0;
    unsub = subscribeFileAppends(
      file,
      () => {
        calls++;
        unsub(); // reentrant teardown from inside the poll's emit
      },
      { intervalMs: INTERVAL, label: "test" },
    );

    fs.appendFileSync(file, "b\n"); // drives one poll emit → reentrant unsub
    await settle();
    fs.appendFileSync(file, "c\n"); // a further change must reach nothing
    await settle();

    // Exactly one emit; the running tick did not schedule another poll past the
    // reentrant unsubscribe, so the second append is never observed.
    expect(calls).toBe(1);
  });
});
