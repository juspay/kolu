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
import { Option, Result, Schema } from "effect";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import {
  PersistedWorksSchema,
  readPersistedTranscript,
  workDirOf,
} from "kolu-conductor";
import { MODE_RUNS, type Policy, prOf, stages, workIdOf } from "kolu-work";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transcriptFilePath,
  transcriptFileStore,
  writeTranscriptFile,
} from "./conductor/transcriptFile.ts";
import { decodeStateBackup } from "./state.ts";
import {
  collapseFlappingChecks_1_51_0,
  CONF_MIGRATIONS,
  dropKoluChoiceOptions_1_54_0,
  foldWorksByKey_1_53_0,
  memberWatchOutOfWorks_1_52_0,
  migrateConductorToWorks_1_50_0,
  koluChoicesSayHowChosen_1_56_0,
  mentionsSayTheirKind_1_58_0,
  toolOutings_1_59_0,
  moveKeptFiles_1_53_0,
  prFactsOnTheTimeline_1_57_0,
  prOpenedSaysDraft_1_61_0,
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

    expect(existsSync(bakPath)).toBe(true);
    const bak = readJson(bakPath);
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
    expect(bak.sleepingTerminals).toEqual([{ id: "s1" }]);
    expect(bak.lastPairedDaemon).toEqual({ stateRoot: "/root" });

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
    const conf = makeStore({
      session: { active: null, terminals: [{ id: "t1" }] },
      activityFeed: { recentRepos: ["/repo"], recentAgents: [] },
      sleepingTerminals: [{ id: "s1" }],
      lastPairedDaemon: { stateRoot: "/root" },
    });
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    stripLegacyStateKeys_1_31_0(conf as never);
    expect(existsSync(bakPath)).toBe(true);
    conf.set("activityFeed", { recentRepos: ["/repo"], recentAgents: [] });
    conf.set("sleepingTerminals", [{ id: "s1" }]);
    conf.set("lastPairedDaemon", { stateRoot: "/root" });

    stripLegacyStateKeys_1_31_0(conf as never);

    const bak = readJson(bakPath);
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
  });
});

describe("the 1.50.0 rung — a piece of work is a stored thing", () => {
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

  const hostAnswer = (work: Record<string, unknown>): unknown =>
    (
      (work.decisions as ReadonlyArray<Record<string, unknown>>).find(
        (one) => one.key === "host",
      )?.answer as { picked: unknown[] }
    ).picked[0];

  it("makes ONE work of the terminals the panel drew as one, and its own of the rest", () => {
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
    expect(alone.title).toBe("a watch");
    expect((alone.members as unknown[]).length).toBe(1);
    expect(hostAnswer(alone)).toBe("remote:box");
  });

  it("records mode and host as DECISIONS answered from nowhere", () => {
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
    expect(statSync(transcript).mode & 0o777).toBe(0o600);
    const works = conf.get("works") as ReadonlyArray<Record<string, unknown>>;
    expect(works.length).toBe(1);
    expect(works[0]?.title).toBe("plan the cutover");
  });

  it("leaves a conductor record alone when its rows are not a list", () => {
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
    const conf = makeStore({ works: "nonsense" });
    collapseFlappingChecks_1_51_0(conf as never);
    expect(conf.get("works")).toBe("nonsense");
  });
});

