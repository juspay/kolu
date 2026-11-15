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
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { readPersistedTranscript } from "kolu-conductor";
import { workDirOf, workIdOf } from "kolu-work";
import { afterEach, describe, expect, it } from "vitest";
import {
  transcriptFilePath,
  transcriptFileStore,
  writeTranscriptFile,
} from "./conductor/transcriptFile.ts";
// Importing state.ts opens its own throwaway store at the test harness's
// KOLU_STATE_DIR (set by the `test:unit` script) — unrelated to the fixtures
// below, which each build their own Conf under a fresh temp dir.
import {
  collapseFlappingChecks_1_51_0,
  decodeStateBackup,
  foldWorksByKey_1_53_0,
  memberWatchOutOfWorks_1_52_0,
  migrateConductorToWorks_1_50_0,
  moveKeptFiles_1_53_0,
  splitWorkAskRows_1_53_0,
  stripLegacyStateKeys_1_31_0,
  TRANSCRIPT_FILE_VERSION,
  worksFromWatched_1_50_0,
} from "./state.ts";

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
        "/home/person/code/odu/.worktrees/docs-human-reading",
      ],
      [
        IMPL,
        "implementor",
        "/home/person/code/odu/.worktrees/docs-human-reading",
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
    // Decisions: every one of them an arm of the sum, and the `host` ones
    // dropped — the host is the key now.
    expect(
      work?.decisions.every((one) => (one.key as string | null) !== "host"),
    ).toBe(true);
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
    // 1.52.0 backfilled the two fields the decision was written without …
    expect(work?.decisions[0]?.header).toBe("");
    expect(work?.decisions[0]?.file).toBe("");
    // … and left everything the commit DID write exactly as it was.
    expect(work?.decisions[0]?.question).toBe("How should this run?");
    // … and 1.53.0 moved the membership into the one map, where the watch
    // bookkeeping already was.
    expect(decoded.members[REF]?.worktree).toBe("/home/person/code/odu");
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

    // THE RUNG: the work-carrying ask row becomes its own kind and the stamp
    // moves, so the reader of today accepts the file it leaves behind.
    splitWorkAskRows_1_53_0(root);
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
