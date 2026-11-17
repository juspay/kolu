/** WHAT THE WORK COLUMN SAYS — every reading the browser adds on top of
 *  `kolu-work`'s folds, as plain functions over the record.
 *
 *  `kolu-work` answers what a work IS (who it waits on, the bar, the
 *  durations, which keys the setup has); this module answers what a READER is
 *  shown: the words beside each timeline dot, the ink each waiter wears, the
 *  sentence under a card's title, the labels the setup is drawn under and how
 *  long a drawn line may be. None of it is stored and none of it is reactive —
 *  the card calls these with the work it already has, so a tick of a clock
 *  re-renders words and never re-reads the wire.
 *
 *  THE ENGLISH AND THE TYPOGRAPHY ARE THE BROWSER'S. A package the server,
 *  the MCP face and the state ladder all read owns no face's words: the MCP
 *  `works` resource renders the same tokens for an agent, and a card restyle
 *  ("the limit is 60 at this breakpoint") must not be an edit to the package
 *  that holds the store's rung type. So `SETUP_LABEL`, the drawing order, the
 *  line limits, `oneLine` and `decisionLabel` live here, beside the five word
 *  tables that were already here.
 *
 *  It stays free of Solid and of the fleet index on purpose: the one live
 *  fact the column mixes in — a PR's check runs, read off the member
 *  terminal's record — arrives as an argument ({@link ChecksTally}), so every
 *  sentence here is testable without a browser. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import { decodeHostKey, isEncodedHostKey } from "kolu-common/hostKey";
import {
  type AnswerFrom,
  type Decision,
  type Driver,
  type EventAbout,
  type EventBy,
  hostOf,
  isAbout,
  isCheckEvent,
  isOnGreen,
  isOpen,
  isSettled,
  type Membership,
  type OnGreen,
  type Outcome,
  policyOf,
  prOf,
  type Said,
  roleRank,
  roleSetupOf,
  setupKeyOf,
  type SetupKey,
  type StandingWhy,
  setupOf,
  standing,
  type Filed,
  type Stages,
  stages,
  timeSpent,
  type Waiter,
  WAITER_OF,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkMember,
  WORK_ROLES,
  type WorkRole,
  type WorkRow,
  waitingOnYou,
} from "kolu-work";
import { type NonEmpty, nonEmpty } from "nonempty";
import { hostLabel } from "../host/hostChipTone";
import { type ChecksTally, checksProgress, mergeWords } from "./prReadings";

/** THE THREE INKS, by who is being waited on — violet for you, amber for CI,
 *  teal for the agents. One table, read by the standing line, the stage
 *  strip, the work chip's dot, the timeline's dots and the legend, so a stage
 *  and the sentence over it are never two different colours of the same
 *  wait. `tint` is a stage that had that waiter's time; `now` is the stage
 *  the work is in, outlined. */
export const WAITER_INK: Record<
  Waiter,
  {
    readonly text: string;
    readonly fill: string;
    readonly tint: string;
    readonly now: string;
  }
> = {
  agent: {
    text: "text-accent",
    fill: "bg-accent",
    tint: "bg-accent/15",
    now: "bg-accent/30 border-accent",
  },
  you: {
    text: "text-alert",
    fill: "bg-alert",
    tint: "bg-alert/15",
    now: "bg-alert/30 border-alert",
  },
  ci: {
    text: "text-attention",
    fill: "bg-attention",
    tint: "bg-attention/15",
    now: "bg-attention/30 border-attention",
  },
};

/** A WORK'S DOT, by who it waits on — the waiter's fill, pulsing when it is
 *  you, and the finished colour once it is over. */
export const WORK_DOT: Record<Waiter | "done", string> = {
  agent: WAITER_INK.agent.fill,
  you: `${WAITER_INK.you.fill} motion-safe:animate-pulse`,
  ci: WAITER_INK.ci.fill,
  done: "bg-ok",
};

/** What each stage is called on the strip — and what a timeline calls the
 *  setup, which no cell holds. */
export const STAGE_LABEL: Record<Filed, string> = {
  setup: "Setup",
  plan: "Plan",
  approve: "Approve",
  build: "Build",
  review: "Review",
  checks: "Checks",
  merge: "Merge",
};

/** THE STAGES of a work, under its own policy. */
export function stagesOf(work: Work, now: string): Stages {
  return stages(work, policyOf(work), now);
}

