import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_ENV } from "@kolu/acp/engine";
import {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  startHarness,
} from "@kolu/acp-harness";
import { confStore } from "@kolu/surface/server";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { Option, Schema } from "effect";
import {
  type ConductorFrame,
  type ConductorRow,
  type ConductorState,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import {
  type ConductorHost,
  EMPTY_PERSISTED_CONDUCTOR,
  type PersistedConductor,
  PersistedConductorSchema,
  type MemberWatch,
  type PersistedMembers,
  type PersistedTranscript,
  PersistedTranscriptSchema,
  type PersistedWorks,
  repointConductorAttachments,
  startConductorHost,
} from "kolu-conductor";
import {
  type Decision,
  hostOf,
  modeOf,
  type WorkKey,
  type WorkMode,
  workIdOf,
  type WorkRole,
} from "kolu-work";
import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FleetMcpEndpoint as LiveFleetMcpEndpoint,
  proveFleetMcpEndpoint,
  startFleetMcpEndpoint,
} from "../fleet/mcpEndpoint.ts";
import { decodeStateBackup, store } from "../state.ts";
import {
  dropKoluChoiceOptions_1_54_0,
  foldWorksByKey_1_53_0,
  koluChoicesSayHowChosen_1_56_0,
  prFactsOnTheTimeline_1_57_0,
  prOpenedSaysDraft_1_61_0,
  workArmsNotNulls_1_55_0,
} from "../stateLadder.ts";
import { TRANSCRIPT_FILE_VERSION } from "../stateShape.ts";
import { transcriptFilePath, transcriptFileStore } from "./transcriptFile.ts";

const HOME = "/home/tester";

const FLEET_REF = "local/11111111-1111-4111-8111-111111111111";

const OTHER_REF = "remote:prod/22222222-2222-4222-8222-222222222222";

const THIRD_REF = "remote:box/33333333-3333-4333-8333-333333333333";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/srv/repo",
  branch: "fix-the-parser",
} as const satisfies WorkKey;
const OTHER_KEY = {
  kind: "branch",
  host: "remote:prod",
  repo: "/srv/repo",
  branch: "last-week",
} as const satisfies WorkKey;

const STATE_SCHEMA_VERSION = "1.61.0";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

const row = (id: string, seq: number, text = id): ConductorRow => ({
  id,
  seq,
  since: "2026-01-01T00:00:00.000Z",
  kind: "agent",
  text,
});

function expectStampedAtBoot(stamped: unknown, after: number): void {
  expect(typeof stamped).toBe("string");
  const at = Date.parse(String(stamped));
  expect(Number.isNaN(at)).toBe(false);
  expect(at).toBeGreaterThanOrEqual(after);
  expect(at).toBeLessThanOrEqual(Date.now());
}

const stateRoot = dirname(store.path);
const conductorStore = confStore<PersistedConductor>(store, "conductor");
const worksStore = confStore<PersistedWorks>(store, "works");
const membersStore = confStore<PersistedMembers>(store, "members");
const transcriptStore = transcriptFileStore(stateRoot, TRANSCRIPT_FILE_VERSION);
const transcriptPath = join(stateRoot, "conductor", "transcript.json");

const recordDeps = () => ({
  store: conductorStore,
  works: worksStore,
  members: membersStore,
  transcript: transcriptStore,
  transcriptPath: () => transcriptFilePath(stateRoot),
  publishWork: () => {},
  publishMember: () => {},
  publishReading: () => {},
  worksMoved: () => {},
  watchScopeMoved: () => {},
  workFiles: {
    list: async () => ({ paths: [], more: false }),
    keep: async () => ({ kept: [], tooBig: [] }),
    sweep: async () => {},
  },
});

