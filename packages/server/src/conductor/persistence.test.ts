/**
 * THE RECORD — kolu-server's `conductor` key, through the real `config.json`.
 *
 * Four things, and each is a different kind of promise:
 *  - a ROUND TRIP: a conversation written by one process comes back whole to
 *    the next one — its rows, the session it IS and the fleet it was working
 *    with — through the same `Conf` the host map and the preferences ride;
 *  - the MIGRATION RUNGS: a state file written before the conductor moved
 *    here opens and answers the empty record, and one written while the
 *    conversation was still called the orchestrator keeps its conversation
 *    under the new key — both walked through the REAL ladder rather than a
 *    re-implementation of it;
 *  - FAIL-LOUD: a parseable-but-wrong record refuses by name instead of being
 *    normalized into a transcript with holes in it;
 *  - the BYTES of an attachment land beside the file, never inside it.
 *
 * The store is kolu-server's own module singleton, under the test harness's
 * ephemeral `KOLU_STATE_DIR` (`test:daemon` sets it) — the same thing
 * `hostPersistence.test.ts` does with the `hosts` key, and for the same
 * reason: what is under test is the FILE, so a parallel `Conf` built here
 * would prove something about a store nothing ships.
 */

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_ENV } from "@kolu/acp/engine";
import type { Harness, HarnessChange, HarnessOptions } from "@kolu/acp-harness";
import { confStore } from "@kolu/surface/server";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { Schema } from "effect";
import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorFrame,
  type ConductorRow,
} from "kolu-common/conductor";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FleetMcpEndpoint as LiveFleetMcpEndpoint,
  proveFleetMcpEndpoint,
  startFleetMcpEndpoint,
} from "../fleet/mcpEndpoint.ts";
import { decodeStateBackup, store } from "../state.ts";
import {
  EMPTY_PERSISTED_CONDUCTOR,
  PersistedConductorSchema,
  repointConductorAttachments,
  startConductorHost,
  type ConductorHost,
  type PersistedConductor,
} from "kolu-conductor";

const HOME = "/home/tester";

/** One terminal this conversation was working with — a FLEET REF, because one
 *  conversation reaches every host and the half before the slash is what says
 *  which. The record keeps it verbatim. */
const FLEET_REF = "local/11111111-1111-4111-8111-111111111111";

/** ... and one on another host, for the watch list — which spans the fleet,
 *  so a record that kept bare ids would name two terminals on a two-host
 *  one. */
const OTHER_REF = "remote:prod/22222222-2222-4222-8222-222222222222";

/** The version this file's ladder pin names. A literal, deliberately: a pin
 *  read off the constant it is pinning asserts nothing. The conductor arrived
 *  at 1.44.0 (master took 1.43.0 for `hostOrder` — see the note on the ladder
 * entry in `state.ts`), 1.45.0 is the rename of its key, and 1.49.0 is the
 * watch list joining the record (1.46.0, 1.47.0 and 1.48.0 are the numbers
 * its earlier builds stamped — one rung walks every one of those shapes
 * through, see that rung). */
const STATE_SCHEMA_VERSION = "1.49.0";

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
 *  conductor's attachments go. Taken off the store rather than off the env
 *  for the reason `live.ts` takes it there: two readings of one root. */
const stateRoot = dirname(store.path);
const conductorStore = confStore<PersistedConductor>(store, "conductor");

/** AN ENDPOINT THAT ANSWERS, and the REAL one: the host proves the fleet MCP
 *  face before it hands the URL to an agent, and the proof is a real
 *  `initialize`. A listener imitating the transport would have to imitate a
 *  session too, and an imitation that drifted would make this file pass over a
 *  door that could no longer serve anybody. */
let liveEndpoint: LiveFleetMcpEndpoint;
const SAVED_AGENT = process.env[AGENT_ENV];