/** IS THIS WORK WAITING ON YOU — by the same `standing` the card's line
 *  reads, so the group a card sits in and the words on it cannot disagree. */
export function waitsOnYou(work: Work): boolean {
  return WAITER_OF[standing(work, policyOf(work)).why] === "you";
}

/** The same three, plus kolu's own — the ink of a timeline dot, by who the
 *  event is BY. kolu's own events (membership, the end, files kept) are the
 *  quiet ink: they are bookkeeping, not somebody working. */
export const EVENT_INK: Record<EventBy, string> = {
  you: "bg-alert",
  agent: "bg-accent",
  ci: "bg-attention",
  kolu: "bg-fg-3",
};

/** How a role reads in a sentence. `other` is a terminal the human pointed
 *  the Conductor at, which has no part in a waterfall — so it is named by
 *  what it is rather than given a job title it does not hold. */
export const ROLE_WORD: Record<WorkRole, string> = {
  planner: "Planner",
  implementor: "Implementor",
  other: "Terminal",
};

/** What "on green" says to a person — the one decision the card shows
 *  plainly, because it is the one kolu and the script both read at the end. */
export const ON_GREEN_WORD: Record<OnGreen, string> = {
  merge: "merge it",
  "hand-over": "hand over",
};

/** WHAT EACH SETUP ANSWER IS CALLED on a card. The host is not among them:
 *  a work IS its host, repo and branch, which the subtitle says, so there is
 *  nothing there to decide. */
export const SETUP_LABEL: Record<SetupKey, string> = {
  mode: "Mode",
  "planner.harness": "Planner",
  "planner.model": "Planner",
  "implementor.harness": "Implementor",
  "implementor.model": "Implementor",
  "on-green": "On green",
};

/** THE SETUP, GROUPED INTO ROWS, in the order the card draws them — one row
 *  per label, so a role's harness and its model are one line and never two.
 *  The grouping is a fact about the KEYS (`setupKeyOf`), which kolu-work
 *  owns; the order and the labels are this card's. */
export const SETUP_ROWS: ReadonlyArray<ReadonlyArray<SetupKey>> = [
  ["mode"],
  ...WORK_ROLES.map((role) =>
    (["harness", "model"] as const).flatMap((what) =>
      Option.match(setupKeyOf(role, what), {
        onNone: (): ReadonlyArray<SetupKey> => [],
        onSome: (key): ReadonlyArray<SetupKey> => [key],
      }),
    ),
  ).filter((keys) => keys.length > 0),
  ["on-green"],
];

/** HOW LONG A DRAWN LINE MAY BE. The card's rows are one line each: a
 *  decision, a timeline event. Past this the line is cut and the rest sits
 *  behind a press — never wrapped into a paragraph, which is how the same
 *  seven facts came to fill a screen three times over. */
export const LINE_LIMIT = 72;

/** ... and how long a LABEL may be: a few words, not a sentence. */
export const LABEL_LIMIT = 34;

/** One line of text, and whether anything was left behind it. */
export interface OneLine {
  readonly line: string;
  /** `true` when the line is not the whole of what was given — it was cut, or
   *  it had line breaks the one line flattened. What a press reveals. */
  readonly rest: boolean;
}

/** THE ONE-LINE RULE, in one place. Whitespace (line breaks included) becomes
 *  single spaces, and anything past `limit` is cut at the last word boundary
 *  with an ellipsis. */
export function oneLine(text: string, limit: number = LINE_LIMIT): OneLine {
  const whole = text.trim();
  const flat = whole.replace(/\s+/g, " ");
  if (flat.length <= limit) return { line: flat, rest: flat !== whole };
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  const kept = space > limit / 2 ? cut.slice(0, space) : cut;
  return { line: `${kept.replace(/[\s,.;:—-]+$/, "")}…`, rest: true };
}

/** WHAT A DECISION IS CALLED on a card: the setup key's own name, else the
 *  header the asker gave it, else the first few words of the question. The
 *  question itself is never the label — a Conductor that reasons inside its
 *  question ("Full or trivial? I'd pick full: …") would otherwise have its
 *  prose drawn as a heading.
 *
 *  A question about the work whose header is `none` stands in a few words of
 *  its own question: that stand-in is this FACE's reading, which is why the
 *  record has an arm saying there is no header rather than an empty one. */
export function decisionLabel(decision: Decision): string {
  switch (decision.topic) {
    case "setup":
      return SETUP_LABEL[decision.key];
    case "work":
      return oneLine(
        decision.header.kind === "header"
          ? decision.header.text
          : decision.question,
        LABEL_LIMIT,
      ).line;
    default:
      return decision satisfies never;
  }
}

