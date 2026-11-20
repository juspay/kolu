import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiSurfaceClient } from "./dial.ts";
import { TerminalNotActive, TerminalNotFound } from "./errors.ts";
import type { PadiRoster, PadiTerminal } from "./surface.ts";
import {
  awaitAgentState,
  awaitOutputSettled,
  awaitTerminalCondition,
  matchingActiveAgent,
} from "./watch.ts";

function activeWithAgent(agent: AgentInfo | null): PadiTerminal {
  return {
    state: "active",
    agent,
    git: { kind: "none" },
    pr: { kind: "pending" },
    foreground: null,
  } as unknown as PadiTerminal;
}

const claude = (state: AgentInfo["state"]): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

describe("matchingActiveAgent — the wait predicate over a composed record", () => {
  const awaitingOrWaiting = new Set(["awaiting", "waiting"]);

  it("returns the very agent whose bucket is in the targets", () => {
    const awaiting = claude("awaiting_user");
    expect(
      matchingActiveAgent(activeWithAgent(awaiting), awaitingOrWaiting),
    ).toBe(awaiting);
    const waiting = claude("waiting");
    expect(
      matchingActiveAgent(activeWithAgent(waiting), awaitingOrWaiting),
    ).toBe(waiting);
  });

  it("does NOT match a working agent for an awaiting/waiting wait", () => {
    expect(
      matchingActiveAgent(
        activeWithAgent(claude("thinking")),
        awaitingOrWaiting,
      ),
    ).toBeNull();
  });

  it("matches a working agent for a working wait (the two-phase phase 1)", () => {
    const working = new Set(["working"]);
    const toolUse = claude("tool_use");
    expect(matchingActiveAgent(activeWithAgent(toolUse), working)).toBe(
      toolUse,
    );
  });

  it("never matches a record with no live agent", () => {
    expect(
      matchingActiveAgent(activeWithAgent(null), awaitingOrWaiting),
    ).toBeNull();
    expect(
      matchingActiveAgent(
        { state: "parked" } as unknown as PadiTerminal,
        awaitingOrWaiting,
      ),
    ).toBeNull();
  });
});

type AttachFrame =
  | { readonly kind: "delta"; readonly data: string }
  | {
      readonly kind: "snapshot";
      readonly data: string;
      readonly topLine: number;
    };

const delta = (data: string): AttachFrame => ({ kind: "delta", data });
const snapshot = (data: string): AttachFrame => ({
  kind: "snapshot",
  data,
  topLine: 0,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

class FakeSource<T> {
  private readonly frames: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  private failure: unknown;
  push(v: T): void {
    this.frames.push(v);
    this.wake();
  }
  end(): void {
    this.ended = true;
    this.wake();
  }
  fail(err: unknown): void {
    this.failure = err;
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
        if (this.failure !== undefined) throw this.failure;
        if (this.ended) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
}

function matchClient(parts: {
  attach?: () => Stream.Stream<AttachFrame, unknown>;
  exit?: () => Stream.Stream<{ code: number }, unknown>;
  keys?: () => Stream.Stream<readonly TerminalId[], unknown>;
  roster?: () => Stream.Stream<PadiRoster, unknown>;
  get?: (key: TerminalId) => Stream.Stream<PadiTerminal, unknown>;
  screenText?: (input: {
    id: TerminalId;
    tail?: number;
  }) => Effect.Effect<string, unknown>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: {
        get: () =>
          parts.attach?.() ??
          Stream.fail(
            new Error("terminalAttach must not be subscribed in this case"),
          ),
      },
      terminalExit: { get: () => parts.exit?.() ?? Stream.never },
      terminals: {
        keys: () =>
          parts.keys?.() ??
          Stream.fail(
            new Error("terminals.keys must not be read in this case"),
          ),
        get: (input: { key: TerminalId }) =>
          parts.get?.(input.key) ?? Stream.make(activeWithAgent(null)),
      },
      roster: {
        get: () =>
          parts.roster?.() ??
          Stream.make({
            kind: "established",
            at: 1,
            ids: [T as TerminalId],
          } as PadiRoster),
      },
      screen: {
        text: (input: { id: TerminalId; tail?: number }) =>
          parts.screenText?.(input) ??
          Effect.fail(new Error("screen.text must not be read in this case")),
      },
    },
  } as unknown as PadiSurfaceClient;
}

const censusWithout = (): Stream.Stream<PadiRoster, unknown> =>
  Stream.make({ kind: "established", at: 1, ids: [] } as PadiRoster);

const T = "t1";

const matchWait = (
  client: PadiSurfaceClient,
  opts: { id: string; pattern: RegExp; timeoutMs?: number },
) =>
  awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "match", pattern: opts.pattern },
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    retryAdvice: "re-run the match wait",
  });