function stored(
  key: WorkKey,
  title: string,
  members: ReadonlyArray<{
    readonly ref: string;
    readonly role: WorkRole;
    readonly watch: MemberWatch;
  }>,
  decisions: ReadonlyArray<Decision> = [],
): { works: PersistedWorks; members: PersistedMembers } {
  const id = workIdOf(key);
  const at = "2026-01-01T00:00:00.000Z";
  return {
    works: {
      [id]: {
        key,
        title,
        startedAt: at,
        decisions,
        events: [
          {
            at,
            by: "you",
            kind: "requested",
            about: { kind: "work" },
            request: { kind: "said", text: title },
          },
          ...members.map((one) => ({
            at,
            by: "kolu" as const,
            kind: "joined" as const,
            about: { kind: "member" as const, terminal: one.ref },
            role: one.role,
          })),
        ],
        state: { kind: "open" },
      },
    },
    members: Object.fromEntries(
      members.map((one) => [
        one.ref,
        {
          work: id,
          role: one.role,
          joinedAt: at,
          worktree: { kind: "unread" as const },
          watch: one.watch,
        },
      ]),
    ),
  };
}

const answered = (mode: WorkMode): Decision => ({
  kind: "settled",
  id: "d-mode",
  ask: "setup",
  at: "2026-01-01T00:00:00.000Z",
  topic: "setup",
  key: "mode",
  question: "mode",
  options: [],
  answer: {
    at: "2026-01-01T00:00:00.000Z",
    how: "answered",
    value: mode,
    from: "card",
  },
});

let liveEndpoint: LiveFleetMcpEndpoint;
const SAVED_AGENT = process.env[AGENT_ENV];

beforeEach(async () => {
  conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
  worksStore.set({});
  membersStore.set({});
  rmSync(join(stateRoot, "conductor"), { recursive: true, force: true });
  process.env[AGENT_ENV] = "/nix/store/fake-acp-adapter";
  liveEndpoint = await startFleetMcpEndpoint({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    serve: async (transport) => {
      const mcp = new McpServer(
        { name: "kolu-fleet", version: "0.0.0" },
        { capabilities: { resources: {}, tools: {} } },
      );
      await mcp.connect(transport);
      return { close: () => mcp.close() };
    },
  });
});

afterEach(async () => {
  if (SAVED_AGENT === undefined) delete process.env[AGENT_ENV];
  else process.env[AGENT_ENV] = SAVED_AGENT;
  conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
  worksStore.set({});
  membersStore.set({});
  rmSync(join(stateRoot, "conductor"), { recursive: true, force: true });
  await liveEndpoint.close();
});

function hostOver(): {
  host: ConductorHost;
  push: () => (change: HarnessChange<ConductorRow>) => void;
  resumedSeq: () => number | undefined;
  resume: () => string | null | undefined;
  readCall: () => HarnessOptions<ConductorRow>["readCall"] | undefined;
  wakes: () => number;
} {
  let onChange: ((change: HarnessChange<ConductorRow>) => void) | undefined;
  let options: HarnessOptions<ConductorRow> | undefined;
  let wakes = 0;
  const host = startConductorHost({
    log,
    home: HOME,
    hostName: "test-box",
    fleetMcp: () => liveEndpoint,
    offer: () => {
      throw new Error("no test here opens a work, so none reads kolu's offer");
    },
    proveFleetMcp: proveFleetMcpEndpoint,
    publish: () => {},
    ...recordDeps(),
    storePath: () => store.path,
    stateRoot,
    spawn: async (opts) => {
      options = opts;
      onChange = opts.onChange;
      const harness: Harness<ConductorRow> = {
        state: () => ({
          ...DEFAULT_CONDUCTOR_STATE,
          taught: false,
          methods: [],
          title: null,
          queues: false,
          phase: "idle",
        }),
        rows: () => [],
        alive: () => true,
        prompt: async () => ({ rowId: "sent" }),
        hostTurn: async () => {
          wakes += 1;
          return { rowId: `woke:${wakes}` };
        },
        cancel: async () => {},
        answer: async () => true,
        signIn: async () => "signed-in",
        askSignIn: () => {},
        signInInput: async () => {},
        signInCancel: async () => false,
        setOption: async () => {},
        newSession: async () => {},
        sendAgain: async () => {},
        sessions: async () => [],
        loadSession: async () => {},
        clearSession: async () => {},
        stop: async () => {
          opts.onChange({
            kind: "state",
            state: {
              ...DEFAULT_CONDUCTOR_STATE,
              taught: false,
              methods: [],
              title: null,
              queues: false,
              phase: "offline",
              sessionId: null,
            },
          });
        },
      };
      return harness;
    },
  });
  return {
    host,
    push: () => {
      if (onChange === undefined) throw new Error("nothing was spawned");
      return onChange;
    },
    resumedSeq: () => options?.resumedSeq,
    resume: () => (options?.opens.kind === "resume" ? options.opens.id : null),
    readCall: () => options?.readCall,
    wakes: () => wakes,
  };
}

