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
import { AGENT_ENV } from "@kolu/acp/engine";
import type {
  Harness,
  HarnessChange,
  HarnessOptions,
  HarnessState,
  PromptFile,
} from "@kolu/acp-harness";
import {
  chunkBase64,
  FRAME_CHUNK_BYTES,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import { exceedsFrameLimit } from "@kolu/surface/frame-limit";
import type { CellStore } from "@kolu/surface/server";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import Conf from "conf";
import { Option, Result, Schema } from "effect";
import type { ConductorReadingLevel } from "kolu-common/conductor";
import {
  ATTACHMENT_BYTE_CAP,
  type ConductorAttachment,
  type ConductorFrame,
  type ConductorRow,
  type ConductorState,
  type ConductorWakeEvent,
  DEFAULT_CONDUCTOR_STATE,
  PROMPT_ATTACHMENT_BYTE_CAP,
} from "kolu-common/conductor";
import {
  type ConductorHost,
  EMPTY_PERSISTED_CONDUCTOR,
  type FleetMcpEndpoint,
  type KoluOffer,
  type MemberDetail,
  type MemberWatch,
  type PersistedConductor,
  type PersistedMembers,
  type PersistedTranscript,
  type PersistedWorks,
  PersistedWorksSchema,
  startConductorHost,
  UNSENT_ATTACHMENT_MS,
  type WatchGit,
  type WatchLevel,
  type WatchObservation,
  type WorkFiles,
  workDirOf,
} from "kolu-conductor";
import { KOLU_FLEET_EXPOSE, KOLU_FLEET_TOOL_NAMES } from "kolu-mcp";
import {
  ABOUT_WORK,
  aboutMember,
  type AskReply,
  type Decision,
  type DecisionAnswer,
  driverOf,
  isAsked,
  isKoluChoiceKey,
  isSettled,
  isSetup,
  type KeptFile,
  type KoluChoiceKey,
  type OnGreen,
  type WorkMode,
  keptOf,
  notKeptOf,
  modeOf,
  type SentAnswer,
  type SetupAsk,
  type SetupKey,
  setupOf,
  setupStanding,
  setupValue,
  type Work,
  type WorkId,
  type WorkKey,
  WorkRefusal,
  type WorkRole,
  workIdOf,
} from "kolu-work";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FleetMcpEndpoint as LiveFleetMcpEndpoint,
  proveFleetMcpEndpoint,
  startFleetMcpEndpoint,
} from "../fleet/mcpEndpoint.ts";
import { CONF_MIGRATIONS } from "../stateLadder.ts";
import { CONF_DEFAULTS, SCHEMA_VERSION } from "../stateShape.ts";

const HOME = "/home/tester";
const HOST = "test-box";

const T0 = "2026-01-01T00:00:00.000Z";

const answer = (values: ReadonlyMap<string, SentAnswer>): AskReply => ({
  kind: "answered",
  values,
});
const DECLINE: AskReply = { kind: "declined" };

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

const row = (id: string, seq: number, text = id): ConductorRow => ({
  id,
  seq,
  since: T0,
  kind: "agent",
  text,
});

const userRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: T0,
  kind: "user",
  text,
  attachments: [],
});

interface Spawned {
  readonly options: HarnessOptions<ConductorRow>;
  readonly push: (change: HarnessChange<ConductorRow>) => void;
  readonly publishOpeningState: () => void;
  readonly die: () => void;
  readonly stopCount: () => number;
  readonly newSessionCount: () => number;
  readonly duringSignIn: (run: () => void) => void;
  readonly promptFilesHanded: () => ReadonlyArray<ReadonlyArray<PromptFile>>;
  readonly wakesSent: () => ReadonlyArray<{
    text: string;
    events: ReadonlyArray<ConductorWakeEvent>;
  }>;
  readonly refuseWakes: (why: string | null) => void;
}

const resumed = (spawned: Spawned | undefined): string | null =>
  spawned?.options.opens.kind === "resume" ? spawned.options.opens.id : null;

function fakeSpawner(): {
  spawn: (
    options: HarnessOptions<ConductorRow>,
  ) => Promise<Harness<ConductorRow>>;
  spawns: Spawned[];
} {
  const spawns: Spawned[] = [];
  const spawn = async (
    options: HarnessOptions<ConductorRow>,
  ): Promise<Harness<ConductorRow>> => {
    let alive = true;
    let stopCount = 0;
    let newSessionCount = 0;
    let signingIn: (() => void) | null = null;
    const promptFilesHanded: ReadonlyArray<PromptFile>[] = [];
    const wakesSent: Array<{
      text: string;
      events: ReadonlyArray<ConductorWakeEvent>;
    }> = [];
    let wakeFails: string | null = null;
    let state: HarnessState = {
      ...DEFAULT_CONDUCTOR_STATE,
      phase: "idle",
      taught: options.taught,
      methods: [],
      title: null,
      queues: false,
    };
    const harness: Harness<ConductorRow> = {
      state: () => state,
      rows: () => [],
      alive: () => alive,
      prompt: async (said) => {
        promptFilesHanded.push(said.files);
        return { rowId: "sent" };
      },
      hostTurn: async (row, text) => {
        if (wakeFails !== null) throw new Error(wakeFails);
        const events: ReadonlyArray<ConductorWakeEvent> =
          row.kind === "wake" ? row.events : [];
        wakesSent.push({ text, events });
        return { rowId: `woke:${wakesSent.length}` };
      },
      cancel: async () => {
        state = { ...state, phase: "idle", busySince: null };
        options.onChange({ kind: "state", state });
      },
      answer: async () => true,
      signIn: async () => {
        signingIn?.();
        return "signed-in";
      },
      askSignIn: () => {},
      signInInput: async () => {},
      signInCancel: async () => false,
      setOption: async () => {},
      newSession: async () => {
        newSessionCount += 1;
      },
      sendAgain: async () => {},
      sessions: async () => [],
      loadSession: async () => {
        newSessionCount += 1;
      },
      clearSession: async (held) => {
        newSessionCount += 1;
        options.onChange({
          kind: "rows",
          upserts: [],
          removes: [...held],
          appends: [],
        });
      },
      stop: async () => {
        stopCount += 1;
        alive = false;
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
      publishOpeningState: () => {
        options.onChange({ kind: "state", state });
      },
      die: () => {
        alive = false;
      },
      stopCount: () => stopCount,
      newSessionCount: () => newSessionCount,
      duringSignIn: (run) => {
        signingIn = run;
      },
      promptFilesHanded: () => promptFilesHanded,
      wakesSent: () => wakesSent,
      refuseWakes: (why) => {
        wakeFails = why;
      },
    });
    return harness;
  };
  return { spawn, spawns };
}

interface Counted<T> {
  readonly store: CellStore<T>;
  readonly readCount: () => number;
  readonly writeCount: () => number;
  readonly value: () => T;
}

function countingStore<T>(initial: T): Counted<T> {
  let held = initial;
  let readCount = 0;
  let writeCount = 0;
  return {
    store: {
      get: () => {
        readCount += 1;
        return held;
      },
      set: (next) => {
        writeCount += 1;
        held = next;
      },
    },
    readCount: () => readCount,
    writeCount: () => writeCount,
    value: () => held,
  };
}

interface FakeFiles {
  readonly port: WorkFiles;
  readonly holds: (paths: ReadonlyArray<string>, more?: boolean) => void;
  readonly tooBig: (paths: ReadonlyArray<string>) => void;
  readonly listFails: (why: string | null) => void;
  readonly listed: () => ReadonlyArray<{ host: string; worktree: string }>;
  readonly kept: () => ReadonlyArray<{
    work: string;
    paths: ReadonlyArray<string>;
  }>;
  readonly swept: () => ReadonlyArray<ReadonlyArray<string>>;
}

function fakeFiles(): FakeFiles {
  let holding: ReadonlyArray<string> = [];
  let holdingMore = false;
  let tooBig: ReadonlyArray<string> = [];
  let listFails: string | null = null;
  const listed: Array<{ host: string; worktree: string }> = [];
  const kept: Array<{ work: string; paths: ReadonlyArray<string> }> = [];
  const swept: Array<ReadonlyArray<string>> = [];
  return {
    port: {
      list: async (at) => {
        listed.push({ host: at.host, worktree: at.worktree });
        if (listFails !== null) throw new Error(listFails);
        return { paths: holding, more: holdingMore };
      },
      keep: async (at) => {
        kept.push({ work: at.work, paths: [...at.paths] });
        return {
          kept: at.paths
            .filter((path) => !tooBig.includes(path))
            .map((path): KeptFile => ({ path, bytes: path.length })),
          tooBig: at.paths.filter((path) => tooBig.includes(path)),
        };
      },
      sweep: async (keep) => {
        swept.push([...keep]);
      },
    },
    holds: (paths, more = false) => {
      holding = paths;
      holdingMore = more;
    },
    tooBig: (paths) => {
      tooBig = paths;
    },
    listFails: (why) => {
      listFails = why;
    },
    listed: () => listed,
    kept: () => kept,
    swept: () => swept,
  };
}

interface PriorStateRoot {
  readonly conductor?: PersistedConductor;
  readonly transcriptRows?: ReadonlyArray<ConductorRow>;
  readonly works?: PersistedWorks;
  readonly members?: PersistedMembers;
  readonly endpoint?: FleetMcpEndpoint | null;
  readonly root?: string;
}

const HARNESS_LISTS_MODELS = "omp";
const HARNESS_UNLISTED = "claude";
const HARNESS_LISTING_FAILS = "brittle";

const LISTED_MODEL_IDS = [
  "anthropic/claude-fable-5-2",
  "litellm/open-large",
] as const;

const LISTING_FAILURE_WORDS =
  "agent-distro brittle: error: cannot list its models: LITELLM_API_KEY is not set";

interface TestOffer {
  readonly offer: KoluOffer;
  readonly modelAsks: () => ReadonlyArray<string>;
  readonly launchAsks: () => ReadonlyArray<string>;
  readonly failModels: (why: string | null) => void;
}

const MODEL_FLAG = { kind: "flag", flag: "--model" } as const;

const koluOffers = (): TestOffer => {
  const modelAsks: string[] = [];
  const launchAsks: string[] = [];
  let modelsFail: string | null = null;
  return {
    offer: {
      harnesses: () => [
        HARNESS_LISTS_MODELS,
        HARNESS_UNLISTED,
        HARNESS_LISTING_FAILS,
      ],
      models: async ({ host, repo, harness }) => {
        modelAsks.push(`${harness}@${host}:${repo}`);
        if (modelsFail !== null) throw new Error(modelsFail);
        if (harness === HARNESS_LISTS_MODELS)
          return { kind: "listed", ids: LISTED_MODEL_IDS };
        if (harness === HARNESS_UNLISTED) return { kind: "unlisted" };
        if (harness === HARNESS_LISTING_FAILS)
          return { kind: "unavailable", why: LISTING_FAILURE_WORDS };
        throw new Error(`${host} has no harness called ${harness}`);
      },
      launch: async ({ host, harness }) => {
        launchAsks.push(`${harness}@${host}`);
        return MODEL_FLAG;
      },
      requireAgentsReady: async () => {},
    },
    modelAsks: () => modelAsks,
    launchAsks: () => launchAsks,
    failModels: (why) => {
      modelsFail = why;
    },
  };
};

