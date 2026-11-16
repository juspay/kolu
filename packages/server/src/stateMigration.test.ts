/**
 * The 1.31.0 BURIAL migration — `stripLegacyStateKeys_1_31_0` — driven against a
 * real `Conf` under an ephemeral temp dir. Two invariants:
 *   (i)  a file WITH legacy keys is BACKED UP (`.pre-1.31-strip.bak` retains
 *        them) before the live file is stripped to just `preferences`;
 *   (ii) a file WITHOUT legacy keys grows no `.bak` (harmless-if-absent).
 *
 * BACKUP-FIRST is load-bearing: a direct pre-W2.2 → W2.3 upgrade runs this strip
 * before a fresh padi imports the legacy session, so the copy is the recovery
 * path if the strip runs first.
 *
 * The 1.50.0 rung is driven the same way: `worksFromWatched_1_50_0` by calling
 * it (the grouping decision and the frozen values it writes), and
 * `migrateConductorToWorks_1_50_0` against a real `Conf` under a temp dir —
 * where the transcript file it writes beside that store can be read back.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Conf from "conf";
import { Result, Schema } from "effect";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import {
  PersistedWorksSchema,
  readPersistedTranscript,
  workDirOf,
} from "kolu-conductor";
import { workIdOf } from "kolu-work";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transcriptFilePath,
  transcriptFileStore,
  writeTranscriptFile,
} from "./conductor/transcriptFile.ts";
// Importing state.ts opens its own throwaway store at the test harness's
// KOLU_STATE_DIR (set by the `test:unit` script) — unrelated to the fixtures
// below, which each build their own Conf under a fresh temp dir. The rungs
// themselves come from `stateLadder.ts`, which opens nothing.
import { decodeStateBackup } from "./state.ts";
import {
  collapseFlappingChecks_1_51_0,
  CONF_MIGRATIONS,
  dropKoluChoiceOptions_1_54_0,
  foldWorksByKey_1_53_0,
  memberWatchOutOfWorks_1_52_0,
  migrateConductorToWorks_1_50_0,
  koluChoicesSayHowChosen_1_56_0,
  moveKeptFiles_1_53_0,
  prFactsOnTheTimeline_1_57_0,
  splitWorkAskRows_1_53_0,
  stripLegacyStateKeys_1_31_0,
  workArmsNotNulls_1_55_0,
  workAskStanding_1_55_0,
  worksFromWatched_1_50_0,
} from "./stateLadder.ts";
import {
  CONF_DEFAULTS,
  SCHEMA_VERSION,
  TRANSCRIPT_FILE_VERSION,
} from "./stateShape.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A real `Conf` under a fresh temp dir, seeded with `preferences` plus whatever
 *  extra (legacy) keys the case wants on disk. */
function makeStore(
  extra: Record<string, unknown>,
): Conf<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "kolu-burial-"));
  dirs.push(dir);
  const conf = new Conf<Record<string, unknown>>({
    cwd: dir,
    projectVersion: "1.31.0",
    defaults: { preferences: DEFAULT_PREFERENCES },
  });
  for (const [key, value] of Object.entries(extra)) conf.set(key, value);
  return conf;
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8"));

describe("stripLegacyStateKeys_1_31_0", () => {
  it("backs up then strips a file carrying the legacy keys", () => {
    const conf = makeStore({
      session: { active: null, terminals: [{ id: "t1" }] },
      activityFeed: { recentRepos: ["/repo"], recentAgents: [] },
      sleepingTerminals: [{ id: "s1" }],
      lastPairedDaemon: { stateRoot: "/root" },
    });
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    stripLegacyStateKeys_1_31_0(conf as never);

    // (i) the backup retains every legacy key verbatim...
    expect(existsSync(bakPath)).toBe(true);
    const bak = readJson(bakPath);
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
    expect(bak.sleepingTerminals).toEqual([{ id: "s1" }]);
    expect(bak.lastPairedDaemon).toEqual({ stateRoot: "/root" });

    // ...and the live file has them stripped, keeping only `preferences`.
    const live = readJson(conf.path);
    expect(live.preferences).toBeDefined();
    expect(live.session).toBeUndefined();
    expect(live.activityFeed).toBeUndefined();
    expect(live.sleepingTerminals).toBeUndefined();
    expect(live.lastPairedDaemon).toBeUndefined();
    expect(conf.has("session" as never)).toBe(false);
  });

  it("creates no .bak for a file without any legacy key", () => {
    const conf = makeStore({});
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    stripLegacyStateKeys_1_31_0(conf as never);

    expect(existsSync(bakPath)).toBe(false);
    expect(readJson(conf.path).preferences).toBeDefined();
  });

  it("preserves the FULL first backup across a partial-strip rerun (write-once)", () => {
    // Simulate a crash mid-strip: the first run backs up the whole file, then the
    // process dies after deleting only `session` (conf persists each delete
    // synchronously but records the migration as done only when the handler
    // returns, so the ladder reruns). The second run must NOT re-copy the now
    // session-less live file over the full first backup.
    const conf = makeStore({
      session: { active: null, terminals: [{ id: "t1" }] },
      activityFeed: { recentRepos: ["/repo"], recentAgents: [] },
      sleepingTerminals: [{ id: "s1" }],
      lastPairedDaemon: { stateRoot: "/root" },
    });
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    // First (partial) run: back up, then lose `session` from the live file only.
    stripLegacyStateKeys_1_31_0(conf as never);
    expect(existsSync(bakPath)).toBe(true);
    // The live file is now stripped; re-seed the residual legacy keys the crash
    // left behind so the rerun still sees legacy state (hence `hasLegacy`).
    conf.set("activityFeed", { recentRepos: ["/repo"], recentAgents: [] });
    conf.set("sleepingTerminals", [{ id: "s1" }]);
    conf.set("lastPairedDaemon", { stateRoot: "/root" });

    // Second (rerun) run: sees legacy keys but MUST keep the full first backup.
    stripLegacyStateKeys_1_31_0(conf as never);

    const bak = readJson(bakPath);
    // The zero-loss guarantee: `session` — deleted from the live file on the first
    // run — still survives verbatim in the backup padi imports from.
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
  });
});

