/**
 * WHAT AN OBSERVATION MEANS TO A WORK, pinned by CALLING it.
 *
 * The padi↔timeline translation used to be three closures inside a 2,800-line
 * host, reachable only by standing one up with three stores, a files port, a
 * spawn and a proven MCP endpoint — while its two siblings in the same chain
 * (`./readings.ts`, `./members.ts`) were modules with unit tests beside them.
 * These are the same rules, exercised the same way.
 */

import { Option } from "effect";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK,
  aboutMember,
  type CheckHead,
  endedAt,
  endWork,
  joinWork,
  holdingOf,
  holds,
  openWork,
  outcomeOf,
  type PrReading,
  prLinks,
  prOf,
  recordEvent,
  type Work,
} from "kolu-work";
import {
  fileEvents,
  observing,
  prEvents,
  ringEvent,
  toldEvents,
} from "./observing.ts";
import type { WatchChecks, WatchMerge, WatchPr } from "./observation.ts";
import { prReading } from "./readings.ts";

const AT = "2026-02-01T10:00:00.000Z";
const A = "local/aaaa";
const B = "remote:box/bbbb";

/** Two members in ONE worktree, which is the shape the defect needs: both
 *  terminals' records carry a reading of the same pull request. */
const work = (): Work =>
  joinWork(
    joinWork(
      openWork({
        key: {
          kind: "branch",
          host: "local",
          repo: "/srv/repo",
          branch: "fix-the-parser",
        },
        title: "fix the parser",
        at: AT,
        request: { kind: "said", text: "fix it" },
      }),
      { terminal: A, role: "implementor", at: AT },
    ),
    { terminal: B, role: "planner", at: AT },
  );

/** The commit the checks are about — a forge's oid, as padi now reports it. */
const HEAD: CheckHead = {
  kind: "commit",
  sha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
};
const PUSHED: CheckHead = {
  kind: "commit",
  sha: "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5",
};
/** A host whose padi predates the field says nothing about commits. */
const NO_HEAD: CheckHead = { kind: "unreported" };

/** The forge's rollup over a PR's checks. */
const rolled = (rollup: "pending" | "pass" | "fail"): WatchChecks => ({
  kind: "rollup",
  rollup,
});

/** What the timeline last said about the PR's checks. */
const checksOf = (one: Work): Option.Option<PrReading["checks"]> =>
  Option.map(prOf(one), (pr) => pr.checks);

/** One reading of the PR. `draft` picks the readiness arm; `merge` is the
 *  forge's answer, which only a PR that is not a draft carries. */
const pr = ({
  merge = { kind: "unsettled" },
  draft = false,
  ...over
}: Omit<Partial<WatchPr>, "readiness"> & {
  readonly merge?: WatchMerge;
  readonly draft?: boolean;
} = {}): WatchPr => ({
  number: 7,
  title: "Fix the parser",
  url: "https://github.com/kolu-e2e/parser/pull/7",
  state: "open",
  checks: { kind: "unreported" },
  readiness: draft ? { kind: "draft" } : { kind: "ready", merge },
  failing: [],
  head: HEAD,
  ...over,
});

/** The merge answers on the timeline, in order. */
const merges = (one: Work) =>
  one.events.flatMap((event) =>
    event.kind === "merge-state" ? [event.merge] : [],
  );

const kinds = (one: Work): ReadonlyArray<string> =>
  one.events.map((event) => event.kind);

describe("what a ring puts on the timeline", () => {
  it("spells an agent's four states as themselves, by the agent", () => {
    for (const level of ["ready", "stopped", "asking", "exited"] as const) {
      expect(ringEvent(A, level, AT)).toEqual(
        Option.some({
          at: AT,
          by: "agent",
          kind: level,
          about: aboutMember(A),
          why: { kind: "none" },
        }),
      );
    }
  });

  it("says a terminal put away is kolu's doing, not an agent's", () => {
    expect(Option.getOrThrow(ringEvent(A, "asleep", AT))).toMatchObject({
      by: "kolu",
      kind: "asleep",
    });
  });

  it("spells a brief that never started as an exit, and says which kind", () => {
    // For a reader of the timeline "the command ended with no agent ever in
    // it" is the same ending as an exit — by kolu, because there was no agent
    // there to do it.
    expect(Option.getOrThrow(ringEvent(A, "ended", AT))).toMatchObject({
      by: "kolu",
      kind: "exited",
      why: { kind: "reason", text: "ended without an agent" },
    });
  });

  it("writes nothing for the three that are not readings of an agent", () => {
    // `gone` is a member LEAVING (`leaveWork` writes that with its reason);
    // the two hand-overs are written where the keys actually changed hands.
    expect(ringEvent(A, "gone", AT)).toEqual(Option.none());
    expect(ringEvent(A, "taken-over", AT)).toEqual(Option.none());
    expect(ringEvent(A, "handed-back", AT)).toEqual(Option.none());
  });
});

