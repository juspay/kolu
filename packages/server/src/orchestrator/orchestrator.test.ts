/**
 * kolu-server's half of the Orchestrator — the bookkeeping, without an adapter.
 *
 * Everything here runs against an injected `spawn` (`OrchestratorDeps.spawn`),
 * which is the whole reason that arrow exists: the facts under test are what
 * kolu-server REMEMBERS, what it hands a reader, what it writes to disk and
 * when, and none of them is a fact about a subprocess. The protocol itself is
 * proven in `@kolu/acp-harness`'s own two-process suite.
 *
 * What it pins, each a defect this file watched land:
 *  - SNAPSHOT-THEN-DELTAS: the first frame a reader gets is a full snapshot,
 *    delivered SYNCHRONOUSLY, so a delta can never arrive first.
 *  - THE RESTART FENCE: a restart restores our rows and tells the new
 *    conversation where to start counting (`resumedSeq`), so a resumed
 *    transcript is not two copies of itself — and so does a REPLACEMENT
 *    adapter, which is spawned over rows we are still holding.
 *  - A FAILED BRING-UP IS SAID OUT LOUD: the panel shows a refusal rather than
 *    an idle-looking composer — an unreadable record included.
 *  - A DEAD ADAPTER IS REPLACED, rather than refusing for the process's life.
 *  - A TEARDOWN LEAVES THE RECORD RESUMABLE: the session id and the fleet are
 *    on disk beside the rows, and the stop's own last breath — which says the
 *    session is gone — is not written over them.
 *  - A TEARDOWN IS NOT A WAIT: a drain does not stand there for an open the
 *    agent has not answered, and stops the child anyway.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Harness,
  HarnessChange,
  HarnessOptions,
  HarnessState,
} from "@kolu/acp-harness";
import {
  ATTACHMENT_BYTE_CAP,
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorAttachment,
  type OrchestratorFrame,
  type OrchestratorRow,
  PROMPT_ATTACHMENT_BYTE_CAP,
} from "kolu-common/orchestrator";
import {
  chunkBase64,
  FRAME_CHUNK_BYTES,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import { exceedsFrameLimit } from "@kolu/surface/frame-limit";
import type { CellStore } from "@kolu/surface/server";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_ENV } from "@kolu/acp/engine";
import {
  type FleetMcpEndpoint,
  type OrchestratorHost,
  startOrchestratorHost,
  UNSENT_ATTACHMENT_MS,
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
  /** The attachments this conversation was HANDED, per prompt — what kolu-server
   *  wrote and filled in before the agent was told anything. */
  readonly handed: () => ReadonlyArray<ReadonlyArray<OrchestratorAttachment>>;
}

function fakeSpawner(): {
  spawn: (options: HarnessOptions) => Promise<Harness>;
  spawns: Spawned[];
} {
  const spawns: Spawned[] = [];
  const spawn = async (options: HarnessOptions): Promise<Harness> => {
    let alive = true;
    let stops = 0;
    const handed: ReadonlyArray<OrchestratorAttachment>[] = [];
    let state: HarnessState = {
      ...DEFAULT_ORCHESTRATOR_STATE,
      phase: "idle",
      // The real harness seeds its `Fleet` from what the caller remembered and
      // publishes `[...fleet.ids()]`, so what it says about the fleet is what
      // it was handed until a tool call adds to it.
      fleet: [...(options.fleet ?? [])],
    };
    const harness: Harness = {
      state: () => state,
      rows: () => [],
      alive: () => alive,
      prompt: async (_text, _mentions, attachments) => {
        handed.push(attachments);
        return { rowId: "sent" };
      },
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
        // so, and kolu-server persists what it is told.
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
      handed: () => handed,
    });
    return harness;
  };
  return { spawn, spawns };
}

