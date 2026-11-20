import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { KoluSurfaceClients } from "./bundleClient.ts";
import { awaitOutputSettled } from "@kolu/padi-client/watch";
import { SurfaceStdioTransportClosed } from "@kolu/surface/errors";
import { type Cause, Effect, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { waitAgentStateTool, waitJson, waitOutputSettledTool } from "./wait.ts";

type AttachFrame =
  | { kind: "snapshot"; data: string; topLine: number }
  | { kind: "delta"; data: string };

class FakeStream<T> {
  private readonly frames: T[] = [];
  private readonly live = new Set<Queue.Queue<T, Cause.Done>>();
  private ended = false;
  torn = 0;
  push(v: T): void {
    this.frames.push(v);
    for (const q of this.live) Queue.offerUnsafe(q, v);
  }
  end(): void {
    this.ended = true;
    for (const q of this.live) Queue.endUnsafe(q);
    this.live.clear();
  }
  stream(): Stream.Stream<T> {
    return Stream.callback<T>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          for (const frame of this.frames) Queue.offerUnsafe(queue, frame);
          if (this.ended) Queue.endUnsafe(queue);
          else this.live.add(queue);
        }),
        () =>
          Effect.sync(() => {
            if (this.live.delete(queue)) this.torn += 1;
          }),
      ),
    );
  }
}

function fakeClient(
  streams: {
    attach: FakeStream<AttachFrame>;
    exit: FakeStream<{ exitCode: number }>;
    keys: FakeStream<string[]>;
  },
  screenText?: string,
  asked: unknown[] = [],
  standing: "established" | "settling" = "established",
): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: { get: () => streams.attach.stream() },
      terminalExit: { get: () => streams.exit.stream() },
      terminals: {
        keys: () => streams.keys.stream(),
        get: () => Stream.make({ state: "active" }),
      },
      roster: {
        get: () =>
          Stream.map(streams.keys.stream(), (ids) =>
            standing === "settling"
              ? { kind: "settling" }
              : { kind: "established", at: 0, ids },
          ),
      },
      screen: {
        text: (input: unknown) => {
          asked.push(input);
          return screenText === undefined
            ? Effect.fail(new Error("screen.text must not be read here"))
            : Effect.succeed(screenText);
        },
      },
    },
  } as unknown as PadiSurfaceClient;
}

