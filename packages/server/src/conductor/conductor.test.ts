/**
 * kolu-server's half of the Conductor — the bookkeeping, without an adapter.
 *
 * Everything here runs against an injected `spawn` (`ConductorDeps.spawn`),
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
 *  - THE WIPE IS THE HOST'S: `clearSession` empties the rows, the record, the
 *    files and the remembered fleet together, and leaves no divider — while
 *    `newSession` beside it keeps every one of them.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
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
  DEFAULT_CONDUCTOR_STATE,
  type ConductorAttachment,
  type ConductorFrame,
  type ConductorRow,
  type ConductorWakeEvent,
  PROMPT_ATTACHMENT_BYTE_CAP,
} from "kolu-common/conductor";
import {
  chunkBase64,
  FRAME_CHUNK_BYTES,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import { exceedsFrameLimit } from "@kolu/surface/frame-limit";
import type { CellStore } from "@kolu/surface/server";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { KOLU_FLEET_EXPOSE, KOLU_FLEET_TOOL_NAMES } from "kolu-mcp";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_ENV } from "@kolu/acp/engine";
import {
  type FleetMcpEndpoint as LiveFleetMcpEndpoint,
  proveFleetMcpEndpoint,
  startFleetMcpEndpoint,
} from "../fleet/mcpEndpoint.ts";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  UNSENT_ATTACHMENT_MS,
  startConductorHost,
  type ConductorHost,
  type FleetMcpEndpoint,
  type PersistedConductor,
  type WatchLevel,
  type WatchObservation,
  type WatchRoot,
} from "kolu-conductor";

const HOME = "/home/tester";
const HOST = "test-box";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

/** A transcript row, as the harness would mint one. */
const row = (id: string, seq: number, text = id): ConductorRow => ({
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
  /** How many times this conversation was asked for a NEW session — what a
   *  wipe must have done to the agent, as distinct from what it did to our
   *  rows. */
  readonly sessions: () => number;
  /** What this conversation does ON ITS WAY OUT of `newSession`. The real
   *  harness mints a `— new session —` row there, and the only way to pin
   *  what the wipe does with that row is to let a test interleave at the same
   *  point. */
  readonly onNewSession: (run: () => void) => void;
  /** The attachments this conversation was HANDED, per prompt — what kolu-server
   *  wrote and filled in before the agent was told anything. */
  readonly handed: () => ReadonlyArray<ReadonlyArray<ConductorAttachment>>;
  /** EVERY WAKE THIS CONVERSATION WAS SENT, in order — the only record of
   *  what the held news became, since a wake's row is the harness's to mint
   *  and this stand-in mints none. */
  readonly wakes: () => ReadonlyArray<{
    text: string;
    events: ReadonlyArray<ConductorWakeEvent>;
  }>;
  /** ... and this conversation REFUSES the next wakes, until it is handed
   *  `null` again. A wake that did not go is the case `told` turns on: news
   *  nobody delivered is still owed. */
  readonly failWakes: (why: string | null) => void;
}

function fakeSpawner(): {
  spawn: (options: HarnessOptions) => Promise<Harness>;
  spawns: Spawned[];
} {
  const spawns: Spawned[] = [];
  const spawn = async (options: HarnessOptions): Promise<Harness> => {
    let alive = true;
    let stops = 0;
    let sessions = 0;
    let leaving: (() => void) | null = null;
    const handed: ReadonlyArray<ConductorAttachment>[] = [];
    const wakes: Array<{
      text: string;
      events: ReadonlyArray<ConductorWakeEvent>;
    }> = [];
    let wakeFails: string | null = null;
    let state: HarnessState = {
      ...DEFAULT_CONDUCTOR_STATE,
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
      wake: async (text, events) => {
        if (wakeFails !== null) throw new Error(wakeFails);
        wakes.push({ text, events });
        return { rowId: `woke:${wakes.length}` };
      },
      // A CANCEL ENDS THE TURN, which the real harness reports as the state
      // every reader counts from: the last ticket left, so the conversation
      // is idle. Modelled because that edge is what releases the held news —
      // "however it ended, a cancel included".
      cancel: async () => {
        state = { ...state, phase: "idle", busySince: null };
        options.onChange({ kind: "state", state });
      },
      answer: async () => true,
      signIn: async () => "signed-in",
      signInInput: async () => {},
      signInCancel: async () => false,
      setOption: async () => {},
      newSession: async () => {
        sessions += 1;
        leaving?.();
      },
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
      sessions: () => sessions,
      onNewSession: (run) => {
        leaving = run;
      },
      handed: () => handed,
      wakes: () => wakes,
      failWakes: (why) => {
        wakeFails = why;
      },
    });
    return harness;
  };
  return { spawn, spawns };
}

/** The conf-backed record, as a counted in-memory store — `reads` is what the
 *  eager-read blocker (a construction that read the store before the boot
 *  had one) is pinned against, `writes` is what the throttle is. */
function countingStore(initial: PersistedConductor): {
  store: CellStore<PersistedConductor>;
  reads: () => number;
  writes: () => number;
  value: () => PersistedConductor;
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
  host: ConductorHost;
  spawns: Spawned[];
  reads: () => number;
  writes: () => number;
  value: () => PersistedConductor;
}

