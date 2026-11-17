/**
 * THE WORDS THE COLUMN SAYS, pinned without a browser.
 *
 * `kolu-work` already tests what a work IS (who it waits on, the bar, the
 * durations). What is this module's own is the reading a PERSON gets: the
 * labels the setup is drawn under, the typography of a one-line row, the
 * sentence under a title, the line beside a timeline dot, and the one number
 * on the tab — which is the only fold here that two surfaces share, so it is
 * the one that must not be re-derived anywhere else.
 */

import { Option } from "effect";
import {
  ABOUT_WORK,
  aboutMember,
  type AnswerFrom,
  type Asked,
  type Decision,
  handBack,
  type KoluChoiceKey,
  type MergeState,
  membershipOf,
  needsYou,
  needsYouOf,
  ON_GREEN,
  type OnGreen,
  type Said,
  type Settled,
  SETUP_KEYS,
  takeOver,
  WORK_MODES,
  type Work,
  type WorkEvent,
  type WorkMember,
  type WorkMode,
} from "kolu-work";
import type { PrInfo } from "anyforge/schemas";
import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { checksTally, failingLine, livePrOf, prSection } from "./prReadings";
import { timelineShown } from "./timelineView";
import {
  answerWords,
  decisionLabel,
  decisionRows,
  eventReader,
  inputAllowed,
  LINE_LIMIT,
  lockCardWords,
  lockWords,
  membersIn,
  oneLine,
  otherDecisions,
  outcomeWords,
  repoName,
  SETUP_ROWS,
  setupLine,
  stagesOf,
  standingLine,
  timeSpentOnYou,
  waitingCount,
  workHost,
  workSubtitle,
  worksStatusWords,
} from "./workReadings";

const AT = "2026-01-01T10:00:00.000Z";
const WORK = "branch:local/%2Fhome%2Fsrid%2Fcode%2Fkolu/update-errors";

/** What every decision carries, whatever it is about. */
interface Over {
  readonly id?: string;
  readonly ask?: string;
  readonly question?: string;
}

const common = (over: Over, fallbackId: string) => ({
  kind: "asked" as const,
  id: over.id ?? fallbackId,
  ask: over.ask ?? "ask-1",
  at: AT,
  question: over.question ?? "Approve the plan?",
});

/** A QUESTION ABOUT THE WORK — the asker's own, with its header, its options
 *  and the file it is about. Each absence is an ARM: a question with no
 *  header is `{kind:"none"}`, never an empty string. */
const asked = (
  over: Over & {
    readonly header?: string;
    readonly options?: ReadonlyArray<string>;
    readonly multiple?: boolean;
    readonly file?: string;
  } = {},
): Extract<Asked, { topic: "work" }> => ({
  ...common(over, "d1"),
  topic: "work",
  header:
    over.header === undefined
      ? { kind: "none" }
      : { kind: "header", text: over.header },
  options: over.options ?? ["Approve", "Ask for changes"],
  multiple: over.multiple ?? false,
  file:
    over.file === undefined
      ? { kind: "none" }
      : { kind: "file", path: over.file },
});

/** ... answered, with what was SAID: a sum with no "answered with nothing"
 *  arm, which is the whole point of this round. */
const said = (
  value: Said,
  over: Parameters<typeof asked>[0] = {},
  from: AnswerFrom = "chat",
): Settled => ({
  ...asked(over),
  kind: "settled",
  answer: { how: "answered", at: AT, from, said: value },
});

const picked = (
  one: string,
  over: Parameters<typeof asked>[0] = {},
  from: AnswerFrom = "chat",
): Settled => said({ kind: "picked", picked: [one] }, over, from);

/** A question about the work nobody would answer. */
const declined = (over: Parameters<typeof asked>[0] = {}): Settled => ({
  ...asked(over),
  kind: "settled",
  answer: { how: "declined", at: AT, from: "card" },
});

/** THE SETUP'S OWN QUESTIONS, by key — labelled by the key's own name, with
 *  no header and no file to carry. */
const modeAsked = (
  over: Over = {},
): Extract<Asked, { topic: "setup"; key: "mode" }> => ({
  ...common(over, "m"),
  topic: "setup",
  key: "mode",
  options: [...WORK_MODES],
});

const mode = (value: WorkMode, over: Over = {}): Settled => ({
  ...modeAsked(over),
  kind: "settled",
  answer: { how: "answered", at: AT, from: "chat", value },
});

const onGreenAsked = (
  over: Over = {},
): Extract<Asked, { topic: "setup"; key: "on-green" }> => ({
  ...common(over, "g"),
  topic: "setup",
  key: "on-green",
  options: [...ON_GREEN],
});

const onGreen = (value: OnGreen, over: Over = {}): Settled => ({
  ...onGreenAsked(over),
  kind: "settled",
  answer: { how: "answered", at: AT, from: "chat", value },
});

