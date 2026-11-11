/**
 * padi's half of the Orchestrator — the bookkeeping, without an adapter.
 *
 * Everything here runs against an injected `spawn` (`OrchestratorDeps.spawn`),
 * which is the whole reason that arrow exists: the facts under test are what
 * padi REMEMBERS, what it hands a reader, what it writes to disk and when, and
 * none of them is a fact about a subprocess. The protocol itself is proven in
 * `@kolu/acp-harness`'s own two-process suite.
 *
 * What it pins, each a defect this file watched land:
 *  - SNAPSHOT-THEN-DELTAS: the first frame a reader gets is a full snapshot,
 *    delivered SYNCHRONOUSLY, so a delta can never arrive first.
 *  - THE RESTART FENCE: a restart restores padi's rows and tells the new
 *    conversation where to start counting (`resumedSeq`), so a resumed
 *    transcript is not two copies of itself — and so does a REPLACEMENT
 *    adapter, which is spawned over rows padi is still holding.
 *  - A FAILED BRING-UP IS SAID OUT LOUD: the panel shows a refusal rather than
 *    an idle-looking composer — an unreadable record included.
 *  - A DEAD ADAPTER IS REPLACED, rather than refusing for the daemon's life.
 *  - A TEARDOWN LEAVES THE RECORD RESUMABLE: the session id and the fleet are
 *    on disk beside the rows, and the stop's own last breath — which says the
 *    session is gone — is not written over them.
 *  - A TEARDOWN IS NOT A WAIT: a drain does not stand there for an open the
 *    agent has not answered, and stops the child anyway.
 */

import type { Harness, HarnessChange, HarnessOptions } from "@kolu/acp-harness";
import {
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorFrame,
  type OrchestratorRow,
  type OrchestratorState,
} from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { ACP_AGENT_ENV, KOLU_MCP_BIN_ENV } from "./bake.ts";
import {
  type OrchestratorHost,
  startOrchestratorHost,
} from "./orchestrator.ts";
import {
  EMPTY_PERSISTED_ORCHESTRATOR,
  type PersistedOrchestrator,
} from "./persisted.ts";

const HOME = "/home/tester";
const HOST = "test-box";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

/** A transcript row, as the harness would mint one. */
const row = (id: string, seq: number, text = id): OrchestratorRow => ({
  id,
  seq,
  since: "2026-01-01T00:00:00.000Z",
  kind: "agent",
  text,
});

/** The conversation this host spawned, as the TEST drives it: the options it
 *  was handed, a way to report movement, a way to take the first breath a real
 *  harness takes at the end of its open, and a way to die the way a child that
 *  exited does. */
interface Spawned {
  readonly options: HarnessOptions;
  readonly push: (change: HarnessChange) => void;
  /** What `startHarness` does on its last line: publish the state it opened
   *  with — the seeded fleet included. */
  readonly opened: () => void;
  readonly die: () => void;
  readonly stops: () => number;
}

function fakeSpawner(): {
  spawn: (options: HarnessOptions) => Promise<Harness>;
  spawns: Spawned[];
} {
  const spawns: Spawned[] = [];
  const spawn = async (options: HarnessOptions): Promise<Harness> => {
    let alive = true;
    let stops = 0;
    let state: OrchestratorState = {
      ...DEFAULT_ORCHESTRATOR_STATE,
      phase: "idle",
      cwd: options.cwd,
      // The real harness seeds its `Fleet` from what the caller remembered and
      // publishes `[...fleet.ids()]`, so what it says about the fleet is what
      // it was handed until a tool call adds to it.
      fleet: [...(options.fleet ?? [])],
    };
    const harness: Harness = {
      state: () => state,
      rows: () => [],
      alive: () => alive,
      prompt: async () => ({ rowId: "sent" }),
      cancel: async () => {},
      answer: async () => true,
      signIn: async () => "signed-in",
      signInInput: async () => {},
      signInCancel: async () => false,
      setOption: async () => {},
      newSession: async () => {},
      stop: async () => {
        stops += 1;
        alive = false;
        // THE LAST BREATH, modelled because it is the thing that bites: a real
        // `stop()` lets the session go and publishes one final state saying
        // so, and padi persists what it is told.
        state = { ...state, phase: "offline", sessionId: null };
        options.onChange({ kind: "state", state });
      },
    };
    spawns.push({
      options,
      push: (change) => {
        if (change.kind === "state") state = change.state;
        options.onChange(change);
      },
      opened: () => {
        options.onChange({ kind: "state", state });
      },
      die: () => {
        alive = false;
      },
      stops: () => stops,
    });
    return harness;
  };
  return { spawn, spawns };
}