describe("what speaking to a member puts on the timeline", () => {
  const ring = (one: Work, level: "stopped" | "asking"): Work =>
    recordEvent(one, Option.getOrThrow(ringEvent(A, level, AT)));
  const told = (one: Work): number =>
    one.events.filter((event) => event.kind === "told").length;

  it("hands the work to a member that let go of it, once while it holds it", () => {
    const stopped = ring(work(), "stopped");
    expect(holds(holdingOf(stopped), A)).toBe(false);
    const once = toldEvents(stopped, A, AT);
    expect(once.events.at(-1)).toEqual({
      at: AT,
      by: "agent",
      kind: "told",
      about: aboutMember(A),
    });
    // A second word to the agent still at work hands nothing over.
    expect(toldEvents(once, A, AT)).toBe(once);
    // ... and one after it stopped again is a hand-off again.
    const again = toldEvents(ring(once, "stopped"), A, AT);
    expect(told(again)).toBe(2);
  });

  it("records nothing for an answer to an agent that is asking", () => {
    // Asking a person is not letting go: the agent still holds the work.
    const asking = ring(work(), "asking");
    expect(toldEvents(asking, A, AT)).toBe(asking);
  });

  it("records nothing for any word to an `other` member: nothing is handed over", () => {
    const watched = "local/watched";
    const withOther = joinWork(work(), {
      terminal: watched,
      role: "other",
      at: AT,
    });
    let said = withOther;
    for (let word = 0; word < 40; word += 1)
      said = toldEvents(said, watched, AT);
    expect(said).toBe(withOther);
  });

  it("records a word to a planner on a saved work, whatever its old record says", () => {
    // The planner joined and its stop was folded away before kolu kept
    // hand-offs, so its record alone reads as if it held the work.
    expect(holds(holdingOf(work()), B)).toBe(true);
    const saved = recordEvent(work(), {
      at: AT,
      by: "kolu",
      kind: "hand-offs-kept",
      about: ABOUT_WORK,
    });
    expect(toldEvents(saved, B, AT).events.at(-1)).toEqual({
      at: AT,
      by: "agent",
      kind: "told",
      about: aboutMember(B),
    });
  });

  it("writes nothing on any work for a terminal that is no member", () => {
    const saved: Array<Work> = [];
    const watching = observing({
      store: {
        at: () => undefined,
        save: (_id: string, one: Work) => saved.push(one),
      },
      withdraw: () => false,
    } as unknown as Parameters<typeof observing>[0]);
    watching.saidTo("local/stranger");
    expect(saved).toEqual([]);
  });
});

