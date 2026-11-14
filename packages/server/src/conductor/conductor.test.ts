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
 *  - THE WIPE IS THE CONVERSATION'S ONLY: `clearSession` empties the rows, the
 *    record, the files and the remembered fleet together and leaves no divider
 *    — and KEEPS every piece of work, dropping only the question a work had
 *    open, because the conversation that asked it is the thing being deleted.
 *  - A PIECE OF WORK IS A STORED THING: it is opened with its setup asked as
 *    one row, its timeline is written from what kolu OBSERVED (levels, files,
 *    the PR), it ends when the PR lands or every member goes, and the files it
 *    leaves behind are kept — twenty finished works' worth, no more.
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
  type ConductorState,
  type ConductorWakeEvent,
  PROMPT_ATTACHMENT_BYTE_CAP,
} from "kolu-common/conductor";
import type { ConductorReadingLevel } from "kolu-common/conductor";
import {
  chunkBase64,
  FRAME_CHUNK_BYTES,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import { exceedsFrameLimit } from "@kolu/surface/frame-limit";
import type { CellStore } from "@kolu/surface/server";
import type { Form } from "@kolu/acp";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { KOLU_FLEET_EXPOSE, KOLU_FLEET_TOOL_NAMES } from "kolu-mcp";
import {
  driverOf,
  type KeptFile,
  type SetupKey,
  type Work,
  type WorkMember,
  WorkRefusal,
  type WorkRole,
} from "kolu-work";
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
  type MemberWatch,
  type PersistedConductor,
  type PersistedMembers,
  type PersistedTranscript,
  type PersistedWorks,
  type WatchGit,
  type WatchLevel,
  type WatchObservation,
  type WatchPr,
  type WorkFiles,
} from "kolu-conductor";

const HOME = "/home/tester";
const HOST = "test-box";

/** The instant every fixture is dated at — a work's start, a member's join, a
 *  row's `since`. A frozen one, because what these tests compare is order and
 *  membership, never a duration. */
const T0 = "2026-01-01T00:00:00.000Z";

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
  since: T0,
  kind: "agent",
  text,
});

/** ... and the human's own line, which is what a work's `requested` event is
 *  written from: kolu quotes the words it SAW rather than the Conductor's
 *  summary of them. */
const userRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: T0,
  kind: "user",
  text,
  attachments: [],
});

/** One question this conversation put to the human, as the TEST sees it: the
 *  ask's id, the work it names, and the form it is drawn from. */
interface Asked {
  readonly id: string;
  readonly work: string;
  readonly form: Form;
}

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
  /** EVERY QUESTION KOLU PUT TO THE HUMAN through this conversation
   *  (`Harness.askPerson`) — one row each, still open until `host.answer`
   *  settles it or a new session withdraws it. */
  readonly asks: () => ReadonlyArray<Asked>;
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
    const asked: Asked[] = [];
    /** The questions still waiting on somebody, by ask id — the half of
     *  `questions.ask()` this stand-in models: an id is minted, the caller is
     *  told it (which is when the WORK writes its decisions), and the promise
     *  settles when the answer, the decline or the withdrawal arrives. */
    const open = new Map<
      string,
      (settled: {
        outcome: { how: "answered" | "declined" | "withdrawn" };
        content: Record<string, string | number | boolean | Array<string>>;
      }) => void
    >();
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
      askPerson: async (form, about) => {
        const id = `kolu:ask:${asked.length + 1}`;
        const settled = Promise.withResolvers<{
          outcome: { how: "answered" | "declined" | "withdrawn" };
          content: Record<string, string | number | boolean | Array<string>>;
        }>();
        open.set(id, settled.resolve);
        asked.push({ id, work: about.work, form });
        // The id reaches the caller BEFORE anything can answer it — which is
        // the order the work's decisions are written in.
        about.known?.(id);
        return settled.promise;
      },
      // A CANCEL ENDS THE TURN, which the real harness reports as the state
      // every reader counts from: the last ticket left, so the conversation
      // is idle. Modelled because that edge is what releases the held news —
      // "however it ended, a cancel included".
      cancel: async () => {
        state = { ...state, phase: "idle", busySince: null };
        options.onChange({ kind: "state", state });
      },
      answer: async (id, answers) => {
        const settle = open.get(id);
        if (settle === undefined) return true;
        open.delete(id);
        // The registry settles SYNCHRONOUSLY inside `answer`, exactly as the
        // real one does — which is what lets the host's `answer(…, from)`
        // write down where the press came from and have the waiting ask read
        // it in the same tick.
        settle(
          answers === null
            ? { outcome: { how: "declined" }, content: {} }
            : {
                outcome: { how: "answered" },
                content: Object.fromEntries(
                  answers.map((one) => [one.key, [...one.values]]),
                ),
              },
        );
        return true;
      },
      signIn: async () => "signed-in",
      signInInput: async () => {},
      signInCancel: async () => false,
      setOption: async () => {},
      newSession: async () => {
        sessions += 1;
        // A NEW CONVERSATION WITHDRAWS WHAT THE OLD ONE ASKED: the promise
        // behind every open row belonged to the session that is going.
        for (const settle of open.values())
          settle({ outcome: { how: "withdrawn" }, content: {} });
        open.clear();
        leaving?.();
      },
      clearSession: async (held) => {
        sessions += 1;
        for (const settle of open.values())
          settle({ outcome: { how: "withdrawn" }, content: {} });
        open.clear();
        leaving?.();
        // THE REMOVES ARE THE HARNESS'S. The conversation's rows are the
        // harness's own — and so is everything kept beside them — so the wipe
        // reports their disappearance like any other change. `held` is the ids
        // the caller holds that this conversation never minted.
        options.onChange({
          kind: "rows",
          upserts: [],
          removes: [...held],
          appends: [],
        });
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
      asks: () => asked,
    });
    return harness;
  };
  return { spawn, spawns };
}

/** One of the three records, as a counted in-memory store — `reads` is what
 *  the eager-read blocker (a construction that read a store before the boot
 *  had one) is pinned against, `writes` is what the throttle is. */
interface Counted<T> {
  readonly store: CellStore<T>;
  readonly reads: () => number;
  readonly writes: () => number;
  readonly value: () => T;
}

