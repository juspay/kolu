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
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Conf from "conf";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
// Importing state.ts opens its own throwaway store at the test harness's
// KOLU_STATE_DIR (set by the `test:unit` script) — unrelated to the fixtures
// below, which each build their own Conf under a fresh temp dir.
import {
  TRANSCRIPT_FILE_VERSION,
  migrateConductorToWorks_1_50_0,
  stripLegacyStateKeys_1_31_0,
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