/** The conf-backed record, as a counted in-memory store — `reads` is what the
 *  eager-read blocker (every padi unit test crashing in
 *  `buildPadiSurfaceDeps`) is pinned against, `writes` is what the throttle is. */
function countingStore(initial: PersistedOrchestrator): {
  store: CellStore<PersistedOrchestrator>;
  reads: () => number;
  writes: () => number;
  value: () => PersistedOrchestrator;
} {
  let held = initial;
  let reads = 0;
  let writes = 0;
  return {
    store: {
      get: () => {
        reads += 1;
        return held;
      },
      set: (next) => {
        writes += 1;
        held = next;
      },
    },
    reads: () => reads,
    writes: () => writes,
    value: () => held,
  };
}

interface Rig {
  host: OrchestratorHost;
  spawns: Spawned[];
  reads: () => number;
  writes: () => number;
  value: () => PersistedOrchestrator;
}

function rig(
  remembered: PersistedOrchestrator = EMPTY_PERSISTED_ORCHESTRATOR,
  socket: string | null = "/run/padi.sock",
): Rig {
  const { spawn, spawns } = fakeSpawner();
  const backing = countingStore(remembered);
  const host = startOrchestratorHost({
    log,
    home: HOME,
    hostName: HOST,
    socketPath: () => socket,
    store: backing.store,
    storePath: () => "/state/config.json",
    spawn,
  });
  return {
    host,
    spawns,
    reads: backing.reads,
    writes: backing.writes,
    value: backing.value,
  };
}

const SAVED_AGENT = process.env[ACP_AGENT_ENV];
const SAVED_BIN = process.env[KOLU_MCP_BIN_ENV];

beforeEach(() => {
  __resetPadiSurfaceCtxForTest();
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  // The adapter is BAKED, so a seated engine is the normal case; nothing is
  // executed here because `spawn` is injected.
  process.env[ACP_AGENT_ENV] = "/nix/store/fake-acp-adapter";
  process.env[KOLU_MCP_BIN_ENV] = "/nix/store/fake-kolu";
});

afterEach(() => {
  vi.useRealTimers();
  __resetPadiSurfaceCtxForTest();
  if (SAVED_AGENT === undefined) delete process.env[ACP_AGENT_ENV];
  else process.env[ACP_AGENT_ENV] = SAVED_AGENT;
  if (SAVED_BIN === undefined) delete process.env[KOLU_MCP_BIN_ENV];
  else process.env[KOLU_MCP_BIN_ENV] = SAVED_BIN;
});

describe("the transcript a reader is handed", () => {
  it("leads with a SNAPSHOT, synchronously, before `watch` returns", () => {
    const seen: OrchestratorFrame[] = [];
    const r = rig();
    r.host.watch((frame) => seen.push(frame));
    // Synchronous: a stream that queued its first frame a tick later could
    // have a delta queued ahead of it, which is the one ordering the retry
    // fence cannot survive.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("snapshot");
  });

  it("then DELTAS, in the fold order the schema states", async () => {
    const seen: OrchestratorFrame[] = [];
    const r = rig();
    r.host.watch((frame) => seen.push(frame));
    await r.host.prompt("hello", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");

    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "one")],
      removes: [],
      appends: [],
    });
    // Removes BEFORE upserts, appends LAST: this frame drops `a` and re-states
    // it in the same breath, then appends to what it just put there. Folded in
    // any other order the row is either gone or carries the wrong text.
    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "one")],
      removes: ["a"],
      appends: [{ of: "a", at: 3, text: " and two" }],
    });

    expect(seen.map((f) => f.kind)).toEqual(["snapshot", "delta", "delta"]);
    const after: OrchestratorFrame[] = [];
    r.host.watch((frame) => after.push(frame));
    const snapshot = after[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows).toEqual([row("a", 1, "one and two")]);
  });

  it("serves the remembered rows BEFORE the agent is up", () => {
    const r = rig({
      ...EMPTY_PERSISTED_ORCHESTRATOR,
      sessionId: "sess-1",
      cwd: HOME,
      rows: [row("old-1", 1), row("old-2", 2)],
    });
    const seen: OrchestratorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows.map((one) => one.id)).toEqual(["old-1", "old-2"]);
    expect(r.host.state().sessionId).toBe("sess-1");
  });
});