const given = (key: SetupKey, answer: string): SetupAsk =>
  isKoluChoiceKey(key)
    ? { key, given: { kind: "given", value: answer } }
    : {
        key,
        question: `${key}?`,
        options: [answer],
        given: { kind: "given", value: answer },
      };

const toAsk = { kind: "ask" } as const;

interface Rig {
  host: ConductorHost;
  spawns: Spawned[];
  record: Counted<PersistedConductor>;
  transcript: Counted<PersistedTranscript>;
  works: Counted<PersistedWorks>;
  members: Counted<PersistedMembers>;
  files: FakeFiles;
  published: () => ConductorState[];
  worksPublished: () => Array<{ id: string; work: Work | null }>;
  readingsPublished: () => Array<{
    terminal: string;
    reading: { level: ConductorReadingLevel; since: string } | null;
  }>;
  worksMoved: () => number;
  watchScopeMoved: () => number;
  modelAsks: () => ReadonlyArray<string>;
  launchAsks: () => ReadonlyArray<string>;
  failModels: (why: string | null) => void;
  loseFleetMcp: () => void;
}

function rig(over: PriorStateRoot = {}): Rig {
  const root = over.root ?? "/state";
  const { spawn, spawns } = fakeSpawner();
  const record = countingStore<PersistedConductor>(
    over.conductor ?? EMPTY_PERSISTED_CONDUCTOR,
  );
  const transcript = countingStore<PersistedTranscript>({
    rows: over.transcriptRows ?? [],
  });
  const works = countingStore<PersistedWorks>(over.works ?? {});
  const members = countingStore<PersistedMembers>(over.members ?? {});
  const files = fakeFiles();
  const published: ConductorState[] = [];
  let worksMoved = 0;
  let watchScopeMoved = 0;
  const worksPublished: Array<{ id: string; work: Work | null }> = [];
  const readingsPublished: Array<{
    terminal: string;
    reading: { level: ConductorReadingLevel; since: string } | null;
  }> = [];
  const offered = koluOffers();
  let lostFleetMcp = false;
  const host = startConductorHost({
    log,
    home: HOME,
    hostName: HOST,
    fleetMcp: () => {
      if (lostFleetMcp) return null;
      return over.endpoint === undefined ? liveEndpoint : over.endpoint;
    },
    offer: () => offered.offer,
    proveFleetMcp: proveFleetMcpEndpoint,
    publish: (state) => {
      published.push(state);
    },
    publishWork: (id, work) => {
      worksPublished.push({ id, work });
    },
    publishMember: () => {},
    publishReading: (terminal, reading) => {
      readingsPublished.push({ terminal, reading });
    },
    worksMoved: () => {
      worksMoved += 1;
    },
    watchScopeMoved: () => {
      watchScopeMoved += 1;
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
    worksMoved: () => worksMoved,
    watchScopeMoved: () => watchScopeMoved,
    modelAsks: offered.modelAsks,
    launchAsks: offered.launchAsks,
    failModels: offered.failModels,
    loseFleetMcp: () => {
      lostFleetMcp = true;
    },
  };
}

const SAVED_AGENT = process.env[AGENT_ENV];

let liveEndpoint: LiveFleetMcpEndpoint;

let fleetFaces: Array<{ closed: boolean }> = [];

beforeEach(async () => {
  process.env[AGENT_ENV] = "/nix/store/fake-acp-adapter";
  fleetFaces = [];
  liveEndpoint = await startFleetMcpEndpoint({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    serve: async (transport) => {
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
    const saying: HarnessChange<ConductorRow> = {
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
      conductor: {
        ...EMPTY_PERSISTED_CONDUCTOR,
        sessionId: "sess-1",
        cwd: HOME,
      },
      transcriptRows: [row("old-1", 1), row("old-2", 2)],
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
    taught: false,
  };
  const rows = [row("old-1", 1), row("old-2", 2), row("old-3", 3)];

  it("resumes the session and tells the new conversation where to count from", async () => {
    const r = rig({ conductor: record, transcriptRows: rows });
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    expect(resumed(agent)).toBe("sess-1");
    expect(agent.options.resumedSeq).toBe(3);
  });

  it("does NOT double the transcript when the host restarts over it", async () => {
    const r = rig({ conductor: record, transcriptRows: rows });
    const seen: ConductorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows).toHaveLength(3);

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
      conductor: {
        ...record,
        cwd: "/home/somebody-else",
        fleet: ["11111111-1111-4111-8111-111111111111"],
      },
      transcriptRows: rows,
    });
    const seen: ConductorFrame[] = [];
    r.host.watch((frame) => seen.push(frame));
    const first = seen[0];
    if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(first.rows).toEqual([]);
    expect(r.host.state().sessionId).toBeNull();
    expect(r.host.state().fleet).toEqual([]);
  });

  it("brings the WORKS back whatever happened to the conversation", () => {
    const r = rig({
      conductor: { ...record, cwd: "/home/somebody-else" },
      transcriptRows: rows,
      works: storedWorks(storedWork()),
      members: storedMembers({ [A]: {} }),
    });
    r.host.watch(() => {});
    expect(r.host.works().map(([id]) => id)).toEqual([workIdOf(workKey())]);
    expect(r.host.memberRefs()).toEqual([A]);
  });
});

describe("the remembered records are read on the first reader's edge (B3)", () => {
  it("touches the stores NOT AT ALL at construction", () => {
    const r = rig();
    expect(r.record.readCount()).toBe(0);
    expect(r.transcript.readCount()).toBe(0);
    expect(r.works.readCount()).toBe(0);
    expect(r.host.state().phase).toBe("offline");
    expect(r.record.readCount()).toBe(0);
  });

  it("reads them ONCE, however many readers look", async () => {
    const r = rig();
    r.host.watch(() => {});
    r.host.watch(() => {});
    await r.host.prompt("hi", [], [], false);
    expect(r.record.readCount()).toBe(1);
    expect(r.transcript.readCount()).toBe(1);
    expect(r.works.readCount()).toBe(1);
  });

  it("reads them to answer `works`, and starts NO agent doing it", () => {
    const r = rig({
      works: storedWorks(storedWork()),
      members: storedMembers({ [A]: {} }),
    });
    expect(r.host.works()).toHaveLength(1);
    expect(r.spawns).toHaveLength(0);
  });
});

describe("a bring-up that did not get there (M2)", () => {
  it("publishes the refusal instead of leaving an idle-looking panel", async () => {
    const r = rig({ endpoint: null });
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow();
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain(
      "has not published its fleet MCP endpoint",
    );
  });

  it("refuses an endpoint NOBODY IS SERVING rather than handing the agent a dead URL", async () => {
    const r = rig({
      endpoint: { url: "http://127.0.0.1:1/mcp", token: "unused" },
    });
    await expect(r.host.prompt("hello", [], [], false)).rejects.toThrow(
      /cannot reach this kolu's fleet MCP face/,
    );
    expect(r.spawns).toHaveLength(0);
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain("http://127.0.0.1:1/mcp");
  });

  it("refuses an endpoint that REJECTS the token rather than opening with no hands", async () => {
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

    expect(fleetFaces).toHaveLength(1);
    await vi.waitFor(() => {
      expect(fleetFaces[0]?.closed).toBe(true);
    });
  });

  it("reaches a READER, who has nothing to catch", async () => {
    const r = rig({ endpoint: null });
    r.host.watch(() => {});
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
    expect(first.stopCount()).toBe(1);
  });

  it("comes back into the conversation the agent is in NOW, not the id the file named", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-remembered",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(resumed(first)).toBe("sess-remembered");

    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-opened",
      },
    });

    first.die();
    await r.host.newSession();
    expect(resumed(r.spawns[1])).toBe("sess-opened");
  });

  it("RESTARTS the agent into the same conversation after a sign-in, and on a person's reload", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-1",
      },
    });

    expect(await r.host.signIn("subscription")).toEqual({
      outcome: "signed-in",
      restart: { kind: "restarted" },
    });
    expect(first.stopCount()).toBe(1);
    expect(r.spawns).toHaveLength(2);
    expect(resumed(r.spawns[1])).toBe("sess-1");

    await r.host.reloadAgent();
    expect(r.spawns[1]?.stopCount()).toBe(1);
    expect(r.spawns).toHaveLength(3);
    expect(resumed(r.spawns[2])).toBe("sess-1");
  });

  it("restarts into the conversation that was live when the button was pressed", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-booted",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-new",
      },
    });
    first.duringSignIn(() => {
      first.push({
        kind: "state",
        state: {
          ...DEFAULT_CONDUCTOR_STATE,
          taught: false,
          methods: [],
          title: null,
          queues: false,
          phase: "idle",
          sessionId: "sess-booted",
        },
      });
    });

    await r.host.signIn("subscription");
    expect(resumed(r.spawns[1])).toBe("sess-new");
  });

  it("restarts into a conversation this process started, never a silent fresh one", async () => {
    const r = rig();
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(resumed(first)).toBeNull();
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-z",
      },
    });
    first.push({
      kind: "rows",
      upserts: [row("agent:1", 1, "an answer")],
      removes: [],
      appends: [],
    });
    first.duringSignIn(() => {
      first.push({
        kind: "state",
        state: {
          ...DEFAULT_CONDUCTOR_STATE,
          taught: false,
          methods: [],
          title: null,
          queues: false,
          phase: "idle",
          sessionId: "sess-somewhere-else",
        },
      });
    });

    await r.host.signIn("subscription");
    expect(resumed(r.spawns[1])).toBe("sess-z");
  });

  it("REFUSES a restart while a turn is running, and says what to do", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "working",
        sessionId: "sess-1",
        busySince: T0,
      },
    });

    await expect(r.host.reloadAgent()).rejects.toThrow(/Stop the turn/);
    expect(first.stopCount()).toBe(0);
    expect(r.spawns).toHaveLength(1);
  });

  it("answers BOTH facts when the login landed and the restart did not", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    first.duringSignIn(() => {
      first.push({
        kind: "state",
        state: {
          ...DEFAULT_CONDUCTOR_STATE,
          taught: false,
          methods: [],
          title: null,
          queues: false,
          phase: "working",
          sessionId: "sess-1",
          busySince: T0,
        },
      });
    });

    const ended = await r.host.signIn("subscription");
    expect(ended.outcome).toBe("signed-in");
    expect(ended.restart.kind).toBe("did-not-restart");
    expect(
      ended.restart.kind === "did-not-restart" ? ended.restart.why : "",
    ).toContain("Stop the turn");
    expect(r.spawns).toHaveLength(1);
  });

  it("keeps the record's session when the respawn FAILS", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [row("agent:1", 1, "an answer")],
    });
    await r.host.prompt("first", [], [], false);
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    first.push({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-1",
      },
    });

    r.loseFleetMcp();
    await expect(r.host.reloadAgent()).rejects.toThrow();
    expect(first.stopCount()).toBe(1);
    expect(r.host.state().sessionId).toBe("sess-1");
    await r.host.dispose();
    expect(r.record.value().sessionId).toBe("sess-1");
  });

  it("fences the REPLACEMENT on the rows we still hold (R2)", async () => {
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
    expect(agent.options.teaching).toContain(`You run on ${HOST}`);
    expect(agent.options.teaching).not.toContain(HOME);
    expect(agent.options.teaching).toContain("`host/id`");
  });

  it("names only verbs the session actually has", async () => {
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
      [...agent.options.teaching.matchAll(/`([a-z]+_[a-zA-Z]+)`/g)]
        .map((hit) => hit[1])
        .filter((name): name is string => name !== undefined),
    );
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
    const afterFirst = r.transcript.writeCount();
    expect(afterFirst).toBe(1);

    for (let i = 0; i < 200; i += 1) {
      agent.push({
        kind: "rows",
        upserts: [],
        removes: [],
        appends: [{ of: "a", at: i, text: "x" }],
      });
    }
    expect(r.transcript.writeCount()).toBe(afterFirst);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.transcript.writeCount()).toBe(afterFirst + 1);
    expect(r.transcript.value().rows[0]).toMatchObject({
      id: "a",
      text: "x".repeat(200),
    });
  });

  it("rewrites the TRANSCRIPT alone when only the rows moved", async () => {
    vi.useFakeTimers();
    const r = rig();
    await r.host.prompt("stream at me", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    const works = r.works.writeCount();
    agent.push({
      kind: "rows",
      upserts: [row("a", 1, "one")],
      removes: [],
      appends: [],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(r.transcript.writeCount()).toBeGreaterThan(0);
    expect(r.works.writeCount()).toBe(works);
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
    const before = r.transcript.writeCount();
    agent.push({
      kind: "rows",
      upserts: [row("b", 2)],
      removes: [],
      appends: [],
    });
    expect(r.transcript.writeCount()).toBe(before);

    await r.host.dispose();
    expect(r.transcript.writeCount()).toBe(before + 1);
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
    expect(agent.stopCount()).toBe(1);
  });

  it("stops a bring-up that was still IN FLIGHT", async () => {
    const { spawn, spawns } = fakeSpawner();
    const held = Promise.withResolvers<void>();
    const host = startConductorHost({
      log,
      home: HOME,
      hostName: HOST,
      fleetMcp: () => liveEndpoint,
      offer: () => koluOffers().offer,
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: () => {},
      publishWork: () => {},
      publishMember: () => {},
      publishReading: () => {},
      worksMoved: () => {},
      watchScopeMoved: () => {},
      store: countingStore(EMPTY_PERSISTED_CONDUCTOR).store,
      transcript: countingStore<PersistedTranscript>({ rows: [] }).store,
      works: countingStore<PersistedWorks>({}).store,
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
    expect(spawns[0]?.stopCount()).toBe(1);
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
        taught: false,
        methods: [],
        title: null,
        queues: false,
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
      offer: () => koluOffers().offer,
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: () => {},
      publishWork: () => {},
      publishMember: () => {},
      publishReading: () => {},
      worksMoved: () => {},
      watchScopeMoved: () => {},
      store: countingStore(EMPTY_PERSISTED_CONDUCTOR).store,
      transcript: countingStore<PersistedTranscript>({ rows: [] }).store,
      works: countingStore<PersistedWorks>({}).store,
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
    let settled = false;
    const stopped = host.dispose().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(true);
    await stopped;

    held.resolve();
    await sent.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(spawns[0]?.stopCount()).toBe(1);
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

  it("is kept by this module rather than re-learned from the agent", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet,
        taught: false,
      },
      transcriptRows: [row("old-1", 1)],
    });
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");

    agent.publishOpeningState();
    expect(r.host.state().fleet).toEqual(fleet);
    await r.host.dispose();
    expect(r.record.value().fleet).toEqual(fleet);
  });
});

describe("a record that parses but is wrong (R8)", () => {
  it("says the refusal where a READER is looking, as well as throwing", () => {
    const r = rig({
      conductor: { ...EMPTY_PERSISTED_CONDUCTOR, cwd: HOME },
      transcriptRows: [
        { id: "a", seq: 1, since: T0 },
      ] as unknown as ConductorRow[],
    });
    expect(() => r.host.watch(() => {})).toThrow(
      /kolu could not read the Conductor's saved transcript/,
    );
    expect(r.host.state().phase).toBe("offline");
    expect(r.host.state().refusal).toContain(
      join("/state", "conductor", "transcript.json"),
    );
  });

  it("refuses a WORK that parses but is wrong, by the name of the file holding it", () => {
    const r = rig({
      works: [{ id: "work:1", title: 7 }] as unknown as PersistedWorks,
    });
    expect(() => r.host.watch(() => {})).toThrow(
      /kolu could not read the Conductor's saved works/,
    );
    expect(r.host.state().refusal).toContain(join("/state", "config.json"));
    expect(r.host.state().unreadable?.key).toBe("works");
  });
});

describe("a prompt's attachments", () => {
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
      if (path !== undefined) expect(answer.path).toBe(path);
      path = answer.path;
      expect(answer.bytes).toBeGreaterThan(bytes);
      bytes = answer.bytes;
    }
    expect(bytes).toBe(whole.byteLength);
    expect(readFileSync(join(dir, "att-1")).equals(whole)).toBe(true);

    await r.host.prompt(
      "look",
      [],
      [chip({ name: "big.bin", bytes: 1 })],
      false,
    );
    const one = r.spawns[0]?.promptFilesHanded()[0]?.[0];
    if (one === undefined) throw new Error("nothing was handed over");
    expect(one.path).toBe(join(dir, "att-1"));
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
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a MESSAGE whose files come to more than the per-prompt cap", async () => {
    const r = rig({ root });
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
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "att-1"), "kept");
    writeFileSync(join(dir, "att-2"), "orphan");
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [
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
    r.host.attach({
      id: "att-3",
      name: "att-3.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    await expect(
      r.host.prompt("look", [], [...sent, chip({ id: "gone" })], false),
    ).rejects.toThrow(/no longer on this host/);
    expect(readdirSync(dir)).toEqual(["att-3"]);
  });

  it("does not keep an upload nobody ever sent", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const r = rig({ root });
    r.host.attach({
      id: "att-1",
      name: "att-1.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    expect(readdirSync(dir)).toEqual(["att-1"]);
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
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [
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
    expect(snapshot.rows.map((one) => one.id)).toEqual(["agent-1", "div-1"]);
  });

  it("tells a fresh conversation its last row is ALREADY a divider", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [
        row("agent-1", 1, "you're welcome"),
        divider("div-1", 2),
      ],
    });
    r.host.watch(() => {});
    await r.host.newSession();
    const first = r.spawns[0];
    if (first === undefined) throw new Error("the host spawned nothing");
    expect(first.options.resumedEndsWithDivider).toBe(true);

    first.die();
    await r.host.newSession();
    expect(r.spawns[1]?.options.resumedEndsWithDivider).toBe(true);
  });

  it("says so when the last row is NOT a divider — the guard is a fact, not a default", async () => {
    const r = rig({
      conductor: {
        sessionId: "sess-1",
        cwd: HOME,
        model: null,
        fleet: [],
        taught: false,
      },
      transcriptRows: [divider("div-1", 1), row("agent-1", 2, "hello")],
    });
    await r.host.newSession();
    expect(r.spawns[0]?.options.resumedEndsWithDivider).toBe(false);
  });
});