/** The conf-backed record, as a counted in-memory store — `reads` is what the
 *  eager-read blocker (a construction that read the store before the boot
 *  had one) is pinned against, `writes` is what the throttle is. */
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
  endpoint: FleetMcpEndpoint | null = liveEndpoint,
  root = "/state",
): Rig {
  const { spawn, spawns } = fakeSpawner();
  const backing = countingStore(remembered);
  const host = startOrchestratorHost({
    log,
    home: HOME,
    hostName: HOST,
    fleetMcp: () => endpoint,
    // The served cell, as a sink. Nothing here reads it back — what a reader
    // sees is `host.state()`, which is the same value — so this only has to
    // not throw, the way the real writer does not once the surface is up.
    publish: () => {},
    store: backing.store,
    storePath: () => join(root, "config.json"),
    stateRoot: root,
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

const SAVED_AGENT = process.env[AGENT_ENV];

/** AN ENDPOINT THAT ANSWERS, because the host now proves the fleet MCP face
 *  before it hands the URL to an agent — and the proof is a real request, so
 *  there is nothing to stub. Every test that brings a conversation up
 *  therefore exercises the proof as well as what it was written for.
 *
 *  It answers `400` with the transport's own "not initialized" body, which is
 *  exactly what the real streamable-HTTP endpoint answers a `ping` that opened
 *  no session — so a proof that started demanding `200` would fail here first.
 *  A request without the bearer token gets `401`, because the gate is half of
 *  what the proof is proving. */
let liveEndpoint: FleetMcpEndpoint;
let listener: Server;

beforeEach(async () => {
  // The adapter is BAKED, so a seated engine is the normal case; nothing is
  // executed here because `spawn` is injected.
  process.env[AGENT_ENV] = "/nix/store/fake-acp-adapter";
  const token = "0123456789abcdef";
  listener = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_000, message: "Bad Request: Server not initialized" },
      }),
    );
  });
  const up = Promise.withResolvers<void>();
  listener.listen(0, "127.0.0.1", up.resolve);
  await up.promise;
  const bound = listener.address();
  if (bound === null || typeof bound === "string") {
    throw new Error("the fleet endpoint fixture did not bind a TCP port");
  }
  liveEndpoint = { url: `http://127.0.0.1:${bound.port}/mcp`, token };
});

afterEach(async () => {
  vi.useRealTimers();
  if (SAVED_AGENT === undefined) delete process.env[AGENT_ENV];
  else process.env[AGENT_ENV] = SAVED_AGENT;
  const down = Promise.withResolvers<void>();
  listener.close(() => {
    down.resolve();
  });
  await down.promise;
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
    await r.host.prompt("hello", [], []);
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

  it("takes `at` as AUTHORITATIVE, so a re-sent piece does not stutter", async () => {
    const r = rig();
    r.host.watch(() => {});
    await r.host.prompt("hello", [], []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "one")],
      removes: [],
      appends: [],
    });
    // The SAME piece twice — a frame delivered to this fold a second time.
    // our map is what the record is written from, so a fold that ignored
    // `at` would leave a doubled fragment on disk that no reader ever saw.
    const saying: HarnessChange = {
      kind: "rows",
      upserts: [],
      removes: [],
      appends: [{ of: "a", at: 3, text: " and two" }],
    };
    agent.push(saying);
    agent.push(saying);

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
    await r.host.prompt("still here?", [], []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.resume).toBe("sess-1");
    // The highest `seq` we already hold. Anything the new process mints
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
    await r.host.prompt("one more", [], []);
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
    // The host is built before the surface exists — and there is no surface at
    // all in a unit test — so a read here is a crash in every test that
    // assembles kolu-server's surface.
    expect(r.reads()).toBe(0);
    // Including the serve-time cell seed, which reads this.
    expect(r.host.state().phase).toBe("offline");
    expect(r.reads()).toBe(0);
  });

  it("reads it ONCE, however many readers look", async () => {
    const r = rig();
    r.host.watch(() => {});
    r.host.watch(() => {});
    await r.host.prompt("hi", [], []);
    expect(r.reads()).toBe(1);
  });
});