describe("the 1.52.0 rung — a store this branch wrote before the member bookkeeping moved", () => {
  const DEPLOYED = JSON.parse(
    readFileSync(
      new URL("./fixtures/deployed-1.50.0-old-members.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const PLANNER = "remote:host-d/b05bbccd-4e62-408c-a590-5c5906ce7407";
  const IMPL = "remote:host-d/415ebfc7-4a42-4561-a54b-c47f9d62284b";

  it("brings the deployed store through the WHOLE ladder, and every persisted key decodes", () => {
    const decoded = decodeStateBackup(DEPLOYED, "the deployed store");
    const work = Object.values(decoded.works)[0];
    expect(work).toBeDefined();
    expect(work?.state.kind).toBe("open");
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
    const kinds = work?.events.map((one) => one.kind) ?? [];
    expect(kinds.filter((kind) => kind === "checks-running")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "checks-passed")).toHaveLength(1);
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
  const REF = "remote:host-a/11111111-1111-4111-8111-111111111111";
  const AT = "2026-02-02T10:00:00.000Z";

  it("decodes a store written AFTER the members moved and BEFORE a decision had a header", () => {
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
    const work = Object.values(decoded.works)[0];
    expect(work?.decisions[0]?.topic).toBe("setup");
    expect("header" in (work?.decisions[0] ?? {})).toBe(false);
    expect("file" in (work?.decisions[0] ?? {})).toBe(false);
    expect(work?.decisions[0]?.question).toBe("How should this run?");
    expect(decoded.members[REF]?.worktree).toEqual({
      kind: "read",
      path: "/home/person/code/odu",
    });
    expect(decoded.members[REF]?.watch.name).toBe("Planner: odu docs");
    expect(work?.events.map((one) => one.kind)).toEqual([
      "pr-opened",
      "checks-running",
      "checks-failed",
    ]);
    const failed = work?.events[2];
    expect(failed?.kind === "checks-failed" && failed.failing).toEqual([
      "build",
      "lint",
    ]);
  });

  it("reads a transcript file written when the rows first moved into it", () => {
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

    splitWorkAskRows_1_53_0(root);
    workAskStanding_1_55_0(root);
    mentionsSayTheirKind_1_58_0(root);
    toolOutings_1_59_0(root);
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
    expect(user.attachments).toEqual([]);
    const ask = rows[2];
    if (ask?.kind !== "ask") throw new Error("the ask row went missing");
    expect("work" in ask).toBe(false);
    const workAsk = rows[3];
    if (workAsk?.kind !== "work-ask")
      throw new Error("the work-ask row went missing");
    expect(workAsk.work).toBe("work:abc123");
    expect(workAsk.text).toBe("Which plan should the implementor take?");
  });
});

describe("the 1.53.0 rung — three cards for one branch become one piece of work", () => {
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
    expect(
      work.decisions.every(
        (one) => one.kind === "asked" || one.kind === "answered",
      ),
    ).toBe(true);
    const prs = work.events.filter((one) => one.kind === "pr-opened");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.pr).toBe(181);
    expect(
      work.events
        .filter((one) => String(one.kind).startsWith("checks-"))
        .every((one) => one.pr === 181),
    ).toBe(true);
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
    expect(work.state.kind).toBe("open");
    const files = work.events.filter((one) => one.kind === "file");
    expect(files.length).toBeGreaterThan(20);
    expect(new Set(files.map((one) => one.path)).size).toBe(files.length);
    expect(work.events.some((one) => one.kind === "kept")).toBe(false);
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
    expect(readFileSync(join(dir, ".waterfall/plan.md"), "utf8")).toBe(
      "newest",
    );
    expect(readFileSync(join(dir, ".waterfall/oldest.md"), "utf8")).toBe(
      "oldest",
    );
    for (const work of [one, two, three])
      expect(existsSync(join(root, work.id))).toBe(false);
  });
});

const recordLike = (value: unknown): boolean =>
  typeof value === "object" && value !== null;

describe("the 1.54.0 rung — a role's harness and model are kolu's options", () => {
  const AT_54 = "2026-11-01T00:00:00.000Z";

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

    expect(after["d-model"]).toBeDefined();
    expect("options" in (after["d-model"] ?? {})).toBe(false);
    expect("multiple" in (after["d-model"] ?? {})).toBe(false);
    expect(after["d-model"]?.question).toBe("Which model should plan?");

    expect("options" in (after["d-harness"] ?? {})).toBe(false);
    expect("multiple" in (after["d-harness"] ?? {})).toBe(false);
    expect(after["d-harness"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });

    expect(after["d-mode"]?.options).toEqual(["full", "trivial"]);
    expect(after["d-mode"]?.multiple).toBe(false);
  });

  it("narrows every kolu-choice answer to the one value the reading took", () => {
    const after = decisionsOf(walk(structuredClone(WORKS)));

    expect(after["d-typed"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });
    expect(after["d-many"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["omp"],
      text: null,
      from: "card",
    });
    expect(after["d-fable"]?.answer).toEqual({
      at: AT_54,
      how: "answered",
      picked: ["fable 5.2"],
      text: null,
      from: "card",
    });
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
    const once = walk(structuredClone(WORKS), SCHEMA_VERSION);
    const decoded = Schema.decodeUnknownResult(PersistedWorksSchema)(once);
    expect(Result.isSuccess(decoded)).toBe(true);
    expect(walk(structuredClone(once), SCHEMA_VERSION)).toEqual(once);
  });
});

