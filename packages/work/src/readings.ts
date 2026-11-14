/**
 * WHAT A WORK SAYS, read off its decisions and its events — never stored
 * beside them.
 *
 * The setup is the clearest case: the human answered the setup questions, the
 * answers are decisions, and the host, the mode, the harness and model per
 * role and what to do on green are READINGS of those decisions. A second copy
 * of any of them would be a place for the two to disagree.
 */

import {
  type Decision,
  ON_GREEN,
  type OnGreen,
  type SetupKey,
  WORK_MODES,
  type Work,
  type WorkMode,
  type WorkEvent,
  type WorkRole,
} from "./schema.ts";

/** The latest ANSWERED decision for a setup key. */
const setupDecision = (work: Work, key: SetupKey): Decision | undefined =>
  work.decisions.findLast(
    (one) => one.key === key && one.answer?.how === "answered",
  );

/** What a decision came to as ONE value: the option picked, else the words
 *  typed, else `null`. */
export const answerValue = (decision: Decision | undefined): string | null => {
  const answer = decision?.answer;
  if (answer === null || answer === undefined || answer.how !== "answered")
    return null;
  return answer.picked[0] ?? answer.text;
};

const among = <T extends string>(
  value: string | null,
  vocabulary: ReadonlyArray<T>,
): T | null =>
  value !== null && (vocabulary as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : null;

/** The host the work runs on, or `null` until the human has said. */
export const hostOf = (work: Work): string | null =>
  answerValue(setupDecision(work, "host"));

/** The mode, or `null` until answered (or answered with words that are no
 *  mode). */
export const modeOf = (work: Work): WorkMode | null =>
  among(answerValue(setupDecision(work, "mode")), WORK_MODES);

/** What to do when CI is green — the one place it is written. */
export const onGreenOf = (work: Work): OnGreen | null =>
  among(answerValue(setupDecision(work, "on-green")), ON_GREEN);

/** The roles a mode runs, in the order they come in. */
export const rolesOf = (mode: WorkMode | null): ReadonlyArray<WorkRole> =>
  mode === "full"
    ? ["planner", "implementor"]
    : mode === "trivial"
      ? ["implementor"]
      : [];

export interface SetupReading {
  readonly host: string | null;
  readonly mode: WorkMode | null;
  readonly roles: ReadonlyArray<{
    readonly role: WorkRole;
    readonly harness: string | null;
    readonly model: string | null;
  }>;
  readonly onGreen: OnGreen | null;
}

/** The setup, as the decisions say it. */
export const setupOf = (work: Work): SetupReading => {
  const mode = modeOf(work);
  return {
    host: hostOf(work),
    mode,
    roles: rolesOf(mode).map((role) => ({
      role,
      harness: answerValue(setupDecision(work, `${role}.harness` as SetupKey)),
      model: answerValue(setupDecision(work, `${role}.model` as SetupKey)),
    })),
    onGreen: onGreenOf(work),
  };
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

const PR_STEP: Partial<
  Record<WorkEvent["kind"], Partial<Pick<PrReading, "state" | "checks">>>
> = {
  "checks-running": { checks: "running" },
  "checks-passed": { checks: "passed" },
  "checks-failed": { checks: "failed" },
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
