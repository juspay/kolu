/**
 * THE RECORD — kolu-server's `conductor` and `works` keys, and the transcript
 * FILE beside them, through the real state root.
 *
 * Six things, and each is a different kind of promise:
 *  - a ROUND TRIP: a conversation written by one process comes back whole to
 *    the next one — its rows (now out of `config.json`, in
 *    `conductor/transcript.json`), the session it IS and the fleet it was
 *    working with;
 *  - the MIGRATION RUNGS: a state file written before the conductor moved
 *    here opens and answers the empty record, one written while the
 *    conversation was still called the orchestrator keeps its conversation
 *    under the new key, and a MASTER-SHAPED file (rows in the store, a watch
 *    list beside them) comes back as works with no terminal lost — all
 *    walked through the REAL ladder rather than a re-implementation of it;
 *  - WORKS SURVIVE: the pieces of work a restart finds are the ones it left,
 *    and their members are what the watch scopes itself by;
 *  - FAIL-LOUD: a parseable-but-wrong record refuses by name instead of being
 *    normalized into a transcript with holes in it, and a transcript file
 *    stamped with a version this build did not write is refused by name
 *    rather than read as a guess;
 *  - the BYTES of an attachment land beside the file, never inside it;
 *  - WHAT IS RESUMED: a session nobody spoke into comes back as a new one in
 *    silence, and one that had a turn and is lost still says so — through
 *    the real harness and a scripted adapter whose sessions are as lazy as
 *    the pinned one's.
 *
 * The store is kolu-server's own module singleton, under the test harness's
 * ephemeral `KOLU_STATE_DIR` (`test:daemon` sets it) — the same thing
 * `hostPersistence.test.ts` does with the `hosts` key, and for the same
 * reason: what is under test is the FILE, so a parallel `Conf` built here
 * would prove something about a store nothing ships.
 */

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
import { Schema } from "effect";
import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorFrame,
  type ConductorRow,
  type ConductorState,
} from "kolu-common/conductor";
import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FleetMcpEndpoint as LiveFleetMcpEndpoint,
  proveFleetMcpEndpoint,
  startFleetMcpEndpoint,
} from "../fleet/mcpEndpoint.ts";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  PersistedConductorSchema,
  PersistedTranscriptSchema,
  repointConductorAttachments,
  startConductorHost,
  type ConductorHost,
  type PersistedConductor,
  type PersistedTranscript,
  type PersistedMembers,
  type PersistedWorks,
} from "kolu-conductor";
import { hostOf, modeOf } from "kolu-work";
import {
  TRANSCRIPT_FILE_VERSION,
  decodeStateBackup,
  store,
  worksFromWatched_1_50_0,
} from "../state.ts";
import { transcriptFilePath, transcriptFileStore } from "./transcriptFile.ts";

const HOME = "/home/tester";

/** One terminal this conversation was working with — a FLEET REF, because one
 *  conversation reaches every host and the half before the slash is what says
 *  which. The record keeps it verbatim. */
const FLEET_REF = "local/11111111-1111-4111-8111-111111111111";

/** ... and one on another host, for the watch list — which spans the fleet,
 *  so a record that kept bare ids would name two terminals on a two-host
 *  one. */
const OTHER_REF = "remote:prod/22222222-2222-4222-8222-222222222222";

/** ... and a third, on a third machine, for the carried-over work that was
 *  nobody's group — a plain watch the human asked for. */
const THIRD_REF = "remote:box/33333333-3333-4333-8333-333333333333";

/** The version this file's ladder pin names. A literal, deliberately: a pin
 *  read off the constant it is pinning asserts nothing. The conductor arrived
 *  at 1.44.0 (master took 1.43.0 for `hostOrder` — see the note on the ladder
 * entry in `state.ts`), 1.45.0 is the rename of its key, 1.49.0 is the watch
 * list joining the record (1.46.0, 1.47.0 and 1.48.0 are the numbers its
 * earlier builds stamped — one rung walks every one of those shapes through),
 * and 1.50.0 is the rung that turned the watch list into works and moved the
 * transcript into a file of its own. */