describe("the restart fence (B1)", () => {
  const persisted: PersistedOrchestrator = {
    sessionId: "sess-1",
    cwd: HOME,
    model: null,
    rows: [row("old-1", 1), row("old-2", 2), row("old-3", 3)],
    fleet: [],
  };

  it("resumes the session and tells the new conversation where to count from", async () => {
    const r = rig(persisted);
    await r.host.prompt("still here?", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.resume).toBe("sess-1");
    // The highest `seq` padi already holds. Anything the new process mints
    // sorts after it and cannot collide with a persisted id.
    expect(agent.options.resumedSeq).toBe(3);
  });

  it("does NOT double the transcript when the host restarts over it", async () => {
    const r = rig(persisted);
    const seen: OrchestratorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows).toHaveLength(3);

    // The resumed conversation says ONE new thing. Before the fence, the load
    // replayed the agent's half through a fresh counter and every row landed a
    // second time under a new id.
    await r.host.prompt("one more", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "rows",
      upserts: [row("new-1", (agent.options.resumedSeq ?? 0) + 1)],
      removes: [],
      appends: [],
    });

    const after: OrchestratorFrame[] = [];
    r.host.watch((frame) => after.push(frame));
    const snapshot = after[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows.map((one) => one.id)).toEqual([
      "old-1",
      "old-2",
      "old-3",
      "new-1",
    ]);
  });

  it("drops the session, the rows AND the fleet when `$HOME` moved", () => {
    const r = rig({
      ...persisted,
      cwd: "/home/somebody-else",
      fleet: ["11111111-1111-4111-8111-111111111111"],
    });
    const seen: OrchestratorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows).toEqual([]);
    expect(r.host.state().sessionId).toBeNull();
    // A fleet strip naming the terminals of a conversation that is not coming
    // back is the same lie the transcript would have been.
    expect(r.host.state().fleet).toEqual([]);
  });
});

describe("the remembered record is read on the first reader's edge (B3)", () => {
  it("touches the store NOT AT ALL at construction", () => {
    const r = rig();
    // `buildPadiSurfaceDeps` runs before padi's boot injects the conf store —
    // and never injects it at all in a unit test — so a read here is a crash
    // in every test that assembles padi's surface.
    expect(r.reads()).toBe(0);
    // Including the serve-time cell seed, which reads this.
    expect(r.host.state().phase).toBe("offline");
    expect(r.reads()).toBe(0);
  });

  it("reads it ONCE, however many readers look", async () => {
    const r = rig();
    r.host.watch(() => {});
    r.host.watch(() => {});
    await r.host.prompt("hi", []);
    expect(r.reads()).toBe(1);
  });
});

describe("a bring-up that did not get there (M2)", () => {
  it("publishes the refusal instead of leaving an idle-looking panel", async () => {
    // No socket yet: the conversation cannot be told where this host's
    // terminals are, and `koluServer()` refuses synchronously.
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, null);
    await expect(r.host.prompt("hello", [])).rejects.toThrow();
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain("has not published its socket");
  });

  it("reaches a READER, who has nothing to catch", () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, null);
    r.host.watch(() => {});
    // The bring-up a subscription triggers cannot throw at anybody — the cell
    // is the only place it can be said.
    expect(r.host.state().refusal).toContain("has not published its socket");
  });
});

