/**
 * THE REFUSAL THAT DOES NOT STRAND ANYBODY — `conductor.recoverStore`'s two
 * ways out of a record this build cannot read, over the REAL store, the REAL
 * backup ring and a real conductor host.
 *
 * Four promises:
 *  - the refusal itself says what happened in plain words and tells nobody to
 *    edit a file;
 *  - *Restore the newest backup that reads* steps OVER the snapshots that
 *    carry the corruption (the newest ones usually do) and takes the newest
 *    one that decodes through the real ladder — and the Conductor comes up
 *    without a restart;
 *  - *Start with no works* keeps the unreadable value in a named file beside
 *    `config.json` and starts the record empty — never a silent reset;
 *  - when no backup reads either, that is a sentence a person is told, not a
 *    crash.
 *
 * The store is kolu-server's own module singleton under the harness's
 * ephemeral `KOLU_STATE_DIR`, for the reason `persistence.test.ts` states:
 * what is under test is the FILE, and a parallel `Conf` built here would
 * prove something about a store nothing ships.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { confStore } from "@kolu/surface/server";
import {
  type ConductorUnreadable,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import { ConductorRefused } from "kolu-common/conductorErrors";
import {
  type ConductorHost,
  EMPTY_PERSISTED_CONDUCTOR,
  type PersistedConductor,
  type PersistedMembers,
  type PersistedWorks,
  startConductorHost,
} from "kolu-conductor";
import { type Work, workIdOf } from "kolu-work";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverConductorStore } from "../conductorRecovery.ts";
import { stateBackupRing, store } from "../state.ts";
import { TRANSCRIPT_FILE_VERSION } from "../stateShape.ts";
import {
  transcriptFilePath,
  transcriptFileStore,
  writeTranscriptFile,
} from "./transcriptFile.ts";

const HOME = "/home/tester";
const T0 = "2026-01-01T00:00:00.000Z";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

const stateRoot = dirname(store.path);
const conductorStore = confStore<PersistedConductor>(store, "conductor");
const worksStore = confStore<PersistedWorks>(store, "works");
const membersStore = confStore<PersistedMembers>(store, "members");

/** A piece of work in today's shape — no members, because what these tests
 *  are about is the KEY, not what is inside it. */
const work = (branch: string, title: string): Work => ({
  key: { kind: "branch", host: "local", repo: "/srv/repo", branch },
  title,
  events: [],
  decisions: [],
  startedAt: T0,
  state: { kind: "open" },
});

/** The same, as the one-entry record the store holds. */
const works = (...all: ReadonlyArray<Work>): PersistedWorks =>
  Object.fromEntries(all.map((one) => [workIdOf(one.key), one]));

/** A host over the REAL conf store and the REAL transcript file, with the
 *  conversation itself absent: every one of these scenarios is a bring-up
 *  that never reaches an agent, so a spawn that is never called is honest. */
function hostOver(): ConductorHost {
  return startConductorHost({
    log,
    home: HOME,
    hostName: "test-box",
    fleetMcp: () => null,
    offer: () => {
      throw new Error("no test here opens a work, so none reads kolu's offer");
    },
    proveFleetMcp: async () => null,
    publish: () => {},
    publishWork: () => {},
    publishMember: () => {},
    publishReading: () => {},
    worksMoved: () => {},
    watchScopeMoved: () => {},
    store: conductorStore,
    works: worksStore,
    members: membersStore,
    transcript: transcriptFileStore(stateRoot, TRANSCRIPT_FILE_VERSION),
    storePath: () => store.path,
    transcriptPath: () => transcriptFilePath(stateRoot),
    stateRoot,
    workFiles: {
      list: async () => [],
      keep: async () => [],
      sweep: async () => {},
    },
    spawn: async () => {
      throw new Error("these scenarios never reach an agent");
    },
  });
}

/** The recovery, driven exactly as the `conductor.recoverStore` handler drives
 *  it. */
const recover = (
  host: ConductorHost,
  key: "conductor" | "works" | "members" | "transcript",
  how: "backup" | "empty",
) =>
  recoverConductorStore(
    { key, how },
    { state: () => host.state(), reload: () => host.reloadRecords() },
  );

/** Snapshot the live store into the ring, and answer the file it landed in. */
function snapshot(): string {
  const outcome = stateBackupRing.snapshot();
  if (outcome.kind !== "created") {
    throw new Error(`snapshot did not land: ${outcome.kind}`);
  }
  return outcome.file;
}