const choiceAsked = (
  key: KoluChoiceKey,
  over: Over = {},
): Extract<Asked, { topic: "setup"; key: KoluChoiceKey }> => ({
  ...common(over, key),
  topic: "setup",
  key,
});

const choice = (
  key: KoluChoiceKey,
  value: string,
  over: Over = {},
): Settled => ({
  ...choiceAsked(key, over),
  kind: "settled",
  answer: { how: "answered", at: AT, from: "chat", value, chosen: "picked" },
});

const work = (over: Partial<Work> = {}): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: "/home/srid/code/kolu",
    branch: "update-errors",
  },
  title: "Show agent-distro update errors",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  ...over,
});

/** The ONE members map, as the wire hands it over: terminal to its membership
 *  of a work. */
const members = (
  role: WorkMember["role"] = "planner",
  terminal = "local/a",
): ReadonlyMap<string, WorkMember> =>
  new Map([
    [
      terminal,
      { work: WORK, role, joinedAt: AT, worktree: { kind: "unread" } },
    ],
  ]);

const event = (over: Partial<WorkEvent> & Pick<WorkEvent, "kind">): WorkEvent =>
  ({
    at: AT,
    by: "kolu",
    about: ABOUT_WORK,
    ...over,
  }) as WorkEvent;

/** A member joined, as the TIMELINE says it — which is where a role is read
 *  from, so a terminal that has since left is still named by its part. */
const joined = (terminal = "local/a", role: WorkMember["role"] = "planner") =>
  event({ kind: "joined", about: aboutMember(terminal), role });

const words = (one: Work, of: WorkEvent): string => eventReader(one)(of);

describe("what a card's head says", () => {
  it("names the repo by its last segment, and nothing for a plain watch", () => {
    expect(repoName("/home/srid/code/kolu")).toBe("kolu");
    expect(repoName("/home/srid/code/kolu/")).toBe("kolu");
    expect(repoName("")).toBe("");
  });

  it("says where the work IS — the repo and the branch of its key", () => {
    // Setup unanswered: no mode, no PR — the line is the identity alone.
    expect(workSubtitle(work(), Option.none())).toEqual([
      "kolu",
      "update-errors",
    ]);
    expect(
      workSubtitle(
        work({
          decisions: [mode("trivial")],
          events: [
            event({
              kind: "pr-opened",
              pr: 178,
              title: "Slim it",
              url: { kind: "unrecorded" },
              by: "kolu",
            }),
          ],
        }),
        Option.some("naiveintent"),
      ),
    ).toEqual(["kolu", "update-errors", "naiveintent", "trivial", "PR #178"]);
  });

  it("says a watch is a watch, which has no repo to name", () => {
    expect(
      workSubtitle(
        work({ key: { kind: "watch", terminal: "local/a" } }),
        Option.some("naiveintent"),
      ),
    ).toEqual(["watching", "naiveintent"]);
  });
});

/** A PR's life on the timeline: opened, checks passed on one commit, and
 *  then what GitHub said about merging it. */
const HEAD = { kind: "commit", sha: "abc1234" } as const;
const opened = event({
  kind: "pr-opened",
  pr: 9,
  title: "Slim it",
  url: { kind: "link", href: "https://github.com/o/r/pull/9" },
  by: "agent",
});
const passed = event({
  kind: "checks-passed",
  by: "ci",
  pr: 9,
  head: HEAD,
  failing: [],
});
const failed = event({
  kind: "checks-failed",
  by: "ci",
  pr: 9,
  head: HEAD,
  failing: ["ci::nix", "ci::biome"],
});
const mergeSays = (merge: MergeState): WorkEvent =>
  event({ kind: "merge-state", by: "ci", pr: 9, head: HEAD, merge });
const handingOver = (events: ReadonlyArray<WorkEvent>): Work =>
  work({ decisions: [mode("trivial"), onGreen("hand-over")], events });

describe("the stages a card draws", () => {
  it("draws none for a plain watch, and quiet ones before the mode is known", () => {
    expect(stagesOf(work({ decisions: [mode("watch")] }), AT).kind).toBe(
      "none",
    );
    expect(stagesOf(work(), AT).kind).toBe("unset");
  });

  it("says a trivial work did not plan, approve or review: its mode has no such stages", () => {
    const read = stagesOf(work({ decisions: [mode("trivial")] }), AT);
    if (read.kind !== "staged") throw new Error(`read ${read.kind}`);
    expect(
      read.stages
        .filter((one) => one.state.kind === "skipped")
        .map((one) => one.name),
    ).toEqual(["plan", "approve", "review"]);
  });
});