const A = "local/11111111-1111-4111-8111-111111111111";
const B = "remote:prod/22222222-2222-4222-8222-222222222222";

const storedWatch = (over: Partial<MemberWatch> = {}): MemberWatch => ({
  name: "fix the parser",
  agent: "claude-code",
  told: null,
  joined: "created",
  spoken: true,
  ran: false,
  ...over,
});

const workKey = (branch = "fix-the-parser", host = "local"): WorkKey => ({
  kind: "branch",
  host,
  repo: "/srv/repo",
  branch,
});

const storedWork = (over: Partial<Work> = {}): Work => ({
  key: workKey(),
  title: "fix the parser",
  events: [],
  decisions: [],
  startedAt: T0,
  state: { kind: "open" },
  ...over,
});

const storedWorks = (...all: ReadonlyArray<Work>): PersistedWorks =>
  Object.fromEntries(all.map((one) => [workIdOf(one.key), one]));

const storedMembers = (
  refs: Readonly<
    Record<
      string,
      Partial<MemberWatch> & {
        work?: WorkId;
        role?: WorkRole;
        worktree?: string;
      }
    >
  >,
  work: WorkId = workIdOf(workKey()),
): PersistedMembers =>
  Object.fromEntries(
    Object.entries(refs).map(([ref, over]) => {
      const { work: at, role, worktree, ...watch } = over;
      return [
        ref,
        {
          work: at ?? work,
          role: role ?? "implementor",
          joinedAt: T0,
          worktree:
            worktree === undefined
              ? { kind: "unread" as const }
              : { kind: "read" as const, path: worktree },
          watch: storedWatch(watch),
        },
      ];
    }),
  );

const seeing = (
  ref: string,
  level: WatchLevel,
  over: {
    name?: string;
    agent?: string | null;
    foregroundShell?: boolean | null;
    git?: WatchGit | null;
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
});

const forgeSays = (over: {
  number?: number;
  state?: "open" | "closed" | "merged";
  checks?: "pending" | "pass" | "fail" | null;
  failing?: ReadonlyArray<string>;
  head?: string | null;
}): PrResult => ({
  kind: "ok",
  value: {
    number: over.number ?? 412,
    title: "fix the parser",
    url: "https://forge.example/pr/412",
    state: over.state ?? "open",
    checks: over.checks ?? null,
    checkRuns: (over.failing ?? []).map((name) => ({
      name,
      outcome: "fail" as const,
    })),
    reviewDecision: null,
    mergeStateStatus: "CLEAN",
    headSha: over.head === undefined ? HEAD : over.head,
    isDraft: false,
  },
});

const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";

const inRepo: WatchGit = {
  worktree: "/srv/worktrees/fix-the-parser",
  branch: "fix-the-parser",
  repo: "/srv/repo",
};

const working = (agent: Spawned): void => {
  agent.push({
    kind: "state",
    state: {
      ...DEFAULT_CONDUCTOR_STATE,
      taught: false,
      methods: [],
      title: null,
      queues: false,
      phase: "working",
      busySince: T0,
    },
  });
};

const idle = (agent: Spawned): void => {
  agent.push({
    kind: "state",
    state: {
      ...DEFAULT_CONDUCTOR_STATE,
      taught: false,
      methods: [],
      title: null,
      queues: false,
      phase: "idle",
    },
  });
};

const watchWork = async (
  r: Rig,
  title = "fix the parser",
  key: WorkKey = workKey(),
): Promise<WorkId> => {
  const opened = await r.host.openWork({
    key,
    title,
    setup: [
      {
        key: "mode",
        question: "How should kolu run it?",
        options: ["watch"],
        given: { kind: "given", value: "watch" },
      },
    ],
  });
  return opened.work;
};

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

const theWork = (r: Rig): Work => {
  const one = r.host.works()[0];
  if (one === undefined) throw new Error("no piece of work was opened");
  return one[1];
};

const theWorkId = (r: Rig): WorkId => {
  const one = r.host.works()[0];
  if (one === undefined) throw new Error("no piece of work was opened");
  return one[0];
};

const decisionNamed = (work: Work, question: string): Decision => {
  const one = work.decisions.find((decision) => decision.question === question);
  if (one === undefined) throw new Error(`nothing was asked: ${question}`);
  return one;
};

const setupDecision = (work: Work, key: SetupKey): Decision | undefined =>
  work.decisions.find((one) => isSetup(one) && one.key === key);

const askedKeys = (work: Work): ReadonlyArray<SetupKey> =>
  work.decisions.flatMap((one) =>
    isAsked(one) && isSetup(one) ? [one.key] : [],
  );

