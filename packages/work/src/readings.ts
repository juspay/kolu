/**
 * WHAT A WORK SAYS, read off its decisions and its events — never stored
 * beside them.
 *
 * The MECHANISM of a reading lives here: which decisions belong to one ask,
 * what the timeline last said about the PR, which files kolu has seen. The
 * rules that read the WATERFALL'S WORDS
 * off the same record — the mode, the roles, the setup, who drives — are
 * `./waterfall.ts`, and this module deliberately imports nothing from there: a
 * reading of a decision is the same reading whatever words the waterfall
 * grows.
 */

import { Option } from "effect";
import type {
  CheckHead,
  Decision,
  EventKind,
  EventOf,
  MergeState,
  PrLink,
  PrOpenedDraft,
  WaterfallRole,
  Work,
  WorkEvent,
} from "./schema.ts";
import { isWaterfallRole } from "./schema.ts";

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

/** An open draft reads `cannot: draft`, whatever the forge answered about
 *  merging it: GitHub works a draft's merge state out as if it were ready. */
const draftCannotMerge = (pr: PrReading): PrReading =>
  isOpenDraft(pr) ? { ...pr, merge: { kind: "cannot", why: "draft" } } : pr;

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
    // A FACT ABOUT ANOTHER COMMIT makes the other one's stale: checks about a
    // new head say nothing of whether GitHub would merge it, and a merge
    // answer about a new head says nothing of the old head's checks.
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
      // ENTERING OR LEAVING DRAFT forgets the merge answer: one given while it
      // was a draft (or before it became one) says nothing of the PR as it is
      // now, so GitHub's next answer is news. Learning `ready` for a PR whose
      // word was never recorded changes nothing it said.
      case "draft-state":
        return was.draft === "draft" || event.draft === "draft"
          ? {
              ...was,
              draft: event.draft,
              merge: { kind: "unknown" },
              lastMerge: Option.none(),
            }
          : { ...was, draft: event.draft };
      case "merged":
        return {
          ...was,
          state: "merged",
          checks: "none",
          merge: { kind: "unknown" },
        };
      case "pr-closed":
        return {
          ...was,
          state: "closed",
          checks: "none",
          merge: { kind: "unknown" },
        };
      // A person pressing Reopen, or `work_open` on the same key: the reading
      // goes back to open and FORGETS what it said about the checks and the
      // merge — they were true when the work stopped, maybe a week ago — so
      // the next reading of the PR is news again and says how it stands now.
      // Its draft word is kept: it is about the PR, not about a commit.
      case "reopened":
        return {
          ...was,
          state: "open",
          checks: "none",
          merge: { kind: "unknown" },
          lastCheck: Option.none(),
          lastMerge: Option.none(),
        };
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

/** WHO HOLDS THE WORK, as the timeline has said it so far — the ONE
 *  statement of the hand-off rule, read by the folds (the stage a stretch is
 *  in), by the bound on agent states (`./record.ts`: a stop that lets go is
 *  never folded) and by the Conductor's observer (whether speaking to a
 *  member hands it the work, and is recorded as `told`).
 *
 *  - a member is HANDED the work when it joins as planner or implementor,
 *    and when a `told` is recorded about it while it is not holding it;
 *  - it LETS GO when its agent stops (`ready` is a stop of an agent nobody
 *    had spoken to), exits or is put to sleep, or when it leaves. An agent
 *    asking a question has not let go;
 *  - a member whose role is `other` never holds it;
 *  - the upgrade's `hand-offs-kept` FORGETS who holds it: before it kolu kept
 *    no hand-offs (and its cap folded stops away), so nothing read off the
 *    events before it is believed. Nobody holds it after it, and nobody was
 *    handed it last; the roles members joined in are kept.
 *
 *  The HOLDER ({@link holderOf}) is the member handed the work most recently
 *  among those still holding it, and when nobody is, the one handed it
 *  last. */