describe("whether a work waits on you", () => {
  /** By the one needs-you reading. */
  const waitsOnYou = (one: Work): boolean =>
    Option.isSome(needsYouOf("w", one));

  it("does not hand a green PR over while GitHub still will not merge it", () => {
    const blocked = handingOver([
      opened,
      passed,
      mergeSays({ kind: "cannot", why: "review" }),
    ]);
    expect(waitsOnYou(blocked)).toBe(false);
    const clean = handingOver([opened, passed, mergeSays({ kind: "can" })]);
    expect(waitsOnYou(clean)).toBe(true);
  });

  it("never waits on you to merge a work that merges itself", () => {
    const merging = work({
      decisions: [mode("trivial"), onGreen("merge")],
      events: [opened, passed, mergeSays({ kind: "can" })],
    });
    expect(waitsOnYou(merging)).toBe(false);
  });

  it("counts the time it has waited on you, to the clock it is read at", () => {
    const asking = work({
      decisions: [asked()],
      events: [event({ kind: "question", by: "agent", ask: "ask-1" })],
    });
    expect(timeSpentOnYou(asking, "2026-01-01T10:05:00.000Z")).toBe(300_000);
  });
});

describe("where a work runs", () => {
  it("names the host a work's key carries, and none for a key with none", () => {
    expect(workHost(work())).toEqual(Option.some("local"));
    expect(
      workHost(
        work({
          key: { kind: "branch", host: "", repo: "/r", branch: "b" },
        }),
      ),
    ).toEqual(Option.none());
  });
});

describe("the live PR a card reads", () => {
  const pr = (number: number): PrInfo => ({
    number,
    title: "Slim it",
    url: `https://github.com/o/r/pull/${number}`,
    state: "open",
    checks: "pending",
    checkRuns: [],
    reviewDecision: null,
    mergeStateStatus: null,
    headSha: null,
  });
  const here = (result: TerminalMetadata["pr"]) => ({
    standing: {
      kind: "here" as const,
      meta: {
        state: "active",
        cwd: "/tmp/work",
        git: { kind: "none" },
        location: LOCAL_LOCATION,
        pr: result,
        agent: null,
        foreground: null,
        ports: { status: "unknown" },
        lastActivityAt: 1,
        promptedAt: null,
      } satisfies TerminalMetadata,
    },
  });

  it("takes the first member that reports one, past those that cannot", () => {
    expect(
      livePrOf([
        { standing: undefined },
        { standing: { kind: "gone" } },
        here({ kind: "absent" }),
        here({ kind: "ok", value: pr(12) }),
        here({ kind: "ok", value: pr(13) }),
      ])?.number,
    ).toBe(12);
    expect(livePrOf([here({ kind: "pending" })])).toBeNull();
  });
});

describe("the Pull request section", () => {
  it("says the last check reading, its red gates, and why GitHub will not merge", () => {
    const section = prSection(
      handingOver([
        opened,
        failed,
        mergeSays({ kind: "cannot", why: "behind" }),
      ]),
      Option.none(),
    );
    expect(section).toEqual(
      Option.some({
        number: 9,
        state: "open",
        checks: "Checks failed",
        failing: ["ci::nix", "ci::biome"],
        merge: Option.some({
          words: "GitHub cannot merge it yet · the branch is behind its base",
          reason: "behind",
        }),
      }),
    );
  });

  it("names the first red gates in one line and counts the rest", () => {
    expect(
      failingLine([
        "ci::nix",
        "ci::unit",
        "ci::e2e",
        "ci::biome",
        "ci::docs",
        "ci::home",
        "ci::mcp",
      ]),
    ).toBe("7 failing: ci::nix, ci::unit, +5");
    expect(failingLine(["ci::nix"])).toBe("1 failing: ci::nix");
  });

  it("prefers the live tally, and says when GitHub has not answered", () => {
    const section = Option.getOrThrow(
      prSection(
        handingOver([opened, passed]),
        Option.some({ pass: 3, pending: 1, fail: 0, total: 4 }),
      ),
    );
    expect(section.checks).toBe("3 passed · 1 running · 0 failed");
    expect(Option.map(section.merge, (merge) => merge.reason)).toEqual(
      Option.some("unknown"),
    );
  });

  it("forgets GitHub's answer once checks name another commit", () => {
    const pushed = event({
      kind: "checks-running",
      by: "ci",
      pr: 9,
      head: { kind: "commit", sha: "def5678" },
      failing: [],
    });
    const section = Option.getOrThrow(
      prSection(
        handingOver([opened, passed, mergeSays({ kind: "can" }), pushed]),
        Option.none(),
      ),
    );
    expect(Option.map(section.merge, (merge) => merge.reason)).toEqual(
      Option.some("unknown"),
    );
    expect(
      Option.isSome(
        needsYouOf(
          "w",
          handingOver([opened, passed, mergeSays({ kind: "can" }), pushed]),
        ),
      ),
    ).toBe(false);
  });

  it("drops the merge answer once the PR is merged", () => {
    const done = handingOver([
      opened,
      passed,
      mergeSays({ kind: "can" }),
      event({ kind: "merged", by: "agent", pr: 9 }),
    ]);
    const section = Option.getOrThrow(prSection(done, Option.none()));
    expect(section.state).toBe("merged");
    expect(section.merge).toEqual(Option.none());
  });

  it("is absent for a work with no PR", () => {
    expect(prSection(work(), Option.none())).toEqual(Option.none());
  });
});