function rig(
  remembered: PersistedConductor = EMPTY_PERSISTED_CONDUCTOR,
  endpoint: FleetMcpEndpoint | null = liveEndpoint,
  root = "/state",
): Rig {
  const { spawn, spawns } = fakeSpawner();
  const backing = countingStore(remembered);
  const host = startConductorHost({
    log,
    home: HOME,
    hostName: HOST,
    fleetMcp: () => endpoint,
    // THE REAL PROOF, pushed in the way the boot pushes it: the package that
    // owns the conversation does not own the MCP pin, so what it is handed is
    // the server's own prover — which is why every bring-up below exercises
    // the real door rather than an imitation of it.
    proveFleetMcp: proveFleetMcpEndpoint,
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

/** THE REAL DOOR, because the host now proves the fleet MCP face before it
 *  hands the URL to an agent — and the proof is a real `initialize`, so there
 *  is nothing to stub. Every test that brings a conversation up therefore
 *  exercises the proof as well as what it was written for.
 *
 *  Hand-rolling a listener that imitates the transport was the earlier shape
 *  and it is exactly the drift to avoid: the imitation answered `400` and the
 *  proof passed on it, so a door that could no longer serve anybody looked
 *  identical to a healthy one. Standing the proof on `startFleetMcpEndpoint`
 *  means the two halves of this boot cannot disagree in a test and agree in
 *  production. */
let liveEndpoint: LiveFleetMcpEndpoint;

/** Every face that door served, and whether it was closed again. The proof
 *  opens a REAL session — nothing weaker says "I will serve you" — so it owes
 *  that session a termination; one that leaked would leave a fleet face
 *  holding subscriptions behind every single bring-up. */
let fleetFaces: Array<{ closed: boolean }> = [];

beforeEach(async () => {
  // The adapter is BAKED, so a seated engine is the normal case; nothing is
  // executed here because `spawn` is injected.
  process.env[AGENT_ENV] = "/nix/store/fake-acp-adapter";
  fleetFaces = [];
  liveEndpoint = await startFleetMcpEndpoint({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    serve: async (transport) => {
      // A bare MCP server: the fleet's own members are `kolu-mcp`'s subject.
      // What the proof needs is a face that completes a handshake.
      const mcp = new McpServer(
        { name: "kolu-fleet", version: "0.0.0" },
        { capabilities: { resources: {}, tools: {} } },
      );
      await mcp.connect(transport);
      const face = { closed: false };
      fleetFaces.push(face);
      return {
        close: async () => {
          face.closed = true;
          await mcp.close();
        },
      };
    },
  });
});

afterEach(async () => {
  vi.useRealTimers();
  if (SAVED_AGENT === undefined) delete process.env[AGENT_ENV];
  else process.env[AGENT_ENV] = SAVED_AGENT;
  await liveEndpoint.close();
});

describe("the transcript a reader is handed", () => {
  it("leads with a SNAPSHOT, synchronously, before `watch` returns", () => {
    const seen: ConductorFrame[] = [];
    const r = rig();
    r.host.watch((frame) => seen.push(frame));
    // Synchronous: a stream that queued its first frame a tick later could
    // have a delta queued ahead of it, which is the one ordering the retry
    // fence cannot survive.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("snapshot");
  });

  it("then DELTAS, in the fold order the schema states", async () => {
    const seen: ConductorFrame[] = [];
    const r = rig();
    r.host.watch((frame) => seen.push(frame));
    await r.host.prompt("hello", [], [], false);
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
    const after: ConductorFrame[] = [];
    r.host.watch((frame) => after.push(frame));
    const snapshot = after[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows).toEqual([row("a", 1, "one and two")]);
  });

  it("takes `at` as AUTHORITATIVE, so a re-sent piece does not stutter", async () => {
    const r = rig();
    r.host.watch(() => {});
    await r.host.prompt("hello", [], [], false);
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

    const after: ConductorFrame[] = [];
    r.host.watch((frame) => after.push(frame));
    const snapshot = after[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows).toEqual([row("a", 1, "one and two")]);
  });

  it("serves the remembered rows BEFORE the agent is up", () => {
    const r = rig({
      ...EMPTY_PERSISTED_CONDUCTOR,
      sessionId: "sess-1",
      cwd: HOME,
      rows: [row("old-1", 1), row("old-2", 2)],
    });
    const seen: ConductorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows.map((one) => one.id)).toEqual(["old-1", "old-2"]);
    expect(r.host.state().sessionId).toBe("sess-1");
  });
});

describe("the restart fence (B1)", () => {
  const persisted: PersistedConductor = {
    sessionId: "sess-1",
    cwd: HOME,
    model: null,
    rows: [row("old-1", 1), row("old-2", 2), row("old-3", 3)],
    fleet: [],
    watched: [],
  };

  it("resumes the session and tells the new conversation where to count from", async () => {
    const r = rig(persisted);
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.resume).toBe("sess-1");
    // The highest `seq` we already hold. Anything the new process mints
    // sorts after it and cannot collide with a persisted id.
    expect(agent.options.resumedSeq).toBe(3);
  });

  it("does NOT double the transcript when the host restarts over it", async () => {
    const r = rig(persisted);
    const seen: ConductorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows).toHaveLength(3);

    // The resumed conversation says ONE new thing. Before the fence, the load
    // replayed the agent's half through a fresh counter and every row landed a
    // second time under a new id.
    await r.host.prompt("one more", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "rows",
      upserts: [row("new-1", (agent.options.resumedSeq ?? 0) + 1)],
      removes: [],
      appends: [],
    });

    const after: ConductorFrame[] = [];
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
    const seen: ConductorFrame[] = [];
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
    await r.host.prompt("hi", [], [], false);
    expect(r.reads()).toBe(1);
  });
});