describe("the conversation survives a restart", () => {
  it("round-trips the transcript through its own file, and the session and fleet through `config.json`", async () => {
    const first = hostOver();
    await first.host.prompt("hello", [], [], false);
    first.push()({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        taught: false,
        methods: [],
        title: null,
        queues: false,
        phase: "idle",
        sessionId: "sess-live",
      },
    });
    first.readCall()?.(
      {
        mcp: [{ server: "kolu", tool: "lifecycle_create" }],
        asksThroughForm: undefined,
        input: { host: "local" },
        answer: { id: FLEET_REF },
        called: undefined,
        row: undefined,
        reply: undefined,
        terminals: undefined,
      },
      undefined,
    );
    first.push()({
      kind: "rows",
      upserts: [row("a", 1, "one"), row("b", 2, "two")],
      removes: [],
      appends: [],
    });
    first.push()({
      kind: "rows",
      upserts: [],
      removes: [],
      appends: [{ of: "b", at: 3, text: " and a half" }],
    });
    await first.host.dispose();

    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    expect(Object.keys(file.conductor as object)).not.toContain("rows");
    const kept = JSON.parse(readFileSync(transcriptPath, "utf8")) as {
      version: string;
    };
    expect(kept.version).toBe(TRANSCRIPT_FILE_VERSION);
    expect(transcriptStore.get().rows).toEqual([
      row("a", 1, "one"),
      row("b", 2, "two and a half"),
    ]);
    const onDisk = Schema.decodeUnknownSync(PersistedConductorSchema)(
      file.conductor,
    );
    expect(onDisk.sessionId).toBe("sess-live");
    expect(onDisk.fleet).toEqual([FLEET_REF]);

    const second = hostOver();
    const seen: ConductorFrame[] = [];
    second.host.watch((frame) => seen.push(frame));
    const snapshot = seen[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows).toEqual([
      row("a", 1, "one"),
      row("b", 2, "two and a half"),
    ]);
    await second.host.prompt("still here?", [], [], false);
    expect(second.resumedSeq()).toBe(2);
    expect(second.resume()).toBe("sess-live");
    expect(second.host.state().fleet).toEqual([FLEET_REF]);
    await second.host.dispose();
  });

  it("comes back with the fleet the caller remembered, and adds to it", async () => {
    conductorStore.set({
      ...EMPTY_PERSISTED_CONDUCTOR,
      sessionId: "sess-live",
      cwd: HOME,
      fleet: [FLEET_REF],
    });

    const back = hostOver();
    await back.host.prompt("still here?", [], [], false);
    expect(back.host.state().fleet).toEqual([FLEET_REF]);

    back.readCall()?.(
      {
        mcp: [{ server: "kolu", tool: "lifecycle_create" }],
        asksThroughForm: undefined,
        input: { host: "remote:prod" },
        answer: { id: OTHER_REF },
        called: undefined,
        row: undefined,
        reply: undefined,
        terminals: undefined,
      },
      undefined,
    );
    expect(back.host.state().fleet).toEqual([FLEET_REF, OTHER_REF]);

    await back.host.dispose();
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    const onDisk = Schema.decodeUnknownSync(PersistedConductorSchema)(
      file.conductor,
    );
    expect(onDisk.fleet).toEqual([FLEET_REF, OTHER_REF]);
  });

  it("comes back to the WORKS it left, with their members and their decisions", async () => {
    const carried = stored(
      KEY,
      "fix the parser",
      [
        {
          ref: FLEET_REF,
          role: "planner",
          watch: {
            name: "fix the parser",
            agent: "claude-code",
            told: "stopped",
            joined: "created-run",
            spoken: true,
            ran: true,
          },
        },
        {
          ref: OTHER_REF,
          role: "implementor",
          watch: {
            name: "the implementor",
            agent: null,
            told: null,
            joined: "created",
            spoken: false,
            ran: false,
          },
        },
      ],
      [answered("full")],
    );
    worksStore.set(carried.works);
    membersStore.set(carried.members);

    const host = hostOver().host;
    const works = host.works();
    expect(works.map(([id]) => id)).toEqual([workIdOf(KEY)]);
    const work = works[0]?.[1];
    if (work === undefined) throw new Error("the work was not restored");
    expect(work.title).toBe("fix the parser");
    expect(host.memberRefs()).toEqual([FLEET_REF, OTHER_REF]);
    expect(modeOf(work)).toEqual(Option.some("full"));
    expect(hostOf(work)).toBe("local");
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    expect(Object.keys(file.conductor as object)).not.toContain("held");
    expect(host.state().held).toEqual([]);
    await host.dispose();
  });

  it("a backup restore replaces the works with the snapshot's, and the host reloads them", async () => {
    const today = stored(KEY, "the work of today", [
      {
        ref: FLEET_REF,
        role: "planner",
        watch: {
          name: "the work of today",
          agent: null,
          told: null,
          joined: "created",
          spoken: false,
          ran: false,
        },
      },
    ]);
    worksStore.set(today.works);
    membersStore.set(today.members);
    const host = hostOver().host;
    expect(host.works().map(([, one]) => one.title)).toEqual([
      "the work of today",
    ]);

    const snapshot = stored(OTHER_KEY, "the work of last week", [
      {
        ref: OTHER_REF,
        role: "implementor",
        watch: {
          name: "the work of last week",
          agent: "claude-code",
          told: null,
          joined: "asked",
          spoken: true,
          ran: false,
        },
      },
    ]);
    host.restoreWorks(snapshot.works, snapshot.members);

    expect(host.works().map(([id]) => id)).toEqual([workIdOf(OTHER_KEY)]);
    expect(host.works().map(([, one]) => one.title)).toEqual([
      "the work of last week",
    ]);
    expect(host.memberRefs()).toEqual([OTHER_REF]);
    expect(Object.keys(worksStore.get())).toEqual([workIdOf(OTHER_KEY)]);
    await host.dispose();
  });
});