function countingStore<T>(initial: T): Counted<T> {
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

/** A WORK'S FILES, as the test drives them — kolu-server's port
 *  (`workFiles.ts`) stands over padi's directory listing and remote byte read,
 *  and neither is this file's subject: what is pinned here is WHEN the host
 *  lists, keeps and sweeps. */
interface FakeFiles {
  readonly port: WorkFiles;
  /** What `.waterfall/` holds, as the next listing answers it. */
  readonly holds: (paths: ReadonlyArray<string>) => void;
  /** ... or the host cannot be read at all, until it is handed `null` again. */
  readonly listFails: (why: string | null) => void;
  readonly listed: () => ReadonlyArray<{ host: string; worktree: string }>;
  readonly kept: () => ReadonlyArray<{
    work: string;
    paths: ReadonlyArray<string>;
  }>;
  /** Every reconciliation the host asked for, as the work ids it said to
   *  KEEP — the one rule that deletes a kept-files directory. */
  readonly swept: () => ReadonlyArray<ReadonlyArray<string>>;
}

function fakeFiles(): FakeFiles {
  let holding: ReadonlyArray<string> = [];
  let listFails: string | null = null;
  const listed: Array<{ host: string; worktree: string }> = [];
  const kept: Array<{ work: string; paths: ReadonlyArray<string> }> = [];
  const swept: Array<ReadonlyArray<string>> = [];
  return {
    port: {
      list: async (at) => {
        listed.push({ host: at.host, worktree: at.worktree });
        if (listFails !== null) throw new Error(listFails);
        return holding;
      },
      keep: async (at) => {
        kept.push({ work: at.work, paths: [...at.paths] });
        return at.paths.map((path): KeptFile => ({ path, bytes: path.length }));
      },
      sweep: async (keep) => {
        swept.push([...keep]);
      },
    },
    holds: (paths) => {
      holding = paths;
    },
    listFails: (why) => {
      listFails = why;
    },
    listed: () => listed,
    kept: () => kept,
    swept: () => swept,
  };
}

/** What a kolu-server that has been running before this test left behind. */
interface Remembered {
  /** `config.json`'s `conductor` key — the conversation. */
  readonly record?: PersistedConductor;
  /** The transcript FILE's rows, which left `config.json` so a streaming
   *  answer stops rewriting the host map. */
  readonly rows?: ReadonlyArray<ConductorRow>;
  /** `config.json`'s `works` key — the pieces of work, which outlive the
   *  conversation that opened them. */
  readonly works?: PersistedWorks;
  /** ... and `config.json`'s `members` key: what kolu knew about each of
   *  their member terminals, by fleet ref. Its own key, so a fixture says
   *  what was READ about a terminal apart from what the work claims. */
  readonly members?: PersistedMembers;
  readonly endpoint?: FleetMcpEndpoint | null;
  readonly root?: string;
}

interface Rig {
  host: ConductorHost;
  spawns: Spawned[];
  record: Counted<PersistedConductor>;
  transcript: Counted<PersistedTranscript>;
  works: Counted<PersistedWorks>;
  members: Counted<PersistedMembers>;
  files: FakeFiles;
  /** Every frame a reader was actually given, in order. The host publishes
   *  only when the frame says something different from the last one, so this
   *  is what a browser's panel would have been redrawn from. */
  published: () => ConductorState[];
  /** ... and every work the host put on the wire, in order: the id and the
   *  value, or `null` for one it removed. Per work, because the host tells a
   *  reader only what MOVED. */
  worksPublished: () => Array<{ id: string; work: Work | null }>;
  /** ... and the same for how each member terminal stands. */
  readingsPublished: () => Array<{
    terminal: string;
    reading: { level: ConductorReadingLevel; since: string } | null;
  }>;
  /** Every "the membership moved" the host announced — `true` when the SET of
   *  member refs changed, `false` when only what kolu knows about one did. */
  membersMoved: () => boolean[];
}

function rig(over: Remembered = {}): Rig {
  const root = over.root ?? "/state";
  const { spawn, spawns } = fakeSpawner();
  const record = countingStore<PersistedConductor>(
    over.record ?? EMPTY_PERSISTED_CONDUCTOR,
  );
  const transcript = countingStore<PersistedTranscript>({
    rows: over.rows ?? [],
  });
  const works = countingStore<PersistedWorks>(over.works ?? []);
  const members = countingStore<PersistedMembers>(over.members ?? {});
  const files = fakeFiles();
  const published: ConductorState[] = [];
  const membersMoved: boolean[] = [];
  const worksPublished: Array<{ id: string; work: Work | null }> = [];
  const readingsPublished: Array<{
    terminal: string;
    reading: { level: ConductorReadingLevel; since: string } | null;
  }> = [];
  const host = startConductorHost({
    log,
    home: HOME,
    hostName: HOST,
    fleetMcp: () =>
      over.endpoint === undefined ? liveEndpoint : over.endpoint,
    // THE REAL PROOF, pushed in the way the boot pushes it: the package that
    // owns the conversation does not own the MCP pin, so what it is handed is
    // the server's own prover — which is why every bring-up below exercises
    // the real door rather than an imitation of it.
    proveFleetMcp: proveFleetMcpEndpoint,
    // The served cells, as sinks — kept, because WHEN the host publishes is
    // itself behaviour: a reading that moves something a reader can see has
    // to reach the cell, and one that moves nothing must not.
    publish: (state) => {
      published.push(state);
    },
    publishWork: (id, work) => {
      worksPublished.push({ id, work });
    },
    publishReading: (terminal, reading) => {
      readingsPublished.push({ terminal, reading });
    },
    membersMoved: (membership) => {
      membersMoved.push(membership);
    },
    store: record.store,
    transcript: transcript.store,
    works: works.store,
    members: members.store,
    workFiles: files.port,
    storePath: () => join(root, "config.json"),
    transcriptPath: () => join(root, "conductor", "transcript.json"),
    stateRoot: root,
    spawn,
  });
  return {
    host,
    spawns,
    record,
    transcript,
    works,
    members,
    files,
    published: () => published,
    worksPublished: () => worksPublished,
    readingsPublished: () => readingsPublished,
    membersMoved: () => membersMoved,
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
      record: { ...EMPTY_PERSISTED_CONDUCTOR, sessionId: "sess-1", cwd: HOME },
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
  const record: PersistedConductor = {
    sessionId: "sess-1",
    cwd: HOME,
    model: null,
    fleet: [],
  };
  const rows = [row("old-1", 1), row("old-2", 2), row("old-3", 3)];

  it("resumes the session and tells the new conversation where to count from", async () => {
    const r = rig({ record, rows });
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(agent.options.resume).toBe("sess-1");
    // The highest `seq` we already hold. Anything the new process mints
    // sorts after it and cannot collide with a persisted id.
    expect(agent.options.resumedSeq).toBe(3);
  });

  it("does NOT double the transcript when the host restarts over it", async () => {
    const r = rig({ record, rows });
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
      record: {
        ...record,
        cwd: "/home/somebody-else",
        fleet: ["11111111-1111-4111-8111-111111111111"],
      },
      rows,
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

  it("brings the WORKS back whatever happened to the conversation", () => {
    // The record's `$HOME` moved, so the chat cannot be resumed — and the
    // waterfall it was running is still running. That is the whole reason the
    // works are a record of their own.
    const r = rig({
      record: { ...record, cwd: "/home/somebody-else" },
      rows,
      works: [
        storedWork({
          id: "work:kept",
          title: "fix the parser",
          members: [storedMember(A)],
        }),
      ],
    });
    r.host.watch(() => {});
    expect(r.host.works().map((one) => one.id)).toEqual(["work:kept"]);
    expect(r.host.memberRefs()).toEqual([A]);
  });
});

describe("the remembered records are read on the first reader's edge (B3)", () => {
  it("touches the stores NOT AT ALL at construction", () => {
    const r = rig();
    // The host is built before the surface exists — and there is no surface at
    // all in a unit test — so a read here is a crash in every test that
    // assembles kolu-server's surface.
    expect(r.record.reads()).toBe(0);
    expect(r.transcript.reads()).toBe(0);
    expect(r.works.reads()).toBe(0);
    // Including the serve-time cell seed, which reads this.
    expect(r.host.state().phase).toBe("offline");
    expect(r.record.reads()).toBe(0);
  });

  it("reads them ONCE, however many readers look", async () => {
    const r = rig();
    r.host.watch(() => {});
    r.host.watch(() => {});
    await r.host.prompt("hi", [], [], false);
    expect(r.record.reads()).toBe(1);
    expect(r.transcript.reads()).toBe(1);
    expect(r.works.reads()).toBe(1);
  });

  it("reads them to answer `works`, and starts NO agent doing it", () => {
    // The watcher asks this at boot. A conversation spawned to answer "what
    // work is in flight" is a subprocess nobody asked for.
    const r = rig({
      works: [storedWork({ id: "work:1", members: [storedMember(A)] })],
    });
    expect(r.host.works()).toHaveLength(1);
    expect(r.spawns).toHaveLength(0);
  });
});

describe("a bring-up that did not get there (M2)", () => {
  it("publishes the refusal instead of leaving an idle-looking panel", async () => {
    // No endpoint yet: the conversation cannot be told where the fleet's
    // terminals are, and the bring-up refuses before it spawns anything.
    const r = rig({ endpoint: null });
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
    const r = rig({
      endpoint: { url: "http://127.0.0.1:1/mcp", token: "unused" },
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
    const r = rig({
      endpoint: {
        ...liveEndpoint,
        token: "not-the-token-this-process-minted",
      },
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
      const r = rig({ endpoint: busy.at });
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
      const r = rig({ endpoint: sessionless.at });
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
    const r = rig({ endpoint: null });
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
    // A conversation that HAD a turn — one nobody spoke into is opened again
    // rather than resumed, which is a different question from WHICH id.
    const r = rig({
      record: {
        sessionId: "sess-remembered",
        cwd: HOME,
        model: null,
        fleet: [],
      },
      rows: [row("agent:1", 1, "an answer")],
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
    // conductor has no unbounded wait, and it alone has the work verbs).
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

describe("the records are written on a throttle (M4)", () => {
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
    const afterFirst = r.transcript.writes();
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
    expect(r.transcript.writes()).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.transcript.writes()).toBe(afterFirst + 1);
    expect(r.transcript.value().rows[0]).toMatchObject({
      id: "a",
      text: "x".repeat(200),
    });
  });

  it("rewrites the TRANSCRIPT alone when only the rows moved", async () => {
    // The whole reason the rows left `config.json`: a streaming answer must
    // not rewrite the host map and the preferences at an agent's output
    // cadence. Three records, one timer, and a write each only when it owes
    // one.
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("stream at me", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    const works = r.works.writes();
    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "one")],
      removes: [],
      appends: [],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.transcript.writes()).toBeGreaterThan(0);
    expect(r.works.writes()).toBe(works);
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
    const before = r.transcript.writes();
    agent.push({
      kind: "rows",
      upserts: [row("b", 2)],
      removes: [],
      appends: [],
    });
    expect(r.transcript.writes()).toBe(before);

    await r.host.dispose();
    expect(r.transcript.writes()).toBe(before + 1);
    expect(r.transcript.value().rows.map((one) => one.id)).toEqual(["a", "b"]);
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
    const host = startConductorHost({
      log,
      home: HOME,
      hostName: HOST,
      fleetMcp: () => liveEndpoint,
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: () => {},
      publishWork: () => {},
      publishReading: () => {},
      membersMoved: () => {},
      store: countingStore(EMPTY_PERSISTED_CONDUCTOR).store,
      transcript: countingStore<PersistedTranscript>({ rows: [] }).store,
      works: countingStore<PersistedWorks>([]).store,
      members: countingStore<PersistedMembers>({}).store,
      workFiles: fakeFiles().port,
      storePath: () => "/state/config.json",
      transcriptPath: () => "/state/conductor/transcript.json",
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
    expect(r.record.value().sessionId).toBe("s-1");
    expect(r.transcript.value().rows.map((one) => one.id)).toEqual(["a"]);
  });

  it("does not stand there for an open that is still on the wire (R7)", async () => {
    vi.useFakeTimers();
    const { spawn, spawns } = fakeSpawner();
    const held = Promise.withResolvers<void>();
    const host = startConductorHost({
      log,
      home: HOME,
      hostName: HOST,
      fleetMcp: () => liveEndpoint,
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: () => {},
      publishWork: () => {},
      publishReading: () => {},
      membersMoved: () => {},
      store: countingStore(EMPTY_PERSISTED_CONDUCTOR).store,
      transcript: countingStore<PersistedTranscript>({ rows: [] }).store,
      works: countingStore<PersistedWorks>([]).store,
      members: countingStore<PersistedMembers>({}).store,
      workFiles: fakeFiles().port,
      storePath: () => "/state/config.json",
      transcriptPath: () => "/state/conductor/transcript.json",
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
      record: { sessionId: "sess-1", cwd: HOME, model: null, fleet },
      rows: [row("old-1", 1)],
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
    expect(r.record.value().fleet).toEqual(fleet);
  });
});

describe("a record that parses but is wrong (R8)", () => {
  it("says the refusal where a READER is looking, as well as throwing", () => {
    // A row with no `kind` — the shape a hand-edit or a rolled-back binary
    // leaves behind. The read runs on the `watch` edge, outside the bring-up's
    // own refusal arm.
    const r = rig({
      record: { ...EMPTY_PERSISTED_CONDUCTOR, cwd: HOME },
      rows: [{ id: "a", seq: 1, since: T0 }] as unknown as ConductorRow[],
    });
    expect(() => r.host.watch(() => {})).toThrow(/does not match schema/);
    // Without this the cell still said `refusal: null`, and a person holding
    // an unreadable state-root got an idle-looking panel with a live composer
    // under it instead of the name of the file to fix — and the file named is
    // the one holding the bad value, which is no longer `config.json`.
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain(
      join("/state", "conductor", "transcript.json"),
    );
  });

  it("refuses a WORK that parses but is wrong, by the name of the file holding it", () => {
    // Loudest of the three on purpose: a work carries the human's decisions,
    // and there is no second copy of them anywhere.
    const r = rig({
      works: [{ id: "work:1", title: 7 }] as unknown as PersistedWorks,
    });
    expect(() => r.host.watch(() => {})).toThrow(/do not match schema/);
    expect(r.host.state().refusal).toContain(join("/state", "config.json"));
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
    const r = rig({ root });
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
    const r = rig({ root });
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
    const r = rig({ root });
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
    const r = rig({ root });
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
    const r = rig({ root });
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
    const r = rig({ root });
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
    const r = rig({
      record: { sessionId: "sess-1", cwd: HOME, model: null, fleet: [] },
      rows: [
        {
          id: "user-1",
          seq: 1,
          since: T0,
          kind: "user",
          text: "look",
          attachments: [chip({ bytes: 4, path: join(dir, "att-1") })],
        },
      ],
      root,
    });
    r.host.watch(() => {});
    expect(readdirSync(dir)).toEqual(["att-1"]);
  });

  it("a REFUSED prompt leaves no file the transcript does not name", async () => {
    const r = rig({ root });
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
    const r = rig({ root });
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
    since: T0,
    kind: "divider",
    text: "new session",
  });

  it("restores as ONE — a run of them is one reset, however it got written", () => {
    const r = rig({
      record: { sessionId: "sess-1", cwd: HOME, model: null, fleet: [] },
      rows: [
        row("agent-1", 1, "you're welcome"),
        divider("div-1", 2),
        divider("div-2", 3),
        divider("div-3", 4),
        divider("div-4", 5),
      ],
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
      record: { sessionId: "sess-1", cwd: HOME, model: null, fleet: [] },
      rows: [row("agent-1", 1, "you're welcome"), divider("div-1", 2)],
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
      record: { sessionId: "sess-1", cwd: HOME, model: null, fleet: [] },
      rows: [divider("div-1", 1), row("agent-1", 2, "hello")],
    });
    await r.host.newSession();
    expect(r.spawns[0]?.options.resumedEndsWithDivider).toBe(false);
  });
});

/** Two member terminals, as fleet refs — one per host, because a work's
 *  membership spans the fleet and a bare id would name two terminals on a
 *  two-host one. */
const A = "local/11111111-1111-4111-8111-111111111111";
const B = "remote:prod/22222222-2222-4222-8222-222222222222";

/** What kolu knew about one member TERMINAL, as the `members` key keeps it —
 *  its own record now, beside the works rather than inside one. */
const storedWatch = (over: Partial<MemberWatch> = {}): MemberWatch => ({
  name: "fix the parser",
  agent: "claude-code",
  told: null,
  joined: "created",
  spoken: true,
  ran: false,
  ...over,
});

/** ... and the whole `members` key for a set of refs. */
const storedMembers = (
  refs: Readonly<Record<string, Partial<MemberWatch>>>,
): PersistedMembers =>
  Object.fromEntries(
    Object.entries(refs).map(([ref, over]) => [ref, storedWatch(over)]),
  );

/** One member of a work, as the record keeps it. */
const storedMember = (
  terminal: string,
  over: {
    role?: WorkRole;
    leftAt?: string | null;
    worktree?: string | null;
  } = {},
): WorkMember => ({
  terminal,
  role: over.role ?? "implementor",
  joinedAt: T0,
  leftAt: over.leftAt ?? null,
  worktree: over.worktree ?? null,
});

/** A piece of work as a previous kolu-server left it on disk. */
const storedWork = (over: Partial<Work> & { id: string }): Work => ({
  title: "fix the parser",
  repo: "/srv/repo",
  branch: "fix-the-parser",
  members: [],
  events: [],
  decisions: [],
  startedAt: T0,
  endedAt: null,
  outcome: null,
  keptFiles: [],
  ...over,
});

/** One reading of one terminal, as the watcher hands it over. */
const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
    /** The repository the terminal is in — where a work's files are listed
     *  from. Absent by default: a terminal nothing has read a record for. */
    git?: WatchGit | null;
    /** The PR its record carries, if it carries one. */
    pr?: WatchPr | null;
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
  git: over.git ?? null,
  pr: over.pr ?? null,
});

/** The worktree a member's record names, as a reading carries it. */
const inRepo: WatchGit = {
  worktree: "/srv/worktrees/fix-the-parser",
  branch: "fix-the-parser",
  repo: "/srv/repo",
};

/** A conversation that is WORKING, as the harness publishes one — the state
 *  every held-news rule turns on. */
const working = (agent: Spawned): void => {
  agent.push({
    kind: "state",
    state: {
      ...DEFAULT_CONDUCTOR_STATE,
      phase: "working",
      busySince: T0,
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

/** A PLAIN WATCH the human asked for, opened the way the Conductor opens one:
 *  the two setup answers the request already carried, so nothing is put to
 *  anybody and the work exists the moment this returns. */
const watchWork = async (r: Rig, title = "fix the parser"): Promise<string> => {
  const opened = await r.host.openWork({
    title,
    repo: "/srv/repo",
    branch: "fix-the-parser",
    setup: [
      {
        key: "host",
        question: "Which machine?",
        options: ["local"],
        given: "local",
      },
      {
        key: "mode",
        question: "How should kolu run it?",
        options: ["watch"],
        given: "watch",
      },
    ],
  });
  return opened.work;
};

/** A conversation that is up, working, and a work with both terminals in it —
 *  both of them BRIEFED, which is the ordinary state of a terminal the
 *  Conductor created: it opened it, said what to do, and is waiting for the
 *  answer. An agent nobody has spoken to rings `ready` on its first idle
 *  instead, which is its own case below. */
const busyWatching = async (r: Rig): Promise<Spawned> => {
  await r.host.prompt("hello", [], [], false);
  const agent = r.spawns[0];
  if (agent === undefined) throw new Error("the host spawned nothing");
  working(agent);
  const work = await watchWork(r);
  r.host.joinWork(work, A, "implementor", "created");
  r.host.joinWork(work, B, "other", "created");
  r.host.saidTo(A);
  r.host.saidTo(B);
  return agent;
};

/** The one work this host is holding — every test below opens exactly one
 *  unless it says otherwise. */
const theWork = (r: Rig): Work => {
  const one = r.host.works()[0];
  if (one === undefined) throw new Error("no piece of work was opened");
  return one;
};

const kindsOf = (work: Work): ReadonlyArray<string> =>
  work.events.map((one) => one.kind);

/** Let whatever the last reading set going finish. A member's `.waterfall/` is
 *  listed ONE call at a time, so a test that fired the next reading while the
 *  first listing was still in flight would be racing that guard rather than
 *  the behaviour under it. No wall-clock wait: `setImmediate` lands after
 *  every microtask the listing's own continuations queue, and the fake port
 *  answers in microtasks. */
const drained = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

describe("the wipe (`clearSession`)", () => {
  /** A conversation with something to lose: two rows, a session and a
   *  terminal it remembers. */
  const held: Remembered = {
    record: {
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      fleet: ["local/term-1"],
    },
    rows: [row("user:1", 1, "hello"), row("agent:2", 2, "hello back")],
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
    expect(r.transcript.value().rows).toEqual([]);
    expect(r.record.value().fleet).toEqual([]);
    expect(r.host.state().fleet).toEqual([]);
    // The records are written at once rather than on the throttle: a window in
    // which a file still holds a deleted conversation is a window in which a
    // restart restores it.
    expect(r.record.writes()).toBeGreaterThan(0);
    // ... and the AGENT was given a new conversation, which is the half of
    // this that happens outside our bookkeeping.
    expect(r.spawns[0]?.sessions()).toBe(1);
  });

  it("KEEPS every piece of work, and drops the question one had open", async () => {
    // The ruling this whole record exists for: "New session" clears the
    // CONVERSATION. A person pressing it has said they are done with the chat,
    // not that they stopped caring about a waterfall in flight. What a work
    // does lose is the question it had open — the promise behind it belonged
    // to the conversation being deleted — so the decision is recorded as
    // dropped rather than left waiting on nobody for ever.
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    const asking = r.host.askAboutWork(work, [
      { question: "Approve the plan?", options: ["yes", "no"] },
    ]);
    await vi.waitFor(() => {
      expect(agent.asks()).toHaveLength(1);
    });

    await r.host.clearSession();

    // The work is still in progress, with its member and its decisions.
    const kept = theWork(r);
    expect(kept.id).toBe(work);
    expect(kept.endedAt).toBeNull();
    expect(r.host.memberRefs()).toEqual([A]);
    expect(r.works.value()[0]?.id).toBe(work);
    // ... and the question went with the conversation. (The two decisions
    // before it are the setup the request itself answered.)
    expect(
      kept.decisions.find((one) => one.question === "Approve the plan?")
        ?.answer,
    ).toMatchObject({ how: "dropped" });
    expect(kindsOf(kept)).toContain("question-dropped");
    // The caller is told rather than left holding a promise nothing will
    // settle.
    await expect(asking).resolves.toMatchObject({ declined: true });
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
    const r = rig({ root });
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
          since: T0,
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

describe("opening a piece of work", () => {
  /** The setup a full waterfall must carry — every key the mode it offers can
   *  need, asked in the one call, which is what `work_open` refuses without. */
  const fullSetup = [
    {
      key: "host" as SetupKey,
      question: "Which machine?",
      options: ["local", "prod"],
      given: "local",
    },
    {
      key: "mode" as SetupKey,
      question: "How much of this?",
      options: ["full", "trivial"],
    },
    {
      key: "planner.harness" as SetupKey,
      question: "Planner's harness?",
      options: ["claude-code"],
    },
    {
      key: "planner.model" as SetupKey,
      question: "Planner's model?",
      options: ["opus"],
    },
    {
      key: "implementor.harness" as SetupKey,
      question: "Implementor's harness?",
      options: ["claude-code"],
    },
    {
      key: "implementor.model" as SetupKey,
      question: "Implementor's model?",
      options: ["sonnet"],
    },
    {
      key: "on-green" as SetupKey,
      question: "And when CI is green?",
      options: ["merge", "hand-over"],
    },
  ];

  /** The field one setup question is drawn under — its decision's id, which is
   *  the key `askForm` gives the choice and the key an answer comes back
   *  under. */
  const fieldOf = (r: Rig, key: SetupKey): string => {
    const decision = theWork(r).decisions.find((one) => one.key === key);
    if (decision === undefined) throw new Error(`nothing was asked for ${key}`);
    return decision.id;
  };

  /** A conversation that is up and idle, with the human's own words in the
   *  transcript — which is what a work's first timeline line is written from. */
  const asked = async (r: Rig): Promise<Spawned> => {
    r.host.watch(() => {});
    await r.host.prompt("fix the parser", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    agent.push({
      kind: "rows",
      upserts: [userRow("user:1", 1, "fix the parser on prod, please")],
      removes: [],
      appends: [],
    });
    return agent;
  };

  it("creates the work AT ONCE, puts the setup as ONE row, and reads the answers back", async () => {
    const r = rig();
    const agent = await asked(r);
    const opening = r.host.openWork({
      title: "fix the parser",
      repo: "/srv/repo",
      branch: "fix-the-parser",
      setup: fullSetup,
    });
    const ask = await vi.waitFor(() => {
      const one = agent.asks()[0];
      if (one === undefined) throw new Error("nothing was asked");
      return one;
    });

    // THE WORK EXISTS BEFORE ANYBODY HAS ANSWERED, with the human's own words
    // at the top of its timeline — kolu quotes what it SAW, never the
    // Conductor's summary of it.
    const open = theWork(r);
    expect(open.title).toBe("fix the parser");
    expect(open.events[0]).toMatchObject({
      kind: "requested",
      by: "you",
      detail: "fix the parser on prod, please",
    });
    // ... and the row NAMES the work, which is what lets the card draw and
    // answer the same question the chat does.
    expect(ask.work).toBe(open.id);
    expect(kindsOf(open)).toContain("question");
    // An answer the REQUEST already gave is a decision, and nobody was asked.
    expect(
      open.decisions.find((one) => one.key === "host")?.answer,
    ).toMatchObject({ how: "answered", picked: ["local"], from: "request" });

    await r.host.answer(
      ask.id,
      [
        { key: fieldOf(r, "mode"), values: ["full"] },
        { key: fieldOf(r, "planner.harness"), values: ["claude-code"] },
        { key: fieldOf(r, "planner.model"), values: ["opus"] },
        { key: fieldOf(r, "implementor.harness"), values: ["claude-code"] },
        { key: fieldOf(r, "implementor.model"), values: ["sonnet"] },
        { key: fieldOf(r, "on-green"), values: ["merge"] },
      ],
      "card",
    );
    const settled = await opening;

    // THE SETUP IS A READING of those decisions — there is no second copy.
    expect(settled.declined).toBe(false);
    expect(settled.setup).toEqual({
      host: "local",
      mode: "full",
      roles: [
        { role: "planner", harness: "claude-code", model: "opus" },
        { role: "implementor", harness: "claude-code", model: "sonnet" },
      ],
      onGreen: "merge",
    });
    const answered = theWork(r);
    // ... and the record says WHERE the human was looking when they answered.
    expect(
      answered.decisions.find((one) => one.key === "mode")?.answer,
    ).toMatchObject({ how: "answered", picked: ["full"], from: "card" });
    expect(kindsOf(answered)).toContain("answered");
  });

  it("takes the words the human typed instead of an option", async () => {
    const r = rig();
    const agent = await asked(r);
    const opening = r.host.openWork({
      title: "fix the parser",
      repo: "/srv/repo",
      branch: "fix-the-parser",
      setup: fullSetup,
    });
    const ask = await vi.waitFor(() => {
      const one = agent.asks()[0];
      if (one === undefined) throw new Error("nothing was asked");
      return one;
    });
    // The "or say it in your own words" box beside the options, which is a
    // field of its own keyed off the decision.
    await r.host.answer(
      ask.id,
      [
        { key: fieldOf(r, "mode"), values: ["trivial"] },
        { key: `${fieldOf(r, "implementor.model")}~other`, values: ["haiku"] },
        { key: fieldOf(r, "implementor.harness"), values: ["claude-code"] },
        { key: fieldOf(r, "on-green"), values: ["hand-over"] },
      ],
      "chat",
    );
    const settled = await opening;
    expect(settled.setup.mode).toBe("trivial");
    // Typed rather than picked, and read back all the same.
    expect(settled.setup.roles).toEqual([
      { role: "implementor", harness: "claude-code", model: "haiku" },
    ]);
    expect(settled.setup.onGreen).toBe("hand-over");
    expect(
      theWork(r).decisions.find((one) => one.key === "implementor.model")
        ?.answer,
    ).toMatchObject({
      how: "answered",
      picked: [],
      text: "haiku",
      from: "chat",
    });
  });

  it("ends the work ABANDONED when the human declines the setup", async () => {
    const r = rig();
    const agent = await asked(r);
    const opening = r.host.openWork({
      title: "fix the parser",
      repo: "/srv/repo",
      branch: "fix-the-parser",
      setup: fullSetup,
    });
    const ask = await vi.waitFor(() => {
      const one = agent.asks()[0];
      if (one === undefined) throw new Error("nothing was asked");
      return one;
    });
    await r.host.answer(ask.id, null, "chat");
    const settled = await opening;

    // A setup nobody answered is a work nobody wanted: the Conductor is told
    // rather than left holding an id for a card that will never have a member.
    expect(settled.declined).toBe(true);
    expect(theWork(r)).toMatchObject({ outcome: "abandoned" });
  });

  it("asks NOBODY ANYTHING when the request already said it all", async () => {
    const r = rig();
    const agent = await asked(r);
    const work = await watchWork(r);
    // The whole point of `given`: the human said where and how in the message
    // that started this, and a form putting it back to them is the "you
    // already told me, say it again" this shape removes.
    expect(agent.asks()).toEqual([]);
    expect(theWork(r).id).toBe(work);
    expect(kindsOf(theWork(r))).not.toContain("question");
  });
});

describe("a call about a work that is refused", () => {
  /** The refusal, as the fleet face reads it: a kind to branch on and a whole
   *  sentence to show. (`no-role` is the fourth kind and is refused BEFORE a
   *  terminal is created, in `kolu-mcp`'s `lift.ts` — the role is not optional
   *  in this host's signature at all.) */
  const refusalOf = async (run: () => unknown): Promise<WorkRefusal> => {
    try {
      await run();
    } catch (err) {
      if (err instanceof WorkRefusal) return err;
      throw err;
    }
    throw new Error("nothing was refused");
  };

  it("refuses a setup that does not ask what the mode it offers needs", async () => {
    const r = rig();
    const refused = await refusalOf(() =>
      r.host.openWork({
        title: "fix the parser",
        repo: "/srv/repo",
        branch: "fix-the-parser",
        // `full` is on offer, so the planner's two questions belong in this
        // same form: a work half set up is a planner launched on a model
        // nobody chose, and the Conductor cannot fix that with a second form
        // later.
        setup: [
          {
            key: "host",
            question: "Which machine?",
            options: ["local"],
            given: "local",
          },
          { key: "mode", question: "How much?", options: ["full"] },
        ],
      }),
    );
    expect(refused.kind).toBe("missing-setup");
    expect(refused.why).toContain("planner.harness");
    // NOTHING WAS CREATED: the refusal is taken before the work exists.
    expect(r.host.works()).toEqual([]);
  });

  it("refuses a member joining a work nobody opened", async () => {
    const r = rig();
    const refused = await refusalOf(() =>
      r.host.joinWork("work:never", A, "implementor", "created"),
    );
    expect(refused.kind).toBe("unknown-work");
    expect(r.host.memberRefs()).toEqual([]);
  });

  it("refuses a member, a question and a note once the work has ENDED", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    // Its one member leaves, so nobody is doing it any more.
    r.host.leaveWork(A);
    expect(theWork(r)).toMatchObject({ outcome: "abandoned" });

    expect(
      (await refusalOf(() => r.host.joinWork(work, B, "other", "asked"))).kind,
    ).toBe("work-ended");
    expect(
      (await refusalOf(() => r.host.note(work, "one more thing"))).kind,
    ).toBe("work-ended");
    expect(
      (
        await refusalOf(() =>
          r.host.askAboutWork(work, [
            { question: "Approve?", options: ["yes"] },
          ]),
        )
      ).kind,
    ).toBe("work-ended");
  });
});

describe("the news a member terminal makes", () => {
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
    // happened while it was busy at once — and the account names each, with
    // the work and the part it plays in it.
    expect(woke?.events.map((one) => one.ref)).toEqual([A, B]);
    expect(woke?.events.map((one) => one.level)).toEqual(["stopped", "asking"]);
    expect(woke?.text).toContain(A);
    expect(woke?.text).toContain(B);
    expect(woke?.text).toContain("the implementor of «fix the parser»");
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
    // owed, and the member must not remember having said it.
    agent.failWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    await r.host.dispose();
    const members = r.works.value()[0]?.members ?? [];
    expect(members.map((one) => one.terminal)).toEqual([A, B]);
    // The work says who its members are; the `members` key says what kolu
    // knows about each of those terminals.
    expect(r.members.value()).toEqual({
      [A]: {
        name: "fix the parser",
        agent: "claude-code",
        told: null,
        joined: "created",
        spoken: true,
        ran: false,
      },
      [B]: {
        // Nothing has read this one's host yet, so kolu knows nothing about
        // the terminal beyond the fact that it is a member.
        name: "",
        agent: null,
        told: null,
        joined: "created",
        spoken: true,
        ran: false,
      },
    });

    // ... and when one does go, that is what writes it down.
    const second = rig({
      record: r.record.value(),
      rows: r.transcript.value().rows,
      works: r.works.value(),
      members: r.members.value(),
    });
    await second.host.prompt("hello", [], [], false);
    const live = second.spawns[0];
    if (live === undefined) throw new Error("the host spawned nothing");
    idle(live);
    second.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(live.wakes()).toHaveLength(1);
    });
    await second.host.dispose();
    expect(second.members.value()[A]?.told).toBe("stopped");
  });
});

describe("the watch across a restart", () => {
  it("does not ring again about a terminal that has not moved", async () => {
    // The record a previous kolu-server left: this terminal was stopped, and
    // the conversation was told so before the restart.
    const r = rig({
      record: { ...EMPTY_PERSISTED_CONDUCTOR, cwd: HOME },
      works: [storedWork({ id: "work:carried", members: [storedMember(A)] })],
      members: storedMembers({ [A]: { told: "stopped" } }),
    });
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);

    // The watcher looks at every member terminal again after a boot, and this
    // one is still stopped for the reason it was stopped before: a wake here
    // is the conversation hearing the same news twice.
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.memberRefs()).toContain(A);
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

  it("drops a question that was still open when kolu stopped", async () => {
    // The conversation holding that promise is gone, so nobody can answer it
    // any more — and a decision left `null` would make the card say a person
    // is being waited on for ever.
    const r = rig({
      works: [
        storedWork({
          id: "work:carried",
          members: [storedMember(A)],
          events: [
            {
              at: T0,
              by: "agent",
              kind: "question",
              terminal: null,
              detail: "kolu:ask:1",
            },
          ],
          decisions: [
            {
              id: "d-1",
              ask: "kolu:ask:1",
              at: T0,
              key: null,
              question: "Approve the plan?",
              options: ["yes", "no"],
              multiple: false,
              answer: null,
            },
          ],
        }),
      ],
    });
    const carried = theWork(r);
    expect(carried.decisions[0]?.answer).toMatchObject({
      how: "dropped",
      from: null,
    });
    expect(kindsOf(carried)).toEqual(["question", "question-dropped"]);
    // The work itself is untouched: only the question it could no longer keep.
    expect(carried.endedAt).toBeNull();
  });
});

describe("what a reading publishes", () => {
  /** A work with one member, opened the hand-asked way, with no conversation
   *  in the picture: a reading must reach the cells without one. */
  const oneMember = async (r: Rig, join: "created" | "created-run") => {
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", join);
    return work;
  };

  it("publishes a LEVEL CHANGE that moves nothing else", async () => {
    // The command kolu typed is at the prompt: a shell, with no agent in it
    // and nothing to tell anybody. Then it starts running. Nothing else about
    // the terminal moves — same name, same (absent) agent, nothing held,
    // nothing the conversation was told — so the level and its clock are the
    // WHOLE of what a reader would see change.
    const r = rig();
    await oneMember(r, "created-run");
    r.host.observe([
      seeing(A, "shell", { agent: null, foregroundShell: true }),
    ]);
    const before = r.readingsPublished().length;

    r.host.observe([
      seeing(A, "working", { agent: null, foregroundShell: false }),
    ]);

    // ONE reading, for the one terminal that moved — not every work on the
    // wire again.
    expect(r.readingsPublished().slice(before)).toEqual([
      { terminal: A, reading: { level: "working", since: expect.any(String) } },
    ]);
  });

  it("tells the works' readers when a reading first DETECTS the agent", async () => {
    // The agent is not in the conversation's cell — it is what kolu knows
    // about a member — so what has to move here is the membership event, with
    // `membership: false`: the set of member refs is the same one, and a
    // watcher that re-scoped for this would tear down its subscriptions over
    // a terminal that never left.
    const r = rig();
    await oneMember(r, "created");
    r.host.observe([seeing(A, "working", { agent: null })]);
    const before = r.membersMoved().length;

    r.host.observe([seeing(A, "working", { agent: "claude-code" })]);

    expect(r.membersMoved().slice(before)).toEqual([false]);
    expect(r.host.membersDetail()[0]?.agent).toBe("claude-code");
  });

  it("says NOTHING when a reading repeats what was already read", async () => {
    const r = rig();
    await oneMember(r, "created");
    r.host.observe([seeing(A, "working")]);
    const published = r.worksPublished().length;
    const moved = r.membersMoved().length;

    r.host.observe([seeing(A, "working")]);

    // Including the CLOCK: the stamp of the reading that first saw the level
    // is carried forward, so "working 4m" is four minutes of working rather
    // than four minutes of polling — and a poll that read the same thing
    // again is not a frame, not a write and not an event.
    expect(r.worksPublished().length).toBe(published);
    expect(r.membersMoved().length).toBe(moved);
  });
});

describe("the timeline a reading writes", () => {
  /** A conversation that is up and idle, one work, one member that has been
   *  briefed — the ordinary state of a waterfall in flight. */
  const running = async (r: Rig): Promise<{ agent: Spawned; work: string }> => {
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    r.host.saidTo(A);
    return { agent, work };
  };

  it("writes a ring as the same-named event, by the agent", async () => {
    const r = rig();
    await running(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("stopped");
    });
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "stopped",
      by: "agent",
      terminal: A,
    });

    // ... and a command that ran with no agent ever in it is spelled as an
    // ending, said by kolu because there was no agent there to do it.
    const second = rig();
    const work = await watchWork(second);
    second.host.joinWork(work, B, "other", "created-run");
    second.host.observe([
      seeing(B, "working", { agent: null, foregroundShell: false }),
    ]);
    second.host.observe([
      seeing(B, "shell", { agent: null, foregroundShell: true }),
    ]);
    await vi.waitFor(() => {
      expect(kindsOf(theWork(second))).toContain("exited");
    });
    expect(theWork(second).events.at(-1)).toMatchObject({
      kind: "exited",
      by: "kolu",
      detail: "ended without an agent",
    });
  });

  it("writes a `.waterfall/` file ONCE, however often the directory is listed", async () => {
    const r = rig();
    r.files.holds([".waterfall/plan.md"]);
    await running(r);

    // Off a LEVEL CHANGE rather than a timer: the moment an agent stops is the
    // moment its files have just changed.
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(1);
    });
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      terminal: A,
      detail: ".waterfall/plan.md",
    });
    expect(r.files.listed()).toEqual([
      { host: "local", worktree: inRepo.worktree },
    ]);

    // The same file, listed again on the next level change: a path the
    // timeline already names is not news a second time.
    r.host.observe([seeing(A, "working", { git: inRepo })]);
    await drained();
    r.host.observe([seeing(A, "asking", { git: inRepo })]);
    await drained();
    expect(r.files.listed()).toHaveLength(3);
    expect(theWork(r).events.filter((one) => one.kind === "file")).toHaveLength(
      1,
    );

    // ... and a NEW one is, on the next change.
    r.files.holds([".waterfall/plan.md", ".waterfall/review.md"]);
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(2);
    });
  });

  it("carries on after a listing that FAILED, and asks again on the next change", async () => {
    // A listing that fails is logged and nothing else: the next level change
    // asks again, and a timeline announcing "could not list files" every few
    // seconds would bury the events a person reads it for.
    const r = rig();
    r.files.listFails("the host is not answering");
    r.files.holds([".waterfall/plan.md"]);
    await running(r);
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await drained();
    expect(r.files.listed()).toHaveLength(1);
    expect(theWork(r).events.filter((one) => one.kind === "file")).toEqual([]);

    r.files.listFails(null);
    r.host.observe([seeing(A, "asking", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(1);
    });
  });

  it("records ONE PR for two members, and ends the work when it merges", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.joinWork(work, B, "planner", "created");
    r.host.saidTo(B);
    const pr: WatchPr = {
      number: 412,
      title: "fix the parser",
      state: "open",
      checks: null,
      failing: [],
    };

    // BOTH members see the same PR, in one frame of the world. The comparison
    // is against the TIMELINE, not against the last reading, so it is recorded
    // once.
    r.host.observe([
      seeing(A, "working", { pr }),
      seeing(B, "working", { pr }),
    ]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "pr-opened"),
      ).toHaveLength(1);
    });
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "pr-opened",
      detail: "#412 fix the parser",
    });

    // Its checks start, and pass — by CI, which is who the time bar colours it
    // for.
    r.host.observe([
      seeing(A, "stopped", { pr: { ...pr, checks: "pending" } }),
    ]);
    r.host.observe([
      seeing(A, "working", { pr: { ...pr, checks: "pending" } }),
    ]);
    r.host.observe([seeing(A, "stopped", { pr: { ...pr, checks: "pass" } })]);
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("checks-passed");
    });
    expect(
      theWork(r).events.filter((one) => one.kind === "checks-running"),
    ).toHaveLength(1);

    // ... and the merge is what says a piece of work is finished rather than
    // merely quiet.
    r.host.observe([
      seeing(A, "working", { pr: { ...pr, state: "merged", checks: "pass" } }),
      seeing(B, "working", { pr: { ...pr, state: "merged", checks: "pass" } }),
    ]);
    await vi.waitFor(() => {
      expect(theWork(r).outcome).toBe("merged");
    });
    expect(
      theWork(r).events.filter((one) => one.kind === "merged"),
    ).toHaveLength(1);
    expect(r.host.memberRefs()).toEqual([]);
  });

  it("records failing checks by name", async () => {
    const r = rig();
    await running(r);
    r.host.observe([
      seeing(A, "stopped", {
        pr: {
          number: 7,
          title: "fix the parser",
          state: "open",
          checks: "fail",
          failing: ["build", "unit"],
        },
      }),
    ]);
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("checks-failed");
    });
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "checks-failed",
      by: "ci",
      detail: "build, unit",
    });
  });

  it("ABANDONS a work every member has left", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    idle(agent);
    // Both members go away — nobody is doing this piece of work any more, and
    // no PR ever said how it ended.
    r.host.observe([seeing(A, "gone"), seeing(B, "gone")]);
    await vi.waitFor(() => {
      expect(theWork(r).outcome).toBe("abandoned");
    });
    expect(theWork(r).endedAt).not.toBeNull();
    expect(r.host.memberRefs()).toEqual([]);
  });

  it("takes a NOTE from the Conductor, and nothing else it says", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.note(work, "the planner is re-reading the brief");
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "note",
      by: "agent",
      terminal: null,
      detail: "the planner is re-reading the brief",
    });
  });
});