describe("a bring-up that did not get there (M2)", () => {
  it("publishes the refusal instead of leaving an idle-looking panel", async () => {
    // No endpoint yet: the conversation cannot be told where the fleet's
    // terminals are, and the bring-up refuses before it spawns anything.
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, null);
    await expect(r.host.prompt("hello", [], [])).rejects.toThrow();
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain(
      "has not published its fleet MCP endpoint",
    );
  });

  it("refuses an endpoint NOBODY IS SERVING rather than handing the agent a dead URL", async () => {
    // The failure this exists for: the orchestrator took its endpoint on faith
    // and had never checked it was being served, so a URL that answered
    // nothing was handed over exactly like a good one. The agent's MCP client
    // then cannot connect, the agent marks the server failed ONCE inside
    // `session/new` and never revisits it, and the conversation carries on
    // running shell commands itself — the one failure this feature exists to
    // prevent, and invisible but for a grey word on a roster.
    //
    // Port 1 on loopback: privileged, bound by nothing, so the connect is
    // refused by the kernel rather than by a timeout.
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, {
      url: "http://127.0.0.1:1/mcp",
      token: "unused",
    });
    await expect(r.host.prompt("hello", [], [])).rejects.toThrow(
      /cannot reach this kolu's fleet MCP face/,
    );
    // Nothing was spawned: an adapter with no hands is not a degraded
    // orchestrator, it is a chat window.
    expect(r.spawns).toHaveLength(0);
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain("http://127.0.0.1:1/mcp");
  });

  it("refuses an endpoint that REJECTS the token rather than opening with no hands", async () => {
    // The other half of the proof, and the one a reachability check would
    // miss: something IS listening, and it will not let this process in. An
    // agent handed those headers is refused the same way and carries on
    // without the fleet.
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, {
      ...liveEndpoint,
      token: "not-the-token-this-process-minted",
    });
    await expect(r.host.prompt("hello", [], [])).rejects.toThrow(
      /was refused by this kolu's fleet MCP face/,
    );
    expect(r.spawns).toHaveLength(0);
    expect(r.host.state().refusal).toContain("401");
  });

  it("reaches a READER, who has nothing to catch", async () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, null);
    r.host.watch(() => {});
    // The bring-up a subscription triggers cannot throw at anybody — the cell
    // is the only place it can be said. Waited for rather than read straight
    // off, because the bring-up is one promise from its first step (it begins
    // by proving the fleet endpoint), so even a refusal it reaches immediately
    // is published a tick later.
    await vi.waitFor(() => {
      expect(r.host.state().refusal).toContain(
        "has not published its fleet MCP endpoint",
      );
    });
  });
});

describe("a dead adapter (M3)", () => {
  it("is stopped, dropped and replaced rather than refusing forever", async () => {
    const r = rig();
    await r.host.prompt("first", [], []);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");

    first.die();
    await r.host.newSession();
    expect(r.spawns).toHaveLength(2);
    // The corpse is stopped, not merely forgotten: its pipes and its child's
    // children are what would otherwise be left behind.
    expect(first.stops()).toBe(1);
  });

  it("fences the REPLACEMENT on the rows we still hold (R2)", async () => {
    // A fresh state-root: nothing was restored, so a fence taken at the
    // restore is zero forever.
    const r = rig();
    await r.host.prompt("first", [], []);
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
    // The rows are ours, not the dead harness's: a replacement told to count
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
    await r.host.prompt("first", [], []);
    await r.host.prompt("second", [], []);
    await r.host.cancel();
    expect(r.spawns).toHaveLength(1);
  });
});

describe("the standing prompt (M5)", () => {
  it("names the HOST, and leaves `$HOME` to be the cwd", async () => {
    const r = rig();
    await r.host.prompt("hello", [], []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.cwd).toBe(HOME);
    expect(agent.options.teaching[0]).toContain(`You run on ${HOST}`);
    // The old defect, stated as a negative: a directory is not a machine.
    expect(agent.options.teaching[0]).not.toContain(HOME);
    // …and the fleet grammar is TAUGHT, not assumed: one conversation over
    // every host is only usable if `host/id` is the identity on the wire.
    expect(agent.options.teaching.join("\n")).toContain("`host/id`");
  });
});