describe("a bring-up that did not get there (M2)", () => {
  it("publishes the refusal instead of leaving an idle-looking panel", async () => {
    // No endpoint yet: the conversation cannot be told where the fleet's
    // terminals are, and the bring-up refuses before it spawns anything.
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, null);
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow();
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain(
      "has not published its fleet MCP endpoint",
    );
  });

  it("refuses an endpoint NOBODY IS SERVING rather than handing the agent a dead URL", async () => {
    // The failure this exists for: the conductor took its endpoint on faith
    // and had never checked it was being served, so a URL that answered
    // nothing was handed over exactly like a good one. The agent's MCP client
    // then cannot connect, the agent marks the server failed ONCE inside
    // `session/new` and never revisits it, and the conversation carries on
    // running shell commands itself — the one failure this feature exists to
    // prevent, and invisible but for a grey word on a roster.
    //
    // Port 1 on loopback: privileged, bound by nothing, so the connect is
    // refused by the kernel rather than by a timeout.
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, {
      url: "http://127.0.0.1:1/mcp",
      token: "unused",
    });
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
      /cannot reach this kolu's fleet MCP face/,
    );
    // Nothing was spawned: an adapter with no hands is not a degraded
    // conductor, it is a chat window.
    expect(r.spawns).toHaveLength(0);
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain("http://127.0.0.1:1/mcp");
  });

  it("refuses an endpoint that REJECTS the token rather than opening with no hands", async () => {
    // The other half of the proof, and the one a reachability check would
    // miss: something IS listening, and it will not let this process in. An
    // agent handed those headers is refused the same way and carries on
    // without the fleet.
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, {
      ...liveEndpoint,
      token: "not-the-token-this-process-minted",
    });
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
      /was refused by this kolu's fleet MCP face/,
    );
    expect(r.spawns).toHaveLength(0);
    expect(r.host.state().refusal).toContain("401");
  });

  it("refuses an endpoint that is LISTENING and will not SERVE it", async () => {
    // The arm a proof that passed on any HTTP answer could not see, and the
    // one that actually happens: `400 Invalid Request: Server already
    // initialized` is what a streamable-HTTP door holding a single transport
    // answers every client after the first, so an adapter respawn met exactly
    // this — and the old probe, which read any answer as proof, handed the URL
    // over anyway and the replacement conversation ran with no hands.
    const listening = async (
      answer: (res: ServerResponse) => void,
    ): Promise<{ at: FleetMcpEndpoint; stop: () => Promise<void> }> => {
      const listener: Server = createServer((req, res) => {
        if (req.headers.authorization !== "Bearer the-token") {
          res.writeHead(401).end();
          return;
        }
        answer(res);
      });
      const up = Promise.withResolvers<void>();
      listener.listen(0, "127.0.0.1", up.resolve);
      await up.promise;
      const bound = listener.address();
      if (bound === null || typeof bound === "string") {
        throw new Error("the fixture listener did not bind a TCP port");
      }
      return {
        at: {
          url: `http://127.0.0.1:${bound.port}/mcp`,
          token: "the-token",
        },
        stop: async () => {
          const down = Promise.withResolvers<void>();
          listener.close(() => down.resolve());
          listener.closeAllConnections();
          await down.promise;
        },
      };
    };

    const busy = await listening((res) => {
      res.writeHead(400, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32_600,
            message: "Invalid Request: Server already initialized",
          },
        }),
      );
    });
    try {
      const r = rig(EMPTY_PERSISTED_CONDUCTOR, busy.at);
      await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
        /could not open a session on this kolu's fleet MCP face/,
      );
      expect(r.spawns).toHaveLength(0);
      expect(r.host.state().refusal).toContain("400");
      expect(r.host.state().refusal).toContain(busy.at.url);
    } finally {
      await busy.stop();
    }

    // The subtler half: a `200` with no session id. Something answered, the
    // gate let us in, and no session exists — an agent's client would send its
    // next request with no `Mcp-Session-Id` and be refused from then on.
    const sessionless = await listening((res) => {
      res
        .writeHead(200, { "content-type": "text/event-stream" })
        .end("event: message\ndata: {}\n\n");
    });
    try {
      const r = rig(EMPTY_PERSISTED_CONDUCTOR, sessionless.at);
      await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
        /without opening a session/,
      );
      expect(r.spawns).toHaveLength(0);
    } finally {
      await sessionless.stop();
    }
  });

  it("closes the session its proof opened, and spawns with the proven URL", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.mcpServers).toEqual([
      {
        kind: "http",
        name: "kolu",
        url: liveEndpoint.url,
        headers: { Authorization: `Bearer ${liveEndpoint.token}` },
      },
    ]);

    // ONE face, and it is shut: the proof opened a real session because
    // nothing weaker proves the door will serve one, and it terminated that
    // session behind itself. A proof that leaked would leave a fleet face
    // holding subscriptions after every bring-up this process ever does.
    expect(fleetFaces).toHaveLength(1);
    await vi.waitFor(() => {
      expect(fleetFaces[0]?.closed).toBe(true);
    });
  });

  it("reaches a READER, who has nothing to catch", async () => {
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, null);
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
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");

    first.die();
    await r.host.newSession();
    expect(r.spawns).toHaveLength(2);
    // The corpse is stopped, not merely forgotten: its pipes and its child's
    // children are what would otherwise be left behind.
    expect(first.stops()).toBe(1);
  });

  it("comes back into the conversation the agent is in NOW, not the id the file named", async () => {
    // A conversation can move on without anybody restarting: somebody asks
    // for a new session, or the agent refuses the remembered id because its
    // own store has never heard of it and the harness opens a fresh one in
    // its place. A replacement adapter handed the BOOT-TIME id would then ask
    // for a conversation that is gone — a break and a line in the transcript
    // for every crash — or, worse, one the agent still has, which is a panel
    // quietly reverting to an older chat.
    const r = rig({
      sessionId: "sess-remembered",
      cwd: HOME,
      model: null,
      rows: [],
      fleet: [],
      watched: [],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(first.options.resume).toBe("sess-remembered");

    // What the harness publishes when the open it actually got is a different
    // conversation from the one it was asked for.
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        phase: "idle",
        sessionId: "sess-opened",
      },
    });

    first.die();
    await r.host.newSession();
    expect(r.spawns[1]?.options.resume).toBe("sess-opened");
  });

  it("fences the REPLACEMENT on the rows we still hold (R2)", async () => {
    // A fresh state-root: nothing was restored, so a fence taken at the
    // restore is zero forever.
    const r = rig();
    await r.host.prompt("first", [], [], false);
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
    const seen: ConductorFrame[] = [];
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
    await r.host.prompt("first", [], [], false);
    await r.host.prompt("second", [], [], false);
    await r.host.cancel();
    expect(r.spawns).toHaveLength(1);
  });
});