describe("the 1.50.0 rung — a piece of work is a stored thing", () => {
  /** A 1.49.0-shaped watch entry: everything that rung guarantees. */
  const entry = (over: {
    ref: string;
    name?: string;
    since?: string;
    root?: { ref: string; name: string } | null;
  }) => ({
    ref: over.ref,
    name: over.name ?? "",
    agent: "claude",
    told: "stopped",
    joined: "created-run",
    spoken: true,
    ran: true,
    since: over.since ?? "2026-01-01T00:00:00.000Z",
    root: over.root ?? null,
  });

  const PLANNER = "local/11111111-1111-4111-8111-111111111111";
  const IMPL = "local/22222222-2222-4222-8222-222222222222";
  const ALONE = "remote:box/33333333-3333-4333-8333-333333333333";

  /** What `hostOf` would read off a carried-over work: the host decision's
   *  one picked answer. */
  const hostAnswer = (work: Record<string, unknown>): unknown =>
    (
      (work.decisions as ReadonlyArray<Record<string, unknown>>).find(
        (one) => one.key === "host",
      )?.answer as { picked: unknown[] }
    ).picked[0];

  it("makes ONE work of the terminals the panel drew as one, and its own of the rest", () => {
    // The grouping is the one the file already carries: `root` is what the
    // watching panel showed as a piece of work, so a person's two terminals
    // come back as one card and the lone one as its own — rather than three
    // cards nobody recognizes, or one card holding unrelated machines.
    let minted = 0;
    const carried = worksFromWatched_1_50_0(
      [
        entry({
          ref: PLANNER,
          name: "plan the cutover",
          root: { ref: PLANNER, name: "plan the cutover" },
        }),
        entry({
          ref: IMPL,
          name: "the implementor",
          since: "2026-01-01T00:10:00.000Z",
          root: { ref: PLANNER, name: "plan the cutover" },
        }),
        entry({ ref: ALONE, name: "a watch" }),
      ],
      () => `work-${++minted}`,
    );

    const works = carried.works;
    expect(works.map((one) => one.id)).toEqual(["work-1", "work-2"]);
    const [waterfall, alone] = works as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // The root's remembered name is the title; the age is the EARLIEST join,
    // not this boot — a person's hour-old waterfall must not come back new.
    expect(waterfall.title).toBe("plan the cutover");
    expect(waterfall.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(waterfall.members).toEqual([
      {
        terminal: PLANNER,
        role: "other",
        joinedAt: "2026-01-01T00:00:00.000Z",
        leftAt: null,
        worktree: null,
      },
      {
        terminal: IMPL,
        role: "other",
        joinedAt: "2026-01-01T00:10:00.000Z",
        leftAt: null,
        worktree: null,
      },
    ]);
    // ... and what kolu KNEW about each of those terminals comes out as the
    // `members` key, keyed by the same refs: two keys out of one watch list,
    // because an entry was always a fact about a work and a fact about a
    // terminal.
    expect(carried.members).toEqual({
      [PLANNER]: {
        name: "plan the cutover",
        agent: "claude",
        told: "stopped",
        joined: "created-run",
        spoken: true,
        ran: true,
      },
      [IMPL]: {
        name: "the implementor",
        agent: "claude",
        told: "stopped",
        joined: "created-run",
        spoken: true,
        ran: true,
      },
      [ALONE]: {
        name: "a watch",
        agent: "claude",
        told: "stopped",
        joined: "created-run",
        spoken: true,
        ran: true,
      },
    });
    // The timeline is never empty: it opens with the carry-over and then says
    // who was there.
    expect(waterfall.events).toEqual([
      {
        at: "2026-01-01T00:00:00.000Z",
        by: "kolu",
        kind: "carried-over",
        terminal: null,
        detail: "watched before kolu stored work",
      },
      {
        at: "2026-01-01T00:00:00.000Z",
        by: "kolu",
        kind: "joined",
        terminal: PLANNER,
        detail: "other",
      },
      {
        at: "2026-01-01T00:10:00.000Z",
        by: "kolu",
        kind: "joined",
        terminal: IMPL,
        detail: "other",
      },
    ]);
    // The lone entry is a work of its own, titled by what kolu last saw the
    // terminal called, and on ITS machine.
    expect(alone.title).toBe("a watch");
    expect((alone.members as unknown[]).length).toBe(1);
    expect(hostAnswer(alone)).toBe("remote:box");
  });

  it("records mode and host as DECISIONS answered from nowhere", () => {
    // `modeOf`/`hostOf` read decisions, so a carried-over work has to carry
    // them as decisions or the card would show a work with no mode and no
    // machine. Nobody was asked — not in a card, not in a chat, not in a
    // request — so `from` is null, which is the only honest value.
    const [work] = worksFromWatched_1_50_0(
      [entry({ ref: ALONE })],
      () => "w",
    ).works;
    const decisions = work?.decisions as ReadonlyArray<Record<string, unknown>>;
    expect(decisions.map((one) => one.key)).toEqual(["mode", "host"]);
    expect(decisions[0]?.answer).toEqual({
      at: "2026-01-01T00:00:00.000Z",
      how: "answered",
      picked: ["watch"],
      text: null,
      from: null,
    });
    // ONE ask for the pair: they were decided together, by the same file.
    expect(decisions[0]?.ask).toBe(decisions[1]?.ask);
    expect(decisions[1]?.question).toBe(
      "Carried over from before kolu stored work",
    );
  });

  it("titles a group whose terminals kolu never read", () => {
    const [work] = worksFromWatched_1_50_0(
      [entry({ ref: ALONE })],
      () => "w",
    ).works;
    expect(work?.title).toBe("Carried over");
  });

  it("moves the rows into the transcript file and the watch list into works", () => {
    // The whole rung, against a REAL `Conf` — the rows leave `config.json` for
    // a file stamped with the ladder's number, the watch list becomes works,
    // and both keys are gone so no later reader can find a stale copy.
    const conf = makeStore({
      conductor: {
        sessionId: "sess-held",
        cwd: "/home/tester",
        model: "claude-sonnet-4",
        rows: [{ id: "u1", seq: 1, kind: "user", text: "do the thing" }],
        fleet: [PLANNER],
        watched: [entry({ ref: PLANNER, name: "plan the cutover" })],
      },
    });

    migrateConductorToWorks_1_50_0(conf as never);

    expect(conf.get("conductor")).toEqual({
      sessionId: "sess-held",
      cwd: "/home/tester",
      model: "claude-sonnet-4",
      fleet: [PLANNER],
    });
    const transcript = join(dirname(conf.path), "conductor", "transcript.json");
    expect(readJson(transcript)).toEqual({
      version: TRANSCRIPT_FILE_VERSION,
      rows: [{ id: "u1", seq: 1, kind: "user", text: "do the thing" }],
    });
    // Owner-only: a transcript carries whatever a person pasted into it.
    expect(statSync(transcript).mode & 0o777).toBe(0o600);
    const works = conf.get("works") as ReadonlyArray<Record<string, unknown>>;
    expect(works.length).toBe(1);
    expect(works[0]?.title).toBe("plan the cutover");
  });

  it("leaves a conductor record alone when its rows are not a list", () => {
    // Not an older shape — a broken file. The rung declines it so the READ
    // refuses it by name, rather than quietly dropping somebody's chat.
    const conf = makeStore({ conductor: { rows: "nonsense", watched: [] } });
    migrateConductorToWorks_1_50_0(conf as never);
    expect(conf.get("conductor")).toEqual({ rows: "nonsense", watched: [] });
    expect(
      existsSync(join(dirname(conf.path), "conductor", "transcript.json")),
    ).toBe(false);
  });
});

describe("the 1.51.0 rung — the check ping-pong, swept out", () => {
  const PLANNER = "local/11111111-1111-4111-8111-111111111111";
  const IMPL = "local/22222222-2222-4222-8222-222222222222";
  const AT = "2026-01-01T22:30:00.000Z";
  const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";
  const PUSHED = "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5";

  /** A work shaped like the human's: two members in ONE worktree, and
   *  hundreds of check events alternating between their two readings of one
   *  pull request — every `checks-running` naming the implementor, every
   *  `checks-passed` the planner, several a second. */
  const flapping = (pairs: number, detail = ""): Record<string, unknown> => ({
    id: "w-flap",
    title: "Rewrite odu's docs",
    events: [
      {
        at: "2026-01-01T22:30:00.000Z",
        by: "you",
        kind: "requested",
        terminal: null,
        detail: "rewrite them",
      },
      {
        at: "2026-01-01T22:30:01.000Z",
        by: "agent",
        kind: "pr-opened",
        terminal: IMPL,
        detail: "#181 Rewrite odu's docs",
      },
      ...Array.from({ length: pairs }, (_, n) => [
        {
          at: `2026-01-01T22:35:${String(n % 60).padStart(2, "0")}.100Z`,
          by: "ci",
          kind: "checks-running",
          terminal: IMPL,
          detail,
        },
        {
          at: `2026-01-01T22:35:${String(n % 60).padStart(2, "0")}.200Z`,
          by: "ci",
          kind: "checks-passed",
          terminal: PLANNER,
          detail,
        },
      ]).flat(),
      {
        at: "2026-01-01T22:40:00.000Z",
        by: "agent",
        kind: "file",
        terminal: IMPL,
        detail: ".waterfall/plan.md",
      },
    ],
  });

  it("keeps the FIRST of each kind and drops the rest, order intact", () => {
    const conf = makeStore({ works: [flapping(215)] });
    collapseFlappingChecks_1_51_0(conf as never);
    const works = conf.get("works") as ReadonlyArray<Record<string, unknown>>;
    const events = works[0]?.events as ReadonlyArray<Record<string, unknown>>;
    // 432 events in, 4 out: what was asked for, the PR, the checks running,
    // the checks passing, the file — and the two check events are the FIRST
    // ones, so the timeline still says when the checks started.
    expect(events.map((one) => one.kind)).toEqual([
      "requested",
      "pr-opened",
      "checks-running",
      "checks-passed",
      "file",
    ]);
    expect(events[2]?.at).toBe("2026-01-01T22:35:00.100Z");
    expect(events[2]?.terminal).toBe(IMPL);
    expect(events[3]?.terminal).toBe(PLANNER);
  });

  it("keeps one of each kind PER COMMIT, so a push survives the sweep", () => {
    const first = flapping(3, HEAD).events as ReadonlyArray<unknown>;
    const second = flapping(3, PUSHED).events as ReadonlyArray<
      Record<string, unknown>
    >;
    const conf = makeStore({
      works: [
        {
          id: "w-pushed",
          title: "Rewrite odu's docs",
          events: [...first, ...second.filter((one) => one.by === "ci")],
        },
      ],
    });
    collapseFlappingChecks_1_51_0(conf as never);
    const works = conf.get("works") as ReadonlyArray<Record<string, unknown>>;
    const events = works[0]?.events as ReadonlyArray<Record<string, unknown>>;
    expect(
      events
        .filter((one) => one.by === "ci")
        .map((one) => `${String(one.kind)} ${String(one.detail)}`),
    ).toEqual([
      `checks-running ${HEAD}`,
      `checks-passed ${HEAD}`,
      `checks-running ${PUSHED}`,
      `checks-passed ${PUSHED}`,
    ]);
  });

  it("leaves a work with nothing to sweep exactly as it was", () => {
    const tidy = {
      id: "w",
      title: "t",
      events: [
        {
          at: AT,
          by: "ci",
          kind: "checks-running",
          terminal: null,
          detail: "",
        },
      ],
    };
    const conf = makeStore({ works: [tidy] });
    collapseFlappingChecks_1_51_0(conf as never);
    expect(conf.get("works")).toEqual([tidy]);
  });

  it("walks past a works key this build would refuse", () => {
    // A rung runs against a file written by an older build: a shape it does
    // not understand is left alone for the READ to refuse by name.
    const conf = makeStore({ works: "nonsense" });
    collapseFlappingChecks_1_51_0(conf as never);
    expect(conf.get("works")).toBe("nonsense");
  });
});

describe("the 1.52.0 rung — a store this branch wrote before the member bookkeeping moved", () => {
  /** The human's REAL store, as their deployed build of this branch wrote it
   *  (juspay/kolu#2376, round 3): stamped 1.50.0, each work member carrying a
   *  `watch`, a top-level `members: {}`, decisions with no `header`, and the
   *  429 flapping check events. Host names and home paths are replaced;
   *  nothing else is touched. */
  const DEPLOYED = JSON.parse(
    readFileSync(
      new URL("./fixtures/deployed-1.50.0-old-members.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const PLANNER = "remote:host-d/b05bbccd-4e62-408c-a590-5c5906ce7407";
  const IMPL = "remote:host-d/415ebfc7-4a42-4561-a54b-c47f9d62284b";

  it("brings the deployed store through the WHOLE ladder, and every persisted key decodes", () => {
    // `decodeStateBackup` is the real ladder on a scratch copy, then the
    // full persisted schema — works, members, conductor, preferences, hosts,
    // viewerMode — decoded, throwing on any key that fails.
    const decoded = decodeStateBackup(DEPLOYED, "the deployed store");
    // ONE work, keyed by its branch (1.53.0), still Open.
    const work = Object.values(decoded.works)[0];
    expect(work).toBeDefined();
    expect(work?.state.kind).toBe("open");
    // The members are the ONE map now, each row carrying where it worked AND
    // the bookkeeping that used to sit beside it.
    expect(
      Object.entries(decoded.members).map(([ref, one]) => [
        ref,
        one.role,
        one.worktree,
      ]),
    ).toEqual([
      [
        PLANNER,
        "planner",
        {
          kind: "read",
          path: "/home/person/code/odu/.worktrees/docs-human-reading",
        },
      ],
      [
        IMPL,
        "implementor",
        {
          kind: "read",
          path: "/home/person/code/odu/.worktrees/docs-human-reading",
        },
      ],
    ]);
    expect(decoded.members[PLANNER]?.watch).toEqual({
      name: "Planner: odu docs for human reading",
      agent: "omp",
      told: "stopped",
      joined: "created-run",
      spoken: true,
      ran: true,
    });
    const implMember = (
      (DEPLOYED.works as ReadonlyArray<Record<string, unknown>>)[0]
        ?.members as ReadonlyArray<Record<string, unknown>>
    ).find((one) => one.terminal === IMPL);
    const { worktree: _worktree, ...implWatch } = (implMember?.watch ??
      {}) as Record<string, unknown>;
    expect(decoded.members[IMPL]?.watch).toEqual(implWatch);
    // The 1.51.0 sweep ran on the same store: the flapping check events are
    // one per kind per commit, and every other event is kept.
    const kinds = work?.events.map((one) => one.kind) ?? [];
    expect(kinds.filter((kind) => kind === "checks-running")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "checks-passed")).toHaveLength(1);
    // Decisions: every one of them an arm of the sum. The `host` ones the
    // 1.53.0 rung dropped are not even sayable any more — a setup key is one
    // of the six the live schema names, which is what this decode proves —
    // and 1.55.0 left the rest as setup questions about the work's own run.
    expect(
      work?.decisions.filter((one) => one.topic === "setup").length,
    ).toBeGreaterThan(0);
    expect(work?.decisions.length).toBeGreaterThanOrEqual(7);
  });

  it("keeps a members entry that is already there — the newer writer's word wins", () => {
    const conf = makeStore({
      works: [
        {
          id: "w",
          members: [
            {
              terminal: "local/a",
              role: "planner",
              joinedAt: "t",
              leftAt: null,
              watch: {
                name: "old",
                agent: null,
                told: null,
                joined: "asked",
                spoken: false,
                ran: false,
                worktree: "/w",
              },
            },
          ],
          decisions: [],
        },
      ],
      members: {
        "local/a": {
          name: "new",
          agent: "omp",
          told: "ready",
          joined: "asked",
          spoken: true,
          ran: true,
        },
      },
    });
    memberWatchOutOfWorks_1_52_0(conf as never);
    expect(
      (conf.get("members") as Record<string, Record<string, unknown>>)[
        "local/a"
      ]?.name,
    ).toBe("new");
    const members = (
      conf.get("works") as ReadonlyArray<Record<string, unknown>>
    )[0]?.members as ReadonlyArray<Record<string, unknown>>;
    expect(members[0]).toEqual({
      terminal: "local/a",
      role: "planner",
      joinedAt: "t",
      leftAt: null,
      worktree: "/w",
    });
  });

  it("passes a store already in the current shape through untouched", () => {
    const current = {
      id: "w",
      members: [
        {
          terminal: "local/a",
          role: "planner",
          joinedAt: "t",
          leftAt: null,
          worktree: null,
        },
      ],
      decisions: [
        { id: "d", ask: "a", header: "Plan", file: ".waterfall/plan.md" },
      ],
    };
    const conf = makeStore({ works: [current], members: {} });
    memberWatchOutOfWorks_1_52_0(conf as never);
    expect(conf.get("works")).toEqual([current]);
    expect(conf.get("members")).toEqual({});
  });
});

describe("what an EARLIER COMMIT of this branch wrote, read by head", () => {
  // The rule the state skill now states: a branch somebody has deployed has
  // released its saved shape onto their disk, so every commit of it that
  // moved a persisted shape has to be readable by head. These are the two
  // shapes no fixture above stands for — the store an intermediate commit
  // wrote (members already moved, decisions not yet carrying a header), and
  // the transcript FILE, which rides this ladder without a rung of its own.
  const REF = "remote:host-a/11111111-1111-4111-8111-111111111111";
  const AT = "2026-02-02T10:00:00.000Z";

  it("decodes a store written AFTER the members moved and BEFORE a decision had a header", () => {
    // Commits 910515439 … 3c4b46f90^: the member bookkeeping already sits in
    // the top-level `members` record and the member carries `worktree`, but
    // `Decision.header` does not exist yet and no check event names a head
    // commit. Stamped 1.50.0, because 1.51.0 was not written until later.
    const decoded = decodeStateBackup(
      {
        __internal__: { migrations: { version: "1.50.0" } },
        works: [
          {
            id: "w-mid",
            title: "the docs reading",
            repo: "odu",
            branch: "docs-human-reading",
            members: [
              {
                terminal: REF,
                role: "planner",
                joinedAt: AT,
                leftAt: null,
                worktree: "/home/person/code/odu",
              },
            ],
            events: [
              {
                at: AT,
                by: "kolu",
                kind: "pr-opened",
                terminal: REF,
                detail: "#7 docs",
              },
              // Check events in the grammar of the day: the failing names
              // alone, no head commit. They all key the same, so the 1.51.0
              // sweep keeps the first of each kind.
              {
                at: AT,
                by: "ci",
                kind: "checks-running",
                terminal: REF,
                detail: "",
              },
              {
                at: AT,
                by: "ci",
                kind: "checks-failed",
                terminal: REF,
                detail: "build, lint",
              },
              {
                at: AT,
                by: "ci",
                kind: "checks-failed",
                terminal: REF,
                detail: "build",
              },
            ],
            decisions: [
              {
                id: "d-1",
                ask: "ask-1",
                at: AT,
                key: "mode",
                question: "How should this run?",
                options: ["full", "trivial"],
                multiple: false,
                answer: null,
              },
            ],
            startedAt: AT,
            endedAt: null,
            outcome: null,
            keptFiles: [],
          },
        ],
        members: {
          [REF]: {
            name: "Planner: odu docs",
            agent: "omp",
            told: "stopped",
            joined: "created-run",
            spoken: true,
            ran: true,
          },
        },
      },
      "the mid-branch store",
    );
    // The 1.53.0 rung re-keyed the works by their branch, so there is one
    // value rather than one row.
    const work = Object.values(decoded.works)[0];
    // 1.52.0 backfilled the two fields the decision was written without, and
    // 1.55.0 took them back off a SETUP question — whose label is its key's
    // own name, so there is nowhere to write either.
    expect(work?.decisions[0]?.topic).toBe("setup");
    expect("header" in (work?.decisions[0] ?? {})).toBe(false);
    expect("file" in (work?.decisions[0] ?? {})).toBe(false);
    // … and left everything the commit DID write exactly as it was.
    expect(work?.decisions[0]?.question).toBe("How should this run?");
    // … and 1.53.0 moved the membership into the one map, where the watch
    // bookkeeping already was.
    expect(decoded.members[REF]?.worktree).toEqual({
      kind: "read",
      path: "/home/person/code/odu",
    });
    expect(decoded.members[REF]?.watch.name).toBe("Planner: odu docs");
    // The 1.51.0 sweep read the old detail grammar as "names no commit", so
    // the two failures collapse to the first and the running one stands.
    expect(work?.events.map((one) => one.kind)).toEqual([
      "pr-opened",
      "checks-running",
      "checks-failed",
    ]);
    // The detail string became typed fields: the gates that are red are a
    // list, and the event carries the pull request it is about.
    const failed = work?.events[2];
    expect(failed?.kind === "checks-failed" && failed.failing).toEqual([
      "build",
      "lint",
    ]);
  });

  it("reads a transcript file written when the rows first moved into it", () => {
    // The file is stamped by the ladder, not by a ladder of its own, so a
    // row-shape change is a rung that rewrites it and moves
    // TRANSCRIPT_FILE_VERSION — which 1.53.0 did, splitting the work-carrying
    // ask row off into its own kind. The rows a 1.50.0 file holds that did
    // NOT move (a user row with no `attachments`, a tool row, an ask about no
    // work, a wake) must still come back whole through the reader the
    // conversation uses, once the rung has restamped the file.
    const root = mkdtempSync(join(tmpdir(), "kolu-transcript-compat-"));
    dirs.push(root);
    const path = transcriptFilePath(root);
    writeTranscriptFile(path, "1.50.0", [
      { id: "u1", seq: 1, since: AT, kind: "user", text: "plan the cutover" },
      {
        id: "t1",
        seq: 2,
        since: AT,
        kind: "tool",
        text: "watch_terminal",
        status: "completed",
        kolu: {
          kind: "watch",
          terminalId: "11111111-1111-4111-8111-111111111111",
          host: "remote:host-a",
          name: "Planner: odu docs",
          watching: true,
        },
      },
      {
        id: "a1",
        seq: 3,
        since: AT,
        kind: "ask",
        text: "How should this run?",
        ask: {
          fields: [
            {
              key: "mode",
              label: null,
              hint: null,
              kind: "choice",
              choices: [{ value: "full", label: "Full", hint: null }],
              required: true,
              attachedTo: null,
            },
          ],
          link: null,
          outcome: null,
        },
      },
      {
        id: "a2",
        seq: 4,
        since: AT,
        kind: "ask",
        text: "Which plan should the implementor take?",
        work: "work:abc123",
        ask: {
          fields: [
            {
              key: "plan",
              label: null,
              hint: null,
              kind: "choice",
              choices: [{ value: "a", label: "A", hint: null }],
              required: true,
              attachedTo: null,
            },
          ],
          link: null,
          outcome: null,
        },
      },
      {
        id: "w1",
        seq: 4,
        since: AT,
        kind: "wake",
        from: "watch",
        text: "Planner: odu docs has stopped",
        events: [
          {
            ref: REF,
            host: "remote:host-a",
            terminalId: "11111111-1111-4111-8111-111111111111",
            hostName: "host-a",
            name: "Planner: odu docs",
            agent: "omp",
            level: "stopped",
            at: AT,
          },
        ],
      },
    ]);

    // THE RUNGS: the work-carrying ask row becomes its own kind (1.53.0), its
    // outcome becomes where it stands (1.55.0), and the stamp moves, so the
    // reader of today accepts the file they leave behind.
    splitWorkAskRows_1_53_0(root);
    workAskStanding_1_55_0(root);
    expect(
      JSON.parse(readFileSync(path, "utf8")) as { version: string },
    ).toMatchObject({ version: TRANSCRIPT_FILE_VERSION });
    const rows = readPersistedTranscript(
      transcriptFileStore(root, TRANSCRIPT_FILE_VERSION),
      path,
      root,
    ).rows;

    expect(rows.map((one) => one.kind)).toEqual([
      "user",
      "tool",
      "ask",
      "work-ask",
      "wake",
    ]);
    const user = rows[0];
    if (user?.kind !== "user") throw new Error("the user row went missing");
    // Written without the key; read as "nothing rode along", not refused.
    expect(user.attachments).toEqual([]);
    // The ask about NO work stayed an `ask` — and has nowhere to put a work.
    const ask = rows[2];
    if (ask?.kind !== "ask") throw new Error("the ask row went missing");
    expect("work" in ask).toBe(false);
    // ... and the one that named a work is the kind that carries one.
    const workAsk = rows[3];
    if (workAsk?.kind !== "work-ask")
      throw new Error("the work-ask row went missing");
    expect(workAsk.work).toBe("work:abc123");
    expect(workAsk.text).toBe("Which plan should the implementor take?");
  });
});

describe("the 1.53.0 rung — three cards for one branch become one piece of work", () => {
  /** The human's REAL store at 1.52.0, as their deployed build left it after
   *  the false "gone" (juspay/kolu#2376, round 4): ONE waterfall — odu's docs
   *  on `docs-human-reading`, PR #181 — written down three times, two of them
   *  ended `abandoned`. Host names and home paths are replaced; nothing else
   *  is touched. */
  const THREE = JSON.parse(
    readFileSync(
      new URL("./fixtures/deployed-1.52.0-three-works.json", import.meta.url),
      "utf8",
    ),
  ) as { works: unknown[]; members: Record<string, unknown> };

  const folded = () => foldWorksByKey_1_53_0(THREE.works, THREE.members);

  it("folds the three into ONE work, keyed by its branch, and OPEN", () => {
    const { works } = folded();
    const ids = Object.keys(works);
    expect(ids).toHaveLength(1);
    const id = ids[0] ?? "";
    expect(id).toBe(
      workIdOf({
        kind: "branch",
        host: "remote:host-d",
        repo: "/home/person/code/odu",
        branch: "docs-human-reading",
      }),
    );
    const work = works[id] as Record<string, unknown>;
    // `abandoned` does not exist: nothing kolu merely failed to SEE ends a
    // piece of work, so the human's real waterfall is in progress again.
    expect(work.state).toEqual({ kind: "open" });
    expect(work.title).toBe(
      "Rewrite odu's docs for human reading (like kolu PR #2375)",
    );
  });

  it("keeps every decision, drops the `host` ones, and keeps the timeline", () => {
    const { works } = folded();
    const work = Object.values(works)[0] as {
      decisions: ReadonlyArray<Record<string, unknown>>;
      events: ReadonlyArray<Record<string, unknown>>;
    };
    expect(work.decisions.length).toBeGreaterThanOrEqual(8);
    expect(work.decisions.some((one) => one.key === "host")).toBe(false);
    // Every decision is one arm of the sum or the other, never "answered with
    // null".
    expect(
      work.decisions.every(
        (one) => one.kind === "asked" || one.kind === "answered",
      ),
    ).toBe(true);
    // ONE pull request, said once, however many of the three works saw it
    // open — and every check event carries it.
    const prs = work.events.filter((one) => one.kind === "pr-opened");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.pr).toBe(181);
    expect(
      work.events
        .filter((one) => String(one.kind).startsWith("checks-"))
        .every((one) => one.pr === 181),
    ).toBe(true);
    // The full timeline: what the three recorded between them, in time order,
    // with nothing kolu cannot say any more.
    expect(work.events.length).toBeGreaterThan(40);
    expect(work.events.some((one) => one.kind === "ended")).toBe(false);
  });

  it("re-keys the members into the one map, one per role", () => {
    const { works, members } = folded();
    const id = Object.keys(works)[0] ?? "";
    const rows = Object.values(members) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.every((one) => one.work === id)).toBe(true);
    expect(rows.map((one) => one.role).sort()).toEqual([
      "implementor",
      "planner",
    ]);
    // The watch bookkeeping rides in the same row — one member, one place.
    expect(rows.every((one) => recordLike(one.watch))).toBe(true);
    expect(
      rows.every(
        (one) =>
          one.worktree ===
          "/home/person/code/odu/.worktrees/docs-human-reading",
      ),
    ).toBe(true);
  });

  it("drops a work that never got past its setup and has no twin", () => {
    const { works } = foldWorksByKey_1_53_0(
      [
        {
          id: "w",
          title: "nothing happened here",
          repo: "",
          branch: "",
          members: [],
          events: [
            {
              at: "t",
              by: "you",
              kind: "requested",
              terminal: null,
              detail: "",
            },
          ],
          decisions: [],
          startedAt: "t",
          endedAt: null,
          outcome: null,
          keptFiles: [],
        },
      ],
      {},
    );
    expect(Object.keys(works)).toHaveLength(0);
  });
});

describe("the 1.53.0 rung — the human's store as it stands, and its kept files", () => {
  /** The SAME waterfall, a round later: the human's live 1.52.0 store after
   *  the Conductor merged PR #181 and closed both terminals, so all THREE
   *  works are ended `abandoned` and each kept the twenty-odd documents of
   *  the one `.waterfall/` (juspay/kolu#2376, round 5). Sanitized exactly as
   *  its sibling fixture is. */
  const ALL_ENDED = JSON.parse(
    readFileSync(
      new URL("./fixtures/deployed-1.52.0-all-ended.json", import.meta.url),
      "utf8",
    ),
  ) as {
    works: Array<{ id: string; endedAt: string }>;
    members: Record<string, unknown>;
  };

  const folded = () =>
    foldWorksByKey_1_53_0(ALL_ENDED.works, ALL_ENDED.members);

  it("says each file ONCE, and says nothing about kept files", () => {
    const { works } = folded();
    expect(Object.keys(works)).toHaveLength(1);
    const work = Object.values(works)[0] as {
      state: { kind: string };
      events: Array<Record<string, unknown>>;
    };
    // Nothing the forge said ended these: `abandoned` is kolu losing sight of
    // its own terminals, so the work is in progress.
    expect(work.state.kind).toBe("open");
    const files = work.events.filter((one) => one.kind === "file");
    // Three cards watched one worktree fill up, so the naive union listed
    // every document three times over.
    expect(files.length).toBeGreaterThan(20);
    expect(new Set(files.map((one) => one.path)).size).toBe(files.length);
    // Kept files are what an ENDED work left behind; this one is open, and
    // its files are still in its worktree.
    expect(work.events.some((one) => one.kind === "kept")).toBe(false);
    // What a person ASKED FOR is not a repetition — three requests were three
    // things said, and all three stay.
    expect(work.events.filter((one) => one.kind === "requested")).toHaveLength(
      3,
    );
  });

  it("moves every old work's kept files into the one new directory", () => {
    const root = mkdtempSync(join(tmpdir(), "kolu-kept-"));
    dirs.push(root);
    const [one, two, three] = ALL_ENDED.works;
    if (one === undefined || two === undefined || three === undefined)
      throw new Error("the fixture lost a work");
    // Three REAL directories, named by the ids the works are about to lose,
    // with a file only one of them has and a file all three kept.
    for (const [work, body] of [
      [one, "oldest"],
      [two, "middle"],
      [three, "newest"],
    ] as const) {
      mkdirSync(join(root, work.id, ".waterfall"), { recursive: true });
      writeFileSync(join(root, work.id, ".waterfall/plan.md"), body);
      writeFileSync(join(root, work.id, ".waterfall", `${body}.md`), body);
    }
    const { works, moves } = folded();
    const id = Object.keys(works)[0] ?? "";
    moveKeptFiles_1_53_0(root, moves);

    const dir = join(root, workDirOf(id));
    expect(readdirSync(root)).toEqual([workDirOf(id)]);
    expect(readdirSync(join(dir, ".waterfall")).sort()).toEqual([
      "middle.md",
      "newest.md",
      "oldest.md",
      "plan.md",
    ]);
    // The same path from three works: the copy of the one that ended LAST is
    // the one a person reads.
    expect(readFileSync(join(dir, ".waterfall/plan.md"), "utf8")).toBe(
      "newest",
    );
    expect(readFileSync(join(dir, ".waterfall/oldest.md"), "utf8")).toBe(
      "oldest",
    );
    // No orphan left behind for the sweep to find.
    for (const work of [one, two, three])
      expect(existsSync(join(root, work.id))).toBe(false);
  });
});

const recordLike = (value: unknown): boolean =>
  typeof value === "object" && value !== null;

describe("the 1.54.0 rung — a role's harness and model are kolu's options", () => {
  const AT_54 = "2026-11-01T00:00:00.000Z";

  /** A real store stamped at 1.53.0, holding the works record below, reopened
   *  through the LIVE ladder AS FAR AS `to` — 1.54.0 by default, so this
   *  describe reads what THAT rung produces rather than what a later one does
   *  to its output. (1.55.0 takes these same decisions to their arms; it has
   *  its own describe below, and its own walk to the live head.) */
  const walk = (
    works: Record<string, unknown>,
    to = "1.54.0",
  ): Record<string, unknown> => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-kolu-choice-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: DEFAULT_PREFERENCES,
        works,
        __internal__: { migrations: { version: "1.53.0" } },
      }),
    );
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: to,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
      migrations: CONF_MIGRATIONS as never,
    });
    expect(store.get("__internal__" as never)).toBeDefined();
    return readJson(store.path).works as Record<string, unknown>;
  };

  const ID = "branch:local/%2Frepo/setup-choices";

  const WORKS = {
    [ID]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "setup" },
      title: "the setup form",
      startedAt: AT_54,
      decisions: [
        // (a) an OPEN question the Conductor offered its own model list for.
        {
          kind: "asked",
          id: "d-model",
          ask: "ask-1",
          at: AT_54,
          key: "planner.model",
          header: "",
          question: "Which model should plan?",
          options: ["opus", "sonnet"],
          multiple: false,
          file: "",
        },
        // (b) an ANSWERED harness question, options and all.
        {
          kind: "answered",
          id: "d-harness",
          ask: "ask-1",
          at: AT_54,
          key: "implementor.harness",
          header: "",
          question: "Which harness implements?",
          options: ["claude", "omp"],
          multiple: false,
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: ["omp"],
            text: null,
            from: "card",
          },
        },
        // ... and a question whose options are still the asker's.
        {
          kind: "asked",
          id: "d-mode",
          ask: "ask-1",
          at: AT_54,
          key: "mode",
          header: "",
          question: "How should this run?",
          options: ["full", "trivial"],
          multiple: false,
          file: "",
        },
        // (c) a LEGACY TYPED answer: the value lived in `text`.
        {
          kind: "answered",
          id: "d-typed",
          ask: "ask-1",
          at: AT_54,
          key: "planner.harness",
          header: "",
          question: "Which harness plans?",
          options: ["claude", "omp"],
          multiple: true,
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: [],
            text: "omp",
            from: "card",
          },
        },
        // (d) a legacy MULTIPLE answer, with a typed value beside it: the
        // reading took `picked[0]`, so that is the one value kept.
        {
          kind: "answered",
          id: "d-many",
          ask: "ask-1",
          at: AT_54,
          key: "implementor.model",
          header: "",
          question: "Which model implements?",
          options: ["opus", "sonnet"],
          multiple: true,
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: ["omp", "claude"],
            text: "codex",
            from: "card",
          },
        },
        // (e) a typed value kolu will refuse at start — kept VERBATIM here.
        {
          kind: "answered",
          id: "d-fable",
          ask: "ask-2",
          at: AT_54,
          key: "planner.model",
          header: "",
          question: "Which model plans?",
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: [],
            text: "fable 5.2",
            from: "card",
          },
        },
        // (f) a DECLINED kolu-choice answer: no value at all.
        {
          kind: "answered",
          id: "d-declined",
          ask: "ask-2",
          at: AT_54,
          key: "implementor.harness",
          header: "",
          question: "Which harness implements?",
          file: "",
          answer: {
            at: AT_54,
            how: "declined",
            picked: [],
            text: "never mind",
            from: "card",
          },
        },
        // (g) an ANSWERED `mode` question, typed: not kolu's to narrow.
        {
          kind: "answered",
          id: "d-mode-answered",
          ask: "ask-2",
          at: AT_54,
          key: "on-green",
          header: "",
          question: "What on green?",
          options: ["merge", "stop"],
          multiple: true,
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: ["merge", "stop"],
            text: "and tell me",
            from: "card",
          },
        },
        // (h) a KEYLESS answered question: nothing here names it.
        {
          kind: "answered",
          id: "d-keyless",
          ask: "ask-2",
          at: AT_54,
          key: null,
          header: "",
          question: "Anything else?",
          options: ["yes", "no"],
          multiple: true,
          file: "",
          answer: {
            at: AT_54,
            how: "answered",
            picked: [],
            text: "carry on",
            from: "card",
          },
        },
      ],
      events: [],
      state: { kind: "open" },
    },
  };

  const decisionsOf = (works: Record<string, unknown>) =>
    (
      (works[ID] as { decisions: Array<Record<string, unknown>> }).decisions ??
      []
    ).reduce<Record<string, Record<string, unknown>>>((all, one) => {
      all[one.id as string] = one;
      return all;
    }, {});

  it("drops options and multiple from the four kolu-choice decisions only", () => {
    const after = decisionsOf(walk(structuredClone(WORKS)));

    // The open question becomes one kolu draws the options for — which is
    // what makes it answerable at all after this change.
    expect(after["d-model"]).toBeDefined();
    expect("options" in (after["d-model"] ?? {})).toBe(false);
    expect("multiple" in (after["d-model"] ?? {})).toBe(false);
    expect(after["d-model"]?.question).toBe("Which model should plan?");

    // The answered one loses the same two fields and keeps its answer: that
    // `picked` is what the readings read.
    expect("options" in (after["d-harness"] ?? {})).toBe(false);
    expect("multiple" in (after["d-harness"] ?? {})).toBe(false);
    expect(after["d-harness"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });

    // A question whose options are the asker's keeps them.
    expect(after["d-mode"]?.options).toEqual(["full", "trivial"]);
    expect(after["d-mode"]?.multiple).toBe(false);
  });

  it("narrows every kolu-choice answer to the one value the reading took", () => {
    const after = decisionsOf(walk(structuredClone(WORKS)));

    // A legacy TYPED answer: the value moves out of `text` into `picked`.
    expect(after["d-typed"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });
    // A legacy MULTIPLE answer keeps the first pick — what was read before —
    // and the typed text beside it goes.
    expect(after["d-many"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });
    // A typed value kolu cannot offer is kept VERBATIM: refusing it is the
    // start's job, not the rung's.
    expect(after["d-fable"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["fable 5.2"],
      text: null,
      from: "card",
    });
    // Declined: no value, and the text that came with it goes too.
    expect(after["d-declined"]?.answer).toEqual({
      at: AT_54,
      how: "declined",
      picked: [],
      text: null,
      from: "card",
    });
  });

  it("leaves an answer kolu does not draw the options for alone", () => {
    const after = decisionsOf(walk(structuredClone(WORKS)));

    expect(after["d-mode-answered"]).toEqual(
      (WORKS[ID].decisions as Array<Record<string, unknown>>).find(
        (one) => one.id === "d-mode-answered",
      ),
    );
    expect(after["d-keyless"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: [],
      text: "carry on",
      from: "card",
    });
  });

  it("writes nothing when every decision is already in the new shape", () => {
    const once = walk(structuredClone(WORKS));
    const dir = mkdtempSync(join(tmpdir(), "kolu-kolu-choice-again-"));
    dirs.push(dir);
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
    });
    store.set("works", once);
    const set = vi.spyOn(store, "set");
    dropKoluChoiceOptions_1_54_0(store as never);
    expect(set).not.toHaveBeenCalled();
    expect(store.get("works")).toEqual(once);
  });

  it("decodes through the live works schema once the ladder is walked out, and runs again as a no-op", () => {
    // The live schema is the HEAD's, so the record is taken to the head: what
    // 1.54.0 leaves is 1.55.0's input, and the two together are what a
    // person's store does on the boot after this change.
    const once = walk(structuredClone(WORKS), SCHEMA_VERSION);
    const decoded = Schema.decodeUnknownResult(PersistedWorksSchema)(once);
    expect(Result.isSuccess(decoded)).toBe(true);
    // Idempotent: the walked record fed back through the rungs is unchanged.
    expect(walk(structuredClone(once), SCHEMA_VERSION)).toEqual(once);
  });
});

