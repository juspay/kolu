import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeFileAppends } from "./file-append-watcher.ts";
import { suppressFsWatchEdges } from "./suppress-fs-watch.testlib.ts";

const INTERVAL = 80;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

    fs.appendFileSync(file, "b\n");
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
    const file = path.join(tmp, "late.jsonl");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: INTERVAL,
      label: "test",
    });

    fs.writeFileSync(file, "hello\n");
    await settle();

    expect(onChange).toHaveBeenCalled();
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
    fs.appendFileSync(file, "b\n");
    await settle();

    expect(onChange).toHaveBeenCalled();
    unsub();
  });
});

describe("subscribeFileAppends — the edge fast path", () => {
  it("delivers via the edge well before the (long) poll interval", async () => {
    const file = path.join(tmp, "fast.jsonl");
    fs.writeFileSync(file, "a\n");
    const onChange = vi.fn();
    const unsub = subscribeFileAppends(file, onChange, {
      intervalMs: 5000,
      label: "test",
    });

    await sleep(30);
    fs.appendFileSync(file, "b\n");
    await sleep(400);

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

    fs.appendFileSync(file, "b\n");
    unsub();
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
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

    fs.rmSync(file);
    await settle();

    expect(onChange).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    unsub();
  });

  it("logs a hard stat error (EACCES) but does NOT emit a false transition (F6)", async () => {
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

    fs.chmodSync(subdir, 0o000);
    await settle();
    fs.chmodSync(subdir, 0o755);
    await settle();

    expect(log.error).toHaveBeenCalled();
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
        unsub();
      },
      { intervalMs: INTERVAL, label: "test" },
    );

    fs.appendFileSync(file, "b\n");
    await settle();
    fs.appendFileSync(file, "c\n");
    await settle();

    expect(calls).toBe(1);
  });
});