/** The value a corrupt `works` key holds: a work whose title is a number —
 *  the shape a rolled-back binary or a half-written rung leaves behind. */
const CORRUPT_WORKS = {
  "branch:local/%2Fsrv%2Frepo/bad": { ...work("bad", "the bad one"), title: 7 },
} as unknown as PersistedWorks;

/** Make the first reader trip, and hand back what the panel is now showing. */
function refuse(host: ConductorHost): {
  refusal: string;
  unreadable: ConductorUnreadable;
} {
  expect(() => host.watch(() => {})).toThrow();
  const state = host.state();
  const unreadable = state.unreadable;
  if (state.refusal === null || unreadable === null) {
    throw new Error("the host came up over a record it cannot read");
  }
  return { refusal: state.refusal, unreadable };
}

/** Every file the recovery may have kept aside, newest-ish first. */
const keptAside = (): string[] =>
  existsSync(join(stateRoot, "conductor"))
    ? readdirSync(join(stateRoot, "conductor")).filter((name) =>
        name.startsWith("unreadable-"),
      )
    : [];

beforeEach(() => {
  conductorStore.set({ ...EMPTY_PERSISTED_CONDUCTOR, cwd: HOME });
  worksStore.set({});
  membersStore.set({});
  rmSync(join(stateRoot, "conductor"), { recursive: true, force: true });
  rmSync(stateBackupRing.dir, { recursive: true, force: true });
});

afterEach(() => {
  conductorStore.set(EMPTY_PERSISTED_CONDUCTOR);
  worksStore.set({});
  membersStore.set({});
  rmSync(join(stateRoot, "conductor"), { recursive: true, force: true });
  rmSync(stateBackupRing.dir, { recursive: true, force: true });
});

describe("a record this build cannot read", () => {
  it("says what happened in plain words, and tells nobody to edit a file", () => {
    worksStore.set(CORRUPT_WORKS);
    const said = refuse(hostOver());
    expect(said.refusal).toBe(
      `kolu could not read the Conductor's saved works — the saved value is in a shape this build does not understand. Nothing has been changed: ${store.path} still holds them.`,
    );
    // The whole of the old sentence's advice, gone: no key to fix, no file to
    // delete, no editor to open.
    expect(said.refusal).not.toMatch(/fix|delete|edit/i);
    expect(said.unreadable.key).toBe("works");
    expect(said.unreadable.path).toBe(store.path);
    // ...and the schema's own words ride along for a bug report, beside the
    // sentence rather than inside it.
    expect(said.unreadable.detail).toContain("title");
  });

  it("names the transcript FILE, and does not tell anybody to delete it", () => {
    mkdirSync(join(stateRoot, "conductor"), { recursive: true });
    writeTranscriptFile(transcriptFilePath(stateRoot), "0.0.0", []);
    const said = refuse(hostOver());
    expect(said.unreadable.key).toBe("transcript");
    expect(said.unreadable.path).toBe(transcriptFilePath(stateRoot));
    expect(said.refusal).toContain("kolu could not read");
    expect(said.refusal).not.toMatch(/delete/i);
  });
});