describe("the 1.55.0 rung — no hole in the work model", () => {
  const AT = "2026-11-10T00:00:00.000Z";
  const ID = "branch:local/%2Frepo/setup-choices";
  const REF = "local/aaaa";

  /** A real store stamped at 1.54.0, walked to the LIVE head — what the boot
   *  after this change does to a person's file, transcript and all. Answers
   *  the whole config plus the state root, so a case can read the transcript
   *  the rung rewrote beside it. */
  const walk = (
    seed: Record<string, unknown>,
  ): { readonly state: Record<string, unknown> } => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-no-null-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: DEFAULT_PREFERENCES,
        ...seed,
        __internal__: { migrations: { version: "1.54.0" } },
      }),
    );
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
      migrations: CONF_MIGRATIONS as never,
    });
    return { state: readJson(store.path) };
  };

  /** One work's decisions after the walk, by their own ids. */
  const decisionsOf = (
    state: Record<string, unknown>,
  ): Record<string, Record<string, unknown>> => {
    const works = state.works as Record<string, { decisions: unknown[] }>;
    const all: Record<string, Record<string, unknown>> = {};
    for (const one of works[ID]?.decisions ?? []) {
      const decision = one as Record<string, unknown>;
      all[decision.id as string] = decision;
    }
    return all;
  };

  /** A 1.54.0 work, open unless the case ends it. */
  const workWith = (
    decisions: ReadonlyArray<Record<string, unknown>>,
    events: ReadonlyArray<Record<string, unknown>> = [],
    state: Record<string, unknown> = { kind: "open" },
  ) => ({
    [ID]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "setup" },
      title: "the setup form",
      startedAt: AT,
      decisions,
      events,
      state,
    },
  });

  /** The shape a 1.54.0 decision has: every field, including the two a setup
   *  question has no use for and the `key: null` a work question carried. */
  const decision = (fields: Record<string, unknown>) => ({
    kind: "asked",
    ask: "ask-1",
    at: AT,
    key: null,
    header: "",
    question: "?",
    file: "",
    ...fields,
  });

  it("takes a question about the work to its header, file and said arms", () => {
    const { state } = walk({
      works: workWith([
        decision({
          id: "d-plan",
          kind: "answered",
          header: "The plan",
          question: "Approve the plan?",
          options: ["Approve", "Change it"],
          multiple: false,
          file: ".waterfall/plan.md",
          answer: {
            at: AT,
            how: "answered",
            picked: ["Approve"],
            text: "  ship it  ",
            from: "reader",
          },
        }),
        decision({
          id: "d-typed",
          kind: "answered",
          question: "Anything else?",
          options: [],
          multiple: false,
          answer: {
            at: AT,
            how: "answered",
            picked: [],
            text: "carry on",
            from: null,
          },
        }),
        decision({
          id: "d-open",
          question: "Still thinking?",
          options: ["yes"],
          multiple: true,
        }),
      ]),
    });
    const after = decisionsOf(state);

    expect(after["d-plan"]).toEqual({
      kind: "settled",
      id: "d-plan",
      ask: "ask-1",
      at: AT,
      topic: "work",
      question: "Approve the plan?",
      header: { kind: "header", text: "The plan" },
      options: ["Approve", "Change it"],
      multiple: false,
      file: { kind: "file", path: ".waterfall/plan.md" },
      answer: {
        how: "answered",
        at: AT,
        from: "reader",
        said: {
          kind: "picked-and-typed",
          picked: ["Approve"],
          text: "ship it",
        },
      },
    });
    // No key at all on a question about the work — and an answer kolu
    // carried over from the file it kept says so by name.
    expect("key" in (after["d-typed"] ?? {})).toBe(false);
    expect(after["d-typed"]?.header).toEqual({ kind: "none" });
    expect(after["d-typed"]?.file).toEqual({ kind: "none" });
    expect(after["d-typed"]?.answer).toEqual({
      how: "answered",
      at: AT,
      from: "carried-over",
      said: { kind: "typed", text: "carry on" },
    });
    expect(after["d-open"]?.kind).toBe("asked");
    expect("answer" in (after["d-open"] ?? {})).toBe(false);
  });

  it("takes a setup question to its key's own words, with no header, file or multiple", () => {
    const { state } = walk({
      works: workWith([
        decision({
          id: "d-mode",
          kind: "answered",
          key: "mode",
          header: "How",
          question: "How should this run?",
          // `stop` is nobody's word for a mode: it cannot be offered.
          options: ["full", "trivial", "stop"],
          multiple: true,
          answer: {
            at: AT,
            how: "answered",
            picked: ["full"],
            text: "and quickly",
            from: "card",
          },
        }),
        decision({
          id: "d-green",
          kind: "answered",
          key: "on-green",
          options: ["merge", "hand-over"],
          multiple: false,
          answer: {
            at: AT,
            how: "answered",
            picked: [],
            text: " merge ",
            from: "chat",
          },
        }),
        decision({
          id: "d-harness",
          kind: "answered",
          key: "planner.harness",
          answer: {
            at: AT,
            how: "answered",
            picked: ["omp"],
            text: null,
            from: "card",
          },
        }),
        decision({
          id: "d-declined",
          kind: "answered",
          key: "implementor.harness",
          answer: {
            at: AT,
            how: "declined",
            picked: [],
            text: null,
            from: "card",
          },
        }),
        decision({
          id: "d-faceless",
          kind: "answered",
          key: "implementor.model",
          answer: {
            at: AT,
            how: "declined",
            picked: [],
            text: null,
            from: null,
          },
        }),
      ]),
    });
    const after = decisionsOf(state);

    expect(after["d-mode"]).toEqual({
      kind: "settled",
      id: "d-mode",
      ask: "ask-1",
      at: AT,
      topic: "setup",
      key: "mode",
      question: "How should this run?",
      options: ["full", "trivial"],
      answer: { how: "answered", at: AT, from: "card", value: "full" },
    });
    // A typed on-green answer is one of kolu's words once it is trimmed.
    expect(after["d-green"]?.answer).toEqual({
      how: "answered",
      at: AT,
      from: "chat",
      value: "merge",
    });
    // Kolu's own choices carry no options at all — and, walked on to head,
    // say how they were chosen (1.56.0).
    expect("options" in (after["d-harness"] ?? {})).toBe(false);
    expect(after["d-harness"]?.answer).toEqual({
      how: "answered",
      at: AT,
      from: "card",
      value: "omp",
      chosen: "picked",
    });
    // A decline keeps the face it was said on; a decline with no face is
    // nobody declining, which is what `dropped` means.
    expect(after["d-declined"]?.answer).toEqual({
      how: "declined",
      at: AT,
      from: "card",
    });
    expect(after["d-faceless"]?.answer).toEqual({ how: "dropped", at: AT });
  });

  it("asks an empty answer again in an open work, and drops it in an ended one", () => {
    const empty = (id: string, key: string) =>
      decision({
        id,
        kind: "answered",
        key,
        question: `Which model for ${key}?`,
        answer: {
          at: AT,
          how: "answered",
          picked: [],
          text: null,
          from: "chat",
        },
      });

    const open = decisionsOf(
      walk({ works: workWith([empty("d", "planner.model")]) }).state,
    );
    expect(open.d?.kind).toBe("asked");
    expect(open.d?.ask).toBe("ask-1");
    expect("answer" in (open.d ?? {})).toBe(false);

    const ended = decisionsOf(
      walk({
        works: workWith([empty("d", "planner.model")], [], {
          kind: "ended",
          at: AT,
          outcome: { kind: "stopped", by: "you" },
          kept: [],
        }),
      }).state,
    );
    expect(ended.d?.kind).toBe("settled");
    expect(ended.d?.answer).toEqual({ how: "dropped", at: AT });
  });

  it("takes every event to what it is about, and says a part-answered form is part-answered", () => {
    const { state } = walk({
      works: workWith(
        [
          decision({
            id: "d-open",
            key: "planner.model",
            kind: "answered",
            answer: {
              at: AT,
              how: "answered",
              picked: [],
              text: null,
              from: "chat",
            },
          }),
        ],
        [
          {
            at: AT,
            by: "you",
            kind: "requested",
            terminal: null,
            text: "fix the thing",
          },
          { at: AT, by: "kolu", kind: "carried-over", terminal: null },
          { at: AT, by: "agent", kind: "stopped", terminal: REF, why: "" },
          {
            at: AT,
            by: "agent",
            kind: "asking",
            terminal: REF,
            why: "needs a model",
          },
          {
            at: AT,
            by: "ci",
            kind: "checks-running",
            terminal: null,
            pr: 7,
            head: null,
            failing: [],
          },
          {
            at: AT,
            by: "ci",
            kind: "checks-failed",
            terminal: null,
            pr: 7,
            head: "abc1234",
            failing: ["build"],
          },
          { at: AT, by: "you", kind: "answered", terminal: null, ask: "ask-1" },
        ],
      ),
    });
    const events = (
      state.works as Record<string, { events: Record<string, unknown>[] }>
    )[ID]?.events as Record<string, unknown>[];

    expect(events[0]).toEqual({
      at: AT,
      by: "you",
      kind: "requested",
      about: { kind: "work" },
      request: { kind: "said", text: "fix the thing" },
    });
    expect(events[1]?.about).toEqual({ kind: "work" });
    expect(events[2]?.about).toEqual({ kind: "member", terminal: REF });
    expect(events[2]?.why).toEqual({ kind: "none" });
    expect(events[3]?.why).toEqual({ kind: "reason", text: "needs a model" });
    expect(events[4]?.head).toEqual({ kind: "unreported" });
    expect(events[5]?.head).toEqual({ kind: "commit", sha: "abc1234" });
    // The ask this rung just re-opened was never finished, so the line that
    // said it was says what is true instead.
    expect(events[6]?.kind).toBe("answered-part");
  });

  it("says whether a member's worktree has been read", () => {
    const { state } = walk({
      works: workWith([]),
      members: {
        [REF]: {
          work: ID,
          role: "planner",
          joinedAt: AT,
          worktree: null,
          watch: {
            name: "",
            agent: null,
            told: null,
            joined: "asked",
            spoken: false,
            ran: false,
          },
        },
        "local/bbbb": {
          work: ID,
          role: "implementor",
          joinedAt: AT,
          worktree: "/repo",
          watch: {
            name: "",
            agent: null,
            told: null,
            joined: "asked",
            spoken: false,
            ran: false,
          },
        },
      },
    });
    const members = state.members as Record<string, Record<string, unknown>>;
    expect(members[REF]?.worktree).toEqual({ kind: "unread" });
    expect(members["local/bbbb"]?.worktree).toEqual({
      kind: "read",
      path: "/repo",
    });
  });

  it("takes a work-ask row's outcome to a standing, and leaves a plain ask row alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-no-null-rows-"));
    dirs.push(dir);
    const plain = {
      key: "r-0",
      at: AT,
      by: "agent",
      kind: "ask",
      text: "May I?",
      ask: { fields: [], link: null, outcome: null },
    };
    writeTranscriptFile(transcriptFilePath(dir), "1.53.0", [
      plain,
      {
        key: "r-1",
        at: AT,
        by: "kolu",
        kind: "work-ask",
        text: "Which model?",
        work: ID,
        ask: { fields: [], link: null, outcome: null },
      },
      {
        key: "r-2",
        at: AT,
        by: "kolu",
        kind: "work-ask",
        text: "Which model?",
        work: ID,
        ask: {
          fields: [],
          link: { href: "x", label: "x" },
          outcome: {
            how: "answered",
            answers: [
              { key: "planner.model", values: [] },
              { key: "planner.harness", values: ["omp"] },
            ],
          },
        },
      },
      {
        key: "r-3",
        at: AT,
        by: "kolu",
        kind: "work-ask",
        text: "Which model?",
        work: ID,
        ask: {
          fields: [],
          link: null,
          outcome: { how: "answered", answers: [{ key: "mode", values: [] }] },
        },
      },
      {
        key: "r-4",
        at: AT,
        by: "kolu",
        kind: "work-ask",
        text: "Which model?",
        work: ID,
        ask: {
          fields: [],
          link: null,
          outcome: { how: "withdrawn", answers: [] },
        },
      },
    ] as never);

    workAskStanding_1_55_0(dir);

    const file = readJson(transcriptFilePath(dir));
    expect(file.version).toBe(TRANSCRIPT_FILE_VERSION);
    const rows = file.rows as Array<Record<string, unknown>>;
    // A plain ask — the agent holding a call open on a person — is not this
    // rung's business.
    expect(rows[0]).toEqual(plain);
    const askOf = (at: number) => rows[at]?.ask as Record<string, unknown>;
    expect(askOf(1)).toEqual({ fields: [], standing: { kind: "open" } });
    // The link goes, and only the answers that HAVE values are answers.
    expect(askOf(2)).toEqual({
      fields: [],
      standing: {
        kind: "answered",
        answers: [{ key: "planner.harness", values: ["omp"] }],
      },
    });
    // "Answered" with nothing in it is nobody answering.
    expect(askOf(3)).toEqual({ fields: [], standing: { kind: "declined" } });
    expect(askOf(4)).toEqual({ fields: [], standing: { kind: "withdrawn" } });

    // Idempotent, and a file with nothing left to do is not rewritten.
    const again = readFileSync(transcriptFilePath(dir), "utf8");
    workAskStanding_1_55_0(dir);
    expect(readFileSync(transcriptFilePath(dir), "utf8")).toBe(again);
  });

  it("restamps a transcript with no work-ask row, and names why a refusal was signed out", () => {
    // A transcript after a New session holds no form at all — and the reader
    // takes exactly the stamp it was built with, so leaving this at 1.53.0
    // would refuse the file on the boot that ran the rung.
    const dir = mkdtempSync(join(tmpdir(), "kolu-transcript-stamp-"));
    dirs.push(dir);
    writeTranscriptFile(transcriptFilePath(dir), "1.53.0", [
      {
        key: "u-1",
        at: AT,
        kind: "user",
        text: "hi",
        delivery: "refused",
        auth: true,
      },
      {
        key: "u-2",
        at: AT,
        kind: "user",
        text: "and you",
        delivery: "refused",
      },
    ] as never);

    workAskStanding_1_55_0(dir);

    const file = readJson(transcriptFilePath(dir));
    expect(file.version).toBe(TRANSCRIPT_FILE_VERSION);
    expect(file.rows).toEqual([
      {
        key: "u-1",
        at: AT,
        kind: "user",
        text: "hi",
        delivery: "refused",
        signIn: "signed-out",
      },
      {
        key: "u-2",
        at: AT,
        kind: "user",
        text: "and you",
        delivery: "refused",
      },
    ]);
    const again = readFileSync(transcriptFilePath(dir), "utf8");
    workAskStanding_1_55_0(dir);
    expect(readFileSync(transcriptFilePath(dir), "utf8")).toBe(again);
  });

  it("writes nothing when every work is already in the new shape", () => {
    const { state } = walk({ works: workWith([decision({ id: "d" })]) });
    const dir = mkdtempSync(join(tmpdir(), "kolu-no-null-again-"));
    dirs.push(dir);
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
    });
    store.set("works", state.works);
    store.set("members", state.members);
    const set = vi.spyOn(store, "set");
    workArmsNotNulls_1_55_0(store as never);
    expect(set).not.toHaveBeenCalled();
  });

  describe("the human's own bytes", () => {
    /** THE DECISION THIS ROUND EXISTS FOR, exactly as it sits in the human's
     *  store: "answered", from the chat, with nothing picked and nothing
     *  typed. Two of them — one model question per role — on an OPEN work
     *  whose harness, mode and on-green answers all landed. */
    const emptyModel = (role: string) => ({
      id: `d-${role}-model`,
      ask: "ask-setup",
      at: AT,
      kind: "answered",
      key: `${role}.model`,
      header: "",
      question: `Which model should ${role}?`,
      file: "",
      answer: {
        how: "answered",
        picked: [],
        text: null,
        from: "chat",
        at: AT,
      },
    });
    const answered = (id: string, key: string, value: string) => ({
      id,
      ask: "ask-setup",
      at: AT,
      kind: "answered",
      key,
      header: "",
      question: key,
      file: "",
      ...(key === "mode" || key === "on-green"
        ? {
            options:
              key === "mode" ? ["full", "trivial"] : ["merge", "hand-over"],
            multiple: false,
          }
        : {}),
      answer: {
        how: "answered",
        picked: [value],
        text: null,
        from: "chat",
        at: AT,
      },
    });

    const SEED = {
      works: workWith(
        [
          answered("d-mode", "mode", "full"),
          answered("d-planner-harness", "planner.harness", "omp"),
          emptyModel("planner"),
          answered("d-implementor-harness", "implementor.harness", "omp"),
          emptyModel("implementor"),
          answered("d-green", "on-green", "merge"),
        ],
        [
          {
            at: AT,
            by: "you",
            kind: "answered",
            terminal: null,
            ask: "ask-setup",
          },
        ],
      ),
    };

    it("brings both model questions back to ASKED, in the same ask, and decodes", () => {
      const { state } = walk(structuredClone(SEED));
      const after = decisionsOf(state);

      for (const role of ["planner", "implementor"]) {
        const one = after[`d-${role}-model`];
        expect(one?.kind).toBe("asked");
        expect(one?.ask).toBe("ask-setup");
        expect(one?.topic).toBe("setup");
        expect(one?.key).toBe(`${role}.model`);
        expect("answer" in (one ?? {})).toBe(false);
      }
      // What they DID answer is still answered.
      expect(after["d-mode"]?.answer).toEqual({
        how: "answered",
        at: AT,
        from: "chat",
        value: "full",
      });
      expect(after["d-planner-harness"]?.answer).toEqual({
        how: "answered",
        at: AT,
        from: "chat",
        value: "omp",
        chosen: "picked",
      });
      // The form was not finished, so the line that said it was does not say
      // it any more.
      const events = (
        state.works as Record<
          string,
          { events: Array<Record<string, unknown>> }
        >
      )[ID]?.events;
      expect(events?.[0]?.kind).toBe("answered-part");

      // ... and the whole record reads back through the live schema.
      const decoded = Schema.decodeUnknownResult(PersistedWorksSchema)(
        state.works,
      );
      expect(Result.isSuccess(decoded)).toBe(true);
    });

    it("runs again as a no-op", () => {
      const once = walk(structuredClone(SEED)).state;
      const twice = walk({
        works: once.works as Record<string, unknown>,
        members: once.members as Record<string, unknown>,
      }).state;
      expect(twice.works).toEqual(once.works);
      expect(twice.members).toEqual(once.members);
    });
  });
});

