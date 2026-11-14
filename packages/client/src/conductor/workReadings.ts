/** WHAT THE WORK COLUMN SAYS — every reading the browser adds on top of
 *  `kolu-work`'s folds, as plain functions over the record.
 *
 *  `kolu-work` answers what a work IS (who it waits on, the bar, the
 *  durations); this module answers what a READER is shown: the words beside
 *  each timeline dot, the ink each waiter wears, the sentence under a card's
 *  title. None of it is stored and none of it is reactive — the card calls
 *  these with the work it already has, so a tick of a clock re-renders words
 *  and never re-reads the wire.
 *
 *  It stays free of Solid and of the fleet index on purpose: the one live
 *  fact the column mixes in — a PR's check runs, read off the member
 *  terminal's record — arrives as an argument ({@link ChecksTally}), so every
 *  sentence here is testable without a browser. */

import type { PrInfo } from "anyforge/schemas";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import {
  type Decision,
  type EventBy,
  type Membership,
  type OnGreen,
  type Waiter,
  type Work,
  type WorkEvent,
  type WorkRole,
  prOf,
  setupOf,
  standing,
  timeBar,
  timeSpent,
  waitingOnYou,
} from "kolu-work";

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

/** THE LOCK'S BANNER — who drives this terminal, the part it plays and the
 *  work it plays it in, in the tile's title area and above the phone's key
 *  bar. The same sentence in both places, from the same membership reading,
 *  so a person who takes a terminal over on the phone and reads it on the
 *  desktop is told one thing.
 *
 *  A driver of `null` is not a lock at all (a watch, a mode nobody has
 *  answered yet, a terminal that left) and nothing is drawn for it — which is
 *  why this answers `""` rather than inventing words for a banner that has no
 *  reason to exist. */
export function lockWords(at: Membership): string {
  if (at.driver === null) return "";
  const who = at.driver === "you" ? "Taken over" : "Driven by the Conductor";
  return `${who} · ${ROLE_WORD[at.role]} · ${at.title}`;
}

/** What a blocked keystroke is told — one line, pointing at the one control
 *  that unblocks it. Never a silent swallow: a terminal that ignores typing
 *  without saying why reads as broken. */
export const LOCK_NUDGE_WORDS =
  "The Conductor is driving this — Take over to type";

/** MAY A PERSON TYPE into a terminal with this driver? The lock's whole rule,
 *  in one place: the Conductor DRIVING a terminal is the only thing that
 *  blocks a person's input. A terminal they have taken over is theirs, a
 *  terminal whose work drives nothing (a watch, a mode nobody has answered
 *  yet) never left their hands, and a terminal in no work at all was never
 *  the Conductor's.
 *
 *  Here rather than beside the guard that calls it (`workLock.ts`, which
 *  reaches the wire for the active host) so the rule is statable — and
 *  tested — without a browser. `undefined` is the ordinary case: a terminal
 *  the membership index does not name at all. */
export function inputAllowed(
  driver: Membership["driver"] | undefined,
): boolean {
  return driver !== "conductor";
}

/** The repository as a person names it: the last segment of its path. A
 *  watch carries no repo (`""`), and then there is nothing to say. */