describe("the PR the work's own watch reads", () => {
  it("records the pull request ONCE, and says so with no terminal", () => {
    const opened = prEvents(work(), pr(), AT);
    expect(kinds(opened)).toContain("pr-opened");
    expect(
      opened.events.find((event) => event.kind === "pr-opened"),
    ).toMatchObject({
      kind: "pr-opened",
      by: "kolu",
      about: ABOUT_WORK,
      pr: 7,
      url: { kind: "link", href: "https://github.com/kolu-e2e/parser/pull/7" },
    });
    // The comparison is against the TIMELINE, so the next poll — and the
    // first look after a restart — records nothing.
    expect(prEvents(opened, pr(), AT)).toBe(opened);
  });

  it("learns the address of a PR recorded before kolu kept one", () => {
    const before = recordEvent(work(), {
      at: AT,
      by: "kolu",
      kind: "pr-opened",
      about: ABOUT_WORK,
      pr: 7,
      title: "Fix the parser",
      url: { kind: "unrecorded" },
      draft: "unrecorded",
    });
    const learned = prEvents(before, pr(), AT);
    expect(prLinks(learned).get(7)).toBe(
      "https://github.com/kolu-e2e/parser/pull/7",
    );
    expect(kinds(learned).filter((kind) => kind === "pr-opened")).toHaveLength(
      1,
    );
  });

  it("answers a reading whose PR has no address as broken, not as a PR", () => {
    expect(
      prReading({
        kind: "ok",
        value: {
          number: 7,
          title: "t",
          url: "",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: null,
          headSha: null,
          isDraft: false,
        },
      }).kind,
    ).toBe("broken");
  });

  it("steps the checks through the ONE table, and names the failures", () => {
    let one = prEvents(work(), pr({ checks: rolled("pending") }), AT);
    expect(checksOf(one)).toEqual(Option.some("running"));
    // The same rollup again is the same reading: nothing is written.
    expect(prEvents(one, pr({ checks: rolled("pending") }), AT)).toBe(one);
    one = prEvents(
      one,
      pr({ checks: rolled("fail"), failing: ["build", "lint"] }),
      AT,
    );
    expect(checksOf(one)).toEqual(Option.some("failed"));
    expect(one.events.at(-1)).toMatchObject({
      kind: "checks-failed",
      by: "ci",
      about: ABOUT_WORK,
      pr: 7,
      head: HEAD,
      failing: ["build", "lint"],
    });
    one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    expect(checksOf(one)).toEqual(Option.some("passed"));
  });

  // THE DEFECT THIS GUARDS (juspay/kolu#2376): the work used to learn its PR
  // from every member's record, so two terminals in one worktree thirty
  // seconds out of step wrote a check event each, every frame, for as long as
  // they disagreed — 429 of the human's real work's 465 events. There is ONE
  // reader now, and the poll is what repeats.
  it("writes a HANDFUL of events for five hundred polls of one PR", () => {
    let one = work();
    for (let poll = 0; poll < 250; poll += 1)
      one = prEvents(one, pr({ checks: rolled("pending") }), AT);
    for (let poll = 0; poll < 250; poll += 1)
      one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
    expect(kinds(one).filter((kind) => kind === "pr-opened")).toHaveLength(1);
  });

  it("records a change of the rollup's word on ONE commit, every time", () => {
    // The quick checks pass, then the real CI run makes the rollup pending
    // again on the same commit; it fails, and passes on a re-run.
    let one = work();
    for (const word of ["pending", "pass", "pending", "fail", "pass"] as const)
      one = prEvents(
        one,
        pr({
          checks: rolled(word),
          failing: word === "fail" ? ["build"] : [],
        }),
        AT,
      );
    expect(kinds(one).filter((kind) => kind.startsWith("checks-"))).toEqual([
      "checks-running",
      "checks-passed",
      "checks-running",
      "checks-failed",
      "checks-passed",
    ]);
    expect(checksOf(one)).toEqual(Option.some("passed"));
  });

  it("says WHICH COMMIT a check event is about, so a push reads as one", () => {
    let one = prEvents(work(), pr({ checks: rolled("pending") }), AT);
    one = prEvents(one, pr({ checks: rolled("pass") }), AT);
    // A push: the same rollup word about a different commit is news.
    one = prEvents(one, pr({ checks: rolled("pending"), head: PUSHED }), AT);
    expect(kinds(one).filter((kind) => kind.startsWith("checks-"))).toEqual([
      "checks-running",
      "checks-passed",
      "checks-running",
    ]);
    expect(one.events.at(-1)).toMatchObject({ head: PUSHED, pr: 7 });
    // ... and the new commit's checks running is still recorded once.
    expect(
      prEvents(one, pr({ checks: rolled("pending"), head: PUSHED }), AT),
    ).toBe(one);
  });

  it("records whether the forge would merge it, once per change", () => {
    // Quick checks passed, required ones not started: the checks say passed
    // and the forge says it cannot merge — two facts, two events.
    let one = prEvents(
      work(),
      pr({
        checks: rolled("pass"),
        merge: { kind: "cannot", why: "blocked" },
      }),
      AT,
    );
    for (let poll = 0; poll < 20; poll += 1)
      one = prEvents(
        one,
        pr({
          checks: rolled("pass"),
          merge: { kind: "cannot", why: "blocked" },
        }),
        AT,
      );
    expect(merges(one)).toEqual([{ kind: "cannot", why: "blocked" }]);
    one = prEvents(one, pr({ merge: { kind: "can" } }), AT);
    // The base moved on: the green is taken back; GitHub recomputes the
    // commit, which takes back the answer it had; then gives it again.
    one = prEvents(one, pr({ merge: { kind: "cannot", why: "behind" } }), AT);
    one = prEvents(one, pr({ merge: { kind: "unsettled" } }), AT);
    one = prEvents(one, pr({ merge: { kind: "can" } }), AT);
    expect(merges(one)).toEqual([
      { kind: "cannot", why: "blocked" },
      { kind: "can" },
      { kind: "cannot", why: "behind" },
      { kind: "unsettled" },
      { kind: "can" },
    ]);
    // ... and nothing more for a host that never says.
    expect(prEvents(one, pr({ merge: { kind: "unreported" } }), AT)).toBe(one);
  });

  it("records GitHub working out a NEW commit, so the last one's answer does not stand", () => {
    let one = prEvents(work(), pr({ merge: { kind: "can" } }), AT);
    // A push: GitHub has not worked the new commit out yet.
    one = prEvents(one, pr({ head: PUSHED, merge: { kind: "unsettled" } }), AT);
    expect(merges(one)).toEqual([{ kind: "can" }, { kind: "unsettled" }]);
    expect(Option.map(prOf(one), (reading) => reading.merge.kind)).toEqual(
      Option.some("unsettled"),
    );
    // ... once: the next poll still unsettled is no news.
    expect(
      prEvents(one, pr({ head: PUSHED, merge: { kind: "unsettled" } }), AT),
    ).toBe(one);
  });

  it("hears a reading with NO head when its word moves", () => {
    // A host whose padi predates the field says nothing about commits, so
    // there is nothing to tell two readings apart with but the word.
    let one = prEvents(
      work(),
      pr({ checks: rolled("pending"), head: NO_HEAD }),
      AT,
    );
    one = prEvents(one, pr({ checks: rolled("pending"), head: NO_HEAD }), AT);
    one = prEvents(one, pr({ checks: rolled("pass"), head: NO_HEAD }), AT);
    one = prEvents(one, pr({ checks: rolled("pass"), head: NO_HEAD }), AT);
    expect(one.events.filter((event) => event.by === "ci")).toHaveLength(2);
  });

  it("ENDS the work when the PR merges, and when it closes", () => {
    const merged = prEvents(work(), pr({ state: "merged" }), AT);
    expect(kinds(merged)).toContain("merged");
    expect(outcomeOf(merged)).toEqual(Option.some({ kind: "merged", pr: 7 }));
    expect(endedAt(merged)).toEqual(Option.some(AT));

    const closed = prEvents(work(), pr({ state: "closed" }), AT);
    expect(outcomeOf(closed)).toEqual(Option.some({ kind: "closed", pr: 7 }));
  });

  it("ends a MERGED work whose members are all gone, on the first look", () => {
    // The real sequence (#2376): the Conductor merged #181 and closed both
    // terminals fourteen seconds later, with no poll in between. The work is
    // open, has no members, and the next look is what ends it.
    const abandoned = recordEvent(
      recordEvent(work(), {
        at: AT,
        by: "kolu",
        kind: "left",
        about: aboutMember(A),
        why: "closed",
      }),
      {
        at: AT,
        by: "kolu",
        kind: "left",
        about: aboutMember(B),
        why: "closed",
      },
    );
    const ended = prEvents(abandoned, pr({ number: 181, state: "merged" }), AT);
    expect(outcomeOf(ended)).toEqual(Option.some({ kind: "merged", pr: 181 }));
    // The pull request is on the timeline too: kolu never saw it opened, and
    // a merge of a PR nobody recorded is still this work's merge.
    expect(kinds(ended)).toContain("pr-opened");
  });

  it("NEVER brings a work back: the forge can end one, not reopen it", () => {
    // The scope of PR observation is the works IN PROGRESS
    // (`workStore.prWatches`), so a finished work's branch is not asked about
    // at all. Even handed the reading directly, nothing here undoes an
    // ending — Reopen on the card, or `work_open` on the same key, is the one
    // way back.
    const closed = prEvents(work(), pr({ state: "closed" }), AT);
    expect(closed.state.kind).toBe("ended");
    const again = prEvents(closed, pr({ state: "open" }), AT);
    expect(again.state.kind).toBe("ended");
    expect(kinds(again)).not.toContain("reopened");
    // ... and it is the very value that went in: nothing was written.
    expect(again).toBe(closed);
  });

  it("leaves a work somebody STOPPED stopped, PR open or not", () => {
    const stopped = endWork(prEvents(work(), pr(), AT), {
      outcome: { kind: "stopped", by: "you" },
      at: AT,
    });
    expect(prEvents(stopped, pr({ state: "open" }), AT)).toBe(stopped);
  });

  it("follows the branch: a number the timeline has not got is an opening", () => {
    // One reader, asking the forge about THIS branch — so a different number
    // is not a second opinion, it is the next pull request on the branch.
    const first = prEvents(work(), pr(), AT);
    const next = prEvents(first, pr({ number: 9, title: "Other" }), AT);
    expect(Option.map(prOf(next), (one) => one.number)).toEqual(Option.some(9));
    expect(kinds(next).filter((kind) => kind === "pr-opened")).toHaveLength(2);
    expect(prEvents(next, pr({ number: 9, title: "Other" }), AT)).toBe(next);
  });

  // THE PROPERTY: an observation is a question about what the timeline
  // already says, so a reading the timeline already says adds nothing — the
  // next poll, or the first look after a restart. A deterministic sweep
  // rather than a random one — the repo has no fast-check — over every
  // reading the watch can make about one PR.
  it("appends NOTHING for a reading the timeline already says", () => {
    const checks: ReadonlyArray<WatchChecks> = [
      rolled("pending"),
      rolled("pass"),
      rolled("fail"),
      { kind: "unreported" },
    ];
    const heads = [HEAD, PUSHED, NO_HEAD];
    const answers: ReadonlyArray<WatchMerge> = [
      { kind: "can" },
      { kind: "cannot", why: "behind" },
      { kind: "unsettled" },
      { kind: "unreported" },
    ];
    let settled = work();
    for (const draft of [false, true])
      for (const check of checks)
        for (const head of heads)
          for (const merge of answers) {
            const one = pr({
              checks: check,
              head,
              merge,
              draft,
              failing:
                check.kind === "rollup" && check.rollup === "fail"
                  ? ["ci"]
                  : [],
            });
            settled = prEvents(settled, one, AT);
            expect(prEvents(settled, one, AT)).toBe(settled);
          }
  });
});