describe("the 1.56.0 rung — an answer to one of kolu's questions says how it was chosen", () => {
  const AT = "2026-11-15T00:00:00.000Z";
  const ID = "branch:local/%2Frepo/setup-choices";

  /** One 1.55.0 decision: settled, in the shape that rung left. */
  const settled = (id: string, key: string, answer: Record<string, unknown>) =>
    key === "mode" || key === "on-green"
      ? {
          kind: "settled",
          id,
          ask: "ask-setup",
          at: AT,
          topic: "setup",
          key,
          question: key,
          options: key === "mode" ? ["trivial"] : ["merge"],
          answer,
        }
      : {
          kind: "settled",
          id,
          ask: "ask-setup",
          at: AT,
          topic: "setup",
          key,
          question: key,
          answer,
        };

  const SEED = {
    [ID]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "setup" },
      title: "the setup form",
      startedAt: AT,
      decisions: [
        settled("d-mode", "mode", {
          how: "answered",
          at: AT,
          from: "card",
          value: "trivial",
        }),
        settled("d-harness", "implementor.harness", {
          how: "answered",
          at: AT,
          from: "card",
          value: "omp",
        }),
        settled("d-model", "implementor.model", {
          how: "answered",
          at: AT,
          from: "card",
          value: "anthropic/claude-fable-5-2",
        }),
        settled("d-declined", "planner.model", {
          how: "declined",
          at: AT,
          from: "card",
        }),
      ],
      events: [],
      state: { kind: "open" },
    },
  };

  /** A real store stamped at 1.55.0 — the shape the human's store holds —
   *  walked to the live head. */
  const walk = (works: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-how-chosen-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: DEFAULT_PREFERENCES,
        works,
        __internal__: { migrations: { version: "1.55.0" } },
      }),
    );
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
      migrations: CONF_MIGRATIONS as never,
    });
    return { store, state: readJson(store.path) };
  };

  it("makes every answered kolu choice a pick, leaves everything else, and decodes", () => {
    const { state } = walk(structuredClone(SEED));
    const decisions = (
      state.works as Record<string, { decisions: Record<string, unknown>[] }>
    )[ID]?.decisions;
    const answerOf = (id: string) =>
      decisions?.find((one) => one.id === id)?.answer;
    expect(answerOf("d-harness")).toEqual({
      how: "answered",
      at: AT,
      from: "card",
      value: "omp",
      chosen: "picked",
    });
    expect(answerOf("d-model")).toMatchObject({ chosen: "picked" });
    // Not one of kolu's choices, or not answered: the same bytes.
    expect(answerOf("d-mode")).toEqual({
      how: "answered",
      at: AT,
      from: "card",
      value: "trivial",
    });
    expect(answerOf("d-declined")).toEqual({
      how: "declined",
      at: AT,
      from: "card",
    });
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PersistedWorksSchema)(state.works),
      ),
    ).toBe(true);
  });

  it("writes nothing to a store already in the new shape", () => {
    const { store } = walk(structuredClone(SEED));
    const set = vi.spyOn(store, "set");
    koluChoicesSayHowChosen_1_56_0(store as never);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("the 1.57.0 rung — a PR's address and the forge's merge answer", () => {
  const AT = "2026-11-16T00:00:00.000Z";
  const LATER = "2026-11-16T00:10:00.000Z";
  const ID = "branch:local/%2Frepo/merged-before";
  const HEAD = { kind: "commit", sha: "4f21a9c" };
  const WORK = { kind: "work" };

  /** A finished work as 1.56.0 stores it: a PR opened with no address, its
   *  checks passed (which then WAS green) and the forge merged it. */
  const SEED = {
    [ID]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "b" },
      title: "merged before the rung",
      startedAt: AT,
      decisions: [],
      events: [
        {
          at: AT,
          by: "you",
          about: WORK,
          kind: "requested",
          request: { kind: "none" },
        },
        {
          at: AT,
          by: "kolu",
          about: WORK,
          kind: "pr-opened",
          pr: 9,
          title: "t",
        },
        {
          at: AT,
          by: "ci",
          about: WORK,
          kind: "checks-passed",
          pr: 9,
          head: HEAD,
          failing: [],
        },
        { at: LATER, by: "kolu", about: WORK, kind: "merged", pr: 9 },
        {
          at: LATER,
          by: "kolu",
          about: WORK,
          kind: "ended",
          outcome: { kind: "merged", pr: 9 },
        },
      ],
      state: {
        kind: "ended",
        at: LATER,
        outcome: { kind: "merged", pr: 9 },
        kept: [],
      },
    },
  };

  const OPEN = "branch:local/%2Frepo/in-flight";
  const TWO = "branch:local/%2Frepo/second-attempt";
  const OTHER = { kind: "commit", sha: "9b7e3d1" };
  const opened = (pr: number) => ({
    at: AT,
    by: "kolu",
    about: WORK,
    kind: "pr-opened",
    pr,
    title: "t",
  });
  const passed = (pr: number, head: unknown) => ({
    at: AT,
    by: "ci",
    about: WORK,
    kind: "checks-passed",
    pr,
    head,
    failing: [],
  });
  /** A work still in flight whose checks passed, a finished one that had two
   *  PRs, and a pass already followed by the forge saying it cannot merge. */
  const MORE = {
    [OPEN]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "o" },
      title: "in flight at the upgrade",
      startedAt: AT,
      decisions: [],
      events: [opened(4), passed(4, HEAD)],
      state: { kind: "open" },
    },
    [TWO]: {
      key: { kind: "branch", host: "local", repo: "/repo", branch: "t" },
      title: "two attempts",
      startedAt: AT,
      decisions: [],
      events: [
        opened(9),
        passed(9, HEAD),
        { at: AT, by: "kolu", about: WORK, kind: "pr-closed", pr: 9 },
        opened(10),
        passed(10, OTHER),
        {
          at: AT,
          by: "kolu",
          about: WORK,
          kind: "merge-state",
          pr: 10,
          head: OTHER,
          merge: { kind: "cannot", why: "review" },
        },
        { at: LATER, by: "kolu", about: WORK, kind: "merged", pr: 10 },
      ],
      state: {
        kind: "ended",
        at: LATER,
        outcome: { kind: "merged", pr: 10 },
        kept: [],
      },
    },
  };

  /** A real store stamped at 1.56.0, walked to the live head. */
  const walk = (works: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-pr-facts-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: DEFAULT_PREFERENCES,
        works,
        __internal__: { migrations: { version: "1.56.0" } },
      }),
    );
    const store = new Conf<Record<string, unknown>>({
      cwd: dir,
      projectVersion: SCHEMA_VERSION,
      defaults: CONF_DEFAULTS as unknown as Record<string, unknown>,
      migrations: CONF_MIGRATIONS as never,
    });
    return { store, state: readJson(store.path) };
  };

  it("records no invented address, keeps a passing check green, and decodes", () => {
    const { state } = walk(structuredClone(SEED));
    const events = (
      state.works as Record<string, { events: Record<string, unknown>[] }>
    )[ID]?.events;
    expect(events?.map((one) => one.kind)).toEqual([
      "requested",
      "pr-opened",
      "checks-passed",
      "merge-state",
      "merged",
      "ended",
    ]);
    expect(events?.[1]).toMatchObject({ url: { kind: "unrecorded" } });
    expect(events?.[3]).toEqual({
      at: AT,
      by: "kolu",
      about: WORK,
      kind: "merge-state",
      pr: 9,
      head: HEAD,
      merge: { kind: "can" },
    });
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PersistedWorksSchema)(state.works),
      ),
    ).toBe(true);
  });

  it("answers only a finished work's passes, never a closed PR's, and none twice", () => {
    const { state } = walk(structuredClone({ ...SEED, ...MORE }));
    const works = state.works as Record<
      string,
      { events: Record<string, unknown>[] }
    >;
    // IN FLIGHT: an address it will learn, and no answer it never had — its
    // next reading records GitHub's.
    expect(works[OPEN]?.events).toEqual([
      { ...opened(4), url: { kind: "unrecorded" } },
      passed(4, HEAD),
    ]);
    // FINISHED, TWO PRs: the first was closed unmerged, so its pass gets no
    // answer; the second's pass already had its answer, which stands.
    const two = works[TWO]?.events ?? [];
    expect(two.map((one) => one.kind)).toEqual([
      "pr-opened",
      "checks-passed",
      "pr-closed",
      "pr-opened",
      "checks-passed",
      "merge-state",
      "merged",
    ]);
    expect(two[5]).toMatchObject({
      pr: 10,
      merge: { kind: "cannot", why: "review" },
    });
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PersistedWorksSchema)(state.works),
      ),
    ).toBe(true);
  });

  it("writes nothing to a store already in the new shape", () => {
    const { store } = walk(structuredClone(SEED));
    const set = vi.spyOn(store, "set");
    prFactsOnTheTimeline_1_57_0(store as never);
    expect(set).not.toHaveBeenCalled();
  });
});