describe("the conductor's rungs", () => {
  const fileAt = (version: string, keys: Record<string, unknown>): unknown => ({
    preferences: (
      JSON.parse(readFileSync(store.path, "utf8")) as {
        preferences: unknown;
      }
    ).preferences,
    hosts: [],
    viewerMode: "dark",
    ...keys,
    __internal__: { migrations: { version } },
  });

  it("cost a pre-conductor state file nothing, and carry the version", () => {
    const migrated = decodeStateBackup(fileAt("1.42.0", {}), "1.42-era");
    expect(migrated.conductor).toEqual(EMPTY_PERSISTED_CONDUCTOR);
    expect(migrated.works).toEqual({});

    conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
    const after = JSON.parse(readFileSync(store.path, "utf8")) as {
      __internal__: { migrations: { version: string } };
    };
    expect(after.__internal__.migrations.version).toBe(STATE_SCHEMA_VERSION);
  });

  it("carry a conversation written under the old name across to `conductor`", () => {
    const held = {
      sessionId: "sess-held",
      cwd: HOME,
      model: "claude-sonnet-4",
      rows: [row("a", 1, "one")],
      fleet: [FLEET_REF],
    };
    const migrated = decodeStateBackup(
      fileAt("1.44.0", { orchestrator: held }),
      "1.44-era",
    );
    expect(migrated.conductor).toEqual({
      sessionId: "sess-held",
      cwd: HOME,
      model: "claude-sonnet-4",
      fleet: [FLEET_REF],
      taught: false,
    });
    expect(migrated.works).toEqual({});
    expect((migrated as unknown as Record<string, unknown>).orchestrator).toBe(
      undefined,
    );
  });

  it("lose no terminal off a watch list a pre-release build stamped 1.46.0", () => {
    const held = {
      sessionId: "sess-held",
      cwd: HOME,
      model: null,
      rows: [row("a", 1, "one")],
      fleet: [FLEET_REF],
      watched: [
        { ref: FLEET_REF, name: "build", agent: "claude", told: "stopped" },
        {
          ref: OTHER_REF,
          name: "",
          agent: null,
          told: null,
          joined: "created-run",
          spoken: true,
          ran: true,
          root: { ref: FLEET_REF, name: "build" },
        },
      ],
    };
    const before = Date.now();
    const migrated = decodeStateBackup(
      fileAt("1.46.0", { conductor: held }),
      "1.46-pre-release",
    );
    const ids = Object.keys(migrated.works);
    expect(ids.length).toBe(1);
    const id = ids[0] ?? "";
    const work = migrated.works[id];
    if (work === undefined) throw new Error("the watch list lost its work");
    expect(work.title).toBe("build");
    const watched = migrated.members;
    expect(
      Object.entries(watched)
        .filter(([, one]) => one.work === id)
        .map(([ref]) => ref),
    ).toEqual([FLEET_REF, OTHER_REF]);
    expect([
      watched[FLEET_REF]?.watch.told,
      watched[OTHER_REF]?.watch.told,
    ]).toEqual(["stopped", null]);
    expect([
      watched[FLEET_REF]?.watch.joined,
      watched[OTHER_REF]?.watch.joined,
    ]).toEqual(["asked", "created-run"]);
    expect([
      watched[FLEET_REF]?.watch.spoken,
      watched[OTHER_REF]?.watch.spoken,
    ]).toEqual([false, true]);
    expect(Object.values(watched).every((one) => one.role === "other")).toBe(
      true,
    );
    expectStampedAtBoot(work.startedAt, before);
  });

  it("turn a MASTER-SHAPED 1.49.0 file into works without losing a terminal", () => {
    const held = {
      sessionId: "sess-held",
      cwd: HOME,
      model: null,
      rows: [row("a", 1, "one")],
      fleet: [FLEET_REF],
      watched: [
        {
          ref: FLEET_REF,
          name: "plan the cutover",
          agent: "claude",
          told: "stopped",
          joined: "created-run",
          spoken: true,
          ran: true,
          since: "2026-01-01T00:00:00.000Z",
          root: { ref: FLEET_REF, name: "plan the cutover" },
        },
        {
          ref: OTHER_REF,
          name: "the implementor",
          agent: "claude",
          told: null,
          joined: "created-run",
          spoken: true,
          ran: true,
          since: "2026-01-01T00:10:00.000Z",
          root: { ref: FLEET_REF, name: "plan the cutover" },
        },
        {
          ref: THIRD_REF,
          name: "a plain watch",
          agent: null,
          told: null,
          joined: "asked",
          spoken: false,
          ran: false,
          since: "2026-01-01T00:20:00.000Z",
          root: null,
        },
      ],
    };
    const migrated = decodeStateBackup(
      fileAt("1.49.0", { conductor: held }),
      "1.49-master",
    );
    expect(migrated.conductor).toEqual({
      sessionId: "sess-held",
      cwd: HOME,
      model: null,
      fleet: [FLEET_REF],
      taught: false,
    });
    const ids = Object.keys(migrated.works);
    expect(ids).toEqual([
      workIdOf({ kind: "watch", terminal: FLEET_REF }),
      workIdOf({ kind: "watch", terminal: THIRD_REF }),
    ]);
    const all = Object.values(migrated.works);
    const memberRefs = (id: string) =>
      Object.entries(migrated.members)
        .filter(([, one]) => one.work === id)
        .map(([ref]) => ref);
    expect(
      all.map((one, at) => [one.title, memberRefs(ids[at] ?? "")]),
    ).toEqual([
      ["plan the cutover", [FLEET_REF, OTHER_REF]],
      ["a plain watch", [THIRD_REF]],
    ]);
    expect(all.map((one) => one.startedAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:20:00.000Z",
    ]);
    expect(all.map((one) => modeOf(one))).toEqual([
      Option.some("watch"),
      Option.some("watch"),
    ]);
    expect(all.map((one) => hostOf(one))).toEqual(["local", "remote:box"]);
    expect(all[0]?.events[0]?.kind).toBe("carried-over");
  });

  it("re-point a remembered attachment at the corner its bytes moved to", () => {
    const before: PersistedTranscript = {
      rows: [
        {
          id: "u1",
          seq: 1,
          since: "2026-01-01T00:00:00.000Z",
          kind: "user",
          text: "look at this",
          mentions: [],
          attachments: [
            {
              id: "att-1",
              name: "shot.png",
              mimeType: "image/png",
              bytes: 4,
              path: "/state/orchestrator/attachments/att-1",
            },
          ],
        },
      ],
    };
    const after = repointConductorAttachments(
      before,
      "/state/orchestrator",
      "/state/conductor",
    );
    const row = after.rows[0];
    if (row?.kind !== "user") throw new Error("the user row went missing");
    expect(row.attachments[0]?.path).toBe("/state/conductor/attachments/att-1");
    expect(
      repointConductorAttachments(
        before,
        "/somewhere/else",
        "/state/conductor",
      ),
    ).toEqual(before);
  });
});

