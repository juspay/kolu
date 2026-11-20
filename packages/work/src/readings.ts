import { Option } from "effect";
import type {
  CheckHead,
  Decision,
  EventKind,
  EventOf,
  MergeState,
  PrLink,
  PrOpenedDraft,
  Work,
  WorkEvent,
} from "./schema.ts";

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
  /** Where it lives, as its `pr-opened` recorded it. */
  readonly link: PrLink;
  /** What the timeline last said about its checks — `none` until a check
   *  event since it was opened (or since it merged or closed). */
  readonly checks: "none" | "running" | "passed" | "failed";
  /** The forge's last recorded answer to "can it merge" — `unknown` until a
   *  `merge-state` since it was opened, and again once it merged or closed. */
  readonly merge: MergeState | { readonly kind: "unknown" };
  /** The last check event about it, with the gates that were red — what a
   *  card says about its checks once nobody is reading them live. */
  readonly lastCheck: Option.Option<EventOf<CheckKind>>;
  /** The commit and answer of its last `merge-state`, for the observer to
   *  record a merge state only when it CHANGES. */
  readonly lastMerge: Option.Option<EventOf<"merge-state">>;
  /** Whether it is a draft, as its `pr-opened` and any `draft-state` since
   *  said — `unrecorded` for a PR opened before kolu kept the word. */
  readonly draft: PrOpenedDraft;
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
      readonly checks: CheckWord;
    }
  >
>;

/** A word the checks of a PR can be in, once a check event said one. */
export type CheckWord = Exclude<PrReading["checks"], "none">;

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
) as Readonly<Record<CheckKind, CheckWord>>;

/** Whether this event is one of the three — narrowing the EVENT, which is
 *  what every reader of its `pr`, `head` and `failing` needs. */
export const isCheckEvent = (event: WorkEvent): event is EventOf<CheckKind> =>
  CHECK_KINDS.has(event.kind);

/** WHETHER TWO READINGS ARE ABOUT THE SAME COMMIT — by kind and sha, never
 *  by spelling. Two heads a source could not report are the same: there is
 *  nothing to tell them apart by. */
export const sameHead = (a: CheckHead, b: CheckHead): boolean =>
  a.kind === "commit"
    ? b.kind === "commit" && a.sha === b.sha
    : b.kind === a.kind;

/** ONE EVENT'S MOVE ON THE PR READING — the one statement of the PR-fact
 *  rule: a check result or a merge answer about another commit makes the
 *  other fact unknown, and opening, merging, closing, reopening and a draft
 *  flip each say what is forgotten. None for a work no PR was opened for yet,
 *  which only `pr-opened` changes. The observer reads it (through
 *  {@link prOf}) to tell news from a repeat, and the folds carry it to tell
 *  green.
 *
 *  A DRAFT CANNOT MERGE, by construction: every step ends in
 *  {@link draftCannotMerge}, so no arm can forget it and no `merge-state` a
 *  draft was ever given can make it read green. */
export const prStep = (
  pr: Option.Option<PrReading>,
  event: WorkEvent,
): Option.Option<PrReading> => Option.map(stepPr(pr, event), draftCannotMerge);

/** WHETHER THE PR IS AN OPEN DRAFT — the one spelling every reader uses: a
 *  merged or closed PR is not a draft whatever its last word was, and a PR
 *  whose word kolu never recorded (`unrecorded`) is not one either. */
export const isOpenDraft = (pr: PrReading): boolean =>
  pr.state === "open" && pr.draft === "draft";

const draftCannotMerge = (pr: PrReading): PrReading =>
  isOpenDraft(pr) ? { ...pr, merge: { kind: "cannot", why: "draft" } } : pr;

type PrFact = "checks" | "merge" | "lastCheck" | "lastMerge";

const FORGOTTEN: Readonly<Record<PrFact, Partial<PrReading>>> = {
  checks: { checks: "none" },
  merge: { merge: { kind: "unknown" } },
  lastCheck: { lastCheck: Option.none() },
  lastMerge: { lastMerge: Option.none() },
};