/** ONE MEMBER of a piece of work: the terminal's ref, and what the one
 *  members map says about it. */
export interface WorkMemberRow {
  readonly terminal: string;
  readonly member: WorkMember;
}

/** THE MEMBERS OF ONE WORK, in the order a waterfall runs them — read out of
 *  the ONE members map, which is keyed by terminal, so a terminal appears
 *  under exactly one work and "who is in this work" has a single answer.
 *
 *  A work that has ENDED has no members at all: ending removes them in the
 *  same step, so this answers the empty list for one by construction. */
export function membersIn(
  members: ReadonlyMap<string, WorkMember>,
  work: WorkId,
): ReadonlyArray<WorkMemberRow> {
  const rows: WorkMemberRow[] = [];
  for (const [terminal, member] of members)
    if (member.work === work) rows.push({ terminal, member });
  return rows.sort((a, b) => roleRank(a.member.role) - roleRank(b.member.role));
}

/** THE TWO DRIVERS THAT ARE A LOCK. `nobody` — a watch, a mode nobody has
 *  answered yet — is not one: there is no banner to draw for it, so the
 *  faces below cannot be asked for one. */
export type Lock = Exclude<Driver, "nobody">;

/** THE LOCK'S BANNER — who drives this terminal, the part it plays and the
 *  work it plays it in, in the tile's title area and above the phone's key
 *  bar. The same sentence in both places, from the same membership reading,
 *  so a person who takes a terminal over on the phone and reads it on the
 *  desktop is told one thing.
 *
 *  The driver is handed in NARROWED ({@link Lock}): the caller has already
 *  decided there is a lock to draw, so this has no "nothing to say" answer
 *  to invent. */
export function lockWords(at: Membership, driver: Lock): string {
  const who = driver === "you" ? "Taken over" : "Driven by the Conductor";
  return `${who} · ${ROLE_WORD[at.role]} · ${at.title}`;
}

/** THE CARD'S FACE — what a terminal says when a person types at a keyboard
 *  it does not own. One line: who is driving, and the part this terminal
 *  plays, which is the whole of what a reader needs before pressing Take
 *  over. Never a silent swallow — a terminal that ignores typing without
 *  saying why reads as broken — and never the work's title either, which is
 *  a sentence the card's own terminal already sits inside.
 *
 *  A driver of `nobody` raises no card (nothing is gated), so this is only
 *  ever asked about a terminal the Conductor drives. */
export function lockCardWords(at: Membership): string {
  return `The Conductor is driving this terminal · ${ROLE_WORD[at.role]}`;
}

/** MAY A PERSON TYPE into this terminal? The lock's whole rule, in one
 *  place: the Conductor DRIVING a terminal is the only thing that blocks a
 *  person's input. A terminal they have taken over is theirs, a terminal
 *  whose work drives nothing (`nobody`: a watch, a mode nobody has answered
 *  yet) never left their hands, and a terminal the membership index does not
 *  name at all — the ordinary case, and the `none` here — was never the
 *  Conductor's.
 *
 *  Here rather than beside the guard that calls it (`personInput.ts`, which
 *  reaches the wire for the active host) so the rule is statable — and
 *  tested — without a browser. */
export function inputAllowed(at: Option.Option<Membership>): boolean {
  return !Option.exists(at, (one) => one.driver === "conductor");
}