const answerOf = (work: Work, key: SetupKey): DecisionAnswer | undefined => {
  const decision = setupDecision(work, key);
  return decision !== undefined && isSettled(decision)
    ? decision.answer
    : undefined;
};

const membersOf = (r: Rig, work: WorkId): ReadonlyArray<MemberDetail> =>
  r.host.membersDetail().filter((one) => one.work === work);

const kindsOf = (work: Work): ReadonlyArray<string> =>
  work.events.map((one) => one.kind);

const served = (host: ConductorHost): ReadonlyArray<ConductorRow> => {
  const seen: ConductorFrame[] = [];
  host.watch((frame) => seen.push(frame));
  const first = seen[0];
  if (first?.kind !== "snapshot") throw new Error("expected a snapshot");
  return first.rows;
};

const afterPendingFileListing = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};

describe("the wipe (`clearSession`)", () => {
  const held: PriorStateRoot = {
    conductor: {
      sessionId: "sess-1",
      cwd: HOME,
      model: null,
      fleet: ["local/term-1"],
      taught: false,
    },
    transcriptRows: [
      row("user:1", 1, "hello"),
      row("agent:2", 2, "hello back"),
    ],
  };

  it("leaves an EMPTY conversation — rows, record and fleet together", async () => {
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.clearSession();

    expect(served(r.host)).toEqual([]);
    expect(r.transcript.value().rows).toEqual([]);
    expect(r.record.value().fleet).toEqual([]);
    expect(r.host.state().fleet).toEqual([]);
    expect(r.record.writeCount()).toBeGreaterThan(0);
    expect(r.spawns[0]?.newSessionCount()).toBe(1);
  });

  it("KEEPS every piece of work, and the question one had open", async () => {
    const r = rig(held);
    r.host.watch(() => {});
    await r.host.prompt("still here?", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    const { ask } = r.host.askAboutWork(work, [
      {
        header: { kind: "header", text: "Plan approval" },
        question: "Approve the plan?",
        options: ["yes", "no"],
        multiple: false,
        file: { kind: "none" },
      },
    ]);
    expect(served(r.host).some((one) => one.id === ask)).toBe(true);

    await r.host.clearSession();

    const kept = theWork(r);
    expect(theWorkId(r)).toBe(work);
    expect(kept.state.kind).toBe("open");
    expect(r.host.memberRefs()).toEqual([A]);
    expect(Object.keys(r.works.value())).toEqual([work]);
    expect(
      kept.decisions.find((one) => one.question === "Approve the plan?")?.kind,
    ).toBe("asked");
    expect(kindsOf(kept)).not.toContain("question-dropped");
    expect(served(r.host)).toEqual([]);

    expect(
      await r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map([[decisionNamed(kept, "Approve the plan?").id, ["yes"]]]),
        ),
      }),
    ).toEqual({ outcome: { kind: "answered" } });
    await vi.waitFor(() => {
      expect(r.spawns.at(-1)?.wakesSent()).toHaveLength(1);
    });
    expect(r.spawns.at(-1)?.wakesSent()[0]?.text).toContain("ANSWERED");
  });

  it("leaves a REPLACEMENT nothing to fence against", async () => {
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

    expect(r.spawns).toHaveLength(1);
    expect(r.spawns[0]?.newSessionCount()).toBe(1);
  });

  it("`newSession` beside it keeps EVERY one of those things", async () => {
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
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("opening a piece of work", () => {
  const fullSetup: ReadonlyArray<SetupAsk> = [
    {
      key: "mode",
      question: "How much of this?",
      options: ["full", "trivial"],
      given: toAsk,
    },
    { key: "planner.harness", given: toAsk },
    { key: "planner.model", given: toAsk },
    { key: "implementor.harness", given: toAsk },
    { key: "implementor.model", given: toAsk },
    {
      key: "on-green",
      question: "And when CI is green?",
      options: ["merge", "hand-over"],
      given: toAsk,
    },
  ];

  const fieldOf = (r: Rig, key: SetupKey): string => {
    const decision = setupDecision(theWork(r), key);
    if (decision === undefined) throw new Error(`nothing was asked for ${key}`);
    return decision.id;
  };

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

  it("creates the work AT ONCE, puts the setup as ONE row, and ANSWERS WITHOUT WAITING", async () => {
    const r = rig();
    const agent = await asked(r);
    const opened = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });

    expect(opened.asked).toBe(true);
    expect(opened.ask).toMatch(/^ask:/);
    expect(opened.created).toBe(true);
    expect(opened.setup.host).toBe("local");
    expect(opened.setup.mode).toEqual(Option.none());

    const open = theWork(r);
    expect(open.title).toBe("fix the parser");
    expect(open.events[0]).toMatchObject({
      kind: "requested",
      by: "you",
      request: { kind: "said", text: "fix the parser on prod, please" },
    });
    expect(served(r.host).find((one) => one.id === opened.ask)).toMatchObject({
      kind: "work-ask",
      work: opened.work,
    });
    expect(r.host.state().workAsks).toEqual([opened.ask]);
    expect(r.host.state().openAsks).toEqual([]);
    expect(kindsOf(open)).toContain("question");

    expect(
      await r.host.answerWork({
        work: opened.work,
        ask: opened.ask,
        from: "card",
        reply: answer(
          new Map([
            [fieldOf(r, "mode"), ["full"]],
            [fieldOf(r, "planner.harness"), [HARNESS_LISTS_MODELS]],
            [fieldOf(r, "planner.model"), [LISTED_MODEL_IDS[0]]],
            [fieldOf(r, "implementor.harness"), [HARNESS_LISTS_MODELS]],
            [fieldOf(r, "implementor.model"), [LISTED_MODEL_IDS[1]]],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      }),
    ).toEqual({ outcome: { kind: "answered" } });
    expect(r.modelAsks()).toEqual([`${HARNESS_LISTS_MODELS}@local:/srv/repo`]);

    expect(setupOf(theWork(r))).toEqual({
      host: "local",
      mode: Option.some("full"),
      roles: [
        {
          role: "planner",
          setup: {
            kind: "harness-and-model",
            harness: HARNESS_LISTS_MODELS,
            model: LISTED_MODEL_IDS[0],
          },
        },
        {
          role: "implementor",
          setup: {
            kind: "harness-and-model",
            harness: HARNESS_LISTS_MODELS,
            model: LISTED_MODEL_IDS[1],
          },
        },
      ],
      onGreen: Option.some("merge"),
    });
    const answered = theWork(r);
    expect(answerOf(answered, "mode")).toMatchObject({
      how: "answered",
      value: "full",
      from: "card",
    });
    expect(kindsOf(answered)).toContain("answered");
    expect(r.host.state().workAsks).toEqual([]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    const woke = agent.wakesSent()[0]?.text ?? "";
    expect(woke).toContain("the human answered a question you asked");
    expect(woke).toContain("on the work's card");
    expect(woke).toContain("full");
    expect(served(r.host).find((one) => one.id === opened.ask)).toMatchObject({
      ask: { standing: { kind: "answered" } },
    });
  });

  it("takes a model the human TYPED for a harness that cannot list its own", async () => {
    const r = rig();
    await asked(r);
    const opened = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    await r.host.answerWork({
      work: opened.work,
      ask: opened.ask,
      from: "chat",
      reply: answer(
        new Map([
          [fieldOf(r, "mode"), ["trivial"]],
          [fieldOf(r, "implementor.harness"), [HARNESS_UNLISTED]],
          [fieldOf(r, "implementor.model"), ["opus-4-6-20260110"]],
          [fieldOf(r, "on-green"), ["hand-over"]],
        ]),
      ),
    });
    expect(r.modelAsks()).toEqual([`${HARNESS_UNLISTED}@local:/srv/repo`]);
    const setup = setupOf(theWork(r));
    expect(setup.mode).toEqual(Option.some("trivial"));
    expect(setup.roles).toEqual([
      {
        role: "implementor",
        setup: {
          kind: "harness-and-model",
          harness: HARNESS_UNLISTED,
          model: "opus-4-6-20260110",
        },
      },
    ]);
    expect(setup.onGreen).toEqual(Option.some("hand-over"));
    expect(answerOf(theWork(r), "implementor.model")).toMatchObject({
      how: "answered",
      value: "opus-4-6-20260110",
      from: "chat",
    });
  });

  it("REMOVES a work nothing has happened in when the human declines its setup", async () => {
    const r = rig();
    const agent = await asked(r);
    const opened = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    expect(
      await r.host.answerWork({
        work: opened.work,
        ask: opened.ask,
        from: "chat",
        reply: DECLINE,
      }),
    ).toEqual({ outcome: { kind: "declined" } });

    expect(r.host.works()).toEqual([]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.text).toContain("DECLINED");
  });

  it("KEEPS a work something HAS happened in, with the decline recorded", async () => {
    const r = rig();
    await asked(r);
    const opened = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    r.host.joinWork(opened.work, A, "implementor", "created");
    await r.host.answerWork({
      work: opened.work,
      ask: opened.ask,
      from: "chat",
      reply: DECLINE,
    });
    const kept = theWork(r);
    expect(theWorkId(r)).toBe(opened.work);
    expect(kept.state.kind).toBe("open");
    expect(answerOf(kept, "mode")).toMatchObject({ how: "declined" });
  });

  it("asks NOBODY ANYTHING when the request already said it all", async () => {
    const r = rig();
    await asked(r);
    const work = await watchWork(r);
    expect(
      served(r.host).some(
        (one) => one.kind === "ask" || one.kind === "work-ask",
      ),
    ).toBe(false);
    expect(theWorkId(r)).toBe(work);
    expect(kindsOf(theWork(r))).not.toContain("question");
  });

  it("is IDEMPOTENT: a key kolu holds comes back as it stands", async () => {
    const r = rig();
    await asked(r);
    const first = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    await r.host.answerWork({
      work: first.work,
      ask: first.ask,
      from: "card",
      reply: answer(
        new Map([
          [fieldOf(r, "mode"), ["trivial"]],
          [fieldOf(r, "implementor.harness"), [HARNESS_LISTS_MODELS]],
          [fieldOf(r, "implementor.model"), [LISTED_MODEL_IDS[1]]],
          [fieldOf(r, "on-green"), ["merge"]],
        ]),
      ),
    });

    const again = await r.host.openWork({
      key: workKey(),
      title: "a different name for the same branch",
      setup: fullSetup,
    });
    expect(again.work).toBe(first.work);
    expect(again.created).toBe(false);
    expect(r.host.works()).toHaveLength(1);
    expect(again.asked).toBe(false);
    expect(again.setup.mode).toEqual(Option.some("trivial"));
  });

  it("asks only the setup questions that have NO answer — an open one once", async () => {
    const r = rig();
    await asked(r);
    const first = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: [
        given("mode", "full"),
        given("planner.harness", HARNESS_LISTS_MODELS),
        { key: "planner.model", given: toAsk },
        given("implementor.harness", HARNESS_LISTS_MODELS),
        given("implementor.model", LISTED_MODEL_IDS[0]),
        given("on-green", "merge"),
      ],
    });
    expect(first.asked).toBe(true);

    const again = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    expect(again.work).toBe(first.work);
    expect(again.asked).toBe(true);
    expect(askedKeys(theWork(r))).toEqual(["planner.model"]);
    expect(r.host.state().workAsks).toEqual([again.ask]);
  });

  it("asks NOTHING about a role the answered mode does not run", async () => {
    const r = rig();
    await asked(r);
    await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: [
        given("mode", "trivial"),
        given("implementor.harness", HARNESS_LISTS_MODELS),
        given("implementor.model", LISTED_MODEL_IDS[0]),
        given("on-green", "merge"),
      ],
    });
    const again = await r.host.openWork({
      key: workKey(),
      title: "fix the parser",
      setup: fullSetup,
    });
    expect(again.asked).toBe(false);
    expect(askedKeys(theWork(r))).toEqual([]);
  });

  it("STOPS a work, and OPENING IT AGAIN brings it back with everything kept", async () => {
    const r = rig();
    await asked(r);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");

    r.host.stopWork(work, "you");
    const stopped = theWork(r);
    expect(stopped.state).toMatchObject({
      kind: "ended",
      outcome: { kind: "stopped", by: "you" },
    });
    expect(r.host.memberRefs()).toEqual([]);
    expect(membersOf(r, work)).toEqual([]);
    const decisions = stopped.decisions.length;
    const events = stopped.events.length;

    const again = await watchWork(r);
    expect(again).toBe(work);
    const back = theWork(r);
    expect(back.state.kind).toBe("open");
    expect(back.decisions).toHaveLength(decisions);
    expect(back.events.length).toBeGreaterThan(events);
    expect(kindsOf(back)).toContain("reopened");
    expect(r.host.works()).toHaveLength(1);
  });

  it("REOPENS from the card, which is the same way back", async () => {
    const r = rig();
    await asked(r);
    const work = await watchWork(r);
    r.host.stopWork(work, "conductor");
    expect(theWork(r).state).toMatchObject({
      outcome: { kind: "stopped", by: "conductor" },
    });
    r.host.reopenWork(work);
    expect(theWork(r).state.kind).toBe("open");
  });

  it("tells the WATCH its scope moved when a work comes back with no members", async () => {
    const r = rig();
    await asked(r);
    const work = await watchWork(r);
    r.host.stopWork(work, "you");
    expect(r.host.memberRefs()).toEqual([]);
    expect(r.host.prWatches()).toEqual([]);
    const scopes = r.watchScopeMoved();

    r.host.reopenWork(work);

    expect(theWork(r).state.kind).toBe("open");
    expect(r.watchScopeMoved()).toBeGreaterThan(scopes);
    expect(r.host.prWatches().map((one) => one.work)).toEqual([work]);
  });

  it("... and when a work is OPENED, before any terminal has joined it", async () => {
    const r = rig();
    await asked(r);
    const scopes = r.watchScopeMoved();

    const work = await watchWork(r);

    expect(r.host.memberRefs()).toEqual([]);
    expect(r.watchScopeMoved()).toBeGreaterThan(scopes);
    expect(r.host.prWatches().map((one) => one.work)).toEqual([work]);
  });

  it("refuses a second terminal in a role the work already has", async () => {
    const r = rig();
    await asked(r);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    let refused: unknown;
    try {
      r.host.joinWork(work, B, "implementor", "created");
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(WorkRefusal);
    expect((refused as WorkRefusal).kind).toBe("role-taken");
    expect(membersOf(r, work).map((one) => one.ref)).toEqual([A]);
    r.host.joinWork(work, B, "planner", "created");
    expect(membersOf(r, work).map((one) => one.role)).toEqual([
      "implementor",
      "planner",
    ]);
  });

  it("a question nobody answers for longer than a tool call may live costs the Conductor NOTHING", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval"] });
    try {
      const r = rig();
      const agent = await asked(r);
      const work = await watchWork(r);
      const { ask } = r.host.askAboutWork(work, [
        {
          header: { kind: "header", text: "Plan approval" },
          question: "Approve the plan?",
          options: ["approve", "change it"],
          multiple: false,
          file: { kind: "file", path: ".waterfall/plan.md" },
        },
      ]);
      expect(ask).toMatch(/^ask:/);

      vi.setSystemTime(Date.now() + 10 * 60_000);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(agent.wakesSent()).toEqual([]);
      expect(r.host.state().workAsks).toEqual([ask]);
      const waiting = theWork(r).decisions.find((one) => one.ask === ask);
      if (waiting === undefined || waiting.topic !== "work")
        throw new Error("the plan question is not a question about the work");
      expect(waiting.kind).toBe("asked");
      expect(waiting.file).toEqual({
        kind: "file",
        path: ".waterfall/plan.md",
      });

      expect(
        await r.host.answerWork({
          work,
          ask,
          from: "reader",
          reply: answer(new Map([[waiting.id, ["approve"]]])),
        }),
      ).toEqual({ outcome: { kind: "answered" } });
      await vi.waitFor(() => {
        expect(agent.wakesSent()).toHaveLength(1);
      });
      const woke = agent.wakesSent()[0]?.text ?? "";
      expect(woke).toContain("the human answered a question you asked");
      expect(woke).toContain("in the reader, with the file open");
      expect(woke).toContain("approve");
    } finally {
      vi.useRealTimers();
    }
  });

  describe("the two questions kolu draws the options for", () => {
    const opening = async (
      r: Rig,
    ): Promise<{ readonly work: WorkId; readonly ask: string }> => {
      const opened = await r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: fullSetup,
      });
      return { work: opened.work, ask: opened.ask };
    };

    const stillAsked = (r: Rig): ReadonlyArray<SetupKey> =>
      askedKeys(theWork(r));

    it("is worded by KOLU and carries no options", async () => {
      const r = rig();
      await asked(r);
      await opening(r);
      const work = theWork(r);
      const harness = setupDecision(work, "planner.harness");
      const model = setupDecision(work, "implementor.model");
      expect(harness?.question).toBe("Which harness runs the planner?");
      expect(model?.question).toBe("Which model does the implementor run on?");
      expect(harness).not.toHaveProperty("options");
      expect(harness).not.toHaveProperty("multiple");
      expect(model).not.toHaveProperty("options");
      expect(setupDecision(work, "mode")).toMatchObject({
        question: "How much of this?",
        options: ["full", "trivial"],
      });
    });

    it("refuses a harness this kolu does not carry, and records nothing", async () => {
      const r = rig();
      await asked(r);
      const { work, ask } = await opening(r);
      const refusal = r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map([
            [fieldOf(r, "mode"), ["trivial"]],
            [fieldOf(r, "implementor.harness"), ["claude-code"]],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      });
      await expect(refusal).rejects.toBeInstanceOf(WorkRefusal);
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      await expect(refusal).rejects.toThrow(
        /"claude-code" is not a harness this kolu carries/,
      );
      await expect(refusal).rejects.toThrow(
        new RegExp(
          `${HARNESS_LISTS_MODELS}, ${HARNESS_UNLISTED}, ${HARNESS_LISTING_FAILS}`,
        ),
      );
      expect(stillAsked(r)).toEqual([
        "mode",
        "planner.harness",
        "planner.model",
        "implementor.harness",
        "implementor.model",
        "on-green",
      ]);
      expect(setupOf(theWork(r)).mode).toEqual(Option.none());
    });

    it("refuses a model the host did not list for its harness", async () => {
      const r = rig();
      await asked(r);
      const { work, ask } = await opening(r);
      const refusal = r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map([
            [fieldOf(r, "mode"), ["trivial"]],
            [fieldOf(r, "implementor.harness"), [HARNESS_LISTS_MODELS]],
            [fieldOf(r, "implementor.model"), ["anthropic/sonnet-9"]],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      });
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      await expect(refusal).rejects.toThrow(
        new RegExp(
          `"anthropic/sonnet-9" is not a model ${HARNESS_LISTS_MODELS} offers on local`,
        ),
      );
      expect(r.modelAsks()).toEqual([
        `${HARNESS_LISTS_MODELS}@local:/srv/repo`,
      ]);
      expect(stillAsked(r)).toHaveLength(6);
    });

    it("records a model the host could not list, and starts it without that list", async () => {
      const r = rig();
      await asked(r);
      const { work, ask } = await opening(r);
      await r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map([
            [fieldOf(r, "mode"), ["trivial"]],
            [fieldOf(r, "implementor.harness"), [HARNESS_LISTING_FAILS]],
            [fieldOf(r, "implementor.model"), ["litellm/used-before"]],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      });
      expect(answerOf(theWork(r), "implementor.model")).toMatchObject({
        how: "answered",
        value: "litellm/used-before",
        chosen: "picked",
      });
      await expect(r.host.startOf(work, "implementor")).resolves.toEqual({
        host: "local",
        harness: HARNESS_LISTING_FAILS,
        model: "litellm/used-before",
        launch: MODEL_FLAG,
      });
      expect(r.launchAsks()).toEqual([`${HARNESS_LISTING_FAILS}@local`]);
    });

    it("records a typed model as typed, holds it to no list, and starts it asking for none", async () => {
      const r = rig();
      await asked(r);
      const { work, ask } = await opening(r);
      await r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map<string, SentAnswer>([
            [fieldOf(r, "mode"), ["trivial"]],
            [fieldOf(r, "implementor.harness"), [HARNESS_LISTS_MODELS]],
            [fieldOf(r, "implementor.model"), { typed: "opus" }],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      });
      expect(answerOf(theWork(r), "implementor.model")).toMatchObject({
        value: "opus",
        chosen: "typed",
      });
      expect(r.modelAsks()).toEqual([]);
      await expect(r.host.startOf(work, "implementor")).resolves.toEqual({
        host: "local",
        harness: HARNESS_LISTS_MODELS,
        model: "opus",
        launch: MODEL_FLAG,
      });
      expect(r.modelAsks()).toEqual([]);
      expect(r.launchAsks()).toEqual([`${HARNESS_LISTS_MODELS}@local`]);
    });

    it("checks a harness the REQUEST named before any work exists", async () => {
      const r = rig();
      await asked(r);
      const refusal = r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: [
          given("mode", "trivial"),
          given("implementor.harness", "claude-code"),
          { key: "implementor.model", given: toAsk },
          given("on-green", "merge"),
        ],
      });
      await expect(refusal).rejects.toBeInstanceOf(WorkRefusal);
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      await expect(refusal).rejects.toThrow(
        /"claude-code" is not a harness this kolu carries/,
      );
      expect(r.host.works()).toEqual([]);
      expect(
        served(r.host).some(
          (one) => one.kind === "ask" || one.kind === "work-ask",
        ),
      ).toBe(false);
    });

    it("names the harness and the host when the listing fails, and quotes nothing", async () => {
      const r = rig();
      await asked(r);
      r.failModels(
        "agent-distro omp: error: + export LITELLM_API_KEY=sk-live-9ab3c7d1e5f00042",
      );
      const refusal = r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: [
          given("mode", "trivial"),
          given("implementor.harness", HARNESS_LISTS_MODELS),
          given("implementor.model", LISTED_MODEL_IDS[1]),
          given("on-green", "merge"),
        ],
      });
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      const why = await refusal.then(
        () => "",
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      );
      expect(why).not.toContain("sk-live-9ab3c7d1e5f00042");
      expect(why).not.toContain("LITELLM_API_KEY");
      expect(why).toContain(HARNESS_LISTS_MODELS);
      expect(why).toContain("local");
      expect(why).toContain("human");
    });

    it("checks a MODEL the request named against the harness it named with it", async () => {
      const r = rig();
      await asked(r);
      const refusal = r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: [
          given("mode", "trivial"),
          given("implementor.harness", HARNESS_LISTS_MODELS),
          given("implementor.model", "anthropic/sonnet-9"),
          given("on-green", "merge"),
        ],
      });
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      await expect(refusal).rejects.toThrow(
        new RegExp(
          `"anthropic/sonnet-9" is not a model ${HARNESS_LISTS_MODELS} offers on local`,
        ),
      );
      expect(r.host.works()).toEqual([]);

      const opened = await r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: [
          given("mode", "trivial"),
          given("implementor.harness", HARNESS_LISTS_MODELS),
          given("implementor.model", LISTED_MODEL_IDS[1]),
          given("on-green", "merge"),
        ],
      });
      expect(opened.asked).toBe(false);
      expect(setupOf(theWork(r)).roles).toEqual([
        {
          role: "implementor",
          setup: {
            kind: "harness-and-model",
            harness: HARNESS_LISTS_MODELS,
            model: LISTED_MODEL_IDS[1],
          },
        },
      ]);
    });

    it("refuses a typed model that is not a model id, and says why", async () => {
      const r = rig();
      await asked(r);
      const { work, ask } = await opening(r);
      const refusal = r.host.answerWork({
        work,
        ask,
        from: "card",
        reply: answer(
          new Map([
            [fieldOf(r, "mode"), ["trivial"]],
            [fieldOf(r, "implementor.harness"), [HARNESS_UNLISTED]],
            [fieldOf(r, "implementor.model"), ["fable 5.2"]],
            [fieldOf(r, "on-green"), ["merge"]],
          ]),
        ),
      });
      await expect(refusal).rejects.toMatchObject({ kind: "not-offered" });
      await expect(refusal).rejects.toThrow(
        /implementor\.model: "fable 5\.2" is not a model id — a model id is one word, with no spaces/,
      );
      expect(stillAsked(r)).toHaveLength(6);
    });
  });

  describe("a saved setup kolu no longer offers", () => {
    const saved = (key: KoluChoiceKey, value: string): Decision => ({
      kind: "settled",
      id: `old-${key}`,
      ask: "old-setup",
      at: T0,
      topic: "setup",
      key,
      question: `${key}?`,
      answer: {
        at: T0,
        how: "answered",
        value,
        chosen: "picked",
        from: "card",
      },
    });

    const savedMode = (mode: WorkMode): Decision => ({
      kind: "settled",
      id: "old-mode",
      ask: "old-setup",
      at: T0,
      topic: "setup",
      key: "mode",
      question: "mode?",
      options: [mode],
      answer: { at: T0, how: "answered", value: mode, from: "card" },
    });
    const savedOnGreen = (onGreen: OnGreen): Decision => ({
      kind: "settled",
      id: "old-on-green",
      ask: "old-setup",
      at: T0,
      topic: "setup",
      key: "on-green",
      question: "on-green?",
      options: [onGreen],
      answer: { at: T0, how: "answered", value: onGreen, from: "card" },
    });

    const legacy = (): Work =>
      storedWork({
        decisions: [
          savedMode("full"),
          saved("planner.harness", HARNESS_UNLISTED),
          saved("planner.model", "fable 5.2"),
          saved("implementor.harness", HARNESS_LISTS_MODELS),
          saved("implementor.model", "claude-opus-5-5"),
          savedOnGreen("hand-over"),
        ],
      });

    const openField = (r: Rig, key: SetupKey): string => {
      const decision = theWork(r).decisions.find(
        (one) => isSetup(one) && one.key === key && isAsked(one),
      );
      if (decision === undefined) throw new Error(`${key} is not being asked`);
      return decision.id;
    };

    it("is refused at start, asked again by `work_open`, and starts once answered", async () => {
      const r = rig({ works: storedWorks(legacy()) });
      await asked(r);
      const id = theWorkId(r);

      const planner = r.host.startOf(id, "planner");
      await expect(planner).rejects.toBeInstanceOf(WorkRefusal);
      await expect(planner).rejects.toMatchObject({ kind: "not-offered" });
      await expect(planner).rejects.toThrow(
        /planner\.model: "fable 5\.2" is not a model id/,
      );
      await expect(planner).rejects.toThrow(/Call `work_open`/);
      await expect(r.host.startOf(id, "implementor")).rejects.toThrow(
        new RegExp(
          `implementor\\.model: "claude-opus-5-5" is not a model ${HARNESS_LISTS_MODELS} offers on local`,
        ),
      );

      const opened = await r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: fullSetup,
      });
      expect(opened.created).toBe(false);
      expect(opened.asked).toBe(true);
      const reasked = theWork(r).decisions.filter((one) => isAsked(one));
      expect(askedKeys(theWork(r))).toEqual([
        "planner.model",
        "implementor.model",
      ]);
      expect(reasked[0]?.question).toBe(
        'Which model does the planner run on? It was "fable 5.2", which is not a model id — a model id is one word, with no spaces.',
      );
      expect(reasked[1]?.question).toBe(
        `Which model does the implementor run on? It was "claude-opus-5-5", which is not a model ${HARNESS_LISTS_MODELS} offers on local.`,
      );

      await r.host.answerWork({
        work: opened.work,
        ask: opened.ask,
        from: "card",
        reply: answer(
          new Map([
            [openField(r, "planner.model"), ["claude-fable-5-2"]],
            [openField(r, "implementor.model"), [LISTED_MODEL_IDS[0]]],
          ]),
        ),
      });

      await expect(r.host.startOf(id, "planner")).resolves.toEqual({
        host: "local",
        harness: HARNESS_UNLISTED,
        model: "claude-fable-5-2",
        launch: MODEL_FLAG,
      });
      await expect(r.host.startOf(id, "implementor")).resolves.toMatchObject({
        harness: HARNESS_LISTS_MODELS,
        model: LISTED_MODEL_IDS[0],
      });

      const again = await r.host.openWork({
        key: workKey(),
        title: "fix the parser",
        setup: fullSetup,
      });
      expect(again.asked).toBe(false);
    });
  });

  describe("the human's own store — answered, with no answer", () => {
    const walkedWorks = (): PersistedWorks => {
      const at = "2026-11-01T09:00:00.000Z";
      const id = workIdOf(workKey());
      const old = (
        key: SetupKey,
        picked: ReadonlyArray<string>,
        question: string,
      ) => ({
        kind: "answered",
        id: `d-${key}`,
        ask: "ask-setup",
        at,
        key,
        header: "",
        question,
        file: "",
        ...(key === "mode" || key === "on-green"
          ? {
              options: key === "mode" ? ["full"] : ["merge", "hand-over"],
              multiple: false,
            }
          : {}),
        answer: { how: "answered", picked, text: null, from: "chat", at },
      });
      const dir = mkdtempSync(join(tmpdir(), "kolu-human-store-"));
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          works: {
            [id]: {
              key: workKey(),
              title: "fix the parser",
              startedAt: at,
              decisions: [
                old("mode", ["full"], "How should this run?"),
                old(
                  "planner.harness",
                  [HARNESS_LISTS_MODELS],
                  "Which harness plans?",
                ),
                old("planner.model", [], "Which model should plan?"),
                old(
                  "implementor.harness",
                  [HARNESS_LISTS_MODELS],
                  "Which harness implements?",
                ),
                old("implementor.model", [], "Which model implements?"),
                old("on-green", ["merge"], "And when CI is green?"),
              ],
              events: [
                {
                  at,
                  by: "you",
                  kind: "answered",
                  terminal: null,
                  ask: "ask-setup",
                },
              ],
              state: { kind: "open" },
            },
          },
          __internal__: { migrations: { version: "1.54.0" } },
        }),
      );
      const store = new Conf<Record<string, unknown>>({
        cwd: dir,
        projectVersion: SCHEMA_VERSION,
        defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
        migrations: CONF_MIGRATIONS as never,
      });
      const decoded = Schema.decodeUnknownResult(PersistedWorksSchema)(
        store.get("works"),
      );
      if (Result.isFailure(decoded))
        throw new Error(`the walked store did not decode: ${decoded.failure}`);
      return decoded.success;
    };

    it("comes back as the two questions it always was, and starts once they are answered", async () => {
      const r = rig({ works: walkedWorks() });
      await asked(r);
      const id = theWorkId(r);
      const work = theWork(r);

      expect(r.host.state().workAsks).toContain("ask-setup");
      expect(setupStanding(work, "planner.model").kind).toBe("open");
      expect(setupStanding(work, "implementor.model").kind).toBe("open");
      expect(setupValue(work, "planner.harness")).toEqual(
        Option.some(HARNESS_LISTS_MODELS),
      );
      expect(modeOf(work)).toEqual(Option.some("full"));

      const planner = r.host.startOf(id, "planner");
      await expect(planner).rejects.toBeInstanceOf(WorkRefusal);
      await expect(planner).rejects.toMatchObject({ kind: "missing-setup" });
      await expect(planner).rejects.toThrow(/planner\.model/);
      await expect(planner).rejects.toThrow(/wait for their answer/);

      await r.host.answerWork({
        work: id,
        ask: "ask-setup",
        from: "card",
        reply: answer(
          new Map([
            [
              decisionNamed(work, "Which model should plan?").id,
              [LISTED_MODEL_IDS[0]],
            ],
            [
              decisionNamed(work, "Which model implements?").id,
              [LISTED_MODEL_IDS[1]],
            ],
          ]),
        ),
      });
      expect(answerOf(theWork(r), "planner.model")).toMatchObject({
        how: "answered",
        value: LISTED_MODEL_IDS[0],
        from: "card",
      });
      expect(r.host.state().workAsks).toEqual([]);

      await expect(r.host.startOf(id, "planner")).resolves.toEqual({
        host: "local",
        harness: HARNESS_LISTS_MODELS,
        model: LISTED_MODEL_IDS[0],
        launch: MODEL_FLAG,
      });
    });
  });
});