describe("a pull request that is a draft", () => {
  /** The draft words on the timeline, in order — the `pr-opened` one first. */
  const draftWords = (one: Work) =>
    one.events.flatMap((event) =>
      event.kind === "pr-opened" || event.kind === "draft-state"
        ? [event.draft]
        : [],
    );
  const readMerge = (one: Work) =>
    Option.map(prOf(one), (reading) => reading.merge);

  it("opens as a draft with no merge answer, and the same reading again is the same work", () => {
    // GitHub says CLEAN for a draft with green checks; the reading carries no
    // merge answer for one, so nothing is recorded.
    const one = prEvents(
      work(),
      pr({ draft: true, checks: rolled("pass") }),
      AT,
    );
    expect(draftWords(one)).toEqual(["draft"]);
    expect(merges(one)).toEqual([]);
    expect(readMerge(one)).toEqual(
      Option.some({ kind: "cannot", why: "draft" }),
    );
    expect(prEvents(one, pr({ draft: true, checks: rolled("pass") }), AT)).toBe(
      one,
    );
  });

  it("records being marked ready once, then GitHub's answer for the ready PR", () => {
    let one = prEvents(work(), pr({ draft: true }), AT);
    one = prEvents(one, pr({ merge: { kind: "can" } }), AT);
    expect(draftWords(one)).toEqual(["draft", "ready"]);
    expect(kinds(one).slice(-2)).toEqual(["draft-state", "merge-state"]);
    expect(merges(one)).toEqual([{ kind: "can" }]);
    expect(readMerge(one)).toEqual(Option.some({ kind: "can" }));
  });

  it("records being turned back into a draft once, with no merge answer", () => {
    let one = prEvents(work(), pr({ merge: { kind: "can" } }), AT);
    one = prEvents(one, pr({ draft: true }), AT);
    expect(draftWords(one)).toEqual(["ready", "draft"]);
    expect(merges(one)).toEqual([{ kind: "can" }]);
    expect(kinds(one).at(-1)).toBe("draft-state");
    // The `can` given while it was ready no longer counts.
    expect(readMerge(one)).toEqual(
      Option.some({ kind: "cannot", why: "draft" }),
    );
    // Marked ready again: the same `can` on the same commit is news again,
    // because the flips forgot it.
    one = prEvents(one, pr({ merge: { kind: "can" } }), AT);
    expect(merges(one)).toEqual([{ kind: "can" }, { kind: "can" }]);
  });

  it("writes no draft row for a PR opened ready", () => {
    const one = prEvents(work(), pr({ merge: { kind: "can" } }), AT);
    expect(kinds(one)).not.toContain("draft-state");
    expect(draftWords(one)).toEqual(["ready"]);
  });

  it("teaches a PR recorded before kolu kept the word, and its stale `can` stops counting", () => {
    // What the 1.61.0 rung leaves: the word unrecorded, and a `can` GitHub
    // gave for what was, in fact, a draft.
    let before = recordEvent(work(), {
      at: AT,
      by: "kolu",
      kind: "pr-opened",
      about: ABOUT_WORK,
      pr: 7,
      title: "Fix the parser",
      url: { kind: "link", href: "https://github.com/kolu-e2e/parser/pull/7" },
      draft: "unrecorded",
    });
    before = recordEvent(before, {
      at: AT,
      by: "kolu",
      kind: "merge-state",
      about: ABOUT_WORK,
      pr: 7,
      head: HEAD,
      merge: { kind: "can" },
    });
    expect(readMerge(before)).toEqual(Option.some({ kind: "can" }));
    const learned = prEvents(before, pr({ draft: true }), AT);
    expect(draftWords(learned)).toEqual(["unrecorded", "draft"]);
    expect(readMerge(learned)).toEqual(
      Option.some({ kind: "cannot", why: "draft" }),
    );
    // A PR that was ready all along learns that too, and keeps its answer.
    const ready = prEvents(before, pr({ merge: { kind: "can" } }), AT);
    expect(draftWords(ready)).toEqual(["unrecorded", "ready"]);
    expect(merges(ready)).toEqual([{ kind: "can" }]);
    expect(readMerge(ready)).toEqual(Option.some({ kind: "can" }));
  });

  it("records no merge answer across #2405's four green readings as a draft", () => {
    // juspay/kolu#2405, as the issue tells it: opened as a draft, then four
    // readings with every check green, each of which GitHub answered as
    // mergeable. A made-up commit and the public times.
    let one = work();
    for (const at of [
      "2026-11-18T01:07:41.000Z",
      "2026-11-18T03:43:00.000Z",
      "2026-11-18T05:24:00.000Z",
      "2026-11-18T09:11:00.000Z",
      "2026-11-18T11:07:00.000Z",
    ])
      one = prEvents(
        one,
        pr({ number: 2405, draft: true, checks: rolled("pass") }),
        at,
      );
    expect(merges(one)).toEqual([]);
    expect(readMerge(one)).toEqual(
      Option.some({ kind: "cannot", why: "draft" }),
    );
  });
});

