/**
 * The framer + the framed serving helper.
 *
 * The headline PR-3 proof lives here: a `terminalEvents` subscriber gets a
 * `snapshot` frame then a `commandRun` `delta` — the mark the `snapshots` cache
 * DROPS (`foldSnapshot` no-ops `commandRun`). That is exactly why a remote kolu
 * must fold from this event stream, not from the served snapshot: the launch line
 * (kolu's `lastAgentCommand` memory) is only reconstructible from the deltas.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import { describe, expect, it } from "vitest";
import { foldSnapshot } from "./fold.ts";
import {
  createFramer,
  serveTerminalEvents,
  snapshotToEvents,
} from "./framer.ts";
import {
  type AgentInfo,
  type TerminalEvent,
  type TerminalFrame,
  type TerminalSnapshot,
  seedSnapshot,
} from "./schema.ts";

function claude(sessionId: string): AgentInfo {
  return {
    kind: "claude-code",
    state: "thinking",
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

const sampleSnapshot = (): TerminalSnapshot => ({
  ...seedSnapshot("/work/repo"),
  agent: claude("A"),
  foreground: { name: "vim", title: "vim file.ts" },
});

describe("createFramer — derives phase + monotonic per-instance seq, nothing else", () => {
  it("stamps deltas with a monotonic seq from 1; the snapshot carries no seq", () => {
    const f = createFramer();
    expect(f.snapshot([])).toEqual({ phase: "snapshot", events: [] });
    expect(f.delta([{ kind: "cwd", cwd: "/a" }])).toEqual({
      phase: "delta",
      seq: 1,
      events: [{ kind: "cwd", cwd: "/a" }],
    });
    expect(f.delta([{ kind: "cwd", cwd: "/b" }]).phase === "delta").toBe(true);
    // Each framer instance has its OWN counter — a second delta is seq 2.
    const second = f.delta([{ kind: "pr", pr: { kind: "absent" } }]);
    expect(second).toMatchObject({ phase: "delta", seq: 3 });
  });
});

describe("snapshotToEvents — the snapshot frame body folds back to the same snapshot", () => {
  it("replays exactly the five re-samplable fields (no commandRun) and round-trips", () => {
    const snap = sampleSnapshot();
    const events = snapshotToEvents(snap);
    expect(events.map((e) => e.kind)).toEqual([
      "cwd",
      "git",
      "pr",
      "agent",
      "foreground",
    ]);
    // No commandRun — it's a memory mark, not a re-samplable field.
    expect(events.some((e) => e.kind === "commandRun")).toBe(false);
    // Folding the snapshot events into a blank snapshot reconstructs the original.
    const rebuilt = events.reduce(foldSnapshot, seedSnapshot("/blank"));
    expect(rebuilt).toEqual(snap);
  });
});

describe("serveTerminalEvents — snapshot-then-commandRun-delta the snapshots cache can't carry", () => {
  it("yields the current state as a snapshot frame, then a commandRun the snapshot fold drops", async () => {
    const snap = sampleSnapshot();
    const bus = inMemoryChannel<TerminalEvent>();
    const abort = new AbortController();
    const gen = serveTerminalEvents({
      events: bus,
      currentSnapshot: () => snap,
      signal: abort.signal,
    });

    // Frame 1 — the snapshot. Subscribe-before-snapshot means the subscriber is
    // registered by the time this resolves, so the publish below is not lost.
    const first = (await gen.next()).value as TerminalFrame;
    expect(first).toEqual({
      phase: "snapshot",
      events: snapshotToEvents(snap),
    });

    // The producer runs an agent command — a `commandRun` mark. The snapshots
    // CACHE drops it (`foldSnapshot` returns the same snapshot for a commandRun),
    // so a snapshot-only consumer would never see the launch line.
    const mark: TerminalEvent = {
      kind: "commandRun",
      command: "claude --model sonnet",
      replayed: false,
    };
    expect(foldSnapshot(snap, mark)).toBe(snap); // the cache truly drops it
    bus.publish(mark);

    // Frame 2 — the commandRun rides a DELTA. This is the capability the snapshots
    // collection can't express: the event stream carries the fold's input verbatim.
    const second = (await gen.next()).value as TerminalFrame;
    expect(second).toEqual({ phase: "delta", seq: 1, events: [mark] });

    abort.abort();
    await gen.return?.(undefined);
  });

  it("buffers an emission published in the snapshot→first-delta window (no lost update)", async () => {
    const snap = sampleSnapshot();
    const bus = inMemoryChannel<TerminalEvent>();
    const abort = new AbortController();
    const gen = serveTerminalEvents({
      events: bus,
      currentSnapshot: () => snap,
      signal: abort.signal,
    });

    // Pull the snapshot (registers the subscriber), THEN publish two deltas before
    // pulling them — both must arrive, in order, with contiguous seq.
    await gen.next();
    bus.publish({ kind: "cwd", cwd: "/work/repo/a" });
    bus.publish({ kind: "cwd", cwd: "/work/repo/b" });
    const d1 = (await gen.next()).value as TerminalFrame;
    const d2 = (await gen.next()).value as TerminalFrame;
    expect(d1).toEqual({
      phase: "delta",
      seq: 1,
      events: [{ kind: "cwd", cwd: "/work/repo/a" }],
    });
    expect(d2).toEqual({
      phase: "delta",
      seq: 2,
      events: [{ kind: "cwd", cwd: "/work/repo/b" }],
    });

    abort.abort();
    await gen.return?.(undefined);
  });
});