describe("the `match:` wait over a fake attach feed", () => {
  it("matches a sentinel SPLIT across two deltas", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("running... SEN"));
    attach.push(delta("TINEL ok\n"));

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream() }),
      { id: T, pattern: /SENTINEL/, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "running... SENTINEL ok",
    });
  });

  it("a match WINS over an already-latched terminalExit", async () => {
    const attach = new FakeSource<AttachFrame>();
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 0 });

    const pending = matchWait(
      matchClient({ attach: () => attach.stream(), exit: () => exit.stream() }),
      { id: T, pattern: /READY/, timeoutMs: 5000 },
    );
    await sleep(50);
    attach.push(delta("READY\n"));

    expect(await pending).toMatchObject({ kind: "met", fired: "match" });
  });

  it("is `gone` when the exit latches and the feed ends with no match — without reading the key set", async () => {
    const attach = new FakeSource<AttachFrame>();
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 1 });
    attach.push(delta("nothing interesting here\n"));

    const pending = matchWait(
      matchClient({ attach: () => attach.stream(), exit: () => exit.stream() }),
      { id: T, pattern: /READY/, timeoutMs: 5000 },
    );
    await sleep(50);
    attach.end();

    expect(await pending).toMatchObject({ kind: "gone" });
  });

  it("RESETS the carry across a fence re-subscribe, so two halves cannot forge a sentinel", async () => {
    const first = new FakeSource<AttachFrame>();
    first.push(delta("SEN"));
    first.fail({ _tag: "RpcClientError", message: "socket closed" });
    const second = new FakeSource<AttachFrame>();
    second.push(delta("TINEL\n"));
    second.end();

    let attempt = 0;
    const outcome = await matchWait(
      matchClient({
        attach: () => (attempt++ === 0 ? first.stream() : second.stream()),
        roster: censusWithout,
      }),
      { id: T, pattern: /SENTINEL/ },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
  }, 15_000);

  it("does NOT scan `snapshot` frames — only `delta`", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("SENTINEL printed minutes ago\n"));
    attach.push(delta("still working\n"));
    attach.end();

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), roster: censusWithout }),
      { id: T, pattern: /SENTINEL/, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a /g pattern's lastIndex can neither cause a miss nor be mutated", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("READY now\n"));
    const pattern = /READY/g;
    pattern.lastIndex = 999;

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream() }),
      { id: T, pattern, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "met", matchedLine: "READY now" });
    expect(pattern.lastIndex).toBe(999);
  });

  it("scans a BOUNDED window — the overlap plus the new delta, never the history", async () => {
    class ScanSpy extends RegExp {
      readonly widths: number[] = [];
      override [Symbol.search](input: string): number {
        this.widths.push(input.length);
        return super[Symbol.search](input);
      }
    }
    const pattern = new ScanSpy("ZZZ");

    const attach = new FakeSource<AttachFrame>();
    const chunk = 1024;
    const frames = 40;
    for (let i = 0; i < frames; i++) attach.push(delta("x".repeat(chunk)));
    attach.end();

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), roster: censusWithout }),
      { id: T, pattern, timeoutMs: 20_000 },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
    expect(pattern.widths).toHaveLength(frames);
    expect(Math.max(...pattern.widths)).toBe(4096 + chunk);
  });

  it("keeps total scan cost proportional to the OUTPUT, not output × window", async () => {
    const attach = new FakeSource<AttachFrame>();
    for (let i = 0; i < 48; i++) attach.push(delta("a".repeat(1024)));
    attach.end();

    const started = Date.now();
    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), roster: censusWithout }),
      { id: T, pattern: /a*Z/ },
    );
    const elapsed = Date.now() - started;

    expect(outcome).toMatchObject({ kind: "gone" });
    expect(elapsed).toBeLessThan(8000);
  }, 30_000);

  it("does NOT call a terminal gone when the host has not finished adopting", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("still working\n"));
    attach.end();

    const outcome = await matchWait(
      matchClient({
        attach: () => attach.stream(),
        roster: () => Stream.make({ kind: "settling" } as PadiRoster),
      }),
      { id: T, pattern: /SENTINEL/, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({
      kind: "closed",
      error: expect.stringContaining("has not finished adopting"),
    });
  });

  it("a LATCHED match stops scanning — a later line never overwrites the one that fired", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("first MARK here\n"));
    attach.push(delta("second MARK there\n"));

    const outcome = await awaitTerminalCondition(
      matchClient({ attach: () => attach.stream() }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /MARK/ },
        settledMs: 80,
        timeoutMs: 5000,
        retryAdvice: "re-run the match wait",
      },
    );

    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "first MARK here",
    });
  });

  it("never cuts a surrogate pair in half when trimming the overlap", async () => {
    const emoji = "\u{1F600}";
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta(`a${emoji}${"b".repeat(4095)}`));
    attach.push(delta("Z\n"));

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), roster: censusWithout }),
      { id: T, pattern: new RegExp(`${emoji}b+Z`, "u"), timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "met", fired: "match" });
  });
});