describe("the 1.55.0 rung — no hole in the work model", () => {
  const AT = "2026-11-10T00:00:00.000Z";
  const ID = "branch:local/%2Frepo/setup-choices";
  const REF = "local/aaaa";

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
    expect(after["d-green"]?.answer).toEqual({
      how: "answered",
      at: AT,
      from: "chat",
      value: "merge",
    });
    expect("options" in (after["d-harness"] ?? {})).toBe(false);
    expect(after["d-harness"]?.answer).toEqual({
      how: "answered",
      at: AT,
      from: "card",
      value: "omp",
      chosen: "picked",
    });
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
    expect(file.version).toBe("1.55.0");
    const rows = file.rows as Array<Record<string, unknown>>;
    expect(rows[0]).toEqual(plain);
    const askOf = (at: number) => rows[at]?.ask as Record<string, unknown>;
    expect(askOf(1)).toEqual({ fields: [], standing: { kind: "open" } });
    expect(askOf(2)).toEqual({
      fields: [],
      standing: {
        kind: "answered",
        answers: [{ key: "planner.harness", values: ["omp"] }],
      },
    });
    expect(askOf(3)).toEqual({ fields: [], standing: { kind: "declined" } });
    expect(askOf(4)).toEqual({ fields: [], standing: { kind: "withdrawn" } });

    const again = readFileSync(transcriptFilePath(dir), "utf8");
    workAskStanding_1_55_0(dir);
    expect(readFileSync(transcriptFilePath(dir), "utf8")).toBe(again);
  });

  it("restamps a transcript with no work-ask row, and names why a refusal was signed out", () => {
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
    expect(file.version).toBe("1.55.0");
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
      const events = (
        state.works as Record<
          string,
          { events: Array<Record<string, unknown>> }
        >
      )[ID]?.events;
      expect(events?.[0]?.kind).toBe("answered-part");

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
    expect(works[OPEN]?.events).toEqual([
      { ...opened(4), url: { kind: "unrecorded" }, draft: "unrecorded" },
      passed(4, HEAD),
    ]);
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

describe("the 1.58.0 rung — a mention says what it is", () => {
  const AT = "2026-11-17T01:00:00.000Z";
  const TERMINAL = {
    terminalId: "11111111-1111-4111-8111-111111111111",
    host: "local",
    name: "chat-on-any-entity",
    intent: null,
    cwd: "/home/me/code/olai",
  };

  it("gives every saved mention `kind: terminal` and moves the stamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-mention-kind-"));
    dirs.push(dir);
    writeTranscriptFile(transcriptFilePath(dir), "1.55.0", [
      { id: "u1", seq: 1, since: AT, kind: "user", text: "hi" },
      {
        id: "u2",
        seq: 2,
        since: AT,
        kind: "user",
        text: "look at @chat-on-any-entity",
        mentions: [TERMINAL],
      },
      { id: "a1", seq: 3, since: AT, kind: "agent", text: "Looking." },
    ] as never);

    mentionsSayTheirKind_1_58_0(dir);

    const file = readJson(transcriptFilePath(dir));
    expect(file.version).toBe("1.58.0");
    expect(file.rows).toEqual([
      { id: "u1", seq: 1, since: AT, kind: "user", text: "hi" },
      {
        id: "u2",
        seq: 2,
        since: AT,
        kind: "user",
        text: "look at @chat-on-any-entity",
        mentions: [{ kind: "terminal", ...TERMINAL }],
      },
      { id: "a1", seq: 3, since: AT, kind: "agent", text: "Looking." },
    ]);
    const again = readFileSync(transcriptFilePath(dir), "utf8");
    mentionsSayTheirKind_1_58_0(dir);
    expect(readFileSync(transcriptFilePath(dir), "utf8")).toBe(again);

    toolOutings_1_59_0(dir);
    expect(readJson(transcriptFilePath(dir)).version).toBe(
      TRANSCRIPT_FILE_VERSION,
    );
    const read = readPersistedTranscript(
      transcriptFileStore(dir, TRANSCRIPT_FILE_VERSION),
      transcriptFilePath(dir),
      dir,
    );
    expect(read.rows[1]).toMatchObject({
      mentions: [{ kind: "terminal", name: "chat-on-any-entity" }],
    });
  });
});