describe("a work that has ended", () => {
  it("KEEPS the files it leaves behind, from both ends of what kolu knows", async () => {
    const r = rig();
    r.files.holds([".waterfall/plan.md"]);
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    r.host.saidTo(A);
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(1);
    });

    // A file written while nothing changed level was never observed, and is
    // still the plan somebody will want to read next month — so the end lists
    // the directory again and keeps the union.
    r.files.holds([".waterfall/plan.md", ".waterfall/review.md"]);
    r.host.leaveWork(A);

    await vi.waitFor(() => {
      expect(r.files.kept()).toHaveLength(1);
    });
    const kept = r.files.kept()[0];
    expect(kept?.work).toBe(work);
    expect([...(kept?.paths ?? [])].sort()).toEqual([
      ".waterfall/plan.md",
      ".waterfall/review.md",
    ]);
    await vi.waitFor(() => {
      expect(theWork(r).keptFiles).toHaveLength(2);
    });
    expect(kindsOf(theWork(r))).toContain("kept");
    // ... and the work is on disk the moment it ends, not a throttle window
    // later.
    expect(r.works.value()[0]?.keptFiles).toHaveLength(2);
  });

  it("drops the OLDEST finished work past the twenty it keeps, files and all", async () => {
    // Twenty finished works already on disk, newest last.
    const r = rig({
      works: Array.from({ length: 20 }, (_, at) =>
        storedWork({
          id: `work:old-${at}`,
          title: `done ${at}`,
          endedAt: `2026-01-02T00:${String(at).padStart(2, "0")}:00.000Z`,
          outcome: "merged",
          members: [storedMember(`local/old-${at}`, { leftAt: T0 })],
        }),
      ),
    });
    const work = await watchWork(r, "the twenty-first");
    r.host.joinWork(work, A, "implementor", "created");
    r.host.leaveWork(A);

    await vi.waitFor(() => {
      expect(r.files.swept().at(-1)).not.toContain("work:old-0");
    });
    const remembered = r.host.works().map((one) => one.id);
    expect(remembered).toHaveLength(20);
    expect(remembered).not.toContain("work:old-0");
    expect(remembered[0]).toBe(work);
    // The file says the same thing, immediately: a cap's whole point is that
    // what was there is gone.
    expect(r.works.value().map((one) => one.id)).not.toContain("work:old-0");
  });

  it("SAYS SO when the copy could not be made", async () => {
    const r = rig();
    r.files.holds([".waterfall/plan.md"]);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(1);
    });
    // The host stops answering between the last file and the end.
    r.files.listFails("the host is not answering");
    r.host.leaveWork(A);
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("kept");
    });
    // The listing failed, so what is kept is what kolu SAW appear — the files
    // are the half of a work that outlives its worktree.
    expect(theWork(r).keptFiles).toEqual([
      { path: ".waterfall/plan.md", bytes: ".waterfall/plan.md".length },
    ]);
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
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created-run");
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

