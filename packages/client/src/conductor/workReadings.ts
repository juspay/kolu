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
import type { PrInfo } from "anyforge/schemas";
import {
  type AnswerFrom,
  branchOf,
  type Decision,
  type EventBy,
  isAnswered,
  isOpen,
  type Membership,
  ON_GREEN,
  type OnGreen,
  type Outcome,
  policyOf,
  prOf,
  repoOf,
  roleRank,
  setupKeyOf,
  type SetupKey,
  type StandingWhy,
  setupOf,
  standing,
  timeBar,
  timeSpent,
  type Waiter,
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

/** THE THREE INKS, by who is being waited on — violet for you, amber for CI,
 *  teal for the agents. One table, read by the standing line, the time bar,
 *  the timeline's dots and the legend, so a stretch of bar and the sentence
 *  over it are never two different colours of the same wait. */
export const WAITER_INK: Record<Waiter, { text: string; fill: string }> = {
  agent: { text: "text-accent", fill: "bg-accent" },
  you: { text: "text-alert", fill: "bg-alert" },
  ci: { text: "text-attention", fill: "bg-attention" },
};

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
    (["harness", "model"] as const)
      .map((what) => setupKeyOf(role, what))
      .filter((key): key is SetupKey => key !== null),
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
 *  prose drawn as a heading. */
export function decisionLabel(decision: Decision): string {
  if (decision.key !== null) return SETUP_LABEL[decision.key];
  const header = decision.header.trim();
  return oneLine(header === "" ? decision.question : header, LABEL_LIMIT).line;
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

/** THE LOCK'S BANNER — who drives this terminal, the part it plays and the
 *  work it plays it in, in the tile's title area and above the phone's key
 *  bar. The same sentence in both places, from the same membership reading,
 *  so a person who takes a terminal over on the phone and reads it on the
 *  desktop is told one thing.
 *
 *  A driver of `null` is not a lock at all (a watch, a mode nobody has
 *  answered yet) and nothing is drawn for it — which is why this answers `""`
 *  rather than inventing words for a banner that has no reason to exist. */
export function lockWords(at: Membership): string {
  if (at.driver === null) return "";
  const who = at.driver === "you" ? "Taken over" : "Driven by the Conductor";
  return `${who} · ${ROLE_WORD[at.role]} · ${at.title}`;
}

/** THE CARD'S FACE — what a terminal says when a person types at a keyboard
 *  it does not own. One line: who is driving, and the part this terminal
 *  plays, which is the whole of what a reader needs before pressing Take
 *  over. Never a silent swallow — a terminal that ignores typing without
 *  saying why reads as broken — and never the work's title either, which is
 *  a sentence the card's own terminal already sits inside.
 *
 *  A driver of `null` raises no card (nothing is gated), so this is only
 *  ever asked about a terminal the Conductor drives. */
export function lockCardWords(at: Membership): string {
  return `The Conductor is driving this terminal · ${ROLE_WORD[at.role]}`;
}

/** MAY A PERSON TYPE into a terminal with this driver? The lock's whole rule,
 *  in one place: the Conductor DRIVING a terminal is the only thing that
 *  blocks a person's input. A terminal they have taken over is theirs, a
 *  terminal whose work drives nothing (a watch, a mode nobody has answered
 *  yet) never left their hands, and a terminal in no work at all was never
 *  the Conductor's.
 *
 *  Here rather than beside the guard that calls it (`personInput.ts`, which
 *  reaches the wire for the active host) so the rule is statable — and
 *  tested — without a browser. `undefined` is the ordinary case: a terminal
 *  the membership index does not name at all. */
export function inputAllowed(
  driver: Membership["driver"] | undefined,
): boolean {
  return driver !== "conductor";
}

/** The repository as a person names it: the last segment of its path. */
export function repoName(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The line under a card's title: WHERE the work is — which is now its
 *  identity, `repo · branch` for a branch work and "watching" for a watch —
 *  the host as a person names it, the mode, and the PR once there is one.
 *  Each part is dropped when it is not known yet rather than drawn as a blank
 *  or a dash. */
export function workSubtitle(
  work: Work,
  hostName: string | null,
): ReadonlyArray<string> {
  const setup = setupOf(work);
  const pr = prOf(work);
  const where =
    work.key.kind === "branch"
      ? [repoName(repoOf(work)), branchOf(work)]
      : ["watching"];
  return [
    ...where,
    hostName ?? "",
    setup.mode ?? "",
    pr === null ? "" : `PR #${pr.number}`,
  ].filter((part) => part !== "");
}

/** A PR's checks, counted — the one LIVE fact the column mixes into a stored
 *  record. It arrives from the member terminal's own record (the fleet index),
 *  never from the timeline: the timeline says checks are running, and how many
 *  of them have landed is only true for the instant it is read. */
export interface ChecksTally {
  readonly pass: number;
  readonly pending: number;
  readonly fail: number;
  readonly total: number;
}

export function checksTally(pr: PrInfo | null): ChecksTally | null {
  if (pr === null || pr.checkRuns.length === 0) return null;
  const tally = { pass: 0, pending: 0, fail: 0 };
  for (const run of pr.checkRuns) tally[run.outcome] += 1;
  return { ...tally, total: pr.checkRuns.length };
}

/** `14 of 23 checks` — what the standing line says while CI runs. */
export function checksProgress(tally: ChecksTally): string {
  return `${tally.pass + tally.fail} of ${tally.total} checks`;
}

/** `14 passed · 9 running · 0 failed` — the Pull request section's own line,
 *  which states every bucket including the empty ones: a zero failed is the
 *  fact a reader came for. */
export function checksBreakdown(tally: ChecksTally): string {
  return `${tally.pass} passed · ${tally.pending} running · ${tally.fail} failed`;
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
  readonly what: string;
  readonly since: string;
}

/** THE WORDS FOR WHERE A WORK STANDS — the lead beside the dot, by the reason
 *  `standing()` gives. `question` and `merge` share "Waiting on you": what
 *  differs is the detail after it, which is the question's own words or the PR
 *  to merge. The last three are the three ways a work can be over. */
const WHY_LEAD: Record<StandingWhy, string> = {
  question: "Waiting on you",
  merge: "Waiting on you",
  ci: "CI running",
  watching: "Watching",
  working: "Agents at work",
  merged: "Merged",
  closed: "Closed",
  stopped: "Stopped",
};

export function standingLine(
  work: Work,
  checks: ChecksTally | null,
): StandingLine {
  const at = standing(work, policyOf(work));
  const lead = WHY_LEAD[at.why];
  if (at.who === "done")
    return {
      who: "done",
      lead,
      // HOW it ended, which for a stopped work is the whole fact: a person
      // reading "Stopped" wants to know whether they did it.
      what: at.outcome === null ? "" : outcomeWords(at.outcome),
      since: at.since,
    };
  if (at.who === "ci")
    return {
      who: "ci",
      lead,
      // The LIVE tally is the only honest detail while checks run: the
      // timeline says they are running, how many have landed is true only for
      // the instant it is read.
      what: checks === null ? "" : checksProgress(checks),
      since: at.since,
    };
  if (at.who === "you")
    return {
      who: "you",
      lead,
      what:
        at.why === "question"
          ? at.what
          : at.ref === null
            ? "merge the PR"
            : `merge PR #${at.ref}`,
      since: at.since,
    };
  return { who: "agent", lead, what: "", since: at.since };
}

/** One stretch of the drawn bar, as a share of the whole life. Percentages
 *  rather than milliseconds because what the eye reads is the proportion;
 *  a work with no measurable life yet draws nothing at all. */
export interface BarSegment {
  readonly who: Waiter;
  readonly percent: number;
}

export function barSegments(
  work: Work,
  now: string,
): ReadonlyArray<BarSegment> {
  const bar = timeBar(work, policyOf(work), now);
  const total = bar.reduce((sum, stretch) => sum + stretch.ms, 0);
  if (total === 0) return [];
  return bar.map((stretch) => ({
    who: stretch.who,
    percent: (stretch.ms / total) * 100,
  }));
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

/** The role a member terminal held, for an event that names it — read off the
 *  TIMELINE's own `joined` events rather than the members map.
 *
 *  A terminal that has left is not in the map at all (leaving is removal and
 *  an event), and the timeline must still be able to say "Implementor left":
 *  the part it played is a fact about what happened, which is what the
 *  timeline is. */
function roleOf(work: Work, terminal: string | null): string {
  if (terminal === null) return "";
  for (let at = work.events.length - 1; at >= 0; at -= 1) {
    const event = work.events[at];
    if (
      event !== undefined &&
      event.kind === "joined" &&
      event.terminal === terminal
    )
      return ROLE_WORD[event.role];
  }
  return "";
}

/** The first decision of an ask that was actually PUT to the human — what a
 *  `question` / `answered` event points at. A setup answer the request already
 *  gave rides the same ask but nobody was asked it, so it never names the
 *  ask. The timeline never copies the words; it holds the ask's id and reads
 *  them here, so a question and the Decisions section can never disagree. */
function askedIn(work: Work, ask: string): Decision | undefined {
  return work.decisions.find(
    (one) =>
      one.ask === ask && !(isAnswered(one) && one.answer.from === "request"),
  );
}

/** What an answer came to, in one phrase: the options picked, then the words
 *  typed — or how it ended when nobody answered. */
export function answerWords(decision: Decision): string {
  if (!isAnswered(decision)) return "waiting";
  const answer = decision.answer;
  if (answer.how !== "answered") return answer.how;
  return [...answer.picked, ...(answer.text === null ? [] : [answer.text])]
    .filter((part) => part !== "")
    .join(" · ");
}

/** WHERE AN ANSWER CAME FROM, said plainly — the card, the chat, the reader
 *  or the request itself. `null` for one nobody answered. */
export function answerSource(decision: Decision): string | null {
  return isAnswered(decision) ? `from the ${decision.answer.from}` : null;
}

/** WHEN A DECISION SETTLED — the answer's own time, or when it was put for
 *  one still open. The clock is handed in: the card speaks one format, and it
 *  is the card's. */
export function answeredWhen(
  decision: Decision,
  clock: (at: string) => string,
): string {
  return isAnswered(decision)
    ? `answered ${clock(decision.answer.at)}`
    : `asked ${clock(decision.at)}`;
}

/** The head commit a check event is about, or `null` for every other kind —
 *  the one reader of that field, so the switch below stays about words. */
function headOf(event: WorkEvent): string | null {
  return event.kind === "checks-running" ||
    event.kind === "checks-passed" ||
    event.kind === "checks-failed"
    ? event.head
    : null;
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
  const head = headOf(event);
  if (head === null || heads.size < 2) return "";
  return ` · ${head.slice(0, 7)}`;
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
    work.events.map(headOf).filter((one): one is string => one !== null),
  );
  return (event: WorkEvent): string => {
    const role = roleOf(work, event.terminal);
    const who = role === "" ? "A terminal" : role;
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
        return event.why === ""
          ? `${who} exited`
          : `${who} exited · ${event.why}`;
      case "asleep":
        return `${who} went to sleep`;
      case "file":
        return `Wrote ${event.path}`;
      // THE TIMELINE DOES NOT QUOTE QUESTIONS. It names the decision — the
      // label the Decisions list draws it under — and the answer. The
      // question's own words are one press away in that list, and saying them
      // here was how one sentence came to be on the card three times.
      case "question": {
        const decision = askedIn(work, event.ask);
        return `Asked: ${decision === undefined ? "something" : decisionLabel(decision)}`;
      }
      case "answered": {
        const decision = askedIn(work, event.ask);
        return decision === undefined
          ? "You answered"
          : `You: ${answerWords(decision)}`;
      }
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
      case "note":
        return event.text;
      // THE LOCK, as the timeline tells it: an act of the person's, named by
      // the part the terminal plays rather than its ref — the same words the
      // tile's banner says, in the past tense.
      case "taken-over":
        return `You took over the ${role === "" ? "terminal" : role.toLowerCase()}`;
      case "handed-back":
        return `You handed the ${role === "" ? "terminal" : role.toLowerCase()} back`;
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
        return `Could not keep the files · ${event.why}`;
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
  readonly key: SetupKey | null;
  readonly label: string;
  /** The answer, already cut to one line. */
  readonly answer: string;
  /** Whether the answer was cut — the rest is behind the press. */
  readonly rest: boolean;
  /** Where the answer came from, for the row's own mark. */
  readonly from: AnswerFrom | null;
  /** What the press opens: the question(s) this row stands for, in full. */
  readonly decisions: ReadonlyArray<Decision>;
}

/** A setup answer as a PERSON reads it: what to do on green in the words the
 *  rest of the card uses. */
function setupAnswer(decision: Decision): string {
  const words = answerWords(decision);
  if (!isAnswered(decision) || decision.answer.how !== "answered") return words;
  if (decision.key === "on-green" && isOnGreen(words))
    return ON_GREEN_WORD[words];
  return words;
}

function isOnGreen(word: string): word is OnGreen {
  return (ON_GREEN as ReadonlyArray<string>).includes(word);
}

/** ONE ROW, OVER THE DECISIONS IT STANDS FOR — at least one, said in the
 *  type: a row IS its first decision (its id, its key, where the answer came
 *  from), and the caller that groups them already holds the witness that the
 *  group is not empty. */
function decisionRow(
  label: string,
  answer: string,
  decisions: NonEmpty<Decision>,
): DecisionRow {
  const first = decisions[0];
  const cut = oneLine(answer);
  const answered = decisions.find((one) => isAnswered(one));
  return {
    id: first.id,
    key: first.key,
    label,
    answer: cut.line,
    rest: cut.rest,
    from:
      answered !== undefined && isAnswered(answered)
        ? answered.answer.from
        : null,
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
    // off the key the group was walked by rather than off the decision's own
    // nullable one.
    const found = group.flatMap((key) => {
      const one = work.decisions.findLast((decision) => decision.key === key);
      return one === undefined ? [] : [{ key, decision: one }];
    });
    const head = found[0];
    const decisions = nonEmpty(found.map((one) => one.decision));
    if (head === undefined || decisions === null) continue;
    rows.push(
      decisionRow(
        SETUP_LABEL[head.key],
        found.map((one) => setupAnswer(one.decision)).join(" · "),
        decisions,
      ),
    );
  }
  for (const decision of work.decisions)
    if (decision.key === null)
      rows.push(
        decisionRow(decisionLabel(decision), answerWords(decision), [decision]),
      );
  return rows;
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
