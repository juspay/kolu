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

const work = (branch: string, title: string): Work => ({
  key: { kind: "branch", host: "local", repo: "/srv/repo", branch },
  title,
  events: [],
  decisions: [],
  startedAt: T0,
  state: { kind: "open" },
});

const works = (...all: ReadonlyArray<Work>): PersistedWorks =>
  Object.fromEntries(all.map((one) => [workIdOf(one.key), one]));

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
      list: async () => ({ paths: [], more: false }),
      keep: async () => ({ kept: [], tooBig: [] }),
      sweep: async () => {},
    },
    spawn: async () => {
      throw new Error("these scenarios never reach an agent");
    },
  });
}

const recover = (
  host: ConductorHost,
  key: "conductor" | "works" | "members" | "transcript",
  how: "backup" | "empty",
) =>
  recoverConductorStore(
    { key, how },
    { state: () => host.state(), reload: () => host.reloadRecords() },
  );

function snapshot(): string {
  const outcome = stateBackupRing.snapshot();
  if (outcome.kind !== "created") {
    throw new Error(`snapshot did not land: ${outcome.kind}`);
  }
  return outcome.file;
}

const CORRUPT_WORKS = {
  "branch:local/%2Fsrv%2Frepo/bad": { ...work("bad", "the bad one"), title: 7 },
} as unknown as PersistedWorks;

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
    expect(said.refusal).not.toMatch(/fix|delete|edit/i);
    expect(said.unreadable.key).toBe("works");
    expect(said.unreadable.path).toBe(store.path);
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
    worksStore.set(works(work("one", "the first")));
    snapshot();
    worksStore.set(works(work("one", "the first"), work("two", "the second")));
    const good = snapshot();
    worksStore.set(CORRUPT_WORKS);
    snapshot();

    const host = hostOver();
    refuse(host);
    const { said } = recover(host, "works", "backup");

    expect(said).toContain(good);
    expect(said).toContain("2 pieces of work came back");
    expect(said).toContain("The Conductor is up.");
    expect(host.state().refusal).toBeNull();
    expect(host.state().unreadable).toBeNull();
    expect(host.works().map(([, one]) => one.title)).toEqual([
      "the first",
      "the second",
    ]);
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
    expect(why).toContain("keeps the unreadable one in a file of its own");
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
    expect(said).toContain(join(stateRoot, "conductor", name));
    expect(said).toContain("nothing was deleted");
    expect(
      JSON.parse(readFileSync(join(stateRoot, "conductor", name), "utf8")),
    ).toEqual(CORRUPT_WORKS);
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