describe("a call about a work that is refused", () => {
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
        key: workKey(),
        title: "fix the parser",
        setup: [
          {
            key: "mode",
            question: "How much?",
            options: ["full"],
            given: toAsk,
          },
        ],
      }),
    );
    expect(refused.kind).toBe("missing-setup");
    expect(refused.why).toContain("planner.harness");
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
    r.host.leaveWork(A);
    expect(theWork(r).state.kind).toBe("open");
    r.host.stopWork(work, "you");
    expect(theWork(r).state).toMatchObject({
      kind: "ended",
      outcome: { kind: "stopped", by: "you" },
    });

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
            {
              header: { kind: "header", text: "Plan approval" },
              question: "Approve?",
              options: ["yes"],
              multiple: false,
              file: { kind: "none" },
            },
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
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A, B]);
    });
    expect(agent.wakesSent()).toEqual([]);

    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    const woke = agent.wakesSent()[0];
    expect(woke?.events.map((one) => one.ref)).toEqual([A, B]);
    expect(woke?.events.map((one) => one.level)).toEqual(["stopped", "asking"]);
    expect(woke?.text).toContain(A);
    expect(woke?.text).toContain(B);
    expect(woke?.text).toContain("the implementor of «fix the parser»");
    expect(r.host.state().held).toEqual([]);
  });

  it("leaves on a CANCEL too, which is a turn ending like any other", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });

    await r.host.cancel();
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events.map((one) => one.ref)).toEqual([A]);
  });

  it("WITHDRAWS what a terminal was going to say once it is working again", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });

    r.host.observe([seeing(A, "working")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([]);
    });
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakesSent()).toEqual([]);
  });

  it("counts a terminal as TOLD only when the wake was delivered", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    agent.refuseWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    await r.host.dispose();
    expect(Object.keys(r.members.value())).toEqual([A, B]);
    const work = theWorkId(r);
    expect(r.members.value()).toMatchObject({
      [A]: {
        work,
        watch: {
          name: "fix the parser",
          agent: "claude-code",
          told: null,
          joined: "created",
          spoken: true,
          ran: false,
        },
      },
      [B]: {
        work,
        watch: {
          name: "",
          agent: null,
          told: null,
          joined: "created",
          spoken: true,
          ran: false,
        },
      },
    });

    const second = rig({
      conductor: r.record.value(),
      transcriptRows: r.transcript.value().rows,
      works: r.works.value(),
      members: r.members.value(),
    });
    await second.host.prompt("hello", [], [], false);
    const live = second.spawns[0];
    if (live === undefined) throw new Error("the host spawned nothing");
    idle(live);
    second.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(live.wakesSent()).toHaveLength(1);
    });
    await second.host.dispose();
    expect(second.members.value()[A]?.watch.told).toBe("stopped");
  });
});