/** The repository as a person names it: the last segment of its path. */
export function repoName(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** THE HOST a work runs on, as a person says it — read off the work's KEY,
 *  which is where the machine lives: it identifies the work, so it was never
 *  a question that could go unanswered. None for a key with no host. */
export function workHost(work: Work): Option.Option<string> {
  const given = hostOf(work);
  if (given === "") return Option.none();
  return Option.some(
    isEncodedHostKey(given) ? hostLabel(decodeHostKey(given)) : given,
  );
}

/** The line under a card's title: WHERE the work is — which is now its
 *  identity, `repo · branch` for a branch work and "watching" for a watch —
 *  the host as a person names it, the mode, and the PR once there is one.
 *  Each part is dropped when it is not known yet rather than drawn as a blank
 *  or a dash. */
export function workSubtitle(
  work: Work,
  hostName: Option.Option<string>,
): ReadonlyArray<string> {
  const setup = setupOf(work);
  const where =
    work.key.kind === "branch"
      ? [repoName(work.key.repo), work.key.branch]
      : ["watching"];
  return [
    ...where,
    ...Option.toArray(hostName),
    ...Option.toArray(setup.mode),
    ...Option.toArray(Option.map(prOf(work), (pr) => `PR #${pr.number}`)),
  ].filter((part) => part !== "");
}

/** HOW A WORK ENDED, in the words the card says it in. There are three ways
 *  and no more — the forge merged it, the forge closed it, or somebody
 *  stopped it — so this is total over the outcome sum and cannot be asked
 *  about a work still in flight. There is no "abandoned": nothing kolu merely
 *  fails to SEE ends a piece of work. */
export function outcomeWords(outcome: Outcome): string {
  switch (outcome.kind) {
    case "merged":
      return `Merged #${outcome.pr}`;
    case "closed":
      return `Closed #${outcome.pr}`;
    case "stopped":
      return outcome.by === "you"
        ? "Stopped by you"
        : "Stopped by the Conductor";
  }
}

/** WHERE IT STANDS, in the words the card draws: a lead that names the waiter
 *  and the detail after it.
 *
 *  `standing()` answers a TOKEN — who is waited on and why — and every word
 *  below is this module's, beside the other word tables. The model used to
 *  hand out two English phrases and this function re-capitalised one of them
 *  and discarded the other; now the browser owns all of its own prose and the
 *  live check tally is mixed in where it belongs. */
export interface StandingLine {
  readonly who: Waiter | "done";
  readonly lead: string;
  /** The detail after the lead — none for a wait that has none to give (the
   *  agents are simply at work), which the card draws as nothing at all
   *  rather than as an empty clause. */
  readonly what: Option.Option<string>;
  readonly since: string;
}

/** THE WORDS FOR WHERE A WORK STANDS — the lead beside the dot, by the reason
 *  `standing()` gives. `question` and `merge` share "Waiting on you": what
 *  differs is the detail after it, which is the question's own words or the PR
 *  to merge. A work that is over is led by how it ended ({@link outcomeWords}),
 *  once, so it has no word here. */
const WHY_LEAD: Record<
  Exclude<StandingWhy, "merged" | "closed" | "stopped">,
  string
> = {
  question: "Waiting on you",
  merge: "Waiting on you",
  ci: "CI running",
  watching: "Watching",
  working: "Agents at work",
};

export function standingLine(
  work: Work,
  checks: Option.Option<ChecksTally>,
): StandingLine {
  const at = standing(work, policyOf(work));
  const line = (lead: string, what: Option.Option<string>): StandingLine => ({
    who: WAITER_OF[at.why],
    lead,
    what,
    since: at.since,
  });
  switch (at.why) {
    case "question":
      return line(WHY_LEAD[at.why], Option.some(at.question));
    case "merge":
      return line(
        WHY_LEAD[at.why],
        Option.some(
          Option.match(at.pr, {
            onNone: () => "merge the PR",
            onSome: (pr) => `merge PR #${pr}`,
          }),
        ),
      );
    // The LIVE tally is the only honest detail while checks run: the timeline
    // says they are running, how many have landed is true only for the
    // instant it is read.
    case "ci":
      return line(WHY_LEAD[at.why], Option.map(checks, checksProgress));
    // The agents are simply at work: no detail to give.
    case "watching":
    case "working":
      return line(WHY_LEAD[at.why], Option.none());
    // HOW it ended, which for a stopped work is the whole fact: a person
    // reading "Stopped" wants to know whether they did it.
    default:
      return line(outcomeWords(at.outcome), Option.none());
  }
}

/** ALL THE TIME A WORK HAS WAITED ON YOU — the card's "you 12m". */
export function timeSpentOnYou(work: Work, now: string): number {
  return timeSpent(work, policyOf(work), now).you;
}

/** WHERE THE TIME WENT, for a finished card — the three figures in one line,
 *  with the buckets that got none left out. */
export function timeSpentWords(work: Work, now: string): string {
  const spent = timeSpent(work, policyOf(work), now);
  return (
    [
      { ms: spent.agent, word: "Agents" },
      { ms: spent.you, word: "waiting on you" },
      { ms: spent.ci, word: "CI" },
    ] as const
  )
    .filter((part) => part.ms > 0)
    .map((part) => `${part.word} ${dualPhrase(part.ms)}`)
    .join(" · ");
}

/** The role a member terminal held, for an event that is ABOUT one — read
 *  off the TIMELINE's own `joined` events rather than the members map.
 *
 *  A terminal that has left is not in the map at all (leaving is removal and
 *  an event), and the timeline must still be able to say "Implementor left":
 *  the part it played is a fact about what happened, which is what the
 *  timeline is. None for an event about the work itself, and for a terminal
 *  no `joined` event on this timeline names. */
function roleOf(work: Work, about: EventAbout): Option.Option<string> {
  if (about.kind === "work") return Option.none();
  for (let at = work.events.length - 1; at >= 0; at -= 1) {
    const event = work.events[at];
    if (
      event !== undefined &&
      event.kind === "joined" &&
      isAbout(event, about.terminal)
    )
      return Option.some(ROLE_WORD[event.role]);
  }
  return Option.none();
}

/** The first decision of an ask that was actually PUT to the human — what a
 *  `question` / `answered` event points at. A setup answer the request already
 *  gave rides the same ask but nobody was asked it, so it never names the
 *  ask. The timeline never copies the words; it holds the ask's id and reads
 *  them here, so a question and the Decisions section can never disagree. */
function askedIn(work: Work, ask: string): Option.Option<Decision> {
  return Option.fromUndefinedOr(
    work.decisions.find(
      (one) =>
        one.ask === ask &&
        !(
          isSettled(one) &&
          one.answer.how !== "dropped" &&
          one.answer.from === "request"
        ),
    ),
  );
}

/** WHAT A PERSON SAID to a question about the work, in one phrase: the
 *  options they picked, then the words they typed. Total over the three arms,
 *  because "said nothing" is not one of them. */
function saidWords(said: Said): string {
  switch (said.kind) {
    case "picked":
      return said.picked.join(" · ");
    case "typed":
      return said.text;
    case "picked-and-typed":
      return [...said.picked, said.text].join(" · ");
    default:
      return said satisfies never;
  }
}

/** What a decision came to, in one phrase: the value a setup question was
 *  answered with, what was said to a question about the work — or how it
 *  ended when nobody answered it, and `waiting` while it is still asked. */
export function answerWords(decision: Decision): string {
  if (!isSettled(decision)) return "waiting";
  switch (decision.topic) {
    case "setup": {
      const answer = decision.answer;
      return answer.how === "answered" ? answer.value : answer.how;
    }
    case "work": {
      const answer = decision.answer;
      return answer.how === "answered" ? saidWords(answer.said) : answer.how;
    }
    default:
      return decision satisfies never;
  }
}

/** WHERE AN ANSWER CAME FROM, said plainly — the card, the chat, the reader,
 *  the request itself or an earlier record it was carried over from. None for
 *  a question still asked, and for one that was DROPPED: nobody answered it,
 *  so there is no face it came from. */
export function answerSource(decision: Decision): Option.Option<string> {
  if (!isSettled(decision)) return Option.none();
  const answer = decision.answer;
  return answer.how === "dropped"
    ? Option.none()
    : Option.some(`from the ${answer.from}`);
}

/** WHEN A DECISION SETTLED — the answer's own time, or when it was put for
 *  one still open. The clock is handed in: the card speaks one format, and it
 *  is the card's. */
export function answeredWhen(
  decision: Decision,
  clock: (at: string) => string,
): string {
  return isSettled(decision)
    ? `answered ${clock(decision.answer.at)}`
    : `asked ${clock(decision.at)}`;
}

/** The head commit a check event is about — none for every other kind, and
 *  none for a host whose record reported no commit at all. The one reader of
 *  that field, so the switch below stays about words. */
function headOf(event: WorkEvent): Option.Option<string> {
  return isCheckEvent(event) && event.head.kind === "commit"
    ? Option.some(event.head.sha)
    : Option.none();
}

/** THE COMMIT A CHECK EVENT NAMES, as a person reads it — ` · 4f21a9c`, and
 *  nothing at all while every check event on the timeline is about the same
 *  commit. The oid is on the record so a new push's run can be told from the
 *  one before it; a work that has been pushed once has nothing to tell apart,
 *  and forty characters of hex beside "CI running" would be the card's
 *  loudest word for its least interesting fact.
 *
 *  `heads` is the TIMELINE'S fact, not the row's: it is computed once for the
 *  whole card ({@link eventReader}) rather than walked per row. */
function commitWords(heads: ReadonlySet<string>, event: WorkEvent): string {
  if (heads.size < 2) return "";
  return Option.match(headOf(event), {
    onNone: () => "",
    onSome: (head) => ` · ${head.slice(0, 7)}`,
  });
}

/** WHY A MEMBER'S TERMINAL IS NO LONGER IN THE WORK, in words. `gone` is the
 *  only one kolu reads rather than is told, and it now means the terminal is
 *  REALLY gone: a host that has not finished saying what it has says nothing
 *  at all. */
const LEFT_WORD: Record<"closed" | "released" | "gone", string> = {
  closed: "its terminal was closed",
  released: "released",
  gone: "its terminal is gone",
};

/** THE TIMELINE'S WORDS, as a reader built ONCE for a card.
 *
 *  Two facts are about the whole timeline rather than about a row — which
 *  commits its check events name, and which decision an ask points at — and
 *  asking them per row is how a twenty-event card came to walk its own events
 *  twenty times a frame. The card builds this reader when the work moves and
 *  calls it per row. */
export function eventReader(work: Work): (event: WorkEvent) => string {
  const heads = new Set(
    work.events.flatMap((one) => Option.toArray(headOf(one))),
  );
  return (event: WorkEvent): string => {
    /** The part the terminal an event is about plays — "A terminal" for one
     *  no `joined` event names, and for an event about the work itself,
     *  which none of the arms below that use it can be. */
    const who = Option.getOrElse(roleOf(work, event.about), () => "A terminal");
    /** ... the same, in a sentence about the lock. */
    const part = Option.match(roleOf(work, event.about), {
      onNone: () => "terminal",
      onSome: (role) => role.toLowerCase(),
    });
    switch (event.kind) {
      case "requested":
        return "You asked for it";
      case "carried-over":
        return "Carried over from an earlier record";
      case "joined":
        return `${ROLE_WORD[event.role]} joined`;
      case "left":
        return `${who} left · ${LEFT_WORD[event.why]}`;
      case "ready":
        return `${who} is up`;
      case "stopped":
        return `${who} stopped`;
      case "asking":
        return `${who} is asking`;
      case "exited":
        return event.why.kind === "reason"
          ? `${who} exited · ${event.why.text}`
          : `${who} exited`;
      case "asleep":
        return `${who} went to sleep`;
      case "file":
        return `Wrote ${event.path}`;
      // THE TIMELINE DOES NOT QUOTE QUESTIONS. It names the decision — the
      // label the Decisions list draws it under — and the answer. The
      // question's own words are one press away in that list, and saying them
      // here was how one sentence came to be on the card three times.
      case "question":
        return `Asked: ${Option.match(askedIn(work, event.ask), {
          onNone: () => "something",
          onSome: decisionLabel,
        })}`;
      case "answered":
        return Option.match(askedIn(work, event.ask), {
          onNone: () => "You answered",
          onSome: (decision) => `You: ${answerWords(decision)}`,
        });
      // PART OF A FORM, and the rest of it still open — what a person pressing
      // Answer with one question blank does. The ask stays on screen with the
      // blank ones on it, so the timeline says so rather than claiming the
      // question was answered.
      case "answered-part":
        return `You answered part of it · the rest is still open`;
      case "question-dropped":
        return "The question went away unanswered";
      case "pr-opened":
        return `Opened #${event.pr} ${event.title}`.trim();
      case "checks-running":
        return `CI running${commitWords(heads, event)}`;
      case "checks-passed":
        return `Checks passed${commitWords(heads, event)}`;
      case "checks-failed":
        return `Checks failed${event.failing.length === 0 ? "" : ` · ${event.failing.join(", ")}`}${commitWords(heads, event)}`;
      case "merged":
        return `Merged #${event.pr}`;
      case "pr-closed":
        return `Closed #${event.pr}`;
      case "merge-state":
        return `${mergeWords(event.merge)}${commitWords(heads, event)}`;
      case "note":
        return event.text;
      // THE LOCK, as the timeline tells it: an act of the person's, named by
      // the part the terminal plays rather than its ref — the same words the
      // tile's banner says, in the past tense.
      case "taken-over":
        return `You took over the ${part}`;
      case "handed-back":
        return `You handed the ${part} back`;
      // The bound: a stretch of agent-state events kolu dropped, counted where
      // they happened, so the timeline still says WHEN the quiet stretch was.
      case "folded":
        return `${event.count} earlier agent state changes`;
      case "ended":
        return outcomeWords(event.outcome);
      // ...AND BACK. A work that ended is not gone: it is opened again, with
      // everything it decided and everything it did still on it.
      case "reopened":
        return "Opened again";
      case "kept":
        return `${event.count} files kept`;
      case "keep-failed":
        return `Not kept · ${event.why}`;
      default:
        return event satisfies never;
    }
  };
}

/** ONE ROW OF THE CARD'S DECISIONS — `label — answer`, one line of it.
 *
 *  The setup is NOT a second section saying the same things: its answers are
 *  the first rows of this one list, labelled by their keys, with a role's
 *  harness and model on the single row the role owns. Everything else — the
 *  full question, when it was answered, where from — is behind a press on the
 *  row, which is what `decisions` carries. */
export interface DecisionRow {
  /** The row's own id (its first decision's), for the open-state set. */
  readonly id: string;
  /** WHAT THE ROW IS ABOUT — one of the setup's keys, or a question about
   *  the work, which has no key at all. The row's own arm rather than a key
   *  that may be missing: "this row is the mode" and "this row is a question
   *  somebody asked" are two different things. */
  readonly topic:
    | { readonly kind: "setup"; readonly key: SetupKey }
    | { readonly kind: "work" };
  readonly label: string;
  /** The answer, already cut to one line. */
  readonly answer: string;
  /** Whether the answer was cut — the rest is behind the press. */
  readonly rest: boolean;
  /** Where the answer came from, for the row's own mark — none while nobody
   *  has answered any of the questions this row stands for. */
  readonly from: Option.Option<AnswerFrom>;
  /** What the press opens: the question(s) this row stands for, in full. */
  readonly decisions: ReadonlyArray<Decision>;
}

/** A setup answer as a PERSON reads it: what to do on green in the words the
 *  rest of the card uses. */
function setupAnswer(decision: Decision): string {
  const words = answerWords(decision);
  if (!isSettled(decision) || decision.topic !== "setup") return words;
  if (decision.answer.how !== "answered") return words;
  const value = decision.answer.value;
  return decision.key === "on-green" && isOnGreen(value)
    ? ON_GREEN_WORD[value]
    : words;
}

/** WHERE THE ROW'S ANSWER CAME FROM — the first of its decisions anybody
 *  answered or declined. None while they are all still asked (and for one
 *  that was dropped, which nobody answered). */
function rowFrom(
  decisions: ReadonlyArray<Decision>,
): Option.Option<AnswerFrom> {
  for (const one of decisions)
    if (isSettled(one) && one.answer.how !== "dropped")
      return Option.some(one.answer.from);
  return Option.none();
}

/** ONE ROW, OVER THE DECISIONS IT STANDS FOR — at least one, said in the
 *  type: a row IS its first decision (its id, where the answer came from),
 *  and the caller that groups them already holds the witness that the group
 *  is not empty. */
function decisionRow(
  topic: DecisionRow["topic"],
  label: string,
  answer: string,
  decisions: NonEmpty<Decision>,
): DecisionRow {
  const cut = oneLine(answer);
  return {
    id: decisions[0].id,
    topic,
    label,
    answer: cut.line,
    rest: cut.rest,
    from: rowFrom(decisions),
    decisions,
  };
}

/** EVERY DECISION THIS WORK HOLDS, as the rows the card draws: the setup
 *  first, in {@link SETUP_ROWS} order, then every other question in the order
 *  it was put. A setup key nobody has answered yet still has a row —
 *  "waiting" is an answer a person wants to see — and a key never asked has
 *  none. */
export function decisionRows(work: Work): ReadonlyArray<DecisionRow> {
  const rows: DecisionRow[] = [];
  for (const group of SETUP_ROWS) {
    // The KEY comes with the decision it found, so the row's label is read
    // off the key the group was walked by rather than off the decision.
    const found = group.flatMap((key) => {
      const one = work.decisions.findLast(
        (decision) => decision.topic === "setup" && decision.key === key,
      );
      return one === undefined ? [] : [{ key, decision: one }];
    });
    const head = found[0];
    const decisions = nonEmpty(found.map((one) => one.decision));
    if (head === undefined || decisions === null) continue;
    rows.push(
      decisionRow(
        { kind: "setup", key: head.key },
        SETUP_LABEL[head.key],
        found.map((one) => setupAnswer(one.decision)).join(" · "),
        decisions,
      ),
    );
  }
  for (const decision of work.decisions)
    if (decision.topic === "work")
      rows.push(
        decisionRow(
          { kind: "work" },
          decisionLabel(decision),
          answerWords(decision),
          [decision],
        ),
      );
  return rows;
}

/** ONE PART OF THE SETUP LINE — `full`, `planner omp/Fable 5.2`, `on green:
 *  hand over` — with what was recorded and where it came from, which the
 *  line carries as data. */
export interface SetupPart {
  readonly key: SetupKey;
  readonly text: string;
  /** The answers AS RECORDED (`hand-over`, not "hand over"). */
  readonly answer: string;
  readonly from: Option.Option<AnswerFrom>;
}

/** THE SETUP, AS ONE LINE: the mode, each role's harness and model, and what
 *  happens on green — the setup's own rows ({@link decisionRows}), each said
 *  in a few words, so the card spends one line on what the human answered
 *  once at the start. */
export function setupLine(work: Work): ReadonlyArray<SetupPart> {
  return decisionRows(work).flatMap((row): ReadonlyArray<SetupPart> => {
    if (row.topic.kind !== "setup") return [];
    const key = row.topic.key;
    const said = row.decisions.map(setupAnswer);
    const text =
      key === "mode"
        ? said.join(" · ")
        : key === "on-green"
          ? `on green: ${said.join(" · ")}`
          : `${row.label.toLowerCase()} ${said.join("/")}`;
    return [
      {
        key,
        text,
        answer: row.decisions.map((one) => answerWords(one)).join(" · "),
        from: row.from,
      },
    ];
  });
}

/** EVERY OTHER DECISION — the questions put about the work, in the order
 *  they were put. A card shows the latest three. */
export function otherDecisions(work: Work): ReadonlyArray<DecisionRow> {
  return decisionRows(work).filter((row) => row.topic.kind === "work");
}

/** The hour and minute an event or a decision carries — the one clock
 *  format a card speaks. */
export const clockOf = (at: string): string =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

/** WHAT A ROLE RUNS, as the setup chose it — `omp/Opus 5.5`, or just the
 *  harness while no model is chosen — for a member's row. None for a role
 *  the setup chose nothing for. */
export function roleRuns(work: Work, role: WorkRole): Option.Option<string> {
  const chosen = roleSetupOf(work, role);
  switch (chosen.kind) {
    case "not-chosen":
      return Option.none();
    case "harness":
      return Option.some(chosen.harness);
    case "harness-and-model":
      return Option.some(`${chosen.harness}/${chosen.model}`);
    default:
      return chosen satisfies never;
  }
}

/** EVERY ASK ANY WORK OWNS. A question about a work is recorded as that
 *  work's decision the moment it is put, so the ask's id being in here is
 *  exactly "this question belongs to a piece of work". */
export function workAskIds(works: ReadonlyArray<Work>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const work of works)
    for (const decision of work.decisions) ids.add(decision.ask);
  return ids;
}

