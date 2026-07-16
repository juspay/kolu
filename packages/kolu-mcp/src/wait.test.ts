/**
 * `awaitOutputSettled` — the MCP face's idle done-signal over padiSurface,
 * driven through a fake snapshot-then-delta client (the same harness shape
 * padi-tui's read.test uses). Pins the outcome matrix: idle-met, gone via the
 * exit event, gone via feed-end + absent key, closed via feed-end + present
 * key (loud, never a false met), and timeout. Plus the tool's JSON frame.
 */
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { describe, expect, it } from "vitest";
import { awaitOutputSettled, waitJson, waitOutputSettledTool } from "./wait.ts";

type AttachFrame =
  | { kind: "snapshot"; data: string; topLine: number }
  | { kind: "delta"; data: string };

/** A pushable stream: subscribers replay queued frames, wait for more, end on
 *  `end()` or signal abort. */
class FakeStream<T> {
  private readonly frames: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  push(v: T): void {
    this.frames.push(v);
    this.wake();
  }
  end(): void {
    this.ended = true;
    this.wake();
  }
  private wake(): void {
    for (const r of this.waiters.splice(0)) r();
  }
  iterable(signal?: AbortSignal): AsyncIterable<T> {
    const frames = this.frames;
    const isEnded = (): boolean => this.ended;
    const waitNext = (): Promise<void> =>
      new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    return {
      async *[Symbol.asyncIterator]() {
        let i = 0;
        while (true) {
          if (signal?.aborted) return;
          if (i < frames.length) {
            yield frames[i++] as T;
            continue;
          }
          if (isEnded()) return;
          await waitNext();
        }
      },
    };
  }
}

function fakeClient(streams: {
  attach: FakeStream<AttachFrame>;
  exit: FakeStream<{ exitCode: number }>;
  keys: FakeStream<string[]>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: {
        get: async (_input: unknown, opts?: { signal?: AbortSignal }) =>
          streams.attach.iterable(opts?.signal),
      },
      terminalExit: {
        get: async (_input: unknown, opts?: { signal?: AbortSignal }) =>
          streams.exit.iterable(opts?.signal),
      },
      terminals: {
        keys: async (_input: unknown, opts?: { signal?: AbortSignal }) =>
          streams.keys.iterable(opts?.signal),
      },
    },
  } as unknown as PadiSurfaceClient;
}

const ID = "t1";
const snapshot: AttachFrame = { kind: "snapshot", data: "screen", topLine: 0 };

function streams(): {
  attach: FakeStream<AttachFrame>;
  exit: FakeStream<{ exitCode: number }>;
  keys: FakeStream<string[]>;
} {
  return {
    attach: new FakeStream<AttachFrame>(),
    exit: new FakeStream<{ exitCode: number }>(),
    keys: new FakeStream<string[]>(),
  };
}

describe("awaitOutputSettled — the idle done-signal over padiSurface", () => {
  it("resolves met once the window elapses after the snapshot", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 25,
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "idle" });
  });

  it("a delta resets the window (settles only after true quiet)", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const started = Date.now();
    // Keep the terminal noisy for ~60ms, then go quiet.
    const noise = setInterval(
      () => s.attach.push({ kind: "delta", data: "x" }),
      15,
    );
    setTimeout(() => clearInterval(noise), 60);
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 40,
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "idle" });
    // It cannot have settled before the noise stopped + the window: the last
    // delta lands at ≥45ms (ticks at 15/30/45), so met is ≥85ms — asserted
    // with a few ms of timer-jitter slack.
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it("resolves gone the instant the exit event fires", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.exit.push({ exitCode: 0 });
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a feed end with the id ABSENT from the roster is gone", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([]); // the roster no longer carries t1
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a feed end with the id STILL live is closed — loud, never a false met", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([ID]); // still live: a dropped feed, not an exit
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "closed" });
    if (outcome.kind === "closed") {
      expect(outcome.error).toMatch(/output feed/);
    }
  });

  it("resolves timeout when the terminal never settles", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const noise = setInterval(
      () => s.attach.push({ kind: "delta", data: "x" }),
      10,
    );
    try {
      const outcome = await awaitOutputSettled(fakeClient(s), {
        id: ID,
        idleMs: 60_000,
        timeoutMs: 50,
      });
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });
});

describe("waitJson — the wire envelope", () => {
  it("PIN: a met payload can never clobber the envelope's reserved keys", () => {
    // The met payload nests under `met` — a payload carrying `id`/`result`
    // keys serializes intact WITHOUT overwriting the envelope (the flat-spread
    // collision the review caught; nesting makes it inexpressible).
    const hostile = {
      kind: "met",
      id: "payload-id",
      result: "payload-result",
    } as const;
    const frame = waitJson("envelope-id", hostile as never);
    expect(frame.id).toBe("envelope-id");
    expect(frame.result).toBe("met");
    expect(frame.met).toMatchObject({
      id: "payload-id",
      result: "payload-result",
    });
  });
});

describe("waitOutputSettledTool — the JSON frame", () => {
  it("returns the uniform result frame (id + result + met detail)", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const result = (await waitOutputSettledTool.handler(
      { id: ID, idleMs: 25 },
      fakeClient(s),
      undefined,
    )) as Record<string, unknown>;
    expect(result).toMatchObject({
      id: ID,
      result: "met",
      met: { fired: "idle" },
    });
    expect(typeof (result.met as { elapsedMs: unknown }).elapsedMs).toBe(
      "number",
    );
  });
});