export interface Holding {
  /** The waterfall role each member has now, as its latest `joined` said —
   *  none for one that joined as `other`. */
  readonly roles: ReadonlyMap<string, WaterfallRole>;
  /** The waterfall roles any member has EVER joined in — kept apart from
   *  {@link roles}, so a terminal that comes back as `other` does not take
   *  back that an implementor joined. */
  readonly joined: ReadonlySet<WaterfallRole>;
  /** The members holding the work now, the one handed it most recently
   *  last. */
  readonly holding: ReadonlyArray<string>;
  /** The member handed the work last, holding it or not. */
  readonly last: Option.Option<string>;
}

/** A work nobody has been handed yet. */
export const NOBODY_HOLDS: Holding = {
  roles: new Map(),
  joined: new Set(),
  holding: [],
  last: Option.none(),
};

/** The events that end a member's hold on the work. */
const LETS_GO: ReadonlySet<string> = new Set<EventKind>([
  "ready",
  "stopped",
  "exited",
  "asleep",
  "left",
]);

/** Whether this member is holding the work now. */
export const holds = (holding: Holding, terminal: string): boolean =>
  holding.holding.includes(terminal);

/** Whether nobody is holding the work now — every member handed it has let
 *  go, or none ever was. */
export const nobodyHolds = (holding: Holding): boolean =>
  holding.holding.length === 0;

/** Whether this event HANDS THE WORK to the member it is about: a planner or
 *  an implementor joining, or a `told` to one that is not holding it. */
export const handsOver = (holding: Holding, event: WorkEvent): boolean => {
  if (event.about.kind !== "member") return false;
  const terminal = event.about.terminal;
  if (holds(holding, terminal)) return false;
  if (event.kind === "joined") return isWaterfallRole(event.role);
  return event.kind === "told" && holding.roles.has(terminal);
};

/** Whether this event ENDS a member's hold: its agent stopped, exited or
 *  was put to sleep, or it left, while holding the work. */
export const letsGo = (holding: Holding, event: WorkEvent): boolean =>
  LETS_GO.has(event.kind) &&
  event.about.kind === "member" &&
  holds(holding, event.about.terminal);

/** ONE EVENT'S MOVE ON WHO HOLDS THE WORK. */
export const holdStep = (was: Holding, event: WorkEvent): Holding => {
  if (event.kind === "hand-offs-kept")
    return { ...was, holding: [], last: Option.none() };
  if (event.about.kind !== "member") return was;
  const terminal = event.about.terminal;
  let at = was;
  if (event.kind === "joined") {
    const role = event.role;
    const roles = new Map(was.roles);
    if (isWaterfallRole(role)) roles.set(terminal, role);
    else roles.delete(terminal);
    at = {
      ...was,
      roles,
      joined: isWaterfallRole(role)
        ? new Set([...was.joined, role])
        : was.joined,
    };
  }
  if (handsOver(at, event))
    return {
      ...at,
      holding: [...at.holding, terminal],
      last: Option.some(terminal),
    };
  if (letsGo(at, event))
    return {
      ...at,
      holding: at.holding.filter((one) => one !== terminal),
    };
  return at;
};

/** Who holds the work after its whole timeline. */
export const holdingOf = (work: Work): Holding =>
  work.events.reduce(holdStep, NOBODY_HOLDS);

/** THE HOLDER'S ROLE — none before anybody was handed the work. */
export const holderOf = (holding: Holding): Option.Option<WaterfallRole> =>
  Option.flatMap(
    Option.orElse(
      Option.fromUndefinedOr(holding.holding.at(-1)),
      () => holding.last,
    ),
    (terminal) => Option.fromUndefinedOr(holding.roles.get(terminal)),
  );

/** Whether a member has ever joined in this role. */
export const joinedAs = (holding: Holding, role: WaterfallRole): boolean =>
  holding.joined.has(role);

/** IS IT THE PLANNER'S TURN — the one thing the stage of the agents' time
 *  asks of the hand-offs. Before an implementor joined, it is while
 *  somebody holds the work (only the planner can); after, while the holder
 *  is the planner. */
export const plannersTurn = (holding: Holding): boolean =>
  joinedAs(holding, "implementor")
    ? Option.exists(holderOf(holding), (role) => role === "planner")
    : !nobodyHolds(holding);

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