describe("the watch across a restart", () => {
  it("does not ring again about a terminal that has not moved", async () => {
    const r = rig({
      conductor: { ...EMPTY_PERSISTED_CONDUCTOR, cwd: HOME },
      works: storedWorks(storedWork()),
      members: storedMembers({ [A]: { told: "stopped" } }),
    });
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);

    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.memberRefs()).toContain(A);
    });
    expect(agent.wakesSent()).toEqual([]);

    r.host.observe([seeing(A, "asking")]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events[0]?.level).toBe("asking");
  });

  it("KEEPS a question that was still open when kolu stopped", async () => {
    const r = rig({
      works: storedWorks(
        storedWork({
          events: [
            {
              at: T0,
              by: "agent",
              kind: "question",
              about: { kind: "work" },
              ask: "kolu:ask:1",
            },
          ],
          decisions: [
            {
              kind: "asked",
              id: "d-1",
              ask: "kolu:ask:1",
              at: T0,
              topic: "work",
              header: { kind: "header", text: "Plan approval" },
              question: "Approve the plan?",
              options: ["yes", "no"],
              multiple: false,
              file: { kind: "none" },
            },
          ],
        }),
      ),
      members: storedMembers({ [A]: {} }),
    });
    const carried = theWork(r);
    expect(carried.decisions[0]?.kind).toBe("asked");
    expect(kindsOf(carried)).toEqual(["question"]);
    expect(carried.state.kind).toBe("open");
  });
});