describe("a dead adapter (M3)", () => {
  it("is stopped, dropped and replaced rather than refusing forever", async () => {
    const r = rig();
    await r.host.prompt("first", []);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");

    first.die();
    await r.host.newSession();
    expect(r.spawns).toHaveLength(2);
    // The corpse is stopped, not merely forgotten: its pipes and its child's
    // children are what would otherwise be left behind.
    expect(first.stops()).toBe(1);
  });

  it("fences the REPLACEMENT on the rows padi still holds (R2)", async () => {
    // A fresh state-root: nothing was restored, so a fence taken at the
    // restore is zero forever.
    const r = rig();
    await r.host.prompt("first", []);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(first.options.resumedSeq).toBe(0);
    first.push({
      kind: "rows",
      upserts: [row("user:1", 1, "ask"), row("agent:2", 2, "answer")],
      removes: [],
      appends: [],
    });

    first.die();
    await r.host.newSession();
    const second = r.spawns[1];
    if (second === undefined) throw new Error("the corpse was not replaced");
    // The rows are padi's, not the dead harness's: a replacement told to count
    // from zero mints `user:1` and `agent:2` a second time and overwrites them
    // by id, and the transcript loses the conversation it is displaying.
    expect(second.options.resumedSeq).toBe(2);

    second.push({
      kind: "rows",
      upserts: [row("user:3", 3, "again")],
      removes: [],
      appends: [],
    });
    const seen: OrchestratorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const snapshot = seen[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows.map((one) => one.id)).toEqual([
      "user:1",
      "agent:2",
      "user:3",
    ]);
  });

  it("keeps a LIVING adapter, however many verbs arrive", async () => {
    const r = rig();
    await r.host.prompt("first", []);
    await r.host.prompt("second", []);
    await r.host.cancel();
    expect(r.spawns).toHaveLength(1);
  });
});

describe("the standing prompt (M5)", () => {
  it("names the HOST, and leaves `$HOME` to be the cwd", async () => {
    const r = rig();
    await r.host.prompt("hello", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.cwd).toBe(HOME);
    expect(agent.options.teaching[0]).toContain(`orchestrator on ${HOST}`);
    // The old defect, stated as a negative: a directory is not a machine.
    expect(agent.options.teaching[0]).not.toContain(`orchestrator on ${HOME}`);
  });
});

describe("the record is written on a throttle (M4)", () => {
  it("costs one write per window, not one per streamed frame", async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("stream at me", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");

    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "")],
      removes: [],
      appends: [],
    });
    const afterFirst = r.writes();
    // Leading edge: the first movement is durable immediately.
    expect(afterFirst).toBe(1);

    for (let i = 0; i < 200; i += 1) {
      agent.push({
        kind: "rows",
        upserts: [],
        removes: [],
        appends: [{ of: "a", at: i, text: "x" }],
      });
    }
    // …and a burst inside the window costs nothing more until it closes.
    expect(r.writes()).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.writes()).toBe(afterFirst + 1);
    expect(r.value().rows[0]).toMatchObject({ id: "a", text: "x".repeat(200) });
  });

  it("flushes what the window still owes on dispose", async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("hello", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "rows",
      upserts: [row("a", 1)],
      removes: [],
      appends: [],
    });
    const before = r.writes();
    agent.push({
      kind: "rows",
      upserts: [row("b", 2)],
      removes: [],
      appends: [],
    });
    expect(r.writes()).toBe(before);

    await r.host.dispose();
    expect(r.writes()).toBe(before + 1);
    expect(r.value().rows.map((one) => one.id)).toEqual(["a", "b"]);
  });
});