describe("the record is written on a throttle (M4)", () => {
  it("costs one write per window, not one per streamed frame", async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("stream at me", [], []);
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
    await r.host.prompt("hello", [], []);
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
    await r.host.prompt("hello", [], []);
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
      fleetMcp: () => liveEndpoint,
      publish: () => {},
      store: backing.store,
      storePath: () => "/state/config.json",
      stateRoot: "/state",
      spawn: async (options) => {
        await held.promise;
        return spawn(options);
      },
    });
    const sent = host.prompt("hello", [], []);
    const stopped = host.dispose();
    held.resolve();
    await sent.catch(() => {});
    await stopped;
    // The orphan this await exists for: without it the child is spawned after
    // the process decided to stop and nothing ever reaches it.
    expect(spawns[0]?.stops()).toBe(1);
  });

  it("keeps the SESSION in the record it flushes (R1)", async () => {
    const r = rig();
    await r.host.prompt("hello", [], []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "state",
      state: {
        ...DEFAULT_ORCHESTRATOR_STATE,
        phase: "idle",
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
    // The stop's own last breath nulls the session, and we persist what it
    // is told — so without the guard every drain and every upgrade writes a
    // transcript beside `sessionId: null`, and the next boot restores the rows
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
      fleetMcp: () => liveEndpoint,
      publish: () => {},
      store: backing.store,
      storePath: () => "/state/config.json",
      stateRoot: "/state",
      spawn: async (options) => {
        // A `session/load` the agent has not answered: the harness's own
        // deadline for one is two minutes.
        await held.promise;
        return spawn(options);
      },
    });
    const sent = host.prompt("hello", [], []);
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
    await expect(r.host.prompt("hello", [], [])).rejects.toThrow(
      /no longer accepting work/,
    );
  });
});