describe("what an open card shows of the setup and the decisions", () => {
  it("says the setup in one line, each part carrying what was recorded", () => {
    const one = work({
      decisions: [
        mode("full"),
        choice("planner.harness", "omp"),
        choice("planner.model", "fable-5.2"),
        onGreen("hand-over"),
        picked("Approve", { id: "w1", ask: "a1" }),
      ],
    });
    const line = setupLine(one);
    expect(line.map((part) => part.text)).toEqual([
      "full",
      "planner omp/fable-5.2",
      "on green: hand over",
    ]);
    expect(line.find((part) => part.key === "on-green")?.answer).toBe(
      "hand-over",
    );
    // ... and a question about the work is not part of it.
    expect(otherDecisions(one).map((row) => row.answer)).toEqual(["Approve"]);
  });
});

describe("which events an open card shows", () => {
  const timeline = [
    event({ kind: "requested", by: "you" }),
    joined("local/p", "planner"),
    joined("local/i", "implementor"),
    opened,
  ];
  const one = work({ decisions: [mode("full")], events: timeline });
  const rowsOfEvents = (indices: ReadonlyArray<number>) =>
    indices.map((index) => ({ kind: "event", index }));

  it("shows the stage the work is in, until a stage is pressed", () => {
    const read = stagesOf(one, "2026-01-01T10:30:00.000Z");
    expect(timelineShown(one, read, undefined, false)).toMatchObject({
      view: { kind: "stage", stage: "review" },
      rows: rowsOfEvents([3]),
    });
    expect(timelineShown(one, read, "plan", false)).toMatchObject({
      view: { kind: "stage", stage: "plan" },
      rows: rowsOfEvents([0, 1]),
    });
    // ... and the whole of it folds back to the stage it came from.
    expect(timelineShown(one, read, "plan", true).folded).toEqual({
      kind: "stage",
      stage: "plan",
    });
    expect(timelineShown(one, read, "plan", true).rows).toHaveLength(4);
  });

  it("shows a watch's latest few, a watch having no stages", () => {
    const watch = work({
      decisions: [mode("watch")],
      events: Array.from({ length: 9 }, () => joined()),
    });
    const shown = timelineShown(watch, stagesOf(watch, AT), undefined, false);
    expect(shown.view).toEqual({ kind: "latest" });
    expect(shown.rows).toEqual(rowsOfEvents([4, 5, 6, 7, 8]));
  });

  it("draws one row where the forge merged a PR and the work ended merged", () => {
    const outcome = { kind: "merged", pr: 9 } as const;
    const done = work({
      state: { kind: "ended", at: AT, outcome, kept: [] },
      decisions: [mode("watch")],
      events: [
        opened,
        event({ kind: "merged", by: "kolu", pr: 9 }),
        event({ kind: "ended", outcome }),
      ],
    });
    const shown = timelineShown(done, stagesOf(done, AT), undefined, true);
    expect(shown.rows).toEqual(rowsOfEvents([0, 1]));
    expect(shown.total).toBe(2);
  });

  describe("a folder the work wrote into", () => {
    const wrote = (path: string, terminal = "local/p") =>
      event({ kind: "file", by: "agent", about: aboutMember(terminal), path });
    const whole = (events: ReadonlyArray<WorkEvent>) => {
      const it = work({ decisions: [mode("watch")], events: [...events] });
      return timelineShown(it, stagesOf(it, AT), undefined, true);
    };

    it("is one row for a run of files in it, deeper folders counted in", () => {
      const shown = whole([
        joined("local/p"),
        wrote(".waterfall/plan.md"),
        wrote(".waterfall/mockup/a.html"),
        wrote(".waterfall/mockup/b.html"),
        wrote(".waterfall/mockup/fonts/x.woff2"),
      ]);
      expect(shown.rows).toEqual([
        { kind: "event", index: 0 },
        { kind: "event", index: 1 },
        { kind: "folder", folder: ".waterfall/mockup/", indices: [2, 3, 4] },
      ]);
      // THE TOTAL COUNTS ROWS AS DRAWN, not the events under them.
      expect(shown.total).toBe(3);
    });

    it("splits where another event, or another terminal, comes between", () => {
      const shown = whole([
        wrote(".waterfall/mockup/a.html"),
        wrote(".waterfall/mockup/b.html"),
        joined("local/i", "implementor"),
        wrote(".waterfall/mockup/c.html"),
        wrote(".waterfall/mockup/d.html"),
        wrote(".waterfall/mockup/e.html", "local/i"),
      ]);
      expect(shown.rows).toEqual([
        { kind: "folder", folder: ".waterfall/mockup/", indices: [0, 1] },
        { kind: "event", index: 2 },
        { kind: "folder", folder: ".waterfall/mockup/", indices: [3, 4] },
        { kind: "event", index: 5 },
      ]);
    });

    it("leaves a lone file in a folder, and top-level files, as plain rows", () => {
      const shown = whole([
        wrote(".waterfall/plan.md"),
        wrote(".waterfall/notes.md"),
        wrote(".waterfall/mockup/a.html"),
        wrote(".waterfall/review.md"),
      ]);
      expect(shown.rows).toEqual(rowsOfEvents([0, 1, 2, 3]));
      expect(shown.total).toBe(4);
    });
  });
});