describe("what a reading publishes", () => {
  const oneMember = async (r: Rig, join: "created" | "created-run") => {
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", join);
    return work;
  };

  it("publishes a LEVEL CHANGE that moves nothing else", async () => {
    const r = rig();
    await oneMember(r, "created-run");
    r.host.observe([
      seeing(A, "shell", { agent: null, foregroundShell: true }),
    ]);
    const before = r.readingsPublished().length;

    r.host.observe([
      seeing(A, "working", { agent: null, foregroundShell: false }),
    ]);

    expect(r.readingsPublished().slice(before)).toEqual([
      { terminal: A, reading: { level: "working", since: expect.any(String) } },
    ]);
  });

  it("tells the works' readers when a reading first DETECTS the agent", async () => {
    const r = rig();
    await oneMember(r, "created");
    r.host.observe([seeing(A, "working", { agent: null })]);
    const redraws = r.worksMoved();
    const scopes = r.watchScopeMoved();

    r.host.observe([seeing(A, "working", { agent: "claude-code" })]);

    expect(r.worksMoved()).toBeGreaterThan(redraws);
    expect(r.watchScopeMoved()).toBe(scopes);
    expect(r.host.membersDetail()[0]?.agent).toBe("claude-code");
  });

  it("says NOTHING when a reading repeats what was already read", async () => {
    const r = rig();
    await oneMember(r, "created");
    r.host.observe([seeing(A, "working")]);
    const published = r.worksPublished().length;
    const redraws = r.worksMoved();
    const scopes = r.watchScopeMoved();

    r.host.observe([seeing(A, "working")]);

    expect(r.worksPublished().length).toBe(published);
    expect(r.worksMoved()).toBe(redraws);
    expect(r.watchScopeMoved()).toBe(scopes);
  });
});

describe("the timeline a reading writes", () => {
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
      about: aboutMember(A),
    });

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
      why: { kind: "reason", text: "ended without an agent" },
    });
  });

  it("writes a `.waterfall/` file ONCE, however often the directory is listed", async () => {
    const r = rig();
    r.files.holds([".waterfall/plan.md"]);
    await running(r);

    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(1);
    });
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      about: aboutMember(A),
      path: ".waterfall/plan.md",
    });
    expect(r.files.listed()).toEqual([
      { host: "local", worktree: inRepo.worktree },
    ]);

    r.host.observe([seeing(A, "working", { git: inRepo })]);
    await afterPendingFileListing();
    r.host.observe([seeing(A, "asking", { git: inRepo })]);
    await afterPendingFileListing();
    expect(r.files.listed()).toHaveLength(3);
    expect(theWork(r).events.filter((one) => one.kind === "file")).toHaveLength(
      1,
    );

    r.files.holds([".waterfall/plan.md", ".waterfall/review.md"]);
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "file"),
      ).toHaveLength(2);
    });
  });

  it("carries on after a listing that FAILED, and asks again on the next change", async () => {
    const r = rig();
    r.files.listFails("the host is not answering");
    r.files.holds([".waterfall/plan.md"]);
    await running(r);
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    await afterPendingFileListing();
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

  it("records the work's ONE PR, and ends the work when it merges", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.joinWork(work, B, "planner", "created");
    r.host.saidTo(B);

    r.host.observedPr(work, forgeSays({}));
    r.host.observedPr(work, forgeSays({}));
    await vi.waitFor(() => {
      expect(
        theWork(r).events.filter((one) => one.kind === "pr-opened"),
      ).toHaveLength(1);
    });
    expect(
      theWork(r).events.find((one) => one.kind === "pr-opened"),
    ).toMatchObject({
      kind: "pr-opened",
      pr: 412,
      title: "fix the parser",
      about: ABOUT_WORK,
    });

    r.host.observedPr(work, forgeSays({ checks: "pending" }));
    r.host.observedPr(work, forgeSays({ checks: "pending" }));
    r.host.observedPr(work, forgeSays({ checks: "pass" }));
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("checks-passed");
    });
    expect(
      theWork(r).events.filter((one) => one.kind === "checks-running"),
    ).toHaveLength(1);

    r.host.observedPr(work, forgeSays({ state: "merged", checks: "pass" }));
    await vi.waitFor(() => {
      expect(theWork(r).state).toMatchObject({
        kind: "ended",
        outcome: { kind: "merged", pr: 412 },
      });
    });
    expect(
      theWork(r).events.filter((one) => one.kind === "merged"),
    ).toHaveLength(1);
    expect(r.host.memberRefs()).toEqual([]);
  });

  it("ends a work whose terminals were closed the moment it merged", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.joinWork(work, B, "planner", "created");
    r.host.closedTerminal(A);
    r.host.closedTerminal(B);
    await vi.waitFor(() => {
      expect(r.host.memberRefs()).toEqual([]);
    });
    expect(r.host.prWatches()).toEqual([
      { work, host: "local", repo: "/srv/repo", branch: "fix-the-parser" },
    ]);

    r.host.observedPr(work, forgeSays({ number: 181, state: "merged" }));
    await vi.waitFor(() => {
      expect(theWork(r).state).toMatchObject({
        kind: "ended",
        outcome: { kind: "merged", pr: 181 },
      });
    });
    expect(r.host.prWatches()).toEqual([]);
  });

  it("tracks the checks of a work that has no terminals at all", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.closedTerminal(A);
    r.host.observedPr(
      work,
      forgeSays({ number: 7, checks: "fail", failing: ["build", "unit"] }),
    );
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("checks-failed");
    });
    expect(
      theWork(r).events.find((one) => one.kind === "checks-failed"),
    ).toMatchObject({
      kind: "checks-failed",
      by: "ci",
      about: ABOUT_WORK,
      pr: 7,
      head: { kind: "commit", sha: HEAD },
      failing: ["build", "unit"],
    });
    expect(theWork(r).state.kind).toBe("open");
  });

  it("NEVER ends a work its members have all left, and says so ONCE", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    idle(agent);
    const before = theWorkId(r);
    r.host.observe([seeing(A, "gone"), seeing(B, "gone")]);
    await vi.waitFor(() => {
      expect(r.host.memberRefs()).toEqual([]);
    });
    expect(theWorkId(r)).toBe(before);
    expect(theWork(r).state.kind).toBe("open");
    await vi.waitFor(() => {
      expect(
        agent.wakesSent().filter((one) => one.text.includes("no terminals")),
      ).toHaveLength(1);
    });
    r.host.observe([seeing(A, "gone"), seeing(B, "gone")]);
    await afterPendingFileListing();
    expect(
      agent.wakesSent().filter((one) => one.text.includes("no terminals")),
    ).toHaveLength(1);
  });

  it("takes a NOTE from the Conductor, and nothing else it says", async () => {
    const r = rig();
    const { work } = await running(r);
    r.host.note(work, "the planner is re-reading the brief");
    expect(theWork(r).events.at(-1)).toMatchObject({
      kind: "note",
      by: "agent",
      about: ABOUT_WORK,
      text: "the planner is re-reading the brief",
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

    r.files.holds([".waterfall/plan.md", ".waterfall/review.md"]);
    r.host.stopWork(work, "you");

    await vi.waitFor(() => {
      expect(r.files.kept()).toHaveLength(1);
    });
    const kept = r.files.kept()[0];
    expect(kept?.work).toBe(workDirOf(work));
    expect([...(kept?.paths ?? [])].sort()).toEqual([
      ".waterfall/plan.md",
      ".waterfall/review.md",
    ]);
    await vi.waitFor(() => {
      expect(Option.map(keptOf(theWork(r)), (one) => one.length)).toEqual(
        Option.some(2),
      );
    });
    expect(kindsOf(theWork(r))).toContain("kept");
    expect(
      Option.map(
        keptOf(Object.values(r.works.value())[0] as Work),
        (one) => one.length,
      ),
    ).toEqual(Option.some(2));
  });

  it("drops the OLDEST finished work past the twenty it keeps, files and all", async () => {
    const r = rig({
      works: storedWorks(
        ...Array.from({ length: 20 }, (_, at) =>
          storedWork({
            key: workKey(`old-${at}`),
            title: `done ${at}`,
            state: {
              kind: "ended",
              at: `2026-01-02T00:${String(at).padStart(2, "0")}:00.000Z`,
              outcome: { kind: "merged", pr: at + 1 },
              kept: [],
            },
          }),
        ),
      ),
    });
    const work = await watchWork(r, "the twenty-first", workKey("twenty-one"));
    r.host.joinWork(work, A, "implementor", "created");
    r.host.stopWork(work, "you");

    const oldest = workIdOf(workKey("old-0"));
    await vi.waitFor(() => {
      expect(r.files.swept().at(-1)).not.toContain(oldest);
    });
    const remembered = r.host.works().map(([id]) => id);
    expect(remembered).toHaveLength(20);
    expect(remembered).not.toContain(oldest);
    expect(remembered[0]).toBe(work);
    expect(Object.keys(r.works.value())).not.toContain(oldest);
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
    r.files.listFails("the host is not answering");
    r.host.stopWork(work, "you");
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("kept");
    });
    expect(keptOf(theWork(r))).toEqual(
      Option.some([
        { path: ".waterfall/plan.md", bytes: ".waterfall/plan.md".length },
      ]),
    );
  });

  it("records what WAS kept and why the rest was not, when a keep is partial", async () => {
    const r = rig();
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created");
    r.host.observe([seeing(A, "stopped", { git: inRepo })]);
    r.files.holds(
      [
        ".waterfall/plan.md",
        ".waterfall/mockup/index.html",
        ".waterfall/mockup/big.mov",
      ],
      true,
    );
    r.files.tooBig([".waterfall/mockup/big.mov"]);
    r.host.stopWork(work, "you");
    await vi.waitFor(() => {
      expect(kindsOf(theWork(r))).toContain("keep-failed");
    });
    expect([...(r.files.kept()[0]?.paths ?? [])].sort()).toEqual([
      ".waterfall/mockup/big.mov",
      ".waterfall/mockup/index.html",
      ".waterfall/plan.md",
    ]);
    expect(
      Option.map(keptOf(theWork(r)), (one) => one.map((file) => file.path)),
    ).toEqual(
      Option.some([".waterfall/plan.md", ".waterfall/mockup/index.html"]),
    );
    expect(kindsOf(theWork(r))).toContain("kept");
    expect(notKeptOf(theWork(r))).toEqual(
      Option.some(
        "mockup/big.mov did not fit in the 50 MiB kolu keeps of a work; kolu stopped listing .waterfall/ at 200 files and folders",
      ),
    );
  });
});