function agentCollection(first: AgentInfo | null): {
  readonly parts: {
    keys: () => Stream.Stream<readonly TerminalId[], unknown>;
    get: (key: TerminalId) => Stream.Stream<PadiTerminal, unknown>;
  };
  readonly push: (agent: AgentInfo | null) => void;
} {
  const values = new FakeSource<PadiTerminal>();
  values.push(activeWithAgent(first));
  return {
    parts: {
      keys: () =>
        Stream.concat(
          Stream.make([T as TerminalId] as readonly TerminalId[]),
          Stream.never,
        ),
      get: () => values.stream(),
    },
    push: (agent) => values.push(activeWithAgent(agent)),
  };
}

describe("awaitTerminalCondition — `--settled`, the quiescence conjunct", () => {
  it("keeps the wait OPEN while bytes move, though the bucket already matches", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const noise = setInterval(() => attach.push(delta("·")), 10);
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({ attach: () => attach.stream(), ...agents.parts }),
        {
          id: T as TerminalId,
          condition: {
            kind: "agent",
            targets: new Set(["awaiting", "waiting"]),
          },
          settledMs: 300,
          timeoutMs: 400,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });

  it("settles the moment the SAME wait sees its quiet window through", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    let ticks = 0;
    const noise = setInterval(() => {
      if (++ticks > 5) {
        clearInterval(noise);
        return;
      }
      attach.push(delta("·"));
    }, 10);

    const outcome = await awaitTerminalCondition(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        condition: { kind: "agent", targets: new Set(["awaiting", "waiting"]) },
        settledMs: 80,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    clearInterval(noise);
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
    if (outcome.kind !== "met") throw new Error("unreachable");
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(80);
  });

  it("RE-ENTERS the wait when the bucket drops back to working", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));

    const pending = awaitTerminalCondition(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        condition: { kind: "agent", targets: new Set(["awaiting", "waiting"]) },
        settledMs: 60,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    agents.push(claude("thinking"));
    await sleep(200);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await sleep(0);
    expect(settled).toBe(false);

    agents.push(claude("awaiting_user"));
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
  });

  it("opens NO attach feed for an agent condition with no conjunct", async () => {
    const agents = agentCollection(claude("waiting"));
    const outcome = await awaitTerminalCondition(matchClient(agents.parts), {
      id: T as TerminalId,
      condition: { kind: "agent", targets: new Set(["waiting"]) },
      timeoutMs: 5000,
      retryAdvice: "re-run the wait",
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
  });
});