const bundle = (padi: PadiSurfaceClient): KoluSurfaceClients => ({
  core: padi,
});

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

  it("a feed end with the id ABSENT from an ESTABLISHED roster is gone", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([]);
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
    });
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a feed end with the id absent from a SETTLING roster is closed", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([]);
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(
      fakeClient(s, undefined, [], "settling"),
      { id: ID, idleMs: 60_000 },
    );
    expect(outcome).toMatchObject({ kind: "closed" });
    if (outcome.kind === "closed") {
      expect(outcome.error).toMatch(/has not finished adopting/);
    }
  });

  it("a feed end with the id STILL live is closed — loud, never a false met", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.keys.push([ID]);
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

  it("PIN: the lost-feed membership read is BOUNDED — a silent roster never outlives the wait", async () => {
    const s = streams();
    s.attach.push(snapshot);
    s.attach.end();
    s.exit.end();
    const outcome = await awaitOutputSettled(fakeClient(s), {
      id: ID,
      idleMs: 60_000,
      timeoutMs: 50,
    });
    expect(outcome).toMatchObject({ kind: "timeout" });
    expect(s.keys.torn).toBe(1);
  });

  it("PIN: a DEAD-transport attach error PROPAGATES (rejects), never folds to closed", async () => {
    const dead = new SurfaceStdioTransportClosed({ reason: "pipe closed" });
    const client = {
      surface: {
        terminalAttach: { get: () => Stream.fail(dead) },
        terminalExit: { get: () => Stream.fail(dead) },
        terminals: {
          keys: () => Stream.fail(dead),
          get: () => Stream.fail(dead),
        },
        roster: { get: () => Stream.fail(dead) },
      },
    } as unknown as PadiSurfaceClient;
    await expect(
      awaitOutputSettled(client, { id: ID, idleMs: 800, timeoutMs: 5000 }),
    ).rejects.toBe(dead);
  });

  it("PIN: a non-positive / over-ceiling idleMs fails fast (RangeError)", async () => {
    await expect(
      awaitOutputSettled(fakeClient(streams()), { id: ID, idleMs: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      awaitOutputSettled(fakeClient(streams()), {
        id: ID,
        idleMs: 2_147_483_648,
      }),
    ).rejects.toThrow(RangeError);
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
    const result = (await Effect.runPromise(
      waitOutputSettledTool.handler(
        { id: ID, idleMs: 25 },
        bundle(fakeClient(s)),
        undefined,
      ),
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

  it("PIN: `screenTail` reaches padi's read — the screen crosses the wire already cut", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const cut = "line two\nline three";
    const asked: unknown[] = [];
    const result = (await Effect.runPromise(
      waitOutputSettledTool.handler(
        { id: ID, idleMs: 25, screenTail: 2 },
        bundle(fakeClient(s, cut, asked)),
        undefined,
      ),
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      id: ID,
      result: "met",
      met: { screen: cut },
    });
    expect(asked).toEqual([{ id: ID, tail: 2 }]);
  });

  it("PIN: no `screenTail` means no `screen` key — the frame every caller already reads", async () => {
    const s = streams();
    s.attach.push(snapshot);
    const result = (await Effect.runPromise(
      waitOutputSettledTool.handler(
        { id: ID, idleMs: 25 },
        bundle(fakeClient(s)),
        undefined,
      ),
    )) as Record<string, unknown>;

    expect(result).toMatchObject({ id: ID, result: "met" });
    expect(Object.keys(result.met as object)).not.toContain("screen");
  });
});

describe("waitAgentStateTool — the modifiers reach padi", () => {
  function agentClient(attach: FakeStream<AttachFrame>): PadiSurfaceClient {
    const record = {
      state: "active",
      agent: { kind: "claude-code", state: "waiting" },
      git: { kind: "none" },
      pr: { kind: "pending" },
      foreground: null,
    };
    return {
      surface: {
        terminalAttach: { get: () => attach.stream() },
        terminalExit: { get: () => Stream.never },
        terminals: {
          keys: () => Stream.concat(Stream.make([ID]), Stream.never),
          get: () => Stream.concat(Stream.make(record), Stream.never),
        },
        roster: {
          get: () =>
            Stream.concat(
              Stream.make({ kind: "established", at: 0, ids: [ID] }),
              Stream.never,
            ),
        },
        screen: {
          text: () => Effect.fail(new Error("screen.text must not be read")),
        },
      },
    } as unknown as PadiSurfaceClient;
  }

  it("PIN: `settledMs` keeps the wait open while bytes still move", async () => {
    const attach = new FakeStream<AttachFrame>();
    attach.push(snapshot);
    const noise = setInterval(
      () => attach.push({ kind: "delta", data: "·" }),
      10,
    );
    try {
      const result = (await Effect.runPromise(
        waitAgentStateTool.handler(
          {
            id: ID,
            until: ["awaiting", "waiting"],
            settledMs: 300,
            timeoutMs: 400,
          },
          bundle(agentClient(attach)),
          undefined,
        ),
      )) as Record<string, unknown>;
      expect(result).toMatchObject({ id: ID, result: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });

  it("PIN: without it the very same call is met at once — so the timeout above is the conjunct's doing", async () => {
    const attach = new FakeStream<AttachFrame>();
    attach.push(snapshot);
    const noise = setInterval(
      () => attach.push({ kind: "delta", data: "·" }),
      10,
    );
    try {
      const result = (await Effect.runPromise(
        waitAgentStateTool.handler(
          { id: ID, until: ["awaiting", "waiting"], timeoutMs: 400 },
          bundle(agentClient(attach)),
          undefined,
        ),
      )) as Record<string, unknown>;
      expect(result).toMatchObject({
        id: ID,
        result: "met",
        met: { agent: { kind: "claude-code", state: "waiting" } },
      });
      expect(Object.keys(result.met as object).sort()).toEqual([
        "agent",
        "elapsedMs",
      ]);
    } finally {
      clearInterval(noise);
    }
  });
});