describe("an agent that has just come up", () => {
  it("rings READY, and the brief that answers it does not ring back", async () => {
    const r = rig();
    await r.host.prompt("hello", [], [], false);
    const agent = r.spawns[0];
    if (agent === undefined) throw new Error("the host spawned nothing");
    idle(agent);
    const work = await watchWork(r);
    r.host.joinWork(work, A, "implementor", "created-run");
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events[0]?.level).toBe("ready");
    expect(agent.wakesSent()[0]?.text).toContain(
      "has not been told anything yet",
    );

    r.host.saidTo(A);
    r.host.observe([seeing(A, "stopped")]);
    r.host.observe([seeing(A, "working")]);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(2);
    });
    expect(agent.wakesSent()[1]?.events[0]?.level).toBe("stopped");
  });

  it("withdraws what a terminal was about to say when the Conductor speaks to it", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.observe([seeing(A, "stopped")]);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    r.host.saidTo(A);
    expect(r.host.state().held).toEqual([]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakesSent()).toEqual([]);
  });
});

describe("a terminal the Conductor closed itself", () => {
  it("leaves in silence even when its going has already rung", async () => {
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
    expect(agent.wakesSent()).toEqual([]);
  });

  it("says nothing about it when the watcher sees it go only afterwards", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.closedTerminal(A);
    expect(r.host.memberRefs()).toEqual([B]);
    r.host.observe([seeing(A, "gone")]);
    expect(r.host.state().held).toEqual([]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().phase).toBe("idle");
    });
    expect(agent.wakesSent()).toEqual([]);
  });

  it("still rings for a terminal that went away WITHOUT being closed", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    r.host.closedTerminal(A);
    r.host.observe([seeing(A, "gone"), seeing(B, "gone")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events.map((one) => one.ref)).toEqual([B]);
  });
});

describe("a wake that could not be delivered", () => {
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
    agent.refuseWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(noticesNow(r)).toHaveLength(1);
    });
    const said = noticesNow(r)[0];
    expect(said?.kind === "notice" ? said.text : "").toContain(A);
    expect(said?.kind === "notice" ? said.text : "").toContain(
      "the agent is not there",
    );
    expect(r.host.state().held).toEqual([A]);
    expect(agent.wakesSent()).toEqual([]);

    r.host.observe([seeing(A, "asking")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    expect(noticesNow(r)).toHaveLength(1);

    agent.refuseWakes(null);
    idle(agent);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events.map((one) => one.level)).toEqual([
      "asking",
    ]);
    expect(r.host.state().held).toEqual([]);
  });

  it("retries on the next reading of a member terminal", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    agent.refuseWakes("the agent is not there");
    r.host.observe([seeing(A, "stopped")]);
    idle(agent);
    await vi.waitFor(() => {
      expect(noticesNow(r)).toHaveLength(1);
    });

    agent.refuseWakes(null);
    r.host.observe([seeing(B, "stopped")]);
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    expect(agent.wakesSent()[0]?.events.map((one) => one.ref)).toEqual([A, B]);
  });
});

const refused = (run: () => unknown): WorkRefusal => {
  try {
    run();
  } catch (err) {
    if (err instanceof WorkRefusal) return err;
    throw err;
  }
  throw new Error("nothing was refused");
};

const drivenWork = async (r: Rig, member = A): Promise<WorkId> => {
  const opened = await r.host.openWork({
    key: workKey("driven"),
    title: "fix the parser",
    setup: [
      given("mode", "full"),
      given("planner.harness", HARNESS_LISTS_MODELS),
      given("planner.model", LISTED_MODEL_IDS[0]),
      given("implementor.harness", HARNESS_LISTS_MODELS),
      given("implementor.model", LISTED_MODEL_IDS[1]),
      given("on-green", "merge"),
    ],
  });
  r.host.joinWork(opened.work, member, "implementor", "created");
  return opened.work;
};

const memberAt = (
  r: Rig,
  ref: string,
): Option.Option<{ readonly work: string; readonly role: WorkRole }> =>
  Option.map(
    Option.fromUndefinedOr(
      r.host.membersDetail().find((member) => member.ref === ref),
    ),
    (one) => ({ work: one.work, role: one.role }),
  );

describe("taking a driven terminal over, and handing it back", () => {
  it("writes it on the work, and tells the Conductor to keep its hands off", async () => {
    const r = rig();
    const agent = await busyWatching(r);
    const work = await drivenWork(r, B);
    idle(agent);

    r.host.takeOver(B);

    const driven = r.host.works().find(([id]) => id === work)?.[1] as Work;
    expect(kindsOf(driven).at(-1)).toBe("taken-over");
    expect(driverOf(driven, B, memberAt(r, B))).toBe("you");
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(1);
    });
    const woke = agent.wakesSent()[0];
    expect(woke?.events.map((one) => one.level)).toEqual(["taken-over"]);
    expect(woke?.text).toContain(B);
    expect(woke?.text).toContain("the implementor of «fix the parser»");
    expect(woke?.text).toContain("TOOK IT OVER");

    r.host.handBack(B);
    const back = r.host.works().find(([id]) => id === work)?.[1] as Work;
    expect(kindsOf(back).at(-1)).toBe("handed-back");
    expect(driverOf(back, B, memberAt(r, B))).toBe("conductor");
    await vi.waitFor(() => {
      expect(agent.wakesSent()).toHaveLength(2);
    });
    expect(agent.wakesSent()[1]?.events.map((one) => one.level)).toEqual([
      "handed-back",
    ]);
  });

  it("works while the agent is DOWN — the news waits for somebody to tell", async () => {
    const r = rig({ endpoint: null });
    await drivenWork(r);

    r.host.takeOver(A);

    expect(driverOf(theWork(r), A, memberAt(r, A))).toBe("you");
    await vi.waitFor(() => {
      expect(r.host.state().held).toEqual([A]);
    });
    expect(
      (Object.values(r.works.value())[0] as Work).events.at(-1)?.kind,
    ).toBe("taken-over");
  });

  it("refuses a terminal nothing drives, and one already in that state", async () => {
    const r = rig();
    await drivenWork(r);
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
    expect(driverOf(theWork(r), A, memberAt(r, A))).toBe("nobody");
  });
});

describe("a restored backup of the works", () => {
  it("replaces them, keeps their open questions, re-scopes and writes NOW", async () => {
    const r = rig();
    const before = await drivenWork(r);
    const scopes = r.watchScopeMoved();
    const writes = r.works.writeCount();

    const restored = workKey("carried-over");
    const id = workIdOf(restored);
    r.host.restoreWorks(
      storedWorks(
        storedWork({
          key: restored,
          title: "carried over",
          decisions: [
            {
              kind: "asked",
              id: "d1",
              ask: "ask:gone",
              at: T0,
              topic: "work",
              header: { kind: "header", text: "Plan approval" },
              question: "Approve the plan?",
              options: ["Approve"],
              multiple: false,
              file: { kind: "file", path: ".waterfall/plan.md" },
            },
          ],
        }),
      ),
      storedMembers({ [B]: {} }, id),
    );

    expect(r.host.works().map(([one]) => one)).toEqual([id]);
    expect(r.host.works()[0]?.[1].decisions[0]?.kind).toBe("asked");
    expect(r.watchScopeMoved()).toBeGreaterThan(scopes);
    expect(r.host.memberRefs()).toEqual([B]);
    expect(r.works.writeCount()).toBeGreaterThan(writes);
    expect(Object.keys(r.works.value())).toEqual([id]);
    expect(r.worksPublished().slice(-2)).toEqual([
      { id, work: expect.objectContaining({ title: "carried over" }) },
      { id: before, work: null },
    ]);
  });

  it("sweeps the kept files of every work it did not restore", async () => {
    const r = rig();
    await drivenWork(r);

    r.host.restoreWorks(
      storedWorks(storedWork({ key: workKey("carried-over") })),
      {},
    );

    await vi.waitFor(() => {
      expect(r.files.swept().at(-1)).toEqual([
        workDirOf(workIdOf(workKey("carried-over"))),
      ]);
    });
  });

  it("drops the runtime bookkeeping of a terminal the snapshot has no member for", async () => {
    const r = rig();
    await drivenWork(r);
    r.host.observe([seeing(A, "working")]);
    await vi.waitFor(() => {
      expect(r.host.readings().get(A)?.level).toBe("working");
    });

    const restored = workKey("carried-over");
    r.host.restoreWorks(
      storedWorks(storedWork({ key: restored })),
      storedMembers({ [B]: {} }, workIdOf(restored)),
    );

    expect(r.host.readings().has(A)).toBe(false);
    expect(r.readingsPublished().at(-1)).toEqual({
      terminal: A,
      reading: null,
    });
    expect(r.host.readings().has(B)).toBe(false);
    expect(r.host.membersDetail().map((one) => one.ref)).toEqual([B]);
  });
});

describe("what the works' readers are told", () => {
  it("publishes ONLY the work that moved, and every stored one once at boot", async () => {
    const r = rig({
      works: storedWorks(
        storedWork({ key: workKey("one"), title: "one" }),
        storedWork({ key: workKey("two"), title: "two" }),
      ),
      members: storedMembers({ [A]: {} }, workIdOf(workKey("one"))),
    });
    r.host.works();
    expect(r.worksPublished().map((one) => one.id)).toEqual([
      workIdOf(workKey("one")),
      workIdOf(workKey("two")),
    ]);

    const before = r.worksPublished().length;
    r.host.note(workIdOf(workKey("one")), "a line on the timeline");

    expect(
      r
        .worksPublished()
        .slice(before)
        .map((one) => one.id),
    ).toEqual([workIdOf(workKey("one"))]);
  });
});