describe("a record that parses but is wrong", () => {
  it("REFUSES in plain words rather than restoring a transcript with holes in it", () => {
    transcriptStore.set({
      rows: [
        { id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" },
      ] as unknown as PersistedTranscript["rows"],
    });

    const host = hostOver().host;
    expect(() => host.watch(() => {})).toThrow(
      /kolu could not read the Conductor's saved transcript/,
    );
    expect(() => host.watch(() => {})).toThrow(transcriptPath);
    expect(host.state().unreadable?.key).toBe("transcript");
  });

  it("REFUSES a transcript file this build's ladder did not stamp", () => {
    // The transcript file rides kolu-server's ONE ladder: a future change to
    // the row shape is a rung in `state.ts` that rewrites this file and moves
    // `TRANSCRIPT_FILE_VERSION` to that rung's number. So a file carrying any
    // other stamp is a file no rung brought here — a rolled-back binary, a
    // hand-edit, a copy from another install — and reading it as if the rows
    // meant what this build thinks they mean is exactly the silent
    // data-mangling the ladder exists to prevent.
    mkdirSync(join(stateRoot, "conductor"), { recursive: true });
    writeFileSync(
      transcriptPath,
      JSON.stringify({ version: "9.99.0", rows: [] }),
    );
    expect(() => transcriptStore.get()).toThrow(transcriptPath);
    expect(() => transcriptStore.get()).toThrow("9.99.0");
  });

  it("reads a state root with no transcript file as a conversation that has said nothing", () => {
    // A fresh install, or one whose ladder wrote no rows. Missing is not
    // broken: `{rows: []}` is the truth, and the refusals above are for a
    // file that IS there and does not belong.
    rmSync(transcriptPath, { force: true });
    expect(transcriptStore.get()).toEqual({ rows: [] });
  });
});

describe("an attachment's bytes", () => {
  /** One pixel of PNG, as the browser CUTS it for the wire: base64 and no
   *  `data:` prefix, because this never rides a prompt frame — it arrives
   *  through `attach`, in pieces, ahead of the message that names it. */
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("land in the state root and NEVER in the record", async () => {
    mkdirSync(stateRoot, { recursive: true });
    const first = hostOver();
    const written = first.host.attach({
      id: "att-1",
      name: "pixel.png",
      mimeType: "image/png",
      data: PIXEL,
    });
    const chip = {
      id: "att-1",
      name: "pixel.png",
      mimeType: "image/png",
      bytes: written.bytes,
      path: written.path,
    };
    await first.host.prompt("look at this", [], [chip], false);
    // The harness mints the user row; this one stands in for it, carrying the
    // attachment the way a real one does — a name, a size and a path.
    first.push()({
      kind: "rows",
      upserts: [
        {
          id: "user-1",
          seq: 1,
          since: "2026-01-01T00:00:00.000Z",
          kind: "user",
          text: "look at this",
          attachments: [chip],
        },
      ],
      removes: [],
      appends: [],
    });
    await first.host.dispose();

    // The bytes are on disk, once, as bytes.
    expect(readFileSync(written.path).length).toBe(70);
    // ...and neither file carries the base64. A copy of it in the record
    // would be read back in full on every boot, and a single pasted
    // screenshot would be the largest thing in the state root.
    const raw = readFileSync(store.path, "utf8");
    const rows = readFileSync(transcriptPath, "utf8");
    for (const text of [raw, rows]) {
      expect(text).not.toContain("base64");
      expect(text).not.toContain("iVBORw0KGgo");
    }
    const transcript = JSON.parse(rows) as {
      rows: ReadonlyArray<{
        attachments?: ReadonlyArray<Record<string, unknown>>;
      }>;
    };
    const kept = transcript.rows[0]?.attachments?.[0];
    if (kept === undefined) throw new Error("the row lost its attachment");
    // A RESTORED ROW IS THE SAME SHAPE AS A LIVE ONE — that is what makes
    // "send again" on an old message read the same file the first send did.
    expect(kept).toEqual(chip);
    expect(kept.path).toBe(written.path);
  });
});

describe("a session nobody spoke into, across a restart", () => {
  /** THE REAL CHAIN this time — `startHarness` over the e2e suite's scripted
   *  adapter — because the defect lived between the two: the adapter answers
   *  `session/new` with an id and writes nothing until the first prompt (the
   *  pinned `claude-agent-acp` does exactly that, measured), so a stubbed
   *  harness could only ever agree with whatever this file assumed. The
   *  fixture keeps its prompted sessions in `sessions`, a directory that
   *  outlives each adapter process the way `~/.claude/projects/` does; `home`
   *  is a real directory because the adapter is really spawned in it. */
  const FIXTURE = join(
    import.meta.dirname,
    "../../../tests/support/acp-fixture-agent.ts",
  );
  let scratch = "";
  let sessions = "";
  let home = "";

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "kolu-conductor-resume-"));
    sessions = join(scratch, "sessions");
    home = join(scratch, "home");
    mkdirSync(sessions);
    mkdirSync(home);
    process.env[AGENT_ENV] = `${process.execPath} ${FIXTURE} ${sessions}`;
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const boot = async (): Promise<{
    host: ConductorHost;
    state: () => ConductorState;
    settled: () => Promise<void>;
    answered: () => Promise<void>;
  }> => {
    let state: ConductorState | null = null;
    let spoke = false;
    const host = startConductorHost({
      log: pino({ level: "silent" }),
      home,
      hostName: "test-box",
      fleetMcp: () => liveEndpoint,
      offer: () => {
        throw new Error(
          "no test here opens a work, so none reads kolu's offer",
        );
      },
      proveFleetMcp: proveFleetMcpEndpoint,
      publish: (next) => {
        state = next;
      },
      ...recordDeps(),
      storePath: () => store.path,
      stateRoot,
      spawn: startHarness,
    });
    host.watch((frame) => {
      if (frame.kind === "delta")
        spoke ||= frame.upserts.some((row) => row.kind === "agent");
    });
    const until = (holds: () => boolean, what: string) =>
      vi.waitFor(
        () => {
          if (!holds()) throw new Error(`${what}: ${JSON.stringify(state)}`);
        },
        { timeout: 20_000, interval: 25 },
      );
    const idle = () => state?.phase === "idle" && state.sessionId !== null;
    const settled = () => until(idle, "never idle with a session");
    await settled();
    return {
      host,
      settled,
      answered: () => until(() => spoke && idle(), "never answered"),
      state: () => {
        if (state === null) throw new Error("nothing was published");
        return state;
      },
    };
  };

  const onDisk = (): PersistedConductor & {
    readonly rows: ReadonlyArray<ConductorRow>;
  } => {
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    return {
      ...Schema.decodeUnknownSync(PersistedConductorSchema)(file.conductor),
      rows: Schema.decodeUnknownSync(PersistedTranscriptSchema)(
        transcriptStore.get(),
      ).rows,
    };
  };
  const says = (rows: ReadonlyArray<ConductorRow>, kind: string): string[] =>
    rows.flatMap((r) => (r.kind === kind && "text" in r ? [r.text] : []));

  it("comes back as a NEW session in silence, every time, with the transcript as it was", async () => {
    const first = await boot();
    await first.host.prompt("say hello", [], [], false);
    await first.answered();
    await first.host.newSession();
    await first.settled();
    const unprompted = first.state().sessionId;
    await first.host.dispose();
    const before = onDisk();
    expect(before.sessionId).toBe(unprompted);
    expect(says(before.rows, "divider")).toHaveLength(1);

    let last = before.sessionId;
    for (const _restart of [1, 2]) {
      const again = await boot();
      const opened = again.state().sessionId;
      await again.host.dispose();
      const after = onDisk();
      expect(after.rows).toEqual(before.rows);
      expect(after.sessionId).toBe(opened);
      expect(opened).not.toBe(last);
      last = opened;
    }
  }, 60_000);

  it("still says so when a conversation that HAD a turn cannot be loaded", async () => {
    const first = await boot();
    await first.host.prompt("say hello", [], [], false);
    await first.answered();
    const spoken = first.state().sessionId;
    await first.host.dispose();
    if (spoken === null) throw new Error("no session was open");

    const resumed = await boot();
    expect(resumed.state().sessionId).toBe(spoken);
    await resumed.host.dispose();
    expect(says(onDisk().rows, "notice")).toEqual([]);

    rmSync(join(sessions, spoken));
    const lost = await boot();
    expect(lost.state().sessionId).not.toBe(spoken);
    await lost.host.dispose();
    const after = onDisk();
    expect(says(after.rows, "divider")).toEqual(["new session"]);
    expect(says(after.rows, "notice")).toEqual([
      `the previous conversation could not be resumed, so this is a new one: \`session/load\` failed: Resource not found: ${spoken}`,
    ]);
  }, 60_000);
});