describe("where it stands", () => {
  it("leads with the waiter, and puts the live check tally after CI", () => {
    // A check is about a PR the timeline opened: the one PR rule reads no
    // check of a PR it never saw open.
    const ci = work({
      events: [
        opened,
        event({
          kind: "checks-running",
          by: "ci",
          pr: 9,
          head: { kind: "unreported" },
          failing: [],
        }),
      ],
    });
    const line = standingLine(
      ci,
      Option.some({ pass: 14, pending: 9, fail: 0, total: 23 }),
    );
    expect(line.who).toBe("ci");
    expect(line.lead).toBe("CI running");
    // 14 landed of 23 — the one number the record cannot hold, because it is
    // only true for the instant it was read.
    expect(line.what).toEqual(Option.some("14 of 23 checks"));
  });

  it("says the question itself while it waits on you", () => {
    const asking = work({
      decisions: [asked()],
      events: [event({ kind: "question", by: "agent", ask: "ask-1" })],
    });
    const line = standingLine(asking, Option.none());
    expect(line.who).toBe("you");
    expect(line.lead).toBe("Needs you");
    expect(line.what).toEqual(Option.some("Approve the plan?"));
    expect(line.clock).toBe("asked");
  });

  it("names the outcome once it is over — and there is no 'abandoned'", () => {
    const outcome = { kind: "merged", pr: 7 } as const;
    const over = work({
      state: { kind: "ended", at: AT, outcome, kept: [] },
      events: [event({ kind: "ended", outcome })],
    });
    // Said once: "Merged #7", never "Merged · Merged #7".
    expect(standingLine(over, Option.none())).toMatchObject({
      who: "done",
      lead: "Merged #7",
      what: Option.none(),
    });
  });

  it("says WHO stopped a work that somebody stopped", () => {
    expect(outcomeWords({ kind: "stopped", by: "you" })).toBe("Stopped by you");
    expect(outcomeWords({ kind: "stopped", by: "conductor" })).toBe(
      "Stopped by the Conductor",
    );
    expect(outcomeWords({ kind: "closed", pr: 12 })).toBe("Closed #12");
  });
});

describe("the members of one work", () => {
  it("reads them out of the ONE map, in the order a waterfall runs them", () => {
    const unread = { kind: "unread" } as const;
    const map = new Map<string, WorkMember>([
      [
        "local/b",
        { work: WORK, role: "implementor", joinedAt: AT, worktree: unread },
      ],
      [
        "local/a",
        { work: WORK, role: "planner", joinedAt: AT, worktree: unread },
      ],
      [
        "local/c",
        {
          work: "branch:local/x/y",
          role: "other",
          joinedAt: AT,
          worktree: unread,
        },
      ],
    ]);
    expect(membersIn(map, WORK).map((one) => one.terminal)).toEqual([
      "local/a",
      "local/b",
    ]);
  });

  it("answers the empty list for a work nothing is a member of", () => {
    expect(membersIn(new Map(), WORK)).toEqual([]);
  });
});