describe("the standing prompt (M5)", () => {
  it("names the HOST, and leaves `$HOME` to be the cwd", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
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

  it("names only verbs the session actually has", async () => {
    // The prompt is a hand-written copy of names `packages/kolu-mcp` owns and
    // renames on its own clock, and nothing binds the two. A renamed verb
    // would leave this conversation quietly instructed to call something the
    // fleet face no longer serves — which reads to a person as the agent
    // being wrong rather than the prompt being stale. So the copy is checked
    // against the registry: every `snake_case` name the words name in
    // backticks must be a tool the FLEET projection mints — not merely one
    // the stdio face has, since the two tables are no longer the same (the
    // conductor has no unbounded wait, and it alone has the watch verbs).
    const served = new Set([
      ...KOLU_FLEET_TOOL_NAMES,
      ...Object.keys(KOLU_FLEET_EXPOSE)
        .filter((member) => member.includes("."))
        .map((member) => member.replace(".", "_")),
    ]);
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    const named = new Set(
      [...agent.options.teaching.join("\n").matchAll(/`([a-z]+_[a-zA-Z]+)`/g)]
        .map((hit) => hit[1])
        .filter((name): name is string => name !== undefined),
    );
    // A prompt that names no verb at all would pass this vacuously.
    expect(named.size).toBeGreaterThan(3);
    expect([...named].filter((name) => !served.has(name))).toEqual([]);
  });
});

describe("the record is written on a throttle (M4)", () => {
  it("costs one write per window, not one per streamed frame", async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("stream at me", [], [], false);
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
    await r.host.prompt("hello", [], [], false);
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
    await r.host.prompt("hello", [], [], false);
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
    const backing = countingStore(EMPTY_PERSISTED_CONDUCTOR);
    const host = startConductorHost({
      log,
      home: HOME,
      hostName: HOST,
      fleetMcp: () => liveEndpoint,
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: () => {},
      store: backing.store,
      storePath: () => "/state/config.json",
      stateRoot: "/state",
      spawn: async (options) => {
        await held.promise;
        return spawn(options);
      },
    });
    const sent = host.prompt("hello", [], [], false);
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
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    agent.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
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
    const backing = countingStore(EMPTY_PERSISTED_CONDUCTOR);
    const host = startConductorHost({
      log,
      home: HOME,
      hostName: HOST,
      fleetMcp: () => liveEndpoint,
      proveFleetMcp: proveFleetMcpEndpoint,
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
    const sent = host.prompt("hello", [], [], false);
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
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
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
      watched: [],
    });
    await r.host.prompt("still here?", [], [], false);
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
      ...EMPTY_PERSISTED_CONDUCTOR,
      cwd: HOME,
      rows: [{ id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" }],
    } as unknown as PersistedConductor);
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
    over: Partial<ConductorAttachment> = {},
  ): ConductorAttachment => ({
    id: "att-1",
    name: "pixel.png",
    mimeType: "image/png",
    bytes: 70,
    path: join(root, "conductor", "attachments", "att-1"),
    ...over,
  });

  let root: string;
  let dir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kolu-orch-att-"));
    dir = join(root, "conductor", "attachments");
  });

  it("takes a file BIGGER THAN ONE FRAME, in pieces, and puts it back together", async () => {
    // THE DEFECT THIS PINS: the whole base64 on one `prompt` frame. The RPC
    // decoder does not fail an oversized frame — it closes the socket with
    // 1009 and takes every subscription in the tab with it. So the test is
    // not only that the file round-trips, but that no single call it took to
    // get here would have busted the cap.
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
    await r.host.prompt(
      "look",
      [],
      [chip({ name: "big.bin", bytes: 1 })],
      false,
    );
    const one = r.spawns[0]?.handed()[0]?.[0];
    if (one === undefined) throw new Error("nothing was handed over");
    expect(one.path).toBe(join(dir, "att-1"));
    // `bytes` is re-read from the file, never carried over from the claim —
    // the chip above said 1.
    expect(one.bytes).toBe(whole.byteLength);
  });

  it("refuses an id that is not a filename, rather than writing where it says", () => {
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
    await expect(r.host.prompt("all three", [], three, false)).rejects.toThrow(
      /at most 20 MiB/,
    );
  });

  it("refuses a message naming a file this host no longer holds", async () => {
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
    await expect(
      r.host.prompt("look", [], [chip({ id: "never-uploaded" })], false),
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
        watched: [],
      },
      liveEndpoint,
      root,
    );
    r.host.watch(() => {});
    expect(readdirSync(dir)).toEqual(["att-1"]);
  });

  it("a REFUSED prompt leaves no file the transcript does not name", async () => {
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
      r.host.prompt("look", [], [...sent, chip({ id: "gone" })], false),
    ).rejects.toThrow(/no longer on this host/);
    // The bytes of a message that never went do not sit in the state root
    // waiting for a server restart to notice them.
    expect(readdirSync(dir)).toEqual(["att-3"]);
  });

  it("does not keep an upload nobody ever sent", () => {
    // Only `Date` is faked: the bring-up below is a real HTTP request, and a
    // frozen event loop would hang it.
    vi.useFakeTimers({ toFake: ["Date"] });
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
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
  const divider = (id: string, seq: number): ConductorRow => ({
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
      watched: [],
    });
    const seen: ConductorFrame[] = [];
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
      watched: [],
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
      watched: [],
    });
    await r.host.newSession();
    expect(r.spawns[0]?.options.resumedEndsWithDivider).toBe(false);
  });
});