describe("the remembered fleet survives the resume (R3)", () => {
  const fleet = ["local/11111111-1111-4111-8111-111111111111"];

  it("is handed to the conversation and not published away under it", async () => {
    const r = rig({
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      rows: [row("old-1", 1)],
      fleet,
    });
    await r.host.prompt("still here?", [], []);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    // Membership otherwise accrues only from tool-call frames, and a resumed
    // conversation's frames are the replay the harness drops — so a harness
    // that was not handed this starts empty.
    expect(agent.options.fleet).toEqual(fleet);

    // The first breath of the open, which is a WHOLE state: whatever it says
    // about the fleet replaces what we were serving, and we write it.
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

describe("a prompt's attachments", () => {
  /** One pixel of PNG, base64 and nothing else — no `data:` prefix, because
   *  no prompt frame ever carries these bytes. */
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  /** The chip a prompt carries: a name, a size and the path kolu-server answered
   *  with. The bytes went up separately, chunk by chunk. */
  const chip = (
    over: Partial<OrchestratorAttachment> = {},
  ): OrchestratorAttachment => ({
    id: "att-1",
    name: "pixel.png",
    mimeType: "image/png",
    bytes: 70,
    path: join(root, "orchestrator", "attachments", "att-1"),
    ...over,
  });

  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kolu-orch-att-"));
    dir = join(root, "orchestrator", "attachments");
  });

  it("takes a file BIGGER THAN ONE FRAME, in pieces, and puts it back together", async () => {
    // THE DEFECT THIS PINS: the whole base64 on one `prompt` frame. The RPC
    // decoder does not fail an oversized frame — it closes the socket with
    // 1009 and takes every subscription in the tab with it. So the test is
    // not only that the file round-trips, but that no single call it took to
    // get here would have busted the cap.
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    const whole = Buffer.alloc(FRAME_CHUNK_BYTES + 4096, 7);
    const pieces = chunkBase64(whole.toString("base64"));
    expect(pieces.length).toBeGreaterThan(1);

    let path: string | undefined;
    let bytes = 0;
    for (const data of pieces) {
      expect(exceedsFrameLimit(frameBytesFor(data.length))).toBe(false);
      const answer = r.host.attach({
        id: "att-1",
        name: "big.bin",
        mimeType: "application/octet-stream",
        data,
        ...(path === undefined ? {} : { appendTo: path }),
      });
      // The first call CREATES and every later one appends to the path it was
      // handed — a path that changed under the sender would silently split
      // one file into two.
      if (path !== undefined) expect(answer.path).toBe(path);
      path = answer.path;
      expect(answer.bytes).toBeGreaterThan(bytes);
      bytes = answer.bytes;
    }
    expect(bytes).toBe(whole.byteLength);
    expect(readFileSync(join(dir, "att-1")).equals(whole)).toBe(true);

    // ...and the prompt that names it hands the agent that same file.
    await r.host.prompt("look", [], [chip({ name: "big.bin", bytes: 1 })]);
    const one = r.spawns[0]?.handed()[0]?.[0];
    if (one === undefined) throw new Error("nothing was handed over");
    expect(one.path).toBe(join(dir, "att-1"));
    // `bytes` is re-read from the file, never carried over from the claim —
    // the chip above said 1.
    expect(one.bytes).toBe(whole.byteLength);
  });

  it("refuses an id that is not a filename, rather than writing where it says", () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    expect(() =>
      r.host.attach({
        id: "../../escaped",
        name: "escaped",
        mimeType: "text/plain",
        data: PIXEL,
      }),
    ).toThrow(/not a name this server will write a file under/);
  });

  it("refuses an `appendTo` that points outside the attachments directory", () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    r.host.attach({
      id: "att-1",
      name: "pixel.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    // The continuation token is client-supplied. Trusted, it would turn an
    // upload into an arbitrary-file append.
    const victim = join(root, "victim.txt");
    writeFileSync(victim, "theirs");
    expect(() =>
      r.host.attach({
        id: "att-1",
        name: "pixel.png",
        mimeType: "image/png",
        data: PIXEL,
        appendTo: victim,
      }),
    ).toThrow(/not this attachment's file/);
    expect(readFileSync(victim, "utf8")).toBe("theirs");
  });

  it("refuses a file that grows past the per-attachment cap AS IT IS WRITTEN", () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    // Each half is legal on its own; together they are one byte over. The
    // cap has to be enforced on the FILE as it grows, or an unlimited upload
    // goes through as an unlimited number of legal chunks.
    const half = Buffer.alloc(ATTACHMENT_BYTE_CAP / 2 + 1, 3).toString(
      "base64",
    );
    const first = r.host.attach({
      id: "att-1",
      name: "huge.bin",
      mimeType: "application/octet-stream",
      data: half,
    });
    expect(() =>
      r.host.attach({
        id: "att-1",
        name: "huge.bin",
        mimeType: "application/octet-stream",
        data: half,
        appendTo: first.path,
      }),
    ).toThrow(/at most 10 MiB/);
    // Dropped rather than left half-written: a file the cap refused must not
    // be one a prompt can still name.
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a MESSAGE whose files come to more than the per-prompt cap", async () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    // Three files, each well under the per-attachment cap, that come to more
    // than one message may carry.
    const third = Buffer.alloc(
      Math.ceil(PROMPT_ATTACHMENT_BYTE_CAP / 3) + 1,
      9,
    ).toString("base64");
    const three = ["att-1", "att-2", "att-3"].map((id) => {
      const answer = r.host.attach({
        id,
        name: `${id}.bin`,
        mimeType: "application/octet-stream",
        data: third,
      });
      return chip({ id, name: `${id}.bin`, ...answer });
    });
    await expect(r.host.prompt("all three", [], three)).rejects.toThrow(
      /at most 20 MiB/,
    );
  });

  it("refuses a message naming a file this host no longer holds", async () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    await expect(
      r.host.prompt("look", [], [chip({ id: "never-uploaded" })]),
    ).rejects.toThrow(/no longer on this host/);
  });

  it("sweeps files the restored transcript no longer names", async () => {
    // A state-root whose record kept ONE row naming ONE attachment, and two
    // files on disk: the record's row cap trimmed the row the second came in
    // on, and nothing else will ever mention it again.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "att-1"), "kept");
    writeFileSync(join(dir, "att-2"), "orphan");
    const r = rig(
      {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        rows: [
          {
            id: "user-1",
            seq: 1,
            since: "2026-01-01T00:00:00.000Z",
            kind: "user",
            text: "look",
            attachments: [chip({ bytes: 4, path: join(dir, "att-1") })],
          },
        ],
        fleet: [],
      },
      liveEndpoint,
      root,
    );
    r.host.watch(() => {});
    expect(readdirSync(dir)).toEqual(["att-1"]);
  });

  it("a REFUSED prompt leaves no file the transcript does not name", async () => {
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    const sent = ["att-1", "att-2"].map((id) => {
      const answer = r.host.attach({
        id,
        name: `${id}.png`,
        mimeType: "image/png",
        data: PIXEL,
      });
      return chip({ id, name: `${id}.png`, ...answer });
    });
    // A third file, uploaded and NOT named by the refused message: it belongs
    // to the composer that is still holding it, and must survive.
    r.host.attach({
      id: "att-3",
      name: "att-3.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    await expect(
      r.host.prompt("look", [], [...sent, chip({ id: "gone" })]),
    ).rejects.toThrow(/no longer on this host/);
    // The bytes of a message that never went do not sit in the state root
    // waiting for a server restart to notice them.
    expect(readdirSync(dir)).toEqual(["att-3"]);
  });

  it("does not keep an upload nobody ever sent", () => {
    // Only `Date` is faked: the bring-up below is a real HTTP request, and a
    // frozen event loop would hang it.
    vi.useFakeTimers({ toFake: ["Date"] });
    const r = rig(EMPTY_PERSISTED_ORCHESTRATOR, liveEndpoint, root);
    r.host.attach({
      id: "att-1",
      name: "att-1.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    expect(readdirSync(dir)).toEqual(["att-1"]);
    // Long enough that nobody is still typing the message it was for. The
    // next upload — what makes the directory grow — is what reaps it.
    vi.setSystemTime(Date.now() + UNSENT_ATTACHMENT_MS + 1);
    r.host.attach({
      id: "att-2",
      name: "att-2.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    expect(readdirSync(dir)).toEqual(["att-2"]);
  });
});

describe("a run of NEW SESSION dividers", () => {
  const divider = (id: string, seq: number): OrchestratorRow => ({
    id,
    seq,
    since: "2026-01-01T00:00:00.000Z",
    kind: "divider",
    text: "new session",
  });

  it("restores as ONE — a run of them is one reset, however it got written", () => {
    const r = rig({
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      rows: [
        row("agent-1", 1, "you're welcome"),
        divider("div-1", 2),
        divider("div-2", 3),
        divider("div-3", 4),
        divider("div-4", 5),
      ],
      fleet: [],
    });
    const seen: OrchestratorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const snapshot = seen[0];
    if (snapshot?.kind !== "snapshot") throw new Error("no snapshot");
    // The FIRST of the run is the one kept: the reset happened there, and a
    // rule that kept the last would draw the line later than the event.
    expect(snapshot.rows.map((one) => one.id)).toEqual(["agent-1", "div-1"]);
  });

  it("tells a fresh conversation its last row is ALREADY a divider", async () => {
    // THE DEFECT: `Transcript.divider()` refuses a second consecutive divider
    // by looking at the rows IT minted, and a respawn builds a fresh one — so
    // a `newSession` straight after would mint a rule beside our last row,
    // which is already a rule, and the panel would draw two for one reset
    // until the next boot read collapsed them. The seed crosses the same
    // seam `resumedSeq` does.
    const r = rig({
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      rows: [row("agent-1", 1, "you're welcome"), divider("div-1", 2)],
      fleet: [],
    });
    r.host.watch(() => {});
    await r.host.newSession();
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(first.options.resumedEndsWithDivider).toBe(true);

    // ...and a REPLACEMENT is told the same thing, read off the rows we are
    // still holding rather than off the record it booted from.
    first.die();
    await r.host.newSession();
    expect(r.spawns[1]?.options.resumedEndsWithDivider).toBe(true);
  });

  it("says so when the last row is NOT a divider — the guard is a fact, not a default", async () => {
    const r = rig({
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      rows: [divider("div-1", 1), row("agent-1", 2, "hello")],
      fleet: [],
    });
    await r.host.newSession();
    expect(r.spawns[0]?.options.resumedEndsWithDivider).toBe(false);
  });
});