describe("the human's real store, one observation later", () => {
  const DEPLOYED = JSON.parse(
    readFileSync(
      new URL("../fixtures/deployed-1.52.0-all-ended.json", import.meta.url),
      "utf8",
    ),
  ) as { works: ReadonlyArray<unknown>; members: Record<string, unknown> };

  it("ends the human's work as Merged 181 on the first look after start-up", async () => {
    const folded = foldWorksByKey_1_53_0(DEPLOYED.works, DEPLOYED.members);
    worksStore.set(folded.works as unknown as PersistedWorks);
    membersStore.set(folded.members as unknown as PersistedMembers);
    dropKoluChoiceOptions_1_54_0(store);
    workArmsNotNulls_1_55_0(store);
    koluChoicesSayHowChosen_1_56_0(store);
    prFactsOnTheTimeline_1_57_0(store);
    prOpenedSaysDraft_1_61_0(store);
    const id = Object.keys(folded.works)[0] ?? "";

    const over = hostOver();
    try {
      const [[, work] = []] = over.host.works();
      expect(work?.state.kind).toBe("open");
      expect(over.host.memberRefs()).toEqual([]);
      expect(over.host.prWatches()).toHaveLength(1);
      expect(over.host.prWatches()[0]?.work).toBe(id);

      over.host.observedPr(id, {
        kind: "ok",
        value: {
          number: 181,
          title: "the Conductor runs the waterfall",
          url: "https://github.com/juspay/kolu/pull/181",
          state: "merged",
          checks: "pass",
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
          isDraft: false,
        },
      });

      await vi.waitFor(() => {
        const [[, ended] = []] = over.host.works();
        expect(ended?.state).toMatchObject({
          kind: "ended",
          outcome: { kind: "merged", pr: 181 },
        });
      });
      expect(over.host.prWatches()).toEqual([]);
    } finally {
      await over.host.dispose();
    }
  });
});