describe("the wipe (`clearSession`)", () => {
  const divider = (id: string, seq: number): ConductorRow => ({
    id,
    seq,
    since: "2026-01-01T00:00:00.000Z",
    kind: "divider",
    text: "new session",
  });

  /** A conversation with something to lose: three rows, a session and a
   *  terminal it remembers. */
  const held: PersistedConductor = {
    sessionId: "sess-1",
    cwd: HOME,
    model: null,
    rows: [row("user:1", 1, "hello"), row("agent:2", 2, "hello back")],
    fleet: ["local/term-1"],
    watched: [],
  };

  /** The rows a NEW reader would be handed — the snapshot, which is what the
   *  next person to open the panel actually sees. */
  const served = (host: ConductorHost): ReadonlyArray<ConductorRow> => {
    const seen: ConductorFrame[] = [];
    host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    return first.rows;
  };

  it("leaves an EMPTY conversation — rows, record and fleet together", async () => {
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.clearSession();

    // What the panel draws, what the next reader is handed, and what the next
    // BOOT reads: three readings of one wipe, because a wipe only one of them
    // saw is a conversation that comes back.
    expect(served(r.host)).toEqual([]);
    expect(r.value().rows).toEqual([]);
    expect(r.value().fleet).toEqual([]);
    expect(r.host.state().fleet).toEqual([]);
    // The record is written at once rather than on the throttle: a window in
    // which the file still holds a deleted conversation is a window in which
    // a restart restores it.
    expect(r.writes()).toBeGreaterThan(0);
    // ... and the AGENT was given a new conversation, which is the half of
    // this that happens outside our bookkeeping.
    expect(r.spawns[0]?.sessions()).toBe(1);
  });

  it("takes the divider the agent mints ON ITS WAY OUT with it", async () => {
    const r = rig(held);
    r.host.watch(() => {});
    // Awaited, because the bring-up a subscription triggers is in flight: the
    // hook below has to be set on the conversation the wipe will ask.
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    // The real harness reports a `— new session —` row from inside
    // `newSession`, before it opens the next conversation. The wipe runs the
    // agent's session change FIRST for exactly this reason: a rule drawn
    // across an empty transcript is a break between nothing and nothing.
    agent.onNewSession(() => {
      agent.push({
        kind: "rows",
        upserts: [divider("div-1", 3)],
        removes: [],
        appends: [],
      });
    });

    await r.host.clearSession();
    expect(served(r.host)).toEqual([]);
    expect(r.value().rows).toEqual([]);
  });

  it("leaves a REPLACEMENT nothing to fence against", async () => {
    // The two seeds a respawn is handed are read off the rows we hold, and
    // after a wipe we hold none — so a replacement counts from zero and knows
    // there is no divider above it to double.
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.clearSession();
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");

    first.die();
    await r.host.prompt("after", [], [], false);
    const second = r.spawns[1];
    if (second === undefined) throw new Error("the corpse was not replaced");
    expect(second.options.resumedSeq).toBe(0);
    expect(second.options.resumedEndsWithDivider).toBe(false);
  });

  it("sends the next prompt into the conversation it just opened", async () => {
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.clearSession();
    await r.host.prompt("fresh start", [], [], false);

    // One adapter, one new session, and the message went to it: the wipe is a
    // conversation change, never a respawn.
    expect(r.spawns).toHaveLength(1);
    expect(r.spawns[0]?.sessions()).toBe(1);
  });

  it("`newSession` beside it keeps EVERY one of those things", async () => {
    // The two paths differ by NAME, and this is the difference: what a person
    // loses. *Try again* under a refused bring-up asks for this one.
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.newSession();

    expect(served(r.host).map((one) => one.id)).toEqual(["user:1", "agent:2"]);
    expect(r.host.state().fleet).toEqual(["local/term-1"]);
  });

  it("deletes the files the rows it dropped were naming", async () => {
    const root = mkdtempSync(join(tmpdir(), "kolu-orch-wipe-"));
    const dir = join(root, "conductor", "attachments");
    const r = rig(EMPTY_PERSISTED_CONDUCTOR, liveEndpoint, root);
    r.host.watch(() => {});
    const written = r.host.attach({
      id: "att-1",
      name: "pixel.png",
      mimeType: "image/png",
      data: Buffer.from("pixel").toString("base64"),
    });
    await r.host.prompt(
      "look",
      [],
      [
        {
          id: "att-1",
          name: "pixel.png",
          mimeType: "image/png",
          bytes: written.bytes,
          path: written.path,
        },
      ],
      false,
    );
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    // The row the harness mints for that message is what KEEPS the file: the
    // rule is that a file lives exactly as long as the row naming it.
    agent.push({
      kind: "rows",
      upserts: [
        {
          id: "user:1",
          seq: 1,
          since: "2026-01-01T00:00:00.000Z",
          kind: "user",
          text: "look",
          attachments: [
            {
              id: "att-1",
              name: "pixel.png",
              mimeType: "image/png",
              bytes: written.bytes,
              path: written.path,
            },
          ],
        },
      ],
      removes: [],
      appends: [],
    });
    expect(readdirSync(dir)).toEqual(["att-1"]);

    await r.host.clearSession();
    // The rows are gone, so nothing names the bytes — and bytes nothing names
    // are bytes a person thought they had deleted.
    expect(readdirSync(dir)).toEqual([]);
  });
});