describe("a terminal the Conductor closed itself", () => {
  it("leaves in silence even when its going has already rung", async () => {
    // The human's session: after a merge the Conductor closed its planner
    // and implementor, and was then woken — `… gone · … gone` — to spend a
    // turn explaining that it had done that itself. padi publishes the
    // removal BEFORE the kill answers, so the watcher sees the terminal go
    // first: by the time the face says "closed", the member has already left
    // its work and its `gone` is waiting for the turn to end.
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "gone")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    r.host.closedTerminal(A);
    expect(r.host.state().held).toEqual([]);
    expect(r.host.memberRefs()).toEqual([B]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakes()).toEqual([]);
  });

  it("says nothing about it when the watcher sees it go only afterwards", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.closedTerminal(A);
    expect(r.host.memberRefs()).toEqual([B]);
    // The frame that was in flight across the close: a ref nobody watches.
    r.host.observe([seeing(A, "gone")]);
    expect(r.host.state().held).toEqual([]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakes()).toEqual([]);
  });

  it("still rings for a terminal that went away WITHOUT being closed", async () => {
    // Only a death the Conductor did not cause is news — closing A says
    // nothing about B.
    const r = rig();
    const agent = await busyWatching(r);
    r.host.closedTerminal(A);
    r.host.observe([seeing(A, "gone"), seeing(B, "gone")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    expect(agent.wakes()[0]?.events.map((one) => one.ref)).toEqual([B]);
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

  it("retries on the next reading of a member terminal", async () => {
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

/** A refusal, caught: a kind to branch on and a whole sentence to show. */
const refused = (run: () => unknown): WorkRefusal => {
  try {
    run();
  } catch (err) {
    if (err instanceof WorkRefusal) return err;
    throw err;
  }
  throw new Error("nothing was refused");
};

/** A work kolu RUNS — `full`, every setup answer already given, so nobody is
 *  asked anything — with one member in it. (A `watch` is the human's own
 *  terminal: the Conductor never types into one, so there is nothing to take
 *  over. That is the refusal below.) */
const drivenWork = async (r: Rig, member = A): Promise<string> => {
  const given = (key: SetupKey, answer: string) => ({
    key,
    question: `${key}?`,
    options: [answer],
    given: answer,
  });
  const opened = await r.host.openWork({
    title: "fix the parser",
    repo: "/srv/repo",
    branch: "fix-the-parser",
    setup: [
      given("host", "local"),
      given("mode", "full"),
      given("planner.harness", "omp"),
      given("planner.model", "Fable 5.2"),
      given("implementor.harness", "omp"),
      given("implementor.model", "Opus 5.5"),
      given("on-green", "merge"),
    ],
  });
  r.host.joinWork(opened.work, member, "implementor", "created");
  return opened.work;
};

describe("taking a driven terminal over, and handing it back", () => {
  it("writes it on the work, and tells the Conductor to keep its hands off", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    const work = await drivenWork(r, B);
    idle(agent);

    r.host.takeOver(B);

    const driven = r.host.works().find((one) => one.id === work);
    expect(kindsOf(driven as Work).at(-1)).toBe("taken-over");
    expect(driverOf(driven as Work, B)).toBe("you");
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(1);
    });
    const woke = agent.wakes()[0];
    expect(woke?.events.map((one) => one.level)).toEqual(["taken-over"]);
    expect(woke?.text).toContain(B);
    expect(woke?.text).toContain("the implementor of «fix the parser»");
    expect(woke?.text).toContain("TOOK IT OVER");

    r.host.handBack(B);
    const back = r.host.works().find((one) => one.id === work);
    expect(kindsOf(back as Work).at(-1)).toBe("handed-back");
    expect(driverOf(back as Work, B)).toBe("conductor");
    await vi.waitFor(() => {
      expect(agent.wakes()).toHaveLength(2);
    });
    expect(agent.wakes()[1]?.events.map((one) => one.level)).toEqual([
      "handed-back",
    ]);
  });

  it("works while the agent is DOWN — the news waits for somebody to tell", async () => {
    // No fleet endpoint: nothing can be brought up, so a take over that went
    // through the conversation could not happen at all. A person must be able
    // to take a terminal over whether or not kolu's agent is there.
    const r = rig({ endpoint: null });
    await drivenWork(r);

    r.host.takeOver(A);

    expect(driverOf(theWork(r), A)).toBe("you");
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    // ... and it is on disk at once: who may type into a terminal is the one
    // fact a restart must not get wrong.
    expect(r.works.value()?.[0]?.events.at(-1)?.kind).toBe("taken-over");
  });

  it("refuses a terminal nothing drives, and one already in that state", async () => {
    const r = rig();
    await drivenWork(r);
    // A terminal of no work at all.
    expect(refused(() => r.host.takeOver(B)).kind).toBe("not-driven");
    r.host.takeOver(A);
    expect(refused(() => r.host.takeOver(A)).kind).toBe("already-yours");
    r.host.handBack(A);
    expect(refused(() => r.host.handBack(A)).kind).toBe("already-conductors");
    expect(refused(() => r.host.handBack(A)).why).toContain(
      "already the Conductor's",
    );
  });

  it("refuses a WATCH: that terminal is the person's, and always was", async () => {
    const r = rig();
    const work = await watchWork(r);
    r.host.joinWork(work, A, "other", "asked");

    expect(refused(() => r.host.takeOver(A)).kind).toBe("not-driven");
    expect(driverOf(theWork(r), A)).toBeNull();
  });
});

describe("a restored backup of the works", () => {
  it("replaces them, drops their open questions, re-scopes and writes NOW", async () => {
    const r = rig();
    const before = await drivenWork(r);
    const moved = r.membersMoved().length;
    const writes = r.works.writes();

    r.host.restoreWorks(
      [
        storedWork({
          id: "work:restored",
          title: "carried over",
          members: [storedMember(B)],
          decisions: [
            {
              id: "d1",
              ask: "ask:gone",
              at: T0,
              key: null,
              question: "Approve the plan?",
              options: ["Approve"],
              multiple: false,
              answer: null,
            },
          ],
        }),
      ],
      storedMembers({ [B]: {} }),
    );

    // The snapshot's works, and only those.
    expect(r.host.works().map((one) => one.id)).toEqual(["work:restored"]);
    // THE QUESTION IS DROPPED: the conversation that asked it is long gone —
    // it was asked before the backup was taken — so nobody can answer it.
    expect(r.host.works()[0]?.decisions[0]?.answer?.how).toBe("dropped");
    // The watcher re-scopes: the membership is now the snapshot's.
    expect(r.membersMoved().slice(moved)).toEqual([true]);
    expect(r.host.memberRefs()).toEqual([B]);
    // ... and the file says so immediately, not within the throttle window: a
    // restore a restart would undo is not a restore.
    expect(r.works.writes()).toBeGreaterThan(writes);
    expect(r.works.value()?.map((one) => one.id)).toEqual(["work:restored"]);
    // The work that was here is GONE from the wire, and the restored one is
    // on it — each said once, for the one that moved.
    expect(r.worksPublished().slice(-2)).toEqual([
      {
        id: "work:restored",
        work: expect.objectContaining({ id: "work:restored" }),
      },
      { id: before, work: null },
    ]);
  });

  it("sweeps the kept files of every work it did not restore", async () => {
    const r = rig();
    await drivenWork(r);

    r.host.restoreWorks([storedWork({ id: "work:restored" })], {});

    // ONE rule: keep what the stored works name, delete the rest. A per-work
    // delete would leave the orphans of a snapshot nobody here ever had.
    await vi.waitFor(() => {
      expect(r.files.swept().at(-1)).toEqual(["work:restored"]);
    });
  });

  it("drops the runtime bookkeeping of a terminal the snapshot has no member for", async () => {
    const r = rig();
    await drivenWork(r);
    r.host.observe([seeing(A, "working")]);
    await vi.waitFor(() => {
      expect(r.host.readings().get(A)?.level).toBe("working");
    });

    r.host.restoreWorks(
      [storedWork({ id: "work:restored", members: [storedMember(B)] })],
      storedMembers({ [B]: {} }),
    );

    // Nothing is left to read about it, and its reading leaves the wire.
    expect(r.host.readings().has(A)).toBe(false);
    expect(r.readingsPublished().at(-1)).toEqual({
      terminal: A,
      reading: null,
    });
    // The restored member is baselined the way a restart baselines one: the
    // record's own bookkeeping, nothing read yet.
    expect(r.host.readings().has(B)).toBe(false);
    expect(r.host.membersDetail().map((one) => one.ref)).toEqual([B]);
  });
});

describe("what the works' readers are told", () => {
  it("publishes ONLY the work that moved, and every stored one once at boot", async () => {
    const r = rig({
      works: [
        storedWork({ id: "work:one", members: [storedMember(A)] }),
        storedWork({ id: "work:two" }),
      ],
    });
    // The first read is the boot: every stored work goes out once.
    r.host.works();
    expect(r.worksPublished().map((one) => one.id)).toEqual([
      "work:one",
      "work:two",
    ]);

    const before = r.worksPublished().length;
    r.host.note("work:one", "a line on the timeline");

    // One work moved, so one work went out. The other is the SAME immutable
    // value and nothing about it was resent.
    expect(
      r
        .worksPublished()
        .slice(before)
        .map((one) => one.id),
    ).toEqual(["work:one"]);
  });
});