describe("awaitTerminalCondition — `screenTail`, the screen stamp", () => {
  const screen = "prompt$ run\nall 12 passed";

  it("stamps the met with the screen padi cut to the asked tail", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const asked: unknown[] = [];
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: (input) => {
          asked.push(input);
          return Effect.succeed(screen);
        },
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        screenTail: 2,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    expect(asked).toEqual([{ id: T, tail: 2 }]);
    expect(outcome).toMatchObject({ kind: "met", fired: "idle", screen });
  });

  it("refuses a tail that is not a positive whole number before subscribing", async () => {
    await expect(
      awaitTerminalCondition(matchClient({}), {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        screenTail: 0,
        retryAdvice: "re-run the wait",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("DISCARDS a screen the terminal moved under, and stamps the next quiet one", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    let release: (() => void) | undefined;
    const reads: string[] = [];
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () =>
          Effect.promise(async () => {
            if (reads.length === 0) {
              reads.push("stale");
              await new Promise<void>((resolve) => {
                release = resolve;
                attach.push(delta("late output\n"));
                setTimeout(resolve, 0);
              });
              return "STALE\n";
            }
            reads.push("fresh");
            return "FRESH\n";
          }),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        settledMs: 40,
        screenTail: 40,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    release?.();

    expect(reads).toEqual(["stale", "fresh"]);
    expect(outcome).toMatchObject({ kind: "met", screen: "FRESH\n" });
  });

  it("reports `gone` when the terminal ends between the condition and the read", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () => Effect.fail(new TerminalNotFound({ id: T })),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        screenTail: 40,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("REFUSES a wait on a SLEEPING terminal instead of waiting on it (kolu#2361)", async () => {
    const err = await awaitTerminalCondition(
      matchClient({
        get: () =>
          Stream.make({ state: "sleeping" } as unknown as PadiTerminal),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TerminalNotActive);
    expect((err as TerminalNotActive).state).toBe("sleeping");
    expect((err as TerminalNotActive).id).toBe(T);
  });

  it("REFUSES a wait on a PARKED terminal the same way", async () => {
    const err = await awaitTerminalCondition(
      matchClient({
        get: () => Stream.make({ state: "parked" } as unknown as PadiTerminal),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TerminalNotActive);
    expect((err as TerminalNotActive).state).toBe("parked");
  });

  it("DISCARDS a screen whose quiet window re-fired under it — not just one whose flags flipped", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const reads: string[] = [];
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () =>
          Effect.promise(async () => {
            if (reads.length === 0) {
              reads.push("stale");
              attach.push(delta("a screenful of late output\n"));
              await sleep(80);
              return "STALE\n";
            }
            reads.push("fresh");
            return "FRESH\n";
          }),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 20 },
        settledMs: 20,
        screenTail: 40,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(reads).toEqual(["stale", "fresh"]);
    expect(outcome).toMatchObject({ kind: "met", screen: "FRESH\n" });
  });

  it("CONVERGES on a chattering terminal whose candidate cannot fall back — exactly one read", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    let reads = 0;
    let chatter: ReturnType<typeof setInterval> | undefined;
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({
          attach: () => attach.stream(),
          roster: censusWithout,
          screenText: () =>
            Effect.promise(async () => {
              reads += 1;
              chatter = setInterval(() => attach.push(delta("·")), 5);
              await sleep(60);
              clearInterval(chatter);
              return "READY\n";
            }),
        }),
        {
          id: T as TerminalId,
          condition: { kind: "match", pattern: /DONE/ },
          screenTail: 40,
          timeoutMs: 3000,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({
        kind: "met",
        fired: "match",
        screen: "READY\n",
      });
      expect(reads).toBe(1);
    } finally {
      if (chatter !== undefined) clearInterval(chatter);
    }
  });

  it("CONVERGES while the roster re-publishes an unchanged agent — exactly one read", async () => {
    const agents = agentCollection(claude("waiting"));
    let reads = 0;
    let churn: ReturnType<typeof setInterval> | undefined;
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({
          ...agents.parts,
          screenText: () =>
            Effect.promise(async () => {
              reads += 1;
              churn = setInterval(() => agents.push(claude("waiting")), 5);
              await sleep(60);
              clearInterval(churn);
              return "READY\n";
            }),
        }),
        {
          id: T as TerminalId,
          condition: {
            kind: "agent",
            targets: new Set(["awaiting", "waiting"]),
          },
          screenTail: 40,
          timeoutMs: 3000,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
      expect(reads).toBe(1);
    } finally {
      if (churn !== undefined) clearInterval(churn);
    }
  });

  it("a latched `match` + a conjunct is MET on the terminal's EXIT, not `gone`", async () => {
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 0 });
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        exit: () => exit.stream(),
        roster: censusWithout,
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "DONE",
    });
  });

  it("the same wait WITH a capture is `gone` — a dead terminal has no screen", async () => {
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 0 });
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        exit: () => exit.stream(),
        roster: censusWithout,
        screenText: () => Effect.fail(new TerminalNotFound({ id: T })),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        screenTail: 40,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a LIVE terminal's dropped feed is `closed` — a lost feed never mints a met", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        roster: () =>
          Stream.make({
            kind: "established",
            at: 1,
            ids: [T as TerminalId],
          } as PadiRoster),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({ kind: "closed" });
  });
});

