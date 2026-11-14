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

import type { Decision, EventKind, Work, WorkEvent } from "./schema.ts";

/** What a decision came to as ONE value: the option picked, else the words
 *  typed, else `null`. */
export const answerValue = (decision: Decision | undefined): string | null => {
  const answer = decision?.answer;
  if (answer === null || answer === undefined || answer.how !== "answered")
    return null;
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
 *  disagree — composing the two halves of a row is true by construction, and a
 *  fourth rollup word is one row here instead of edits in two packages.
 *
 *  The KEY is a forge's vocabulary and not the record's: `pending|pass|fail` is
 *  what a host's record reports, which is an INPUT to a work and never part of
 *  one. So it is a plain string union local to this table — the observer
 *  (`kolu-conductor`) indexes it, and nothing stores it. */
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

/** How each event MOVES the PR reading — the three check rows derived from
 *  {@link CHECK_STEP} rather than re-listed, plus the two that end it. */
const PR_STEP: Partial<
  Record<WorkEvent["kind"], Partial<Pick<PrReading, "state" | "checks">>>
> = {
  ...Object.fromEntries(
    Object.values(CHECK_STEP).map((step) => [
      step.kind,
      { checks: step.checks },
    ]),
  ),
  merged: { state: "merged" },
  "pr-closed": { state: "closed" },
};

export const prOf = (work: Work): PrReading | null => {
  let pr = null as PrReading | null;
  for (const event of work.events) {
    if (event.kind === "pr-opened") {
      const number = Number(/^#(\d+)/.exec(event.detail)?.[1]);
      if (Number.isInteger(number))
        pr = { number, state: "open", checks: null };
      continue;
    }
    const moved = PR_STEP[event.kind];
    if (pr !== null && moved !== undefined) pr = { ...pr, ...moved };
  }
  return pr;
};

/** The worktree-relative paths of every file kolu has seen appear. */
export const filesSeen = (work: Work): ReadonlySet<string> =>
  new Set(
    work.events.filter((one) => one.kind === "file").map((one) => one.detail),
  );