describe("the timeline's words", () => {
  const plan = work({
    decisions: [picked("Approve", { header: "Plan approval" }, "card")],
    events: [joined()],
  });

  it("names the decision rather than copying the question's words", () => {
    // THE DEFECT THIS GUARDS: the timeline used to quote the question, so a
    // sentence a person already read on the card was read to them twice.
    expect(words(plan, event({ kind: "question", ask: "ask-1" }))).toBe(
      "Asked: Plan approval",
    );
    expect(words(plan, event({ kind: "answered", ask: "ask-1" }))).toBe(
      "You: Approve",
    );
  });

  it("says a form answered in parts is answered in parts", () => {
    // BUG 2, on the timeline: what was filled in is recorded and the rest of
    // the ask is still in front of the person, so the line must not read as
    // an answer to the whole of it.
    const line = words(plan, event({ kind: "answered-part", ask: "ask-1" }));
    expect(line).toContain("part");
    expect(line).toContain("still open");
  });

  it("never draws an ask id, not even for a question nobody can find", () => {
    const orphan = { kind: "question", ask: "ask:29b0c4f1:1" } as const;
    for (const kind of ["question", "answered", "question-dropped"] as const)
      expect(words(plan, event({ ...orphan, kind }))).not.toContain("ask:");
    expect(words(plan, event(orphan))).toBe("Asked: something");
  });

  it("says which commit a check event is about once there are two", () => {
    const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";
    const PUSHED = "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5";
    const check = (
      kind: "checks-running" | "checks-passed" | "checks-failed",
      sha: string,
      failing: string[] = [],
    ) =>
      event({ kind, by: "ci", pr: 7, head: { kind: "commit", sha }, failing });
    // One commit: the oid is on the record, and saying it would be the
    // card's loudest word for its least interesting fact.
    const one = work({
      events: [check("checks-running", HEAD), check("checks-passed", HEAD)],
    });
    expect(words(one, one.events[0] as WorkEvent)).toBe("CI running");
    // A push: now the two runs have to be told apart.
    const pushed = work({
      events: [
        ...one.events,
        check("checks-running", PUSHED),
        check("checks-failed", PUSHED, ["ci::biome", "ci::unit"]),
      ],
    });
    expect(words(pushed, pushed.events[0] as WorkEvent)).toBe(
      "CI running · 4f21a9c",
    );
    expect(words(pushed, pushed.events[1] as WorkEvent)).toBe(
      "Checks passed · 4f21a9c",
    );
    expect(words(pushed, pushed.events[3] as WorkEvent)).toBe(
      "Checks failed · ci::biome, ci::unit · 9b7e3d1",
    );
  });

  it("draws a check event whose reading named no commit", () => {
    const old = work({
      events: [
        event({
          kind: "checks-failed",
          by: "ci",
          pr: 7,
          head: { kind: "unreported" },
          failing: ["build"],
        }),
      ],
    });
    expect(words(old, old.events[0] as WorkEvent)).toBe(
      "Checks failed · build",
    );
  });

  it("names a member by the part it played, even after it left", () => {
    expect(
      words(
        plan,
        event({
          kind: "stopped",
          about: aboutMember("local/a"),
          why: { kind: "none" },
        }),
      ),
    ).toBe("Planner stopped");
    expect(
      words(
        plan,
        event({ kind: "left", about: aboutMember("local/a"), why: "gone" }),
      ),
    ).toBe("Planner left · its terminal is gone");
    expect(
      words(plan, event({ kind: "file", path: ".waterfall/plan.md" })),
    ).toBe("Wrote .waterfall/plan.md");
  });

  it("says why an agent exited when its terminal gave a reason", () => {
    expect(
      words(
        plan,
        event({
          kind: "exited",
          about: aboutMember("local/a"),
          why: { kind: "reason", text: "killed" },
        }),
      ),
    ).toBe("Planner exited · killed");
    expect(
      words(
        plan,
        event({
          kind: "exited",
          about: aboutMember("local/a"),
          why: { kind: "none" },
        }),
      ),
    ).toBe("Planner exited");
  });

  it("says the end and the way back in the words there are only four of", () => {
    expect(
      words(
        plan,
        event({ kind: "ended", outcome: { kind: "stopped", by: "you" } }),
      ),
    ).toBe("Stopped by you");
    expect(words(plan, event({ kind: "reopened" }))).toBe("Opened again");
  });

  it("says how an answer ended when nobody gave one", () => {
    expect(answerWords(asked())).toBe("waiting");
    expect(answerWords(declined())).toBe("declined");
  });

  it("says what was SAID — the picks, then the words typed", () => {
    expect(answerWords(picked("Approve"))).toBe("Approve");
    expect(answerWords(said({ kind: "typed", text: "keep the guides" }))).toBe(
      "keep the guides",
    );
    expect(
      answerWords(
        said({
          kind: "picked-and-typed",
          picked: ["Approve"],
          text: "but rename it",
        }),
      ),
    ).toBe("Approve · but rename it");
  });
});