describe("restore the newest backup that reads", () => {
  it("steps over the snapshots that carry the corruption and brings the Conductor up", () => {
    // Three snapshots: one work, then two, then the corruption — which is the
    // ordinary shape of this accident, because the newest snapshots were taken
    // after whatever broke the store.
    worksStore.set(works(work("one", "the first")));
    snapshot();
    worksStore.set(works(work("one", "the first"), work("two", "the second")));
    const good = snapshot();
    worksStore.set(CORRUPT_WORKS);
    snapshot();

    const host = hostOver();
    refuse(host);
    const { said } = recover(host, "works", "backup");

    // The snapshot it took is NAMED — the same file name the backups dialog
    // shows, so a person can tell which one came back.
    expect(said).toContain(good);
    expect(said).toContain("2 pieces of work came back");
    expect(said).toContain("The Conductor is up.");
    // ...and the Conductor IS up, in this process, with no restart: the state
    // it publishes carries no refusal, and the works are the snapshot's.
    expect(host.state().refusal).toBeNull();
    expect(host.state().unreadable).toBeNull();
    expect(host.works().map(([, one]) => one.title)).toEqual([
      "the first",
      "the second",
    ]);
    // The store that could not be read is STILL IN THE RING, so the recovery
    // is itself undoable: the ring takes its own undo snapshot before `apply`
    // runs, and skips it only when it would be byte-identical to the newest
    // member — which here it is, because the corrupt store was snapshotted a
    // moment ago. Three members, one of them the corruption.
    expect(stateBackupRing.list().length).toBe(3);
  });

  it("says so, plainly, when no backup reads either", () => {
    worksStore.set(CORRUPT_WORKS);
    snapshot();
    worksStore.set({ "work:worse": { title: 1 } } as unknown as PersistedWorks);
    snapshot();

    const host = hostOver();
    refuse(host);
    let why = "";
    try {
      recover(host, "works", "backup");
    } catch (err) {
      if (!(err instanceof ConductorRefused)) throw err;
      why = err.why;
    }
    expect(why).toContain("no backup reads either");
    expect(why).toContain("2 saved snapshots");
    // The refusal points at the other button rather than at a text editor.
    expect(why).toContain("keeps the unreadable one in a file of its own");
    // Nothing was written: the record is still exactly what it was.
    expect(store.get("works")).toEqual({ "work:worse": { title: 1 } });
  });

  it("refuses for the TRANSCRIPT, which no backup holds", () => {
    mkdirSync(join(stateRoot, "conductor"), { recursive: true });
    writeTranscriptFile(transcriptFilePath(stateRoot), "0.0.0", []);
    snapshot();
    const host = hostOver();
    refuse(host);
    expect(() => recover(host, "transcript", "backup")).toThrow(
      /no saved copy of the transcript/,
    );
  });
});

describe("start with the record empty", () => {
  it("keeps the unreadable works in a named file and comes up with none", () => {
    worksStore.set(CORRUPT_WORKS);
    const host = hostOver();
    refuse(host);

    const { said } = recover(host, "works", "empty");

    const kept = keptAside();
    expect(kept.length).toBe(1);
    const name = kept[0] ?? "";
    expect(name).toMatch(/^unreadable-works-.*\.json$/);
    // The answer NAMES the file, because "nothing was deleted" is a promise
    // and a path is a fact.
    expect(said).toContain(join(stateRoot, "conductor", name));
    expect(said).toContain("nothing was deleted");
    // The bytes are the ones that could not be read, kept whole...
    expect(
      JSON.parse(readFileSync(join(stateRoot, "conductor", name), "utf8")),
    ).toEqual(CORRUPT_WORKS);
    // ...the key is empty, and the Conductor is up in this process.
    expect(store.get("works")).toEqual({});
    expect(host.state().refusal).toBeNull();
    expect(host.works()).toEqual([]);
  });

  it("moves the unreadable TRANSCRIPT aside and starts an empty one", () => {
    mkdirSync(join(stateRoot, "conductor"), { recursive: true });
    const path = transcriptFilePath(stateRoot);
    writeFileSync(path, "{not json at all");
    const host = hostOver();
    const said = refuse(host);
    expect(said.refusal).toContain("the file is not valid JSON");

    recover(host, "transcript", "empty");

    const kept = keptAside();
    expect(kept.length).toBe(1);
    // MOVED, not copied and not parsed: bytes this build could not read are
    // bytes it has no business rewriting.
    expect(existsSync(path)).toBe(false);
    expect(
      readFileSync(join(stateRoot, "conductor", kept[0] ?? ""), "utf8"),
    ).toBe("{not json at all");
    expect(host.state().refusal).toBeNull();
    expect(host.state().phase).toBe(DEFAULT_CONDUCTOR_STATE.phase);
  });

  it("keeps the unreadable MEMBERS aside and comes up with none", () => {
    membersStore.set({ "local/t1": 7 } as unknown as PersistedMembers);
    const host = hostOver();
    const said = refuse(host);
    expect(said.unreadable.key).toBe("members");

    recover(host, "members", "empty");

    expect(keptAside()[0]).toMatch(/^unreadable-members-.*\.json$/);
    expect(store.get("members")).toEqual({});
    expect(host.state().refusal).toBeNull();
  });
});

describe("the refusals a stale screen can press", () => {
  it("refuses when there is nothing to recover", () => {
    const host = hostOver();
    host.watch(() => {});
    expect(() => recover(host, "works", "empty")).toThrow(/nothing to recover/);
  });

  it("refuses when the record pressed is not the one being refused", () => {
    worksStore.set(CORRUPT_WORKS);
    const host = hostOver();
    refuse(host);
    expect(() => recover(host, "conductor", "empty")).toThrow(
      /not refusing that record any more/,
    );
    expect(keptAside()).toEqual([]);
  });
});
