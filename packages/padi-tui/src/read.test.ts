/**
 * The mirror-driven read paths, exercised against a hand-rolled fake
 * `PadiTuiClient` (no socket): `settledSnapshot` (the `status` read) and
 * `awaitAgentState` (the `wait` read). Two regressions are pinned here:
 *
 *   - `wait` must resolve `gone` — not hang — when the watched terminal exited in
 *     the gap between the caller resolving its id and this subscription opening
 *     (the target is absent from the mirror's FIRST snapshot, so the mirror never
 *     opens — hence never removes — its key; the seeded id is what rescues it).
 *   - `status` must FAIL LOUD when the link drops mid-read, rather than collapsing
 *     a dropped link to a partial/empty table (caught-error-must-not-collapse-to-
 *     empty).
 */

import type { PadiTerminal } from "@kolu/padi/surface";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiTuiClient } from "./connect.ts";
import { awaitAgentState } from "@kolu/padi/dial";
import { settledSnapshot } from "./read.ts";

const id = (s: string): TerminalId => s as TerminalId;

const claudeAgent = (state: string): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

/** A minimal `active` record. `git`/`agent`/`foreground` default to the all-null
 *  shape `isResolved` treats as still-sensing (so `settledSnapshot` keeps waiting);
 *  a case overrides one to mark it resolved. */
function active(over: Record<string, unknown>): PadiTerminal {
  return {
    state: "active",
    agent: null,
    git: null,
    pr: { kind: "pending" },
    foreground: null,
    ...over,
  } as unknown as PadiTerminal;
}

/** A pushable snapshot-then-delta stream: every subscriber replays the queued
 *  frames from the start, waits for more, and ends on `end()` or a signal abort
 *  (the exact contract the surface mirror consumes). */
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
            // In-range by the guard; the cast satisfies noUncheckedIndexedAccess.
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

/** A structural `PadiTuiClient` over three pushable streams — enough of
 *  `.surface.terminals.keys` / `.terminals.get` / `.activity.get` for the mirror
 *  and the direct reads. */
function fakeClient(streams: {
  keys: FakeStream<TerminalId[]>;
  activity: FakeStream<TerminalId[]>;
  get: (key: TerminalId) => FakeStream<PadiTerminal>;
}): PadiTuiClient {
  return {
    surface: {
      terminals: {
        keys: async (_input: unknown, opts?: { signal?: AbortSignal }) =>
          streams.keys.iterable(opts?.signal),
        get: async (
          input: { key: TerminalId },
          opts?: { signal?: AbortSignal },
        ) => streams.get(input.key).iterable(opts?.signal),
      },
      activity: {
        get: async (_input: unknown, opts?: { signal?: AbortSignal }) =>
          streams.activity.iterable(opts?.signal),
      },
    },
  } as unknown as PadiTuiClient;
}

describe("awaitAgentState — the `wait` read", () => {
  it("resolves `gone` when the terminal exited before the watch subscribed", async () => {
    const keys = new FakeStream<TerminalId[]>();
    const activity = new FakeStream<TerminalId[]>();
    // The FIRST (and only) keys snapshot no longer carries the target — it exited
    // in the id-resolve → subscribe gap. Streams stay open (no `end`), so without
    // the seeded-id reconciliation this wait (no timeout) would hang forever.
    keys.push([]);
    activity.push([]);
    const client = fakeClient({
      keys,
      activity,
      get: () => new FakeStream<PadiTerminal>(),
    });

    const outcome = await awaitAgentState(client, {
      id: id("t-gone"),
      targets: new Set(["working"]),
    });
    // `gone` now carries the scaffold's elapsedMs stamp — assert the kind.
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("resolves `met` for a present terminal already in a target bucket (seed is inert here)", async () => {
    const keys = new FakeStream<TerminalId[]>();
    const activity = new FakeStream<TerminalId[]>();
    const tget = new FakeStream<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ agent: claudeAgent("thinking") })); // bucket → working
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeStream<PadiTerminal>()),
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
    const keys = new FakeStream<TerminalId[]>();
    const activity = new FakeStream<TerminalId[]>();
    const tget = new FakeStream<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({})); // never flips `isResolved` → the read keeps waiting…
    // …until the link drops: every subscription ends with no abort from us.
    keys.end();
    activity.end();
    tget.end();
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeStream<PadiTerminal>()),
    });

    await expect(
      settledSnapshot(client, { maxMs: 5000, graceMs: 50 }),
    ).rejects.toThrow(/link closed/i);
  });

  it("returns the snapshot on a clean settle (a warm padi resolves at once)", async () => {
    const keys = new FakeStream<TerminalId[]>();
    const activity = new FakeStream<TerminalId[]>();
    const tget = new FakeStream<PadiTerminal>();
    keys.push([id("t1")]);
    activity.push([]);
    tget.push(active({ git: { branch: "main" } })); // git non-null → resolved
    // Streams stay OPEN — the settle is driven by grace, not a dropped link.
    const client = fakeClient({
      keys,
      activity,
      get: (k) => (k === id("t1") ? tget : new FakeStream<PadiTerminal>()),
    });

    const entries = await settledSnapshot(client, { maxMs: 5000, graceMs: 20 });
    expect(entries.map(([k]) => k)).toEqual([id("t1")]);
  });
});