/** Two watched terminals, as fleet refs — one per host, because the watch
 *  list spans the fleet and a bare id would name two terminals on a two-host
 *  one. */
const A = "local/11111111-1111-4111-8111-111111111111";
const B = "remote:prod/22222222-2222-4222-8222-222222222222";

/** One reading of one terminal, as the watcher hands it over. */
const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
    /** The piece of work it is in, as the watcher walked the parent edges on
     *  its host. Defaults to the terminal ITSELF, which is what a top-level
     *  terminal reads as — a split names the terminal it hangs off. */
    root?: WatchRoot;
  } = {},
): WatchObservation => ({
  ref,
  host: ref.slice(0, ref.lastIndexOf("/")),
  terminalId: ref.slice(ref.lastIndexOf("/") + 1),
  hostName: "box",
  name: over.name ?? "fix the parser",
  agent: over.agent === undefined ? "claude-code" : over.agent,
  level,
  foregroundShell: over.foregroundShell ?? null,
  root: over.root ?? { ref, name: over.name ?? "fix the parser" },
});

/** A conversation that is WORKING, as the harness publishes one — the state
 *  every held-news rule turns on. */
const working = (agent: Spawned): void => {
  agent.push({
    kind: "state",
    state: {
      ...DEFAULT_CONDUCTOR_STATE,
      phase: "working",
      busySince: "2026-01-01T00:00:00.000Z",
    },
  });
};

/** ... and the conversation came back to idle on its own — a turn that simply
 *  ended, rather than one somebody stopped. */
const idle = (agent: Spawned): void => {
  agent.push({
    kind: "state",
    state: { ...DEFAULT_CONDUCTOR_STATE, phase: "idle" },
  });
};