describe("teardown (B2)", () => {
  it("AWAITS the child's stop", async () => {
    const r = rig();
    await r.host.prompt("hello", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    await r.host.dispose();
    // The adapter is spawned `detached`; a dispose that returned before the
    // stop landed would let the process exit with the child still up.
    expect(agent.stops()).toBe(1);
  });

  it("stops a bring-up that was still IN FLIGHT", async () => {
    const { spawn, spawns } = fakeSpawner();
    const held = Promise.withResolvers<void>();
    const backing = countingStore(EMPTY_PERSISTED_ORCHESTRATOR);
    const host = startOrchestratorHost({
      log,
      home: HOME,
      hostName: HOST,
      socketPath: () => "/run/padi.sock",
      store: backing.store,
      storePath: () => "/state/config.json",
      spawn: async (options) => {
        await held.promise;
        return spawn(options);
      },
    });
    const sent = host.prompt("hello", []);
    const stopped = host.dispose();
    held.resolve();
    await sent.catch(() => {});
    await stopped;
    // The orphan this await exists for: without it the child is spawned after
    // the daemon decided to stop and nothing ever reaches it.
    expect(spawns[0]?.stops()).toBe(1);
  });

  it("keeps the SESSION in the record it flushes (R1)", async () => {
    const r = rig();
    await r.host.prompt("hello", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "state",
      state: {
        ...DEFAULT_ORCHESTRATOR_STATE,
        phase: "idle",
        cwd: HOME,
        sessionId: "s-1",
      },
    });
    agent.push({
      kind: "rows",
      upserts: [row("a", 1)],
      removes: [],
      appends: [],
    });

    await r.host.dispose();
    // The stop's own last breath nulls the session, and padi persists what it
    // is told — so without the guard every drain and every upgrade writes a
    // transcript beside `sessionId: null`, and the next padi restores the rows
    // into a conversation it opens FRESH. The rows and the session go to disk
    // together or the resume is a lie.
    expect(r.value().sessionId).toBe("s-1");
    expect(r.value().rows.map((one) => one.id)).toEqual(["a"]);
  });

  it("does not stand there for an open that is still on the wire (R7)", async () => {
    vi.useFakeTimers();
    const { spawn, spawns } = fakeSpawner();
    const held = Promise.withResolvers<void>();
    const backing = countingStore(EMPTY_PERSISTED_ORCHESTRATOR);
    const host = startOrchestratorHost({
      log,
      home: HOME,
      hostName: HOST,
      socketPath: () => "/run/padi.sock",
      store: backing.store,
      storePath: () => "/state/config.json",
      spawn: async (options) => {
        // A `session/load` the agent has not answered: the harness's own
        // deadline for one is two minutes.
        await held.promise;
        return spawn(options);
      },
    });
    const sent = host.prompt("hello", []);
    let settled = false;
    const stopped = host.dispose().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    // A drain, an upgrade or a SIGTERM is not waiting out a replay nobody is
    // watching.
    expect(settled).toBe(true);
    await stopped;

    // …and the child is still stopped when it finally lands, because the stop
    // rides the same promise rather than the wait.
    held.resolve();
    await sent.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(spawns[0]?.stops()).toBe(1);
  });

  it("refuses new work once it has stopped", async () => {
    const r = rig();
    await r.host.dispose();
    await expect(r.host.prompt("hello", [])).rejects.toThrow(
      /no longer accepting work/,
    );
  });
});

describe("the remembered fleet survives the resume (R3)", () => {
  const fleet = ["11111111-1111-4111-8111-111111111111"];

  it("is handed to the conversation and not published away under it", async () => {
    const r = rig({
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      rows: [row("old-1", 1)],
      fleet,
    });
    await r.host.prompt("still here?", []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    // Membership otherwise accrues only from tool-call frames, and a resumed
    // conversation's frames are the replay the harness drops — so a harness
    // that was not handed this starts empty.
    expect(agent.options.fleet).toEqual(fleet);

    // The first breath of the open, which is a WHOLE state: whatever it says
    // about the fleet replaces what padi was serving, and padi writes it.
    agent.opened();
    expect(r.host.state().fleet).toEqual(fleet);
    await r.host.dispose();
    expect(r.value().fleet).toEqual(fleet);
  });
});

describe("a record that parses but is wrong (R8)", () => {
  it("says the refusal where a READER is looking, as well as throwing", () => {
    // A row with no `kind` — the shape a hand-edit or a rolled-back binary
    // leaves behind. The read runs on the `watch` edge, outside the bring-up's
    // own refusal arm.
    const r = rig({
      ...EMPTY_PERSISTED_ORCHESTRATOR,
      cwd: HOME,
      rows: [{ id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" }],
    } as unknown as PersistedOrchestrator);
    expect(() => r.host.watch(() => {})).toThrow(/does not match schema/);
    // Without this the cell still said `refusal: null`, and a person holding
    // an unreadable state-root got an idle-looking panel with a live composer
    // under it instead of the name of the file to fix.
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain("/state/config.json");
  });
});