/** HOW MANY THINGS WAIT ON THE HUMAN — the tab's one number.
 *
 *  A work waiting on you counts once however many questions it holds (the
 *  card is the one place to go), plus every open ask that is about NO work,
 *  which is the conversation's own question and has no card to carry it. An
 *  ask about a work is already counted by its work, so it is not counted
 *  twice. */
export function waitingCount(
  works: ReadonlyArray<Work>,
  asks: ReadonlyArray<string>,
): number {
  const owned = workAskIds(works);
  return waitingOnYou(works) + asks.filter((id) => !owned.has(id)).length;
}

/** Which work an ask belongs to, or `null` for the conversation's own — what
 *  the chat's form says above itself. The ROW, because answering a work's
 *  question names the work by the id it is filed under. */
export function workOfAsk(
  works: ReadonlyArray<WorkRow>,
  ask: string,
): WorkRow | null {
  return (
    works.find(([, work]) => work.decisions.some((one) => one.ask === ask)) ??
    null
  );
}

/** The sentence the status line reads: `N pieces of work · M waiting on you`,
 *  with a part that would read zero left out entirely. Empty when there is
 *  nothing to say, which is what keeps `0 pieces of work` off the screen. */
export function worksStatusWords(
  works: ReadonlyArray<Work>,
  asks: ReadonlyArray<string>,
): string {
  const live = works.filter((one) => isOpen(one)).length;
  const waiting = waitingCount(works, asks);
  const parts: string[] = [];
  if (live > 0)
    parts.push(`${live} ${live === 1 ? "piece of work" : "pieces of work"}`);
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  return parts.join(" · ");
}
