/**
 * A WORK'S PR IS ITS OWN — the card's mark, its check count and its words are
 * drawn from the reading filed under the work's id, never from a member.
 *
 * The first block is the reported defect, inverted: a planner adopted from
 * another worktree carries that branch's merged PR on its terminal record,
 * and the card used to draw it. The second says the same for any members at
 * all. The third pins when a reading is the work's PR and when it is not.
 */

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { PrInfo } from "anyforge/schemas";
import { Option } from "effect";
import type { PrResult } from "kolu-common/surface";
import {
  ABOUT_WORK,
  type Work,
  type WorkEvent,
  type WorkMember,
  workIdOf,
} from "kolu-work";
import { seeded } from "kolu-work/seeded";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

const [members, setMembers] = createSignal<ReadonlyMap<string, WorkMember>>(
  new Map(),
);
const [prs, setPrs] = createSignal<ReadonlyMap<string, PrResult>>(new Map());
const [standings, setStandings] = createSignal<
  ReadonlyMap<string, FleetTerminalStanding>
>(new Map());

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: (host: string, id: string) =>
    standings().get(`${host}/${id}`) ?? { kind: "gone" },
}));
vi.mock("./useWorks", () => ({
  useWorkMembers: () => members,
  useWorkPrs: () => prs,
}));

import { checksTally, prSection } from "./prReadings";
import { createWorkFacts, type WorkFacts } from "./workFacts";
import { workPrOf } from "./workPr";
import { standingLine, workSubtitle } from "./workReadings";

const AT = "2026-11-24T19:00:00.000Z";
const KEY = {
  kind: "branch",
  host: "local",
  repo: "/repo",
  branch: "solid-2-switch",
} as const;
const ID = workIdOf(KEY);

const opened = (pr: number): WorkEvent => ({
  at: AT,
  by: "kolu",
  kind: "pr-opened",
  about: ABOUT_WORK,
  pr,
  title: "The app moves to Solid 2",
  url: { kind: "link", href: `https://example.invalid/pull/${pr}` },
  draft: "draft",
});

/** A work on `solid-2-switch` whose timeline says draft #2438, checks
 *  running. */
const WORK: Work = {
  key: KEY,
  title: "The app moves to Solid 2",
  startedAt: AT,
  decisions: [],
  events: [
    {
      at: AT,
      by: "you",
      kind: "requested",
      about: ABOUT_WORK,
      request: { kind: "none" },
    },
    opened(2438),
    {
      at: AT,
      by: "ci",
      kind: "checks-running",
      about: ABOUT_WORK,
      pr: 2438,
      head: { kind: "commit", sha: "aaaa" },
      failing: [],
    },
  ],
  state: { kind: "open" },
  worktree: { kind: "unread" },
};

const pr = (
  number: number,
  state: PrInfo["state"],
  runs: number,
  isDraft: boolean,
): PrInfo => ({
  number,
  title: "t",
  url: `https://example.invalid/pull/${number}`,
  state,
  checks: "pass",
  checkRuns: Array.from({ length: runs }, (_, i) => ({
    name: `c${i}`,
    outcome: "pass" as const,
  })) as PrInfo["checkRuns"],
  reviewDecision: null,
  mergeStateStatus: null,
  headSha: null,
  isDraft,
});

/** A terminal standing in `/repo/.worktrees/<branch>`, carrying `value`. */
const here = (branch: string, value: PrResult): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    cwd: `/repo/.worktrees/${branch}`,
    git: {
      kind: "repo",
      info: {
        repoRoot: `/repo/.worktrees/${branch}`,
        repoName: "repo",
        worktreePath: `/repo/.worktrees/${branch}`,
        branch,
        isWorktree: true,
        mainRepoRoot: "/repo",
        remoteUrl: null,
        isBare: false,
      },
    },
    location: LOCAL_LOCATION,
    pr: value,
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    promptedAt: null,
  } satisfies TerminalMetadata,
});

const member = (role: WorkMember["role"]): WorkMember => ({
  work: ID,
  role,
  joinedAt: AT,
});

/** The card's reading of {@link WORK}, as `createWorkFacts` makes it. */
const factsOf = <T>(read: (facts: WorkFacts) => T): T =>
  createRoot((dispose) => {
    const out = read(
      createWorkFacts(
        () => ID,
        () => WORK,
      ),
    );
    dispose();
    return out;
  });