describe("the lock, as a person meets it", () => {
  /** A work the Conductor DRIVES — mode answered, one planner in the members
   *  map. The driver is read off the record by `kolu-work`; what is tested
   *  here is the browser's two answers to it: may this person type, and what
   *  does the banner say. */
  const driven = work({ decisions: [mode("full")], events: [joined()] });
  const membershipAt = (one: Work) => {
    const at = membershipOf(new Map([[WORK, one]]), members()).get("local/a");
    if (at === undefined) throw new Error("the planner must be a member");
    return at;
  };

  it("blocks a person's input only while the Conductor is driving", () => {
    // The three cases every input site passes through this one rule: driven,
    // taken over, and a terminal the index does not name at all.
    expect(inputAllowed(Option.some(membershipAt(driven)))).toBe(false);
    const mine = takeOver(driven, "local/a", AT);
    expect(inputAllowed(Option.some(membershipAt(mine)))).toBe(true);
    expect(inputAllowed(Option.none())).toBe(true);
  });

  it("says who is driving, which part and which work", () => {
    const at = membershipAt(driven);
    expect(lockWords(at, "conductor")).toBe(
      "Driven by the Conductor · Planner · Show agent-distro update errors",
    );
    // Taken over: the SAME index, read after the act — so the banner, the
    // dock's mark and the keystroke gate cannot disagree.
    const mine = takeOver(driven, "local/a", AT);
    expect(membershipAt(mine).driver).toBe("you");
    expect(lockWords(membershipAt(mine), "you")).toBe(
      "Taken over · Planner · Show agent-distro update errors",
    );
    expect(membershipAt(handBack(mine, "local/a", AT)).driver).toBe(
      "conductor",
    );
  });

  it("names the Conductor and the part on the card typing raises", () => {
    // ONE LINE, and no work title in it: the card is centred over the very
    // terminal it is about, so the words say who holds the keyboard and what
    // this terminal is for, and nothing a reader can already see.
    expect(lockCardWords(membershipAt(driven))).toBe(
      "The Conductor is driving this terminal · Planner",
    );
  });

  it("drives NOBODY in a work that drives nothing — a watch", () => {
    const watched = work({ decisions: [mode("watch")], events: [joined()] });
    // An arm of its own, not an absence: the terminal is a member, and
    // nothing types into it but the person in front of it.
    expect(membershipAt(watched).driver).toBe("nobody");
    expect(inputAllowed(Option.some(membershipAt(watched)))).toBe(true);
  });

  it("tells the timeline what the person did, by the part they took", () => {
    expect(
      words(
        driven,
        event({ kind: "taken-over", by: "you", about: aboutMember("local/a") }),
      ),
    ).toBe("You took over the planner");
    expect(
      words(
        driven,
        event({
          kind: "handed-back",
          by: "you",
          about: aboutMember("local/a"),
        }),
      ),
    ).toBe("You handed the planner back");
    // The bound's own event: a count, in words, where the stretch happened.
    expect(words(driven, event({ kind: "folded", count: 42 }))).toBe(
      "42 earlier agent state changes",
    );
  });
});

describe("the card's own vocabulary and typography", () => {
  it("labels a setup decision by its key's own name, one label per role", () => {
    expect(decisionLabel(modeAsked())).toBe("Mode");
    expect(decisionLabel(onGreenAsked())).toBe("On green");
    // A role is ONE row: its harness and its model answer under one label.
    expect(decisionLabel(choiceAsked("planner.harness"))).toBe("Planner");
    expect(decisionLabel(choiceAsked("planner.model"))).toBe("Planner");
    expect(decisionLabel(choiceAsked("implementor.model"))).toBe("Implementor");
    // Every key has a row, and no key has two. The HOST is not among them:
    // a work IS its host, so there is nothing there to decide.
    expect([...SETUP_ROWS].flat().sort()).toEqual([...SETUP_KEYS].sort());
  });

  it("labels any other decision by its header", () => {
    expect(decisionLabel(asked({ header: "Plan approval" }))).toBe(
      "Plan approval",
    );
  });

  it("stands in a few words of the question for a header of none", () => {
    expect(decisionLabel(asked())).toBe("Approve the plan?");
    // THE DEFECT THIS GUARDS: a Conductor that reasons inside its question
    // had that whole paragraph drawn as the row's label.
    expect(
      decisionLabel(
        asked({
          question:
            "Full or trivial? I'd pick full: a docs rewrite has choices of scope and voice worth seeing in a plan.",
        }),
      ),
    ).toBe("Full or trivial? I'd pick full: a…");
  });

  it("cuts a line at a word, says there is more, and leaves a short one alone", () => {
    expect(oneLine("Checks passed")).toEqual({
      line: "Checks passed",
      rest: false,
    });
    const whole =
      "Which host should this run on? ~/code/odu is a different checkout on each machine, so it matters";
    const long = oneLine(whole);
    expect(long.rest).toBe(true);
    expect(long.line.endsWith("…")).toBe(true);
    expect(long.line.length).toBeLessThanOrEqual(LINE_LIMIT + 1);
    expect(whole.startsWith(long.line.slice(0, -1))).toBe(true);
  });

  it("flattens line breaks into the one line, and says the rest is behind it", () => {
    expect(oneLine("Opened #7\nRewrite the parser")).toEqual({
      line: "Opened #7 Rewrite the parser",
      rest: true,
    });
  });
});