describe("the 1.59.0 rung — a tool row may say when this outing began", () => {
  const AT = "2026-11-17T01:00:00.000Z";
  const ROWS = [
    { id: "u1", seq: 1, since: AT, kind: "user", text: "run the tests" },
    {
      id: "t1",
      seq: 2,
      since: AT,
      kind: "tool",
      text: "just test",
      status: "completed",
      server: "kolu",
      tool: "lifecycle_sendInput",
    },
  ];

  it("leaves every row exactly as it found it, and moves the stamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-tool-outings-"));
    dirs.push(dir);
    writeTranscriptFile(transcriptFilePath(dir), "1.58.0", ROWS as never);

    toolOutings_1_59_0(dir);

    const file = readJson(transcriptFilePath(dir));
    expect(file.version).toBe(TRANSCRIPT_FILE_VERSION);
    expect(file.rows).toEqual(ROWS);
    const read = readPersistedTranscript(
      transcriptFileStore(dir, TRANSCRIPT_FILE_VERSION),
      transcriptFilePath(dir),
      dir,
    );
    expect(read.rows.map((one) => one.id)).toEqual(["u1", "t1"]);
  });

  it("is safe to run twice — a file at its own number is not rewritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-tool-outings-twice-"));
    dirs.push(dir);
    writeTranscriptFile(transcriptFilePath(dir), "1.58.0", ROWS as never);

    toolOutings_1_59_0(dir);
    const once = readFileSync(transcriptFilePath(dir), "utf8");
    toolOutings_1_59_0(dir);
    expect(readFileSync(transcriptFilePath(dir), "utf8")).toBe(once);
  });

  it("leaves a file it cannot read exactly as it is, for the reader to refuse by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-tool-outings-torn-"));
    dirs.push(dir);
    const path = transcriptFilePath(dir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ this is not json", "utf8");

    toolOutings_1_59_0(dir);

    expect(readFileSync(path, "utf8")).toBe("{ this is not json");
  });
});