const STATE_SCHEMA_VERSION = "1.50.0";

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

/** The `since` the watch-list rung writes onto an entry that never recorded
 *  one: the time the rung RAN, which is what the rung's own comment says it
 *  chose. Asserted as a window between the instant the test handed the file
 *  over and now — pinning a literal would be pinning this test's clock, and
 *  reading it off the record would assert nothing at all. */
function expectStampedAtBoot(stamped: unknown, after: number): void {
  expect(typeof stamped).toBe("string");
  const at = Date.parse(String(stamped));
  expect(Number.isNaN(at)).toBe(false);
  expect(at).toBeGreaterThanOrEqual(after);
  expect(at).toBeLessThanOrEqual(Date.now());
}

/** kolu-server's state root — where `config.json` is, and where the
 *  conductor's attachments and its transcript file go. Taken off the store
 *  rather than off the env for the reason `live.ts` takes it there: two
 *  readings of one root. */
const stateRoot = dirname(store.path);
const conductorStore = confStore<PersistedConductor>(store, "conductor");
const worksStore = confStore<PersistedWorks>(store, "works");
/** ... and the `members` key beside it: what kolu knows about each member
 *  TERMINAL, which is the half of a restart that decides whether it rings. */
const membersStore = confStore<PersistedMembers>(store, "members");
/** The transcript, through the SAME store `live.ts` hands the conversation —
 *  so what this file proves is the file the server writes, not a second
 *  reader of it. */
const transcriptStore = transcriptFileStore(stateRoot, TRANSCRIPT_FILE_VERSION);
const transcriptPath = join(stateRoot, "conductor", "transcript.json");

/** The storage half of `ConductorDeps`, exactly as `live.ts` composes it —
 *  spelled once so no test here can accidentally prove something about a
 *  record the server does not keep. The work FILES are stubbed: copying a
 *  worktree's `.waterfall/` is the padi port's story (`workFiles.ts`), not
 *  this file's. */
const recordDeps = () => ({
  store: conductorStore,
  works: worksStore,
  members: membersStore,
  transcript: transcriptStore,
  transcriptPath: () => transcriptFilePath(stateRoot),
  publishWork: () => {},
  publishReading: () => {},
  membersMoved: () => {},
  workFiles: {
    list: async () => [],
    keep: async () => [],
    sweep: async () => {},
  },
});

/** AN ENDPOINT THAT ANSWERS, and the REAL one: the host proves the fleet MCP
 *  face before it hands the URL to an agent, and the proof is a real
 *  `initialize`. A listener imitating the transport would have to imitate a
 *  session too, and an imitation that drifted would make this file pass over a
 *  door that could no longer serve anybody. */
let liveEndpoint: LiveFleetMcpEndpoint;
const SAVED_AGENT = process.env[AGENT_ENV];

beforeEach(async () => {
  conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
  worksStore.set([]);
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
  worksStore.set([]);
  membersStore.set({});
  rmSync(join(stateRoot, "conductor"), { recursive: true, force: true });
  await liveEndpoint.close();
});

/** A host over the REAL conf store, with the conversation itself stubbed — the
 *  subject here is the file, not the protocol. */