beforeEach(async () => {
  conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
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
    store: conductorStore,
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
  it("round-trips the transcript, the session and the fleet through kolu-server's own `config.json`", async () => {
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

    // The BYTES, read back the way the next boot reads them: through the
    // record's own schema, so "it round-trips" means "it round-trips as a
    // value this code would accept", not "the JSON looked about right".
    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    const onDisk = Schema.decodeUnknownSync(PersistedConductorSchema)(
      file.conductor,
    );
    expect(onDisk.rows).toEqual([
      row("a", 1, "one"),
      row("b", 2, "two and a half"),
    ]);
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

  it("keeps the WATCH LIST — with what each terminal was told — and never the held news", async () => {
    const watchedFrom = Date.now();
    const first = hostOver();
    first.host.watchTerminal(FLEET_REF, "created");
    first.host.watchTerminal(OTHER_REF, "created");
    // The Conductor briefed the first one, so its next idle is a STOP rather
    // than the `ready` an agent nobody has spoken to rings.
    first.host.saidTo(FLEET_REF);
    // One of them rang and the conversation was idle, so it was told at once.
    first.host.observe([
      {
        ref: FLEET_REF,
        host: "local",
        terminalId: FLEET_REF.slice(FLEET_REF.indexOf("/") + 1),
        hostName: "box",
        name: "fix the parser",
        agent: "claude-code",
        level: "stopped",
        foregroundShell: false,
        root: { ref: FLEET_REF, name: "fix the parser" },
      },
    ]);
    await vi.waitFor(() => {
      expect(first.wakes()).toBe(1);
    });
    await first.host.dispose();

    const file: unknown = JSON.parse(readFileSync(store.path, "utf8"));
    if (typeof file !== "object" || file === null || !("conductor" in file))
      throw new Error("kolu-server's state kept no conductor record");
    const onDisk = Schema.decodeUnknownSync(PersistedConductorSchema)(
      file.conductor,
    );
    // Per entry, the facts a restart cannot re-derive — and `told` is the one
    // that makes the restart quiet. The runtime halves of a live entry (the
    // last reading, and whether the next one baselines) are NOT here: a
    // restart re-reads the world. `since` is each terminal's own join time,
    // so it is checked as a window rather than pinned.
    expect(onDisk.watched.map(({ since: _joined, ...rest }) => rest)).toEqual([
      {
        ref: FLEET_REF,
        name: "fix the parser",
        agent: "claude-code",
        told: "stopped",
        joined: "created",
        spoken: true,
        ran: true,
        root: { ref: FLEET_REF, name: "fix the parser" },
      },
      {
        ref: OTHER_REF,
        name: "",
        agent: null,
        told: null,
        joined: "created",
        spoken: false,
        ran: false,
        // Never read: the watcher says nothing about a terminal on a host it
        // has not reached, so which piece of work it is part of is not known
        // yet — and a record that guessed would be the restart inventing a
        // group.
        root: null,
      },
    ]);
    for (const entry of onDisk.watched)
      expectStampedAtBoot(entry.since, watchedFrom);

    // THE HELD NEWS IS MEMORY ONLY: a restart re-reads the world rather than
    // replaying a queue about one that has moved on, so there is no such key
    // on disk to replay from.
    expect(Object.keys(file.conductor as object)).not.toContain("held");

    // ... and the next boot comes back watching exactly those two, with
    // nothing waiting.
    const second = hostOver();
    expect(second.host.watched()).toEqual([FLEET_REF, OTHER_REF]);
    expect(second.host.state().held).toEqual([]);
    await second.host.dispose();
  });
});

describe("the conductor's rungs", () => {
  it("cost a pre-conductor state file nothing, and carry the version", () => {
    // A 1.42-era file: everything kolu-server persisted before the conductor
    // moved here, and no conversation key at all. Walked through the REAL
    // ladder (`decodeStateBackup` builds a scratch store with the shipped
    // `CONF_MIGRATIONS`), so this proves the rung rather than a copy of it.
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      __internal__: { migrations: { version: "1.42.0" } },
    };
    const migrated = decodeStateBackup(legacy, "1.42-era");
    // The rung SEEDS; it does not import. padi's own 1.5.0 rung deletes the
    // matching key on each host, and nothing is carried across — that record
    // was written by another process against another `$HOME`.
    expect(migrated.conductor).toEqual(EMPTY_PERSISTED_CONDUCTOR);

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
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      orchestrator: held,
      __internal__: { migrations: { version: "1.44.0" } },
    };
    const migrated = decodeStateBackup(legacy, "1.44-era");
    // The conversation itself, carried over whole — plus the empty watch list
    // the rung ABOVE this one seeds, because a 1.44-era file walks the rest
    // of the ladder on its way here.
    expect(migrated.conductor).toEqual({ ...held, watched: [] });
    // And the old key is gone — one conversation, one record, not a stale
    // copy left behind for the next reader to find.
    expect((migrated as unknown as Record<string, unknown>).orchestrator).toBe(
      undefined,
    );
  });

  it("seed a `watched` key onto a conversation written before the watch existed", () => {
    // A 1.45-era file: a real conversation — a session a person can resume,
    // the rows their chat reopens with, the terminals it was working with —
    // and no watch list, because there was none to write. The record's schema
    // would refuse that file on read, so the rung owes it the key.
    const held = {
      sessionId: "sess-held",
      cwd: HOME,
      model: "claude-sonnet-4",
      rows: [row("a", 1, "one")],
      fleet: [FLEET_REF],
    };
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      conductor: held,
      __internal__: { migrations: { version: "1.45.0" } },
    };
    const migrated = decodeStateBackup(legacy, "1.45-era");
    // EMPTY is the truth about a conversation that has never watched
    // anything, and every other fact carries across untouched: this rung is
    // an addition, not a reshape.
    expect(migrated.conductor).toEqual({ ...held, watched: [] });
  });

  it("complete each entry of a watch list a pre-release build stamped 1.46.0", () => {
    // A file the watch list's own earlier builds wrote: it HAS a `watched`
    // key, at the version number those builds bumped to, but its entries
    // predate `joined`/`spoken`/`ran` and `root`. The schema carries no
    // defaults for them, so without the rung this file is refused on read —
    // and with it, each entry gains the reading that claims nothing it did
    // not see, while a fact the file DID record is kept, never overwritten.
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
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      conductor: held,
      __internal__: { migrations: { version: "1.46.0" } },
    };
    const before = Date.now();
    const migrated = decodeStateBackup(legacy, "1.46-pre-release");
    // The `since` the rung stamps is read off its own clock, so it is checked
    // as a WINDOW below rather than pinned; everything else is exact.
    expect(
      migrated.conductor.watched.map(({ since: _stamped, ...rest }) => rest),
    ).toEqual([
      {
        ref: FLEET_REF,
        name: "build",
        agent: "claude",
        told: "stopped",
        joined: "asked",
        spoken: false,
        ran: false,
        root: null,
      },
      held.watched[1],
    ]);
    for (const entry of migrated.conductor.watched)
      expectStampedAtBoot(entry.since, before);
    expect(migrated.conductor.rows).toEqual(held.rows);
  });

  it("complete a watch list a 1.47.0 build wrote with no piece of work on it", () => {
    // The rung's OTHER pre-release number: these entries are complete in
    // every way the watch list knew about at 1.47.0, and carry no `root` —
    // the grouping arrived after them. A restart owes them `null` (nothing
    // has read their hosts yet), and the first reading after the boot says
    // which piece of work each is part of.
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
        },
      ],
    };
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      conductor: held,
      __internal__: { migrations: { version: "1.47.0" } },
    };
    const before = Date.now();
    const migrated = decodeStateBackup(legacy, "1.47-pre-release");
    expect(
      migrated.conductor.watched.map(({ since: _stamped, ...rest }) => rest),
    ).toEqual([{ ...held.watched[0], root: null }]);
    expectStampedAtBoot(migrated.conductor.watched[0]?.since, before);
    // ... and nothing else moved: the rung is an addition.
    expect(migrated.conductor.rows).toEqual(held.rows);
  });

  it("give a watch list a 1.48.0 build wrote the start time it never recorded", () => {
    // THE NUMBER A RUNNING INSTALL SITS ON. These entries are complete in
    // every way the watch list knew about at 1.48.0 — they even carry their
    // piece of work — and they have no `since`, because nothing was counting
    // a duration then. The rung is numbered above that version precisely so
    // it runs for this file; were it still 1.48.0, conf would skip it and the
    // conductor's schema would refuse the record by name on the next boot.
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
          root: { ref: FLEET_REF, name: "plan the cutover" },
        },
      ],
    };
    const legacy: unknown = {
      preferences: (
        JSON.parse(readFileSync(store.path, "utf8")) as {
          preferences: unknown;
        }
      ).preferences,
      hosts: [],
      viewerMode: "dark",
      conductor: held,
      __internal__: { migrations: { version: "1.48.0" } },
    };
    const before = Date.now();
    const migrated = decodeStateBackup(legacy, "1.48-era");
    // Every fact the file recorded is kept — the grouping included — and the
    // one it never had is the boot's own time.
    expect(
      migrated.conductor.watched.map(({ since: _stamped, ...rest }) => rest),
    ).toEqual(held.watched);
    for (const entry of migrated.conductor.watched)
      expectStampedAtBoot(entry.since, before);
    // ONE STAMP FOR THE WHOLE FILE: two terminals watched as one piece of
    // work must not come back as two ages a millisecond apart.
    expect(migrated.conductor.watched[1]?.since).toBe(
      migrated.conductor.watched[0]?.since,
    );
    expect(migrated.conductor.rows).toEqual(held.rows);
  });

  it("re-point a remembered attachment at the corner its bytes moved to", () => {
    // The ladder renames `<state>/orchestrator` to `<state>/conductor` when
    // it renames the key, and an attachment's `path` is ABSOLUTE — the agent
    // is handed it and the harness reads the file off it. So the rows have to
    // be re-pointed or every chip in a restored transcript names a file at an
    // address that no longer exists.
    const before: PersistedConductor = {
      sessionId: "sess-held",
      cwd: HOME,
      model: null,
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
      fleet: [],
      watched: [],
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
    // rolled-back binary leaves behind. `confStore` casts, so without the
    // re-validation this reaches the panel as a row nothing can draw.
    //
    // Written through the store rather than onto the bytes, because the live
    // `Conf` is already open over this file and would overwrite a behind-its-
    // back edit; the cast is the point of the test — the store does no
    // decoding, which is exactly what `readPersistedConductor` repairs.
    conductorStore.set({
      sessionId: null,
      cwd: HOME,
      model: null,
      rows: [
        { id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" },
      ] as unknown as PersistedConductor["rows"],
      fleet: [],
      watched: [],
    });

    const host = hostOver().host;
    expect(() => host.watch(() => {})).toThrow(/does not match schema/);
    expect(() => host.watch(() => {})).toThrow(store.path);
  });
});

describe("an attachment's bytes", () => {
  /** One pixel of PNG, as the browser CUTS it for the wire: base64 and no
   *  `data:` prefix, because this never rides a prompt frame — it arrives
   *  through `attach`, in pieces, ahead of the message that names it. */
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("land in the state root and NEVER in `config.json`", async () => {
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
    // ...and `config.json` carries the chip and nothing else. A copy of the
    // base64 in the record would be read back in full on every boot, and a
    // single pasted screenshot would be the largest thing in the file.
    const raw = readFileSync(store.path, "utf8");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("iVBORw0KGgo");
    const config = JSON.parse(raw) as {
      conductor: {
        rows: ReadonlyArray<{
          attachments?: ReadonlyArray<Record<string, unknown>>;
        }>;
      };
    };
    const kept = config.conductor.rows[0]?.attachments?.[0];
    if (kept === undefined) throw new Error("the row lost its attachment");
    // A RESTORED ROW IS THE SAME SHAPE AS A LIVE ONE — that is what makes
    // "send again" on an old message read the same file the first send did.
    expect(kept).toEqual(chip);
    expect(kept.path).toBe(written.path);
  });
});