export function repoName(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The line under a card's title: `repo · host · mode`, and the PR once there
 *  is one. Each part is dropped when it is not known yet rather than drawn as
 *  a blank or a dash — a work whose setup is still being answered says the
 *  little it knows. */
export function workSubtitle(
  work: Work,
  hostName: string | null,
): ReadonlyArray<string> {
  const setup = setupOf(work);
  const pr = prOf(work);
  return [
    repoName(work.repo),
    hostName ?? setup.host ?? "",
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

/** WHERE IT STANDS, in the words the card draws: a lead that names the waiter
 *  and the detail after it. The lead comes from the waiter and the detail from
 *  `standing()` — except while CI runs, where the live tally is the only
 *  honest detail there is. */
export interface StandingLine {
  readonly who: Waiter | "done";
  readonly lead: string;
  readonly what: string;
  readonly since: string;
}

const DONE_WORD: Record<string, string> = {
  merged: "Merged",
  closed: "Closed",
  abandoned: "Abandoned",
  ended: "Ended",
};

export function standingLine(
  work: Work,
  checks: ChecksTally | null,
): StandingLine {
  const at = standing(work);
  if (at.who === "done")
    return {
      who: "done",
      lead: DONE_WORD[at.what] ?? "Ended",
      what: "",
      since: at.since,
    };
  if (at.who === "ci")
    return {
      who: "ci",
      lead: "CI running",
      what: checks === null ? "" : checksProgress(checks),
      since: at.since,
    };
  if (at.who === "you")
    return {
      who: "you",
      lead: "Waiting on you",
      what: at.what,
      since: at.since,
    };
  // The model's own words for the agents' stretch — "agents at work", or
  // "watching" for a plain watch — capitalised as a lead.
  return {
    who: "agent",
    lead: at.what.charAt(0).toUpperCase() + at.what.slice(1),
    what: "",
    since: at.since,
  };
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
  const bar = timeBar(work, now);
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
  const spent = timeSpent(work, now);
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

/** The role a member terminal holds in this work, for an event that names it.
 *  A terminal that has since left is still named by the part it played. */
function roleOf(work: Work, terminal: string | null): string {
  if (terminal === null) return "";
  const member = work.members.find((one) => one.terminal === terminal);
  return member === undefined ? "" : ROLE_WORD[member.role];
}

/** The first decision of an ask that was actually PUT to the human — what a
 *  `question` / `answered` event points at. A setup answer the request already
 *  gave rides the same ask but nobody was asked it, so it never names the
 *  ask. The timeline never copies the words; it holds the ask's id and reads
 *  them here, so a question and the Decisions section can never disagree. */
function askedIn(work: Work, ask: string): Decision | undefined {
  return work.decisions.find(
    (one) => one.ask === ask && one.answer?.from !== "request",
  );
}

/** What an answer came to, in one phrase: the options picked, then the words
 *  typed — or how it ended when nobody answered. */
export function answerWords(decision: Decision): string {
  const answer = decision.answer;
  if (answer === null) return "waiting";
  if (answer.how !== "answered") return answer.how;
  return [...answer.picked, ...(answer.text === null ? [] : [answer.text])]
    .filter((part) => part !== "")
    .join(" · ");
}

/** WHERE AN ANSWER CAME FROM, said plainly — the card, the chat, or the
 *  request itself. `null` for one nobody answered. */
export function answerSource(decision: Decision): string | null {
  const from = decision.answer?.from;
  return from === undefined || from === null ? null : `from the ${from}`;
}

/** ONE LINE OF THE TIMELINE. The event's own `detail` is the only text the
 *  record carries; everything else a reader sees is composed here, from the
 *  kind and whatever the event points at (a member's role, an ask's words). */
export function eventWords(work: Work, event: WorkEvent): string {
  const role = roleOf(work, event.terminal);
  const who = role === "" ? "A terminal" : role;
  switch (event.kind) {
    case "requested":
      return "You asked for it";
    case "carried-over":
      return event.detail;
    case "joined":
      return `${ROLE_WORD[event.detail as WorkRole] ?? who} joined`;
    case "left":
      return `${who} left · ${event.detail}`;
    case "ready":
      return `${who} is up`;
    case "stopped":
      return `${who} stopped`;
    case "asking":
      return `${who} is asking`;
    case "exited":
      return event.detail === ""
        ? `${who} exited`
        : `${who} exited · ${event.detail}`;
    case "asleep":
      return `${who} went to sleep`;
    case "file":
      return `Wrote ${event.detail}`;
    case "question":
      return askedIn(work, event.detail)?.question ?? "Asked you something";
    case "answered": {
      const decision = askedIn(work, event.detail);
      return decision === undefined
        ? "You answered"
        : `You answered: ${answerWords(decision)}`;
    }
    case "question-dropped":
      return "The question went away unanswered";
    case "pr-opened":
      return `Opened ${event.detail}`;
    case "checks-running":
      return "CI running";
    case "checks-passed":
      return "Checks passed";
    case "checks-failed":
      return `Checks failed · ${event.detail}`;
    case "merged":
      return `Merged ${event.detail}`;
    case "pr-closed":
      return `Closed ${event.detail}`;
    case "note":
      return event.detail;
    // THE LOCK, as the timeline tells it: an act of the person's, named by the
    // part the terminal plays rather than its ref — the same words the tile's
    // banner says, in the past tense.
    case "taken-over":
      return `You took over the ${role === "" ? "terminal" : role.toLowerCase()}`;
    case "handed-back":
      return `You handed the ${role === "" ? "terminal" : role.toLowerCase()} back`;
    // The bound: a stretch of agent-state events kolu dropped, counted where
    // they happened, so the timeline still says WHEN the quiet stretch was.
    case "folded":
      return `${event.detail} earlier agent state changes`;
    case "ended":
      return `Ended · ${event.detail}`;
    case "kept":
      return `${event.detail} files kept`;
    case "keep-failed":
      return `Could not keep the files · ${event.detail}`;
  }
}

/** THE SETUP, as one sentence — host, mode, each role's harness and model,
 *  and what to do on green. A part nobody has answered yet is simply not
 *  there. */
export function setupWords(work: Work, hostName: string | null): string {
  const setup = setupOf(work);
  const parts: string[] = [];
  const host = hostName ?? setup.host;
  if (host !== null) parts.push(host);
  if (setup.mode !== null) parts.push(setup.mode);
  for (const role of setup.roles) {
    const how = [role.harness, role.model].filter((one) => one !== null);
    if (how.length > 0) parts.push(`${role.role} ${how.join("/")}`);
  }
  if (setup.onGreen !== null)
    parts.push(`on green: ${ON_GREEN_WORD[setup.onGreen]}`);
  return parts.join(" · ");
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
  openAsks: ReadonlyArray<string>,
): number {
  const owned = workAskIds(works);
  return waitingOnYou(works) + openAsks.filter((id) => !owned.has(id)).length;
}

/** Which work an ask belongs to, or `null` for the conversation's own — what
 *  the chat's form says above itself. */
export function workOfAsk(
  works: ReadonlyArray<Work>,
  ask: string,
): Work | null {
  return (
    works.find((work) => work.decisions.some((one) => one.ask === ask)) ?? null
  );
}

/** The sentence the status line reads: `N pieces of work · M waiting on you`,
 *  with a part that would read zero left out entirely. Empty when there is
 *  nothing to say, which is what keeps `0 pieces of work` off the screen. */
export function worksStatusWords(
  works: ReadonlyArray<Work>,
  openAsks: ReadonlyArray<string>,
): string {
  const live = works.filter((one) => one.endedAt === null).length;
  const waiting = waitingCount(works, openAsks);
  const parts: string[] = [];
  if (live > 0)
    parts.push(`${live} ${live === 1 ? "piece of work" : "pieces of work"}`);
  if (waiting > 0) parts.push(`${waiting} waiting on you`);
  return parts.join(" · ");
}