describe("the files a listing found", () => {
  it("puts every path kolu has not seen before on the timeline, once", () => {
    const first = fileEvents(work(), A, [".waterfall/plan.md"], AT);
    expect(first.events.at(-1)).toMatchObject({
      kind: "file",
      by: "agent",
      about: aboutMember(A),
      path: ".waterfall/plan.md",
    });
    // Listed again — the same file is not news a second time, and the work is
    // the very value that went in.
    expect(fileEvents(first, A, [".waterfall/plan.md"], AT)).toBe(first);
    const second = fileEvents(
      first,
      A,
      [".waterfall/plan.md", ".waterfall/notes.md"],
      AT,
    );
    expect(second.events.filter((event) => event.kind === "file")).toHaveLength(
      2,
    );
  });

  it("reads what kolu has seen off the RECORD, so a restart adds nothing", () => {
    // The file event is the memory: a second process listing the same
    // directory compares against the timeline it restored.
    const restarted = recordEvent(work(), {
      at: AT,
      by: "agent",
      kind: "file",
      about: aboutMember(B),
      path: ".waterfall/plan.md",
    });
    expect(fileEvents(restarted, A, [".waterfall/plan.md"], AT)).toBe(
      restarted,
    );
  });

  it("records each file in a folder once, and a new one as one more event", () => {
    const mockup = [
      ".waterfall/plan.md",
      ".waterfall/mockup/index.html",
      ".waterfall/mockup/fonts/a.woff2",
    ];
    const files = (one: Work) =>
      one.events.flatMap((event) =>
        event.kind === "file" ? [event.path] : [],
      );
    const first = fileEvents(work(), A, mockup, AT);
    expect(files(first)).toEqual(mockup);
    expect(fileEvents(first, A, mockup, AT)).toBe(first);
    const more = fileEvents(
      first,
      A,
      [...mockup, ".waterfall/mockup/fonts/b.woff2"],
      AT,
    );
    expect(files(more)).toEqual([...mockup, ".waterfall/mockup/fonts/b.woff2"]);
  });
});