function hostOver(): {
  host: ConductorHost;
  push: () => (change: HarnessChange) => void;
  resumedSeq: () => number | undefined;
  /** What the NEXT conversation is asked to replay, and the terminals it is
   *  told this one was working with — the two halves of a resume that only the
   *  file can carry across a restart. */
  resume: () => string | null | undefined;
  fleet: () => ReadonlyArray<string> | undefined;
  /** Every wake this conversation was sent — what the watch list's `told` is
   *  written off, and the only way to know the flush has happened before the
   *  record is read. */
  wakes: () => number;
} {
  let onChange: ((change: HarnessChange) => void) | undefined;
  let options: HarnessOptions | undefined;
  let wakes = 0;
  const host = startConductorHost({
    log,
    home: HOME,
    hostName: "test-box",
    fleetMcp: () => liveEndpoint,
    proveFleetMcp: proveFleetMcpEndpoint,
    publish: () => {},
    ...recordDeps(),
    storePath: () => store.path,
    stateRoot,
    spawn: async (opts) => {
      options = opts;
      onChange = opts.onChange;
      const harness: Harness = {
        state: () => ({ ...DEFAULT_CONDUCTOR_STATE, phase: "idle" }),
        rows: () => [],
        alive: () => true,
        prompt: async () => ({ rowId: "sent" }),
        wake: async () => {
          wakes += 1;
          return { rowId: `woke:${wakes}` };
        },
        cancel: async () => {},
        answer: async () => true,
        signIn: async () => "signed-in",
        signInInput: async () => {},
        signInCancel: async () => false,
        setOption: async () => {},
        newSession: async () => {},
        // The wipe reports the removes itself now (the harness owns the rows);
        // nothing in this file asks it to.
        clearSession: async () => {},
        stop: async () => {
          // A real `stop()` lets the session go and publishes one final state
          // saying so. Modelled because this file is where it bites: the flush
          // that follows writes the bytes the next boot reads.
          opts.onChange({
            kind: "state",
            state: {
              ...DEFAULT_CONDUCTOR_STATE,
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
    resume: () => options?.resume,
    fleet: () => options?.fleet,
    wakes: () => wakes,
  };
}

describe("the conversation survives a restart", () => {
  it("round-trips the transcript through its own file, and the session and fleet through `config.json`", async () => {
    const first = hostOver();
    await first.host.prompt("hello", [], [], false);
    // What the open publishes: the conversation this IS, and the terminals it
    // is working with. Both are the agent's to forget and ours to keep.
    first.push()({
      kind: "state",
      state: {
        ...DEFAULT_CONDUCTOR_STATE,
        phase: "idle",
        sessionId: "sess-live",
        fleet: [FLEET_REF],
      },
    });
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
    // The flush the shutdown runs — everything the throttle still owes.
    await first.host.dispose();

    // THE ROWS ARE NOT IN `config.json` ANY MORE. That is the point of the
    // 1.50.0 rung: conf rewrites the whole file on every `set`, and the
    // transcript was most of its bytes.
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    expect(Object.keys(file.conductor as object)).not.toContain("rows");
    // The BYTES of the transcript, read back the way the next boot reads
    // them — through the file store, so "it round-trips" means "it
    // round-trips as a value this code would accept", not "the JSON looked
    // about right". The stamp is the ladder's, and a reader that found
    // another one would refuse rather than guess.
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
    // The teardown's own last breath says the session is gone — it is a stop,
    // not a conversation ending — and a record that believed it would hand the
    // next boot a transcript with nothing to resume it into.
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
    // …and the count does not double: the restored rows are the whole of it,
    // and the fence tells the resumed conversation to count from past them.
    await second.host.prompt("still here?", [], [], false);
    expect(second.resumedSeq()).toBe(2);
    // The conversation the next boot comes back INTO, and the terminals it
    // comes back knowing about. Without both it restores a transcript and then
    // opens a stranger underneath it.
    expect(second.resume()).toBe("sess-live");
    expect(second.fleet()).toEqual([FLEET_REF]);
    await second.host.dispose();
  });

  it("comes back to the WORKS it left, with their members and their decisions", async () => {
    // The record a previous kolu-server wrote: one work in progress with two
    // member terminals on two machines, written here through the ladder's own
    // carry-over shape so this test cannot drift from what an upgraded file
    // actually holds.
    const carried = worksFromWatched_1_50_0(
      [
        {
          ref: FLEET_REF,
          name: "fix the parser",
          agent: "claude-code",
          told: "stopped",
          joined: "created-run",
          spoken: true,
          ran: true,
          since: "2026-01-01T00:00:00.000Z",
          root: { ref: FLEET_REF, name: "fix the parser" },
        },
        {
          ref: OTHER_REF,
          name: "the implementor",
          agent: null,
          told: null,
          joined: "created",
          spoken: false,
          ran: false,
          since: "2026-01-01T00:05:00.000Z",
          root: { ref: FLEET_REF, name: "fix the parser" },
        },
      ],
      () => "work-restored",
    );
    worksStore.set(carried.works as unknown as PersistedWorks);
    membersStore.set(carried.members as unknown as PersistedMembers);

    const host = hostOver().host;
    const works = host.works();
    expect(works.map((one) => one.id)).toEqual(["work-restored"]);
    const work = works[0];
    if (work === undefined) throw new Error("the work was not restored");
    expect(work.title).toBe("fix the parser");
    // THE WATCH'S SCOPE IS MEMBERSHIP: both terminals come back watched, on
    // the hosts their refs name, without anything having to re-derive a
    // grouping from the machines (which may not even be reachable yet).
    expect(host.memberRefs()).toEqual([FLEET_REF, OTHER_REF]);
    // ...and the setup a reader shows is read back off the decisions, not off
    // a second copy of it.
    expect(modeOf(work)).toBe("watch");
    expect(hostOf(work)).toBe("local");
    // THE HELD NEWS IS MEMORY ONLY: a restart re-reads the world rather than
    // replaying a queue about one that has moved on, so there is no such key
    // on disk to replay from.
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    expect(Object.keys(file.conductor as object)).not.toContain("held");
    expect(host.state().held).toEqual([]);
    await host.dispose();
  });

  it("a backup restore replaces the works with the snapshot's, and the host reloads them", async () => {
    // What this process was running when the person pressed restore.
    const today = worksFromWatched_1_50_0(
      [
        {
          ref: FLEET_REF,
          name: "the work of today",
          agent: null,
          told: null,
          joined: "created",
          spoken: false,
          ran: false,
          since: "2026-02-01T00:00:00.000Z",
          root: null,
        },
      ],
      () => "work-today",
    );
    worksStore.set(today.works as unknown as PersistedWorks);
    membersStore.set(today.members as unknown as PersistedMembers);
    const host = hostOver().host;
    expect(host.works().map((one) => one.id)).toEqual(["work-today"]);

    // ...and what the snapshot holds. `restoreWorks` is what `stateBackups.ts`
    // hands the decoded `works` key to: the live host is that key's one
    // writer, so a restore that wrote it underneath would be overwritten by
    // the host's own save within the second.
    const snapshot = worksFromWatched_1_50_0(
      [
        {
          ref: OTHER_REF,
          name: "the work of last week",
          agent: "claude-code",
          told: null,
          joined: "asked",
          spoken: true,
          ran: false,
          since: "2026-01-20T00:00:00.000Z",
          root: null,
        },
      ],
      () => "work-from-backup",
    );
    host.restoreWorks(
      snapshot.works as unknown as PersistedWorks,
      snapshot.members as unknown as PersistedMembers,
    );

    // The host's works ARE the snapshot's — not merged with, not beside.
    expect(host.works().map((one) => one.id)).toEqual(["work-from-backup"]);
    expect(host.works().map((one) => one.title)).toEqual([
      "the work of last week",
    ]);
    // The watch follows membership, so it re-scopes onto the restored members
    // and drops the terminal no restored work names.
    expect(host.memberRefs()).toEqual([OTHER_REF]);
    // ...and the key is written NOW, so a crash a moment later comes back to
    // what the person restored rather than to what they replaced.
    expect(worksStore.get().map((one) => one.id)).toEqual(["work-from-backup"]);
    await host.dispose();
  });
});

describe("the conductor's rungs", () => {
  /** A state file at `version`, carrying `keys` on top of a real one — every
   *  fixture below is this build's own `preferences` plus the key under
   *  test, walked through the REAL ladder by `decodeStateBackup`. */
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
    // A 1.42-era file: everything kolu-server persisted before the conductor
    // moved here, and no conversation key at all. Walked through the REAL
    // ladder (`decodeStateBackup` builds a scratch store with the shipped
    // `CONF_MIGRATIONS`), so this proves the rung rather than a copy of it.
    const migrated = decodeStateBackup(fileAt("1.42.0", {}), "1.42-era");
    // The rung SEEDS; it does not import. padi's own 1.5.0 rung deletes the
    // matching key on each host, and nothing is carried across — that record
    // was written by another process against another `$HOME`.
    expect(migrated.conductor).toEqual(EMPTY_PERSISTED_CONDUCTOR);
    // ...and a file that never watched anything has no work to show for it.
    expect(migrated.works).toEqual([]);

    // …and the live store carries today's version, so a file this build wrote
    // says which ladder position it is at.
    conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
    const after = JSON.parse(readFileSync(store.path, "utf8")) as {
      __internal__: { migrations: { version: string } };
    };
    expect(after.__internal__.migrations.version).toBe(STATE_SCHEMA_VERSION);
  });

  it("carry a conversation written under the old name across to `conductor`", () => {
    // A development build's file from before the rename: the conversation is
    // REAL — a session a person can still resume, the rows their chat reopens
    // with — and it sits under the key this feature used to be called. The
    // rename must MOVE it; a reseed would be a rename that ate the chat.
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
    // The conversation itself, carried over whole — minus the rows, which the
    // 1.50.0 rung moved into the transcript file on the way here (that file's
    // own bytes are proven in `stateMigration.test.ts`, where the scratch
    // store outlives the walk).
    expect(migrated.conductor).toEqual({
      sessionId: "sess-held",
      cwd: HOME,
      model: "claude-sonnet-4",
      fleet: [FLEET_REF],
    });
    // A file that never had a watch list has no works, and the key is THERE:
    // the shape is complete however old the file was.
    expect(migrated.works).toEqual([]);
    // And the old key is gone — one conversation, one record, not a stale
    // copy left behind for the next reader to find.
    expect((migrated as unknown as Record<string, unknown>).orchestrator).toBe(
      undefined,
    );
  });

  it("lose no terminal off a watch list a pre-release build stamped 1.46.0", () => {
    // A file the watch list's own earlier builds wrote: its first entry
    // predates `joined`/`spoken`/`ran`, `root` and `since`. TWO rungs run
    // over it — 1.49.0 completes each entry, 1.50.0 turns them into works —
    // and the promise across both is that no watched terminal is lost, that a
    // fact the file DID record is kept, and that one it never had is the
    // reading claiming nothing it did not see.
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
    // ONE work — the second entry's `root` names the first — holding both
    // terminals as members, with each entry's own wake bookkeeping carried
    // onto its member verbatim.
    expect(migrated.works.length).toBe(1);
    const work = migrated.works[0];
    if (work === undefined) throw new Error("the watch list lost its work");
    expect(work.title).toBe("build");
    expect(work.members.map((one) => one.terminal)).toEqual([
      FLEET_REF,
      OTHER_REF,
    ]);
    // ... and what kolu KNEW about each of those terminals rides the
    // `members` key, keyed by the same ref the member names.
    const watched = migrated.members;
    expect([watched[FLEET_REF]?.told, watched[OTHER_REF]?.told]).toEqual([
      "stopped",
      null,
    ]);
    expect([watched[FLEET_REF]?.joined, watched[OTHER_REF]?.joined]).toEqual([
      "asked",
      "created-run",
    ]);
    expect([watched[FLEET_REF]?.spoken, watched[OTHER_REF]?.spoken]).toEqual([
      false,
      true,
    ]);
    // Every member's role is `other`: roles arrived with works, and a watch
    // is exactly "keep an eye on this".
    expect(work.members.every((one) => one.role === "other")).toBe(true);
    // The start is the 1.49.0 rung's own stamp — the earliest instant kolu
    // can honestly vouch for — not the epoch and not an invented past.
    expectStampedAtBoot(work.startedAt, before);
  });

  it("turn a MASTER-SHAPED 1.49.0 file into works without losing a terminal", () => {
    // THE NUMBER A RUNNING INSTALL SITS ON, with everything 1.49.0
    // guarantees: rows in the store and a complete watch list beside them —
    // two terminals grouped as one piece of work, and a third on its own.
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
    // The rows left the record...
    expect(migrated.conductor).toEqual({
      sessionId: "sess-held",
      cwd: HOME,
      model: null,
      fleet: [FLEET_REF],
    });
    // ...and the watch list left it too, as two works: the waterfall its two
    // terminals were drawn as, and the plain watch on its own.
    expect(
      migrated.works.map((one) => [
        one.title,
        one.members.map((member) => member.terminal),
      ]),
    ).toEqual([
      ["plan the cutover", [FLEET_REF, OTHER_REF]],
      ["a plain watch", [THIRD_REF]],
    ]);
    // NOT A TERMINAL LOST, and each age is the one the person was already
    // being shown — the earliest join in its group, never this boot.
    expect(migrated.works.map((one) => one.startedAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:20:00.000Z",
    ]);
    // The mode and the host are DECISIONS now, so a card reads them the same
    // way it reads an answer a person gave.
    expect(migrated.works.map((one) => modeOf(one))).toEqual([
      "watch",
      "watch",
    ]);
    expect(migrated.works.map((one) => hostOf(one))).toEqual([
      "local",
      "remote:box",
    ]);
    // ...and the timeline opens with the carry-over rather than with nothing.
    expect(migrated.works[0]?.events[0]?.kind).toBe("carried-over");
  });

  it("re-point a remembered attachment at the corner its bytes moved to", () => {
    // The ladder renames `<state>/orchestrator` to `<state>/conductor` when
    // it renames the key, and an attachment's `path` is ABSOLUTE — the agent
    // is handed it and the harness reads the file off it. So the rows have to
    // be re-pointed or every chip in a restored transcript names a file at an
    // address that no longer exists.
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
    // A path this server's attachment writer did not write is left ALONE —
    // re-building it would be inventing a location for somebody else's file.
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
  it("REFUSES by name rather than restoring a transcript with holes in it", () => {
    // A row with no `kind` — the shape a hand-edit, a half-written file or a
    // rolled-back binary leaves behind. The transcript store casts, so
    // without the re-validation this reaches the panel as a row nothing can
    // draw. The refusal names the FILE the rows are in, which is the one
    // thing a person holding a corrupt state root has to act on.
    transcriptStore.set({
      rows: [
        { id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" },
      ] as unknown as PersistedTranscript["rows"],
    });

    const host = hostOver().host;
    expect(() => host.watch(() => {})).toThrow(/does not match schema/);
    expect(() => host.watch(() => {})).toThrow(transcriptPath);
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

  /** One kolu-server's conversation, up — the first reader brings it up —
   *  with the state it last published. */
  const boot = async (): Promise<{
    host: ConductorHost;
    state: () => ConductorState;
    settled: () => Promise<void>;
    /** The agent has answered, and its turn is over. */
    answered: () => Promise<void>;
  }> => {
    let state: ConductorState | null = null;
    let spoke = false;
    const host = startConductorHost({
      log: pino({ level: "silent" }),
      home,
      hostName: "test-box",
      fleetMcp: () => liveEndpoint,
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

  /** The record AND the rows, each read from the file it lives in — the
   *  conversation is one thing to a reader and two files on disk. */
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
    // A conversation that HAD a turn, then a fresh session over it that
    // nobody has typed into yet — the state a person leaves the panel in
    // after starting a new session and walking away.
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

    // Two restarts, because the defect repeated: each restart's replacement
    // session was itself one nobody had spoken into.
    let last = before.sessionId;
    for (const _restart of [1, 2]) {
      const again = await boot();
      const opened = again.state().sessionId;
      await again.host.dispose();
      const after = onDisk();
      expect(after.rows).toEqual(before.rows);
      // A conversation is open — a new one, under the id the agent gave it.
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

    // It loads while the agent still has it: same id, nothing said.
    const resumed = await boot();
    expect(resumed.state().sessionId).toBe(spoken);
    await resumed.host.dispose();
    expect(says(onDisk().rows, "notice")).toEqual([]);

    // ... and when the agent has lost it, the loss is on screen.
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