describe("awaitAgentState / awaitOutputSettled — forwarding, and the wire frames", () => {
  const screen = "prompt$ run\nall 12 passed";

  it("forwards `settledMs` — bytes still moving keep an already-matching bucket open", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const noise = setInterval(() => attach.push(delta("·")), 10);
    try {
      const outcome = await awaitAgentState(
        matchClient({ attach: () => attach.stream(), ...agents.parts }),
        {
          id: T as TerminalId,
          targets: new Set(["awaiting", "waiting"]),
          settledMs: 300,
          timeoutMs: 400,
        },
      );
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });

  it("forwards `screenTail`, and the met frame gains `screen` WITHOUT gaining `fired`", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitAgentState(
      matchClient({
        attach: () => attach.stream(),
        screenText: ({ tail }) =>
          tail === 40 ? Effect.succeed(screen) : Effect.die("wrong tail"),
        ...agents.parts,
      }),
      {
        id: T as TerminalId,
        targets: new Set(["awaiting", "waiting"]),
        screenTail: 40,
        timeoutMs: 5000,
      },
    );
    expect(outcome).toMatchObject({ kind: "met", agent: claude("waiting") });
    expect(outcome).toHaveProperty("screen", screen);
    expect(outcome).not.toHaveProperty("fired");
  });

  it("a met with no capture asked for carries NO `screen` key at all", async () => {
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitAgentState(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        targets: new Set(["awaiting", "waiting"]),
        timeoutMs: 5000,
      },
    );
    expect(outcome).toMatchObject({ kind: "met" });
    expect(Object.keys(outcome)).not.toContain("screen");
  });

  it("awaitOutputSettled forwards `screenTail` to padi's read", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitOutputSettled(
      matchClient({
        attach: () => attach.stream(),
        screenText: ({ tail }) =>
          tail === 20 ? Effect.succeed(screen) : Effect.die("wrong tail"),
      }),
      { id: T, idleMs: 40, screenTail: 20, timeoutMs: 5000 },
    );
    expect(outcome).toMatchObject({ kind: "met", fired: "idle", screen });
  });
});