describe("the decisions, as the rows a card draws", () => {
  const set = work({
    decisions: [
      mode("trivial"),
      choice("implementor.harness", "omp", { id: "ih" }),
      choice("implementor.model", "Opus 5.5", { id: "im" }),
      onGreen("hand-over"),
    ],
  });

  it("draws the setup first, one row per label", () => {
    expect(
      decisionRows(set).map((row) => `${row.label} — ${row.answer}`),
    ).toEqual([
      "Mode — trivial",
      // ONE row for the role: its harness and its model, not two questions.
      "Implementor — omp · Opus 5.5",
      "On green — hand over",
    ]);
    // Nothing asked: no rows at all.
    expect(decisionRows(work())).toEqual([]);
  });

  it("keeps the question and where it was answered behind the row", () => {
    const row = decisionRows(set)[0];
    expect(row?.from).toEqual(Option.some("chat"));
    expect(row?.topic).toEqual({ kind: "setup", key: "mode" });
    expect(row?.decisions.map((one) => one.question)).toEqual([
      "Approve the plan?",
    ]);
  });

  it("says a setup question nobody has answered is still waiting", () => {
    const open = work({ decisions: [modeAsked()] });
    const row = decisionRows(open)[0];
    expect(row?.answer).toBe("waiting");
    expect(row?.from).toEqual(Option.none());
  });

  it("labels a question that is not setup by its header, and cuts a long answer", () => {
    const long = work({
      decisions: [
        picked(
          "Change it: the rewrite should keep the reference pages as they are and only touch the guides",
          { id: "p", header: "Plan approval" },
        ),
      ],
    });
    const row = decisionRows(long)[0];
    expect(row?.label).toBe("Plan approval");
    expect(row?.topic).toEqual({ kind: "work" });
    expect(row?.rest).toBe(true);
    expect(row?.answer.endsWith("…")).toBe(true);
  });
});

describe("the tab's one number", () => {
  const waitingWork = work({
    decisions: [asked({ ask: "ask-work" })],
    events: [event({ kind: "question", by: "agent", ask: "ask-work" })],
  });
  /** The count and the status words, over the one needs-you reading of
   *  these works. */
  const needsOf = (works: ReadonlyArray<Work>) =>
    needsYou(works.map((one, at): [string, Work] => [`w${at}`, one]));
  const count = (works: ReadonlyArray<Work>, asks: ReadonlyArray<string>) =>
    waitingCount(needsOf(works), works, asks);
  const words = (works: ReadonlyArray<Work>, asks: ReadonlyArray<string>) =>
    worksStatusWords(needsOf(works), works, asks);

  it("counts a work waiting on you ONCE, however many questions it holds", () => {
    const two = work({
      decisions: [
        asked({ id: "d1", ask: "ask-work" }),
        asked({ id: "d2", ask: "ask-work" }),
      ],
      events: waitingWork.events,
    });
    expect(count([two], ["ask-work"])).toBe(1);
  });

  it("adds a question that belongs to no work, and never double-counts one that does", () => {
    // `ask-work` is the work's own — already counted by the work. `ask-chat`
    // is the conversation's alone and has no card to carry it.
    expect(count([waitingWork], ["ask-work", "ask-chat"])).toBe(2);
    expect(count([], ["ask-chat"])).toBe(1);
    expect(count([work()], [])).toBe(0);
  });

  it("leaves a part that would read zero out of the status line", () => {
    expect(words([work()], [])).toBe("1 piece of work");
    expect(words([], ["ask-chat"])).toBe("1 needs you");
    expect(words([], ["ask-chat", "ask-other"])).toBe("2 need you");
    expect(words([], [])).toBe("");
    // An ENDED work is not in flight, so it is not counted as a piece of work.
    expect(
      words(
        [
          work({
            state: {
              kind: "ended",
              at: AT,
              outcome: { kind: "stopped", by: "you" },
              kept: [],
            },
          }),
        ],
        [],
      ),
    ).toBe("");
  });
});

describe("a PR's checks", () => {
  it("says nothing at all when no checks are configured", () => {
    expect(
      checksTally(
        Option.some({
          number: 1,
          title: "t",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
        }),
      ),
    ).toEqual(Option.none());
    expect(checksTally(Option.none())).toEqual(Option.none());
  });
});

/** The sum's two arms, as the card reads them — a compile-time claim as much
 *  as a runtime one: an ended work has no `members` and no open asks to draw,
 *  because the ended arm of {@link Decision}'s neighbour has nowhere to put
 *  them. */
describe("a finished card has nothing to draw terminals or questions from", () => {
  it("has no members in the one map once the work has ended", () => {
    // Ending removes a work's members in the same step, so the map simply has
    // no row pointing at it.
    expect(membersIn(new Map(), WORK)).toEqual([]);
  });

  it("keeps its decisions and its timeline across the end", () => {
    const decided: ReadonlyArray<Decision> = [onGreen("hand-over")];
    const over = work({
      decisions: [...decided],
      state: {
        kind: "ended",
        at: AT,
        outcome: { kind: "stopped", by: "you" },
        kept: [],
      },
      events: [
        joined(),
        event({ kind: "ended", outcome: { kind: "stopped", by: "you" } }),
        event({ kind: "reopened" }),
      ],
    });
    expect(decisionRows(over).map((row) => row.label)).toEqual(["On green"]);
    expect(over.events.map((one) => words(over, one))).toEqual([
      "Planner joined",
      "Stopped by you",
      "Opened again",
    ]);
  });
});