const forgets = (was: PrReading, facts: ReadonlyArray<PrFact>): PrReading => {
  const forgotten: Partial<PrReading> = {};
  for (const fact of facts) Object.assign(forgotten, FORGOTTEN[fact]);
  return { ...was, ...forgotten };
};

const STATE_STEP = {
  merged: { state: "merged", forgets: ["checks", "merge"] },
  "pr-closed": { state: "closed", forgets: ["checks", "merge"] },
  reopened: {
    state: "open",
    forgets: ["checks", "merge", "lastCheck", "lastMerge"],
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly state: PrReading["state"];
      readonly forgets: ReadonlyArray<PrFact>;
    }
  >
>;

const stepPr = (
  pr: Option.Option<PrReading>,
  event: WorkEvent,
): Option.Option<PrReading> => {
  if (event.kind === "pr-opened")
    return Option.some({
      number: event.pr,
      state: "open",
      link: event.url,
      checks: "none",
      merge: { kind: "unknown" },
      lastCheck: Option.none(),
      lastMerge: Option.none(),
      draft: event.draft,
    });
  return Option.map(pr, (was): PrReading => {
    if (isCheckEvent(event))
      return {
        ...was,
        checks: CHECKS_READ_BACK[event.kind],
        lastCheck: Option.some(event),
        merge: Option.exists(
          was.lastMerge,
          (last) => last.pr === event.pr && sameHead(last.head, event.head),
        )
          ? was.merge
          : { kind: "unknown" },
      };
    switch (event.kind) {
      case "merge-state":
        return {
          ...was,
          merge: event.merge,
          lastMerge: Option.some(event),
          checks: Option.exists(
            was.lastCheck,
            (last) => last.pr === event.pr && sameHead(last.head, event.head),
          )
            ? was.checks
            : "none",
        };
      case "draft-state":
        return was.draft === "draft" || event.draft === "draft"
          ? { ...forgets(was, ["merge", "lastMerge"]), draft: event.draft }
          : { ...was, draft: event.draft };
      case "merged":
      case "pr-closed":
      case "reopened": {
        const moved = STATE_STEP[event.kind];
        return { ...forgets(was, moved.forgets), state: moved.state };
      }
      default:
        return was;
    }
  });
};

/** THE PR, as the timeline last said it — none until one was opened. The
 *  reading moves on the PR's own events and nothing else, and every one of
 *  them carries its own PR number, so there is no parsing and no event that
 *  is about a pull request nobody named. */
export const prOf = (work: Work): Option.Option<PrReading> =>
  work.events.reduce(prStep, Option.none<PrReading>());

/** WHERE EACH PULL REQUEST THIS WORK EVER HAD LIVES, by number — what turns
 *  `#2393` into a link wherever the work names it, a finished work included.
 *  A PR recorded before kolu kept the address has no entry. */
export const prLinks = (work: Work): ReadonlyMap<number, string> => {
  const links = new Map<number, string>();
  for (const one of work.events)
    if (one.kind === "pr-opened" && one.url.kind === "link")
      links.set(one.pr, one.url.href);
  return links;
};

/** The worktree-relative paths of every file kolu has seen appear. */
export const filesSeen = (work: Work): ReadonlySet<string> =>
  new Set(
    work.events.filter((one) => one.kind === "file").map((one) => one.path),
  );

/** WHAT KOLU DID NOT KEEP WHEN THE WORK LAST ENDED, in its own sentence —
 *  none for a work that is open, or whose latest ending kept everything.
 *
 *  Read off the `keep-failed` event that ending wrote, which covers both a
 *  copy that failed outright and a partial one (files over the size budget,
 *  a listing cut short); an earlier ending's sentence is about files that
 *  ending had, not the ones on the card now. */
export const notKeptOf = (work: Work): Option.Option<string> => {
  if (work.state.kind !== "ended") return Option.none();
  const ending = work.events.findLastIndex((one) => one.kind === "ended");
  const failed = work.events.findLast(
    (one, at): one is EventOf<"keep-failed"> =>
      at > ending && one.kind === "keep-failed",
  );
  return failed === undefined ? Option.none() : Option.some(failed.why);
};