describe("the 1.61.0 rung — a pull request says whether it opened as a draft", () => {
  const AT = "2026-11-18T00:00:00.000Z";
  const LATER = "2026-11-18T02:00:00.000Z";
  const WORK = { kind: "work" };
  const HEAD = { kind: "commit", sha: "4f21a9c" };
  const FINISHED = "branch:local/%2Frepo/finished";
  const IN_PROGRESS = "branch:local/%2Frepo/in-progress";
  const TWO = "branch:local/%2Frepo/two-attempts";
  const NO_PR = "branch:local/%2Frepo/no-pr";
  const requested = {
    at: AT,
    by: "you",
    about: WORK,
    kind: "requested",
    request: { kind: "none" },
  };
  const opened = (pr: number) => ({
    at: AT,
    by: "kolu",
    about: WORK,
    kind: "pr-opened",
    pr,
    title: "t",
    url: { kind: "link", href: `https://forge.example/pr/${pr}` },
  });
  const canMerge = (pr: number) => ({
    at: AT,
    by: "kolu",
    about: WORK,
    kind: "merge-state",
    pr,
    head: HEAD,
    merge: { kind: "can" },
  });
  const work = <E extends { readonly kind: string }>(
    branch: string,
    events: ReadonlyArray<E>,
    state: unknown,
  ) => ({
    key: { kind: "branch", host: "local", repo: "/repo", branch },
    title: branch,
    startedAt: AT,
    decisions: [],
    members: [],
    events,
    state,
  });
  const merged = (pr: number) => [
    { at: LATER, by: "kolu", about: WORK, kind: "merged", pr },
    {
      at: LATER,
      by: "kolu",
      about: WORK,
      kind: "ended",
      outcome: { kind: "merged", pr },
    },
  ];
  const endedState = (pr: number) => ({
    kind: "ended",
    at: LATER,
    outcome: { kind: "merged", pr },
    kept: [],
  });
  const SEED = {
    [FINISHED]: work(
      "finished",
      [requested, opened(9), canMerge(9), ...merged(9)],
      endedState(9),
    ),
    [IN_PROGRESS]: work(
      "in-progress",
      [
        requested,
        {
          at: AT,
          by: "kolu",
          about: { kind: "member", terminal: "local/impl" },
          kind: "joined",
          role: "implementor",
        },
        opened(4),
        {
          at: AT,
          by: "ci",
          about: WORK,
          kind: "checks-passed",
          pr: 4,
          head: HEAD,
          failing: [],
        },
        canMerge(4),
      ],
      { kind: "open" },
    ),
    [TWO]: work(
      "two-attempts",
      [
        requested,
        opened(9),
        { at: AT, by: "kolu", about: WORK, kind: "pr-closed", pr: 9 },
        opened(10),
        ...merged(10),
      ],
      endedState(10),
    ),
    [NO_PR]: work("no-pr", [requested], { kind: "open" }),
  };
  const MEMBERS = {
    "local/impl": {
      name: "impl",
      agent: "omp",
      told: "ready",
      joined: "asked",
      spoken: true,
      ran: true,
    },
  };

  const walk = () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-pr-draft-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        preferences: DEFAULT_PREFERENCES,
        works: SEED,
        members: MEMBERS,
        __internal__: { migrations: { version: "1.60.0" } },
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

  it("gives every pr-opened the word `unrecorded` and moves nothing else", () => {
    const { state } = walk();
    const works = state.works as Record<
      string,
      { events: ReadonlyArray<Record<string, unknown>> }
    >;
    const expected = Object.fromEntries(
      Object.entries(SEED).map(([id, one]) => [
        id,
        {
          ...one,
          events: one.events.map((event) =>
            event.kind === "pr-opened"
              ? { ...event, draft: "unrecorded" }
              : event,
          ),
        },
      ]),
    );
    expect(state.works).toEqual(expected);
    expect(
      Object.values(works).flatMap((one) =>
        one.events.filter((event) => event.kind === "draft-state"),
      ),
    ).toEqual([]);
    expect(state.members).toEqual(MEMBERS);
    expect(
      (state.__internal__ as { migrations: { version: string } }).migrations
        .version,
    ).toBe("1.61.0");
  });

  it("decodes, and walking it again changes nothing", () => {
    const { store, state } = walk();
    expect(
      Result.isSuccess(
        Schema.decodeUnknownResult(PersistedWorksSchema)(state.works),
      ),
    ).toBe(true);
    const set = vi.spyOn(store, "set");
    prOpenedSaysDraft_1_61_0(store as never);
    expect(set).not.toHaveBeenCalled();
  });

  it("leaves the work in progress reading as 1.60.0 read it: the build ended at the open", () => {
    const { state } = walk();
    const decoded = Schema.decodeUnknownSync(PersistedWorksSchema)(state.works);
    const upgraded = decoded[IN_PROGRESS];
    if (upgraded === undefined) throw new Error("no work in progress");
    const asBefore = {
      ...upgraded,
      events: upgraded.events.map((event) =>
        event.kind === "pr-opened"
          ? { ...event, draft: "ready" as const }
          : event,
      ),
    };
    const policy: Policy = {
      handOver: true,
      run: {
        kind: "set",
        driven: MODE_RUNS.full.driven,
        stages: MODE_RUNS.full.stages,
      },
    };
    const now = LATER;
    const read = stages(upgraded, policy, now);
    expect(read).toEqual(stages(asBefore, policy, now));
    if (read.kind !== "staged") throw new Error(read.kind);
    expect(read.current).toBe("merge");
    expect(Option.getOrThrow(prOf(upgraded)).merge).toEqual({ kind: "can" });
  });
});
