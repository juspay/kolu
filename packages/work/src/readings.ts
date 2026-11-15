/**
 * WHAT A WORK SAYS, read off its decisions and its events — never stored
 * beside them.
 *
 * The MECHANISM of a reading lives here: how a decision's answer comes to one
 * value, which decisions belong to one ask, what the timeline last said about
 * the PR, which files kolu has seen. The rules that read the WATERFALL'S WORDS
 * off the same record — the mode, the roles, the setup, who drives — are
 * `./waterfall.ts`, and this module deliberately imports nothing from there: a
 * reading of a decision is the same reading whatever words the waterfall
 * grows.
 */

import type {
  Decision,
  EventKind,
  EventOf,
  Work,
  WorkEvent,
} from "./schema.ts";

/** What a decision came to as ONE value: the option picked, else the words
 *  typed, else `null`. */
export const answerValue = (decision: Decision | undefined): string | null => {
  if (decision === undefined || decision.kind !== "answered") return null;
  const { answer } = decision;
  if (answer.how !== "answered") return null;
  return answer.picked[0] ?? answer.text;
};

/** The decisions of one ask, in the order they were asked. */
export const decisionsOfAsk = (
  work: Work,
  ask: string,
): ReadonlyArray<Decision> => work.decisions.filter((one) => one.ask === ask);

/** THE PR, as the timeline last said it — what an observation is compared
 *  against so a PR seen from two members is recorded once, and what a
 *  restart compares against so it is not recorded again. */
export interface PrReading {
  readonly number: number;
  readonly state: "open" | "merged" | "closed";
  readonly checks: "running" | "passed" | "failed" | null;
}

/** THE CHECK CORRESPONDENCE, in ONE table: a forge's rollup word, the event
 *  it becomes, and what the timeline then SAYS about the checks.
 *
 *  One row rather than two tables and a third in the reverse direction, so
 *  "which event" and "what a reader of the record would then read back" cannot
 *  disagree.
 *
 *  The KEY is a forge's vocabulary and not the record's: `pending|pass|fail` is
 *  what a host's record reports, which is an INPUT to a work and never part of
 *  one. */
export const CHECK_STEP = {
  pending: { kind: "checks-running", checks: "running" },
  pass: { kind: "checks-passed", checks: "passed" },
  fail: { kind: "checks-failed", checks: "failed" },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly kind: EventKind;
      readonly checks: NonNullable<PrReading["checks"]>;
    }
  >
>;

/** The three event kinds a PR's checks become — read off {@link CHECK_STEP},
 *  so the table stays the one place that says which they are. */
export type CheckKind = (typeof CHECK_STEP)[keyof typeof CHECK_STEP]["kind"];

const CHECK_KINDS: ReadonlySet<string> = new Set(
  Object.values(CHECK_STEP).map((step) => step.kind),
);

/** WHAT THE TIMELINE READS BACK for each check event kind — the same rows as
 *  {@link CHECK_STEP}, read the other way, so the two directions cannot
 *  disagree. A fourth rollup word is one row in the table rather than a row
 *  and an arm of a ternary sixty lines below it. */
export const CHECKS_READ_BACK = Object.fromEntries(
  Object.values(CHECK_STEP).map((step) => [step.kind, step.checks]),
) as Readonly<Record<CheckKind, NonNullable<PrReading["checks"]>>>;

/** Whether this event is one of the three — narrowing the EVENT, which is
 *  what every reader of its `pr`, `head` and `failing` needs. */
export const isCheckEvent = (event: WorkEvent): event is EventOf<CheckKind> =>
  CHECK_KINDS.has(event.kind);

/** WHAT A CHECK EVENT IS ABOUT, as one key: its kind, the PR and the commit
 *  it names.
 *
 *  The thing a work's timeline holds at most one of. A check event is news
 *  about ONE PULL REQUEST AT ONE COMMIT, and the work hears about it from
 *  every member that can see it — so the key is what each of them would
 *  produce, and the second member to say it adds nothing. Checks RE-RUN on
 *  the same commit are not news either: nothing about the work moved. A push
 *  is, and it carries a different commit. */
export const checkKey = (
  kind: CheckKind,
  pr: number,
  head: string | null,
): string => `${kind}#${pr}@${head ?? ""}`;

export const checksSeen = (work: Work): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const one of work.events)
    if (isCheckEvent(one)) keys.add(checkKey(one.kind, one.pr, one.head));
  return keys;
};

/** THE PR, as the timeline last said it. The reading moves on five kinds and
 *  nothing else — and every one of them carries its own PR number, so there
 *  is no parsing and no event that is about a pull request nobody named. */
export const prOf = (work: Work): PrReading | null => {
  let pr = null as PrReading | null;
  for (const event of work.events) {
    if (isCheckEvent(event)) {
      if (pr !== null) pr = { ...pr, checks: CHECKS_READ_BACK[event.kind] };
      continue;
    }
    switch (event.kind) {
      case "pr-opened":
        pr = { number: event.pr, state: "open", checks: null };
        break;
      case "merged":
        if (pr !== null) pr = { ...pr, state: "merged", checks: null };
        break;
      case "pr-closed":
        if (pr !== null) pr = { ...pr, state: "closed", checks: null };
        break;
      // A person pressing Reopen, or `work_open` on the same key: the reading
      // goes back to open, so the next frame of the same reading is not news
      // again.
      case "reopened":
        if (pr !== null) pr = { ...pr, state: "open" };
        break;
      default:
        break;
    }
  }
  return pr;
};

/** The worktree-relative paths of every file kolu has seen appear. */
export const filesSeen = (work: Work): ReadonlySet<string> =>
  new Set(
    work.events.filter((one) => one.kind === "file").map((one) => one.path),
  );