/** A member ref the browser resolves: a host key and a terminal id. */
const refOf = (n: number): string =>
  `local/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLANNER = refOf(1);
const IMPLEMENTOR = refOf(2);

describe("a card whose planner stands on another branch", () => {
  // The implementor joined FIRST and the planner second: the card orders them
  // planner-first, which is the order the old scan took the PR in.
  setMembers(
    new Map([
      [IMPLEMENTOR, member("implementor")],
      [PLANNER, member("planner")],
    ]),
  );
  setStandings(
    new Map([
      [
        PLANNER,
        here("solid-2-migration", {
          kind: "ok",
          value: pr(2437, "merged", 35, false),
        }),
      ],
      [
        IMPLEMENTOR,
        here("solid-2-switch", {
          kind: "ok",
          value: pr(2438, "open", 9, true),
        }),
      ],
    ]),
  );
  setPrs(new Map([[ID, { kind: "ok", value: pr(2438, "open", 9, true) }]]));

  it("reads both members, planner first, each standing where it is", () => {
    const read = factsOf((facts) =>
      facts.members().map((one) => [one.member.role, one.standing?.kind]),
    );
    expect(read).toEqual([
      ["planner", "here"],
      ["implementor", "here"],
    ]);
  });

  it("says the work's own PR in its words", () => {
    expect(workSubtitle(WORK, Option.none())).toContain("draft PR #2438");
  });

  it("draws the work's own PR as its mark, not the planner's merged one", () => {
    const drawn = factsOf((facts) => Option.getOrNull(facts.pr()));
    expect(drawn?.number).toBe(2438);
    expect(drawn?.state).toBe("open");
    expect(drawn?.isDraft).toBe(true);
  });

  it("counts the work's own PR's checks on the standing line", () => {
    const line = factsOf((facts) => standingLine(WORK, facts.checks()));
    expect(line.what).toEqual(Option.some("9 of 9 checks"));
  });

  it("names the work's own PR in the Pull request section", () => {
    const section = factsOf((facts) =>
      Option.getOrThrow(prSection(WORK, facts.checks())),
    );
    expect(section.number).toBe(2438);
  });
});

describe("a work's PR and checks, whatever its members carry", () => {
  const RESULTS: ReadonlyArray<(n: number) => PrResult> = [
    () => ({ kind: "pending" }),
    () => ({ kind: "absent" }),
    () => ({ kind: "unsupported" }),
    (n) => ({ kind: "ok", value: pr(n, "open", n % 7, n % 2 === 0) }),
    (n) => ({ kind: "ok", value: pr(n, "merged", n % 5, false) }),
    (n) => ({ kind: "ok", value: pr(n, "closed", 1, false) }),
  ];
  const ROLES = ["planner", "implementor", "other"] as const;

  it("depends only on the work and the reading filed under its id", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const reading = among(RESULTS)(among([2437, 2438, 2439]));
      setPrs(new Map([[ID, reading]]));
      const want = workPrOf(WORK, reading);
      // Any number of members, in any order, on any branch, carrying any PR.
      const count = Math.floor(pick() * 5);
      const rows: Array<[string, WorkMember]> = [];
      const records = new Map<string, FleetTerminalStanding>();
      for (let i = 0; i < count; i += 1) {
        const ref = refOf(seed * 10 + i);
        rows.push([ref, member(among(ROLES))]);
        records.set(
          ref,
          here(
            among(["solid-2-switch", "solid-2-migration", "main"]),
            among(RESULTS)(among([2437, 2438, 2439])),
          ),
        );
      }
      setStandings(records);
      setMembers(new Map(pick() < 0.5 ? rows : [...rows].reverse()));
      const seen = factsOf((facts) => ({
        pr: Option.getOrNull(facts.pr()),
        checks: facts.checks(),
      }));
      expect(seen.pr, `seed ${seed}`).toBe(Option.getOrNull(want));
      expect(seen.checks, `seed ${seed}`).toEqual(checksTally(want));
    }
  });
});

describe("when a reading is the work's PR", () => {
  const OK: PrResult = { kind: "ok", value: pr(2438, "open", 3, true) };

  it("is the work's PR when it is open, a branch, ok, and the number its timeline names", () => {
    expect(Option.getOrNull(workPrOf(WORK, OK))?.number).toBe(2438);
  });

  it("is none for a work that has ended", () => {
    const ended: Work = {
      ...WORK,
      state: {
        kind: "ended",
        at: AT,
        outcome: { kind: "stopped", by: "you" },
        kept: [],
      },
    };
    expect(workPrOf(ended, OK)).toEqual(Option.none());
  });

  it("is none for a watch", () => {
    const watch: Work = {
      ...WORK,
      key: { kind: "watch", terminal: "local/a" },
    };
    expect(workPrOf(watch, OK)).toEqual(Option.none());
  });

  it("is none for a reading that is not ok, or not there", () => {
    for (const reading of [
      { kind: "pending" },
      { kind: "absent" },
      { kind: "unsupported" },
    ] as const)
      expect(workPrOf(WORK, reading)).toEqual(Option.none());
    expect(workPrOf(WORK, undefined)).toEqual(Option.none());
  });

  it("is none for a PR whose number the timeline does not name", () => {
    expect(
      workPrOf(WORK, { kind: "ok", value: pr(2437, "merged", 35, false) }),
    ).toEqual(Option.none());
    expect(workPrOf({ ...WORK, events: [] }, OK)).toEqual(Option.none());
  });
});