/** A conversation that is up, working, and watching both terminals — both of
 *  them BRIEFED, which is the ordinary state of a terminal the Conductor
 *  created: it opened it, said what to do, and is waiting for the answer. An
 *  agent nobody has spoken to rings `ready` on its first idle instead, which
 *  is its own case below. */
const busyWatching = async (r: Rig): Promise<Spawned> => {
  await r.host.prompt("hello", [], [], false);
  const agent = r.spawns[0];
  if (agent === undefined) throw new Error("the host spawned nothing");
  working(agent);
  r.host.watchTerminal(A, "created");
  r.host.watchTerminal(B, "created");
  r.host.saidTo(A);
  r.host.saidTo(B);
  return agent;
};

describe("the news a watched terminal makes", () => {
  it("WAITS while a turn runs, and leaves as ONE wake when it ends", async () => {
    const r = rig();
    const agent = await busyWatching(r);

    r.host.observe([seeing(A, "stopped")]);
    r.host.observe([seeing(B, "asking")]);
    // Both are waiting, in the order they first rang, and the conversation was
    // not interrupted to be told about either: injecting into a running turn
    // is work nobody asked to interrupt.
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A, B]);
    });
    expect(agent.wakes()).toEqual([]);

    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    const woke = agent.wakes()[0];
    // ONE turn with both terminals in it — the Conductor sees everything that
    // happened while it was busy at once — and the account names each.
    expect(woke?.events.map((one) => one.ref)).toEqual([A, B]);
    expect(woke?.events.map((one) => one.level)).toEqual(["stopped", "asking"]);
    expect(woke?.text).toContain(A);
    expect(woke?.text).toContain(B);
    // ... and nothing is left waiting for a second one.
    expect(r.host.state().held).toEqual([]);
  });

  it("leaves on a CANCEL too, which is a turn ending like any other", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });

    // The one ending a person causes. News held across it would sit there
    // until the next turn somebody started — which, for a Conductor that
    // never blocks, could be never.
    await r.host.cancel();
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    expect(agent.wakes()[0]?.events.map((one) => one.ref)).toEqual([A]);
  });

  it("WITHDRAWS what a terminal was going to say once it is working again", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });

    // Held news describes how something STOOD, and this one has stopped
    // standing that way: telling the Conductor an agent stopped, minutes
    // after it went back to work, is worse than not telling it at all.
    r.host.observe([seeing(A, "working")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([]);
    });
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakes()).toEqual([]);
  });

  it("counts a terminal as TOLD only when the wake was delivered", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    // The wake cannot go — the agent refuses it. The news is therefore still
    // owed, and the entry must not remember having said it.
    agent.failWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    await r.host.dispose();
    expect(r.value().watched).toEqual([
      {
        ref: A,
        name: "fix the parser",
        agent: "claude-code",
        told: null,
        joined: "created",
        spoken: true,
        ran: false,
        root: { ref: A, name: "fix the parser" },
      },
      {
        ref: B,
        name: "",
        agent: null,
        told: null,
        joined: "created",
        spoken: true,
        ran: false,
        // Nothing has read this one's host, so there is no piece of work to
        // put it in yet.
        root: null,
      },
    ]);

    // ... and when one does go, that is what writes it down.
    const second = rig(r.value());
    const live = await busyWatching(second);
    idle(live);
    second.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(live.wakes()).toHaveLength(1);
    });
    await second.host.dispose();
    expect(second.value().watched[0]?.told).toBe("stopped");
  });
});

describe("the watch across a restart", () => {
  it("does not ring again about a terminal that has not moved", async () => {
    // The record a previous kolu-server left: this terminal was stopped, and
    // the conversation was told so before the restart.
    const r = rig({
      ...EMPTY_PERSISTED_CONDUCTOR,
      // The same `$HOME` this host runs in: a record whose home moved cannot
      // resume, and the watch list goes with the conversation it was about.
      cwd: HOME,
      watched: [
        {
          ref: A,
          name: "fix the parser",
          agent: "claude-code",
          told: "stopped",
          joined: "created",
          spoken: true,
          ran: false,
          root: { ref: A, name: "fix the parser" },
        },
      ],
    });
    const agent = await busyWatching(r);
    idle(agent);

    // The watcher looks at every watched terminal again after a boot, and
    // this one is still stopped for the reason it was stopped before: a wake
    // here is the conversation hearing the same news twice.
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().watched).toContain(A);
    });
    expect(agent.wakes()).toEqual([]);

    // ... and a terminal that has MOVED since rings, which is the half that
    // makes the quiet one safe.
    r.host.observe([seeing(A, "asking")]);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    expect(agent.wakes()[0]?.events[0]?.level).toBe("asking");
  });
});

