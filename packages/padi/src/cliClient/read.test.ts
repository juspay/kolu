import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { awaitAgentState } from "@kolu/padi-client/watch";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { readTerminalKeys, settledSnapshot } from "./read.ts";

const id = (s: string): TerminalId => s as TerminalId;

const claudeAgent = (state: string): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

function active(over: Record<string, unknown>): PadiTerminal {
  return {
    state: "active",
    agent: null,
    git: { kind: "unresolved" },
    pr: { kind: "pending" },
    foreground: null,
    ...over,
  } as unknown as PadiTerminal;
}

function parkedIterator<T>(
  next: () => Promise<IteratorResult<T, undefined>>,
): AsyncIterable<T> {
  return { [Symbol.asyncIterator]: () => ({ next }) };
}

function returningIterator<T>(
  next: () => Promise<IteratorResult<T, undefined>>,
  onReturn: () => void,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => ({
      next,
      return: () => {
        onReturn();
        return Promise.resolve({ value: undefined, done: true as const });
      },
    }),
  };
}

class FakeSource<T> {
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
  stream(): Stream.Stream<T, unknown> {
    return Stream.suspend(() =>
      Stream.fromAsyncIterable<T, unknown>(this.iterable(), (e) => e),
    );
  }
  private iterable(): AsyncIterable<T> {
    let i = 0;
    const next = async (): Promise<IteratorResult<T, undefined>> => {
      while (true) {
        if (i < this.frames.length) {
          return { value: this.frames[i++] as T, done: false };
        }
        if (this.ended) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
    return parkedIterator(next);
  }
}

function fakeClient(streams: {
  keys: FakeSource<readonly TerminalId[]>;
  activity: FakeSource<readonly TerminalId[]>;
  get: (key: TerminalId) => FakeSource<PadiTerminal>;
  roster?: () => Stream.Stream<PadiRoster, unknown>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminals: {
        keys: () => streams.keys.stream(),
        get: (input: { key: TerminalId }) => streams.get(input.key).stream(),
      },
      roster: {
        get: () =>
          streams.roster?.() ??
          Stream.make({ kind: "established", at: 1, ids: [] } as PadiRoster),
      },
      activity: { get: () => streams.activity.stream() },
    },
  } as unknown as PadiSurfaceClient;
}

function observableKeys(frames: ReadonlyArray<readonly TerminalId[]>) {
  let closed = false;
  let i = 0;
  const stream = Stream.suspend(() =>
    Stream.fromAsyncIterable<readonly TerminalId[], unknown>(
      returningIterator<readonly TerminalId[]>(
        () =>
          i < frames.length
            ? Promise.resolve({
                value: frames[i++] as readonly TerminalId[],
                done: false as const,
              })
            : new Promise<IteratorResult<readonly TerminalId[], undefined>>(
                () => {},
              ),
        () => {
          closed = true;
        },
      ),
      (e) => e,
    ),
  );
  return { stream, isClosed: () => closed };
}

function keysOnlyClient(
  stream: Stream.Stream<readonly TerminalId[], unknown>,
): PadiSurfaceClient {
  return {
    surface: { terminals: { keys: () => stream } },
  } as unknown as PadiSurfaceClient;
}

describe("readTerminalKeys — the one-shot key set", () => {
  it("returns the FIRST snapshot frame of a still-live stream, and closes it", async () => {
    const { stream, isClosed } = observableKeys([[id("t1"), id("t2")]]);

    expect(
      await Effect.runPromise(readTerminalKeys(keysOnlyClient(stream))),
    ).toEqual([id("t1"), id("t2")]);
    expect(isClosed()).toBe(true);
  });

  it("THROWS when the stream ends with no snapshot frame (never 'no terminals')", async () => {
    await expect(
      Effect.runPromise(readTerminalKeys(keysOnlyClient(Stream.empty))),
    ).rejects.toThrow(/no snapshot frame/i);
  });

  it("surfaces a stream failure as a rejection, not a synchronous throw", async () => {
    await expect(
      Effect.runPromise(
        readTerminalKeys(
          keysOnlyClient(Stream.fail(new Error("socket hung up"))),
        ),
      ),
    ).rejects.toThrow(/socket hung up/);
  });
});

describe("awaitAgentState — the `wait` read", () => {
  it("resolves `gone` when the terminal exited before the watch subscribed", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    keys.push([]);
    activity.push([]);
    const client = fakeClient({
      keys,
      activity,
      get: () => new FakeSource<PadiTerminal>(),
    });

    const outcome = await awaitAgentState(client, {
      id: id("t-gone"),
      targets: new Set(["working"]),
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("resolves `met` for a present terminal already in a target bucket (seed is inert here)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ agent: claudeAgent("thinking") }));
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const outcome = await awaitAgentState(client, {
      id: id("t1"),
      targets: new Set(["working"]),
    });
    expect(outcome.kind).toBe("met");
  });
});

describe("settledSnapshot — the `status` read", () => {
  it("FAILS LOUD when the link drops mid-read (never a silent partial table)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({}));
    keys.end();
    activity.end();
    tget.end();
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    await expect(
      Effect.runPromise(settledSnapshot(client, { maxMs: 5000, quietMs: 50 })),
    ).rejects.toThrow(/link closed/i);
  });

  it("returns the snapshot on a clean settle (a warm padi resolves at once)", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ git: { kind: "repo", info: { branch: "main" } } }));
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const entries = await Effect.runPromise(
      settledSnapshot(client, { maxMs: 5000, quietMs: 20 }),
    );
    expect(entries.map(([k]) => k)).toEqual([id("t1")]);
  });

  it("returns one QUIET WINDOW after the last fact, not a flat wait", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ git: { kind: "repo", info: { branch: "main" } } }));
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const startedAt = Date.now();
    const entries = await Effect.runPromise(
      settledSnapshot(client, { maxMs: 10_000, quietMs: 100 }),
    );
    expect(entries.map(([k]) => k)).toEqual([id("t1")]);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("is NOT extended by a busy terminal republishing the same facts", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const tget = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    const busy = (state: string): PadiTerminal =>
      active({
        git: { kind: "repo", info: { branch: "main" } },
        agent: claudeAgent(state),
        foreground: { name: "claude", title: `${state}…`, shell: false },
      });
    tget.push(busy("thinking"));
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeSource<PadiTerminal>()),
    });

    const churn = setInterval(
      () => tget.push(busy(Math.random() < 0.5 ? "thinking" : "tools")),
      40,
    );
    try {
      const startedAt = Date.now();
      const entries = await Effect.runPromise(
        settledSnapshot(client, { maxMs: 10_000, quietMs: 300 }),
      );
      expect(entries.map(([k]) => k)).toEqual([id("t1")]);
      expect(Date.now() - startedAt).toBeLessThan(1500);
    } finally {
      clearInterval(churn);
    }
  });

  it("re-arms the quiet window on every new FACT, so a whole sensor burst is caught", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    const t1 = new FakeSource<PadiTerminal>();
    const t2 = new FakeSource<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    t1.push(active({ foreground: { name: "bash", title: null, shell: true } }));
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? t1 : t2),
    });

    setTimeout(() => {
      t1.push(
        active({
          foreground: { name: "bash", title: null, shell: true },
          git: { kind: "repo", info: { branch: "main" } },
        }),
      );
    }, 60);
    setTimeout(() => {
      t2.push(active({ git: { kind: "repo", info: { branch: "main" } } }));
      keys.push([id("t1"), id("t2")]);
    }, 120);

    const entries = await Effect.runPromise(
      settledSnapshot(client, { maxMs: 10_000, quietMs: 100 }),
    );
    expect(entries.map(([k]) => k).sort()).toEqual([id("t1"), id("t2")]);
    expect(
      entries.find(([k]) => k === id("t1"))?.[1] as
        | { git: unknown }
        | undefined,
    ).toMatchObject({ git: { kind: "repo", info: { branch: "main" } } });
  });

  it("does not wait out `maxMs` on an empty roster", async () => {
    const keys = new FakeSource<TerminalId[]>();
    const activity = new FakeSource<TerminalId[]>();
    keys.push([]);
    activity.push([]);
    const client = fakeClient({
      keys,
      activity,
      get: () => new FakeSource<PadiTerminal>(),
    });

    const startedAt = Date.now();
    const entries = await Effect.runPromise(
      settledSnapshot(client, { maxMs: 10_000, quietMs: 100 }),
    );
    expect(entries).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