describe("the pieces of work the cell publishes", () => {
  /** A terminal on the first host that is a SPLIT of `A` — the implementor a
   *  planner opened, which is the case the grouping exists for. */
  const SPLIT = "local/33333333-3333-4333-8333-333333333333";

  it("folds a split into its planner's piece of work, and says so again when the name arrives", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    r.host.watchTerminal(A, "created");
    r.host.watchTerminal(SPLIT, "created");
    // Before anything has been read, each is a piece of work of its own under
    // its own (empty) name: nothing has looked at the host yet.
    expect(r.host.state().work).toEqual([
      { root: A, name: "", refs: [A] },
      { root: SPLIT, name: "", refs: [SPLIT] },
    ]);

    // The first frame off the host: the planner is top-level, and the split's
    // parent edge ends at it — but that frame landed before the planner's own
    // record did, so its heading is not known yet.
    r.host.observe([
      seeing(SPLIT, "working", {
        name: "write the migration",
        root: { ref: A, name: "" },
      }),
    ]);
    await vi.waitFor(() => {
      expect(r.host.state().work).toEqual([
        { root: A, name: "", refs: [A, SPLIT] },
      ]);
    });

    // ... and the record that names the planner reaches the cell, with no
    // level moving and nothing ringing — a heading is not news.
    r.host.observe([seeing(A, "working", { name: "plan the cutover" })]);
    await vi.waitFor(() => {
      expect(r.host.state().work).toEqual([
        { root: A, name: "plan the cutover", refs: [A, SPLIT] },
      ]);
    });
    expect(agent.wakes()).toEqual([]);
  });

  it("counts two unrelated terminals as two", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "working"), seeing(B, "working")]);
    await vi.waitFor(() => {
      expect(r.host.state().work).toEqual([
        { root: A, name: "fix the parser", refs: [A] },
        { root: B, name: "fix the parser", refs: [B] },
      ]);
    });
    expect(agent.wakes()).toEqual([]);
  });
});

describe("an agent that has just come up", () => {
  it("rings READY, and the brief that answers it does not ring back", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    // The terminal the Conductor opened with `omp …` in it. Seconds later the
    // agent is up and sitting at its prompt — padi's `finishedIds`.
    r.host.watchTerminal(A, "created-run");
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    // NOT `stopped`: nothing has been said to this agent, so nothing of its
    // ended. The account says so in words.
    expect(agent.wakes()[0]?.events[0]?.level).toBe("ready");
    expect(agent.wakes()[0]?.text).toContain("has not been told anything yet");

    // The Conductor briefs it. `agent_say` answers on the keystrokes, so the
    // agent is still in the very idle it rang about when the turn ends — and
    // that must not wake it about the terminal it has just spoken to.
    r.host.saidTo(A);
    r.host.observe([seeing(A, "stopped")]);
    // It then works, and the stop at the END of that work is news.
    r.host.observe([seeing(A, "working")]);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(2);
    });
    // Two wakes, not three: the silent one in the middle never went.
    expect(agent.wakes()[1]?.events[0]?.level).toBe("stopped");
  });

  it("withdraws what a terminal was about to say when the Conductor speaks to it", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    // The Conductor answered that terminal from inside the running turn.
    r.host.saidTo(A);
    expect(r.host.state().held).toEqual([]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakes()).toEqual([]);
  });
});

describe("a wake that could not be delivered", () => {
  /** The notices in the transcript right now — a `watch` hands back the whole
   *  of it as its snapshot, and the sink is dropped again so this can be
   *  asked repeatedly inside a `waitFor`. */
  const noticesNow = (r: Rig): ReadonlyArray<ConductorRow> => {
    const seen: ConductorFrame[] = [];
    const off = r.host.watch((frame) => seen.push(frame));
    off();
    const snapshot = seen[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    return snapshot.rows.filter((one) => one.kind === "notice");
  };

  it("says so ONCE, keeps the news, and sends it on the next idle", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    agent.failWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    // SAID, in the conversation, naming the terminal and the reason. A
    // failure that only reached the log is a panel that looks idle over news
    // nobody will ever hear.
    await vi.waitFor(() => {
      expect(noticesNow(r)).toHaveLength(1);
    });
    const said = noticesNow(r)[0];
    expect(said?.kind === "notice" ? said.text : "").toContain(A);
    expect(said?.kind === "notice" ? said.text : "").toContain(
      "the agent is not there",
    );
    // ... and the news is still owed: a wake that did not go is not a wake.
    expect(r.host.state().held).toEqual([A]);
    expect(agent.wakes()).toEqual([]);

    // A second failing edge does NOT write a second notice: one per episode.
    r.host.observe([seeing(A, "asking")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    expect(noticesNow(r)).toHaveLength(1);

    // THE RETRY, event-driven: the wake can go again, and the next idle is
    // what carries it. No timer waited for anything.
    agent.failWakes(null);
    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    expect(agent.wakes()[0]?.events.map((one) => one.level)).toEqual([
      "asking",
    ]);
    expect(r.host.state().held).toEqual([]);
  });

  it("retries on the next reading of a watched terminal", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    agent.failWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(noticesNow(r)).toHaveLength(1);
    });

    agent.failWakes(null);
    // Nothing changed about the conversation; the WATCHER spoke, which is one
    // of the three edges a held wake waits for.
    r.host.observe([seeing(B, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    // Both go together: the one that was owed and the one that just rang.
    expect(agent.wakes()[0]?.events.map((one) => one.ref)).toEqual([A, B]);
  });
});
