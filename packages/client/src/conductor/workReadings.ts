import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import { decodeHostKey, isEncodedHostKey } from "kolu-common/hostKey";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
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
  isSettled,
  type Membership,
  type NeedsYou,
  type OnGreen,
  type Outcome,
  isOpenDraft,
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
  wantedWords,
  type Work,
  type WorkEvent,
  type WorkId,
  type WorkMember,
  WORK_ROLES,
  type WorkRole,
  waterfallFileName,
} from "kolu-work";
import { type NonEmpty, nonEmpty } from "nonempty";
import { hostLabel } from "../host/hostChipTone";
import { type ChecksTally, checksProgress, mergeWords } from "./prReadings";

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

export const EVENT_INK: Record<EventBy, string> = {
  you: "bg-alert",
  agent: "bg-accent",
  ci: "bg-attention",
  kolu: "bg-fg-3",
};

export const ROLE_WORD: Record<WorkRole, string> = {
  planner: "Planner",
  implementor: "Implementor",
  other: "Terminal",
};

export const ON_GREEN_WORD: Record<OnGreen, string> = {
  merge: "merge it",
  "hand-over": "hand over",
};

export const SETUP_LABEL: Record<SetupKey, string> = {
  mode: "Mode",
  "planner.harness": "Planner",
  "planner.model": "Planner",
  "implementor.harness": "Implementor",
  "implementor.model": "Implementor",
  "on-green": "On green",
};

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

export const LINE_LIMIT = 72;

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

export function membersIn(
  members: ReadonlyMap<string, WorkMember>,
  work: WorkId,
): ReadonlyArray<WorkMemberRow> {
  const rows: WorkMemberRow[] = [];
  for (const [terminal, member] of members)
    if (member.work === work) rows.push({ terminal, member });
  return rows.sort((a, b) => roleRank(a.member.role) - roleRank(b.member.role));
}

export type Lock = Exclude<Driver, "nobody">;

export function lockWords(at: Membership, driver: Lock): string {
  const who = driver === "you" ? "Taken over" : "Driven by the Conductor";
  return `${who} · ${ROLE_WORD[at.role]} · ${at.title}`;
}

export function lockCardWords(at: Membership): string {
  return `The Conductor is driving this terminal · ${ROLE_WORD[at.role]}`;
}

export function inputAllowed(at: Option.Option<Membership>): boolean {
  return !Option.exists(at, (one) => one.driver === "conductor");
}

export function drivenByConductor(
  membership: ReadonlyMap<string, Membership>,
  encHost: string,
  id: string,
): boolean {
  return !inputAllowed(
    Option.fromUndefinedOr(membership.get(fleetTerminalRef(encHost, id))),
  );
}

/** The repository as a person names it: the last segment of its path. */
export function repoName(repo: string): string {
  const trimmed = repo.replace(/\/+$/, "");
  return trimmed === "" ? "" : trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function workHost(work: Work): Option.Option<string> {
  const given = hostOf(work);
  if (given === "") return Option.none();
  return Option.some(
    isEncodedHostKey(given) ? hostLabel(decodeHostKey(given)) : given,
  );
}

/** The line under a card's title: WHERE the work is — which is now its
 *  identity, `repo · branch` for a branch work and "watching" for a watch —
 *  the host as a person names it, the mode, and the PR once there is one
 *  (`draft PR #7` while it is an open draft). Each part is dropped when it is
 *  not known yet rather than drawn as a blank or a dash. */
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
    ...Option.toArray(
      Option.map(
        prOf(work),
        (pr) => `${isOpenDraft(pr) ? "draft " : ""}PR #${pr.number}`,
      ),
    ),
  ].filter((part) => part !== "");
}

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

export interface StandingLine {
  readonly who: Waiter | "done";
  readonly lead: string;
  readonly what: Option.Option<string>;
  readonly since: string;
  /** HOW THE CLOCK AFTER IT READS — a plain duration, `asked … ago` for a
   *  question, `green for …` for a merge, `… ago` for a work that is over. */
  readonly clock: "for" | "asked" | "green" | "ended";
}

const WHY_LEAD: Record<
  Exclude<StandingWhy, "merged" | "closed" | "stopped">,
  string
> = {
  question: "Needs you",
  merge: "Needs you",
  ci: "CI running",
  watching: "Watching",
  working: "Agents at work",
};

export function standingLine(
  work: Work,
  checks: Option.Option<ChecksTally>,
): StandingLine {
  const at = standing(work, policyOf(work));
  const line = (
    lead: string,
    what: Option.Option<string>,
    clock: StandingLine["clock"],
  ): StandingLine => ({
    who: WAITER_OF[at.why],
    lead,
    what,
    since: at.since,
    clock,
  });
  switch (at.why) {
    case "question":
      return line(WHY_LEAD[at.why], Option.some(wantedWords(at)), "asked");
    case "merge":
      return line(WHY_LEAD[at.why], Option.some(wantedWords(at)), "green");
    case "ci":
      return line(WHY_LEAD[at.why], Option.map(checks, checksProgress), "for");
    case "watching":
    case "working":
      return line(WHY_LEAD[at.why], Option.none(), "for");
    default:
      return line(outcomeWords(at.outcome), Option.none(), "ended");
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

export function answeredWhen(
  decision: Decision,
  clock: (at: string) => string,
): string {
  return isSettled(decision)
    ? `answered ${clock(decision.answer.at)}`
    : `asked ${clock(decision.at)}`;
}

function headOf(event: WorkEvent): Option.Option<string> {
  return isCheckEvent(event) && event.head.kind === "commit"
    ? Option.some(event.head.sha)
    : Option.none();
}

function commitWords(heads: ReadonlySet<string>, event: WorkEvent): string {
  if (heads.size < 2) return "";
  return Option.match(headOf(event), {
    onNone: () => "",
    onSome: (head) => ` · ${head.slice(0, 7)}`,
  });
}

const LEFT_WORD: Record<"closed" | "released" | "gone", string> = {
  closed: "its terminal was closed",
  released: "released",
  gone: "its terminal is gone",
};

export function eventReader(work: Work): (event: WorkEvent) => string {
  const heads = new Set(
    work.events.flatMap((one) => Option.toArray(headOf(one))),
  );
  return (event: WorkEvent): string => {
    const who = Option.getOrElse(roleOf(work, event.about), () => "A terminal");
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
      case "answered-part":
        return `You answered part of it · the rest is still open`;
      case "question-dropped":
        return "The question went away unanswered";
      case "pr-opened":
        return `Opened ${event.draft === "draft" ? "draft " : ""}#${event.pr} ${event.title}`.trim();
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
      case "draft-state":
        return event.draft === "ready"
          ? `#${event.pr} is ready for review`
          : `#${event.pr} is a draft`;
      case "note":
        return event.text;
      case "taken-over":
        return `You took over the ${part}`;
      case "handed-back":
        return `You handed the ${part} back`;
      case "folded":
        return `${event.count} earlier agent state changes`;
      case "ended":
        return outcomeWords(event.outcome);
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

export const folderRowWords = (folder: string, files: number): string =>
  `Wrote ${waterfallFileName(folder)} · ${files} files`;

export interface DecisionRow {
  /** The row's own id (its first decision's), for the open-state set. */
  readonly id: string;
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

function setupAnswer(decision: Decision): string {
  const words = answerWords(decision);
  if (!isSettled(decision) || decision.topic !== "setup") return words;
  if (decision.answer.how !== "answered") return words;
  const value = decision.answer.value;
  return decision.key === "on-green" && isOnGreen(value)
    ? ON_GREEN_WORD[value]
    : words;
}

function rowFrom(
  decisions: ReadonlyArray<Decision>,
): Option.Option<AnswerFrom> {
  for (const one of decisions)
    if (isSettled(one) && one.answer.how !== "dropped")
      return Option.some(one.answer.from);
  return Option.none();
}

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

export function waitingCount(
  needs: ReadonlyArray<NeedsYou>,
  ownAsks: ReadonlyArray<string>,
): number {
  return needs.length + ownAsks.length;
}

/** The sentence the status line reads: `N pieces of work · M need you` — the
 *  column's own word, "Needs you" — with a part that would read zero left
 *  out entirely. Empty when there is nothing to say, which is what keeps
 *  `0 pieces of work` off the screen. `waiting` is {@link waitingCount}'s. */
export function worksStatusWords(live: number, waiting: number): string {
  const parts: string[] = [];
  if (live > 0)
    parts.push(`${live} ${live === 1 ? "piece of work" : "pieces of work"}`);
  if (waiting > 0)
    parts.push(`${waiting} ${waiting === 1 ? "needs" : "need"} you`);
  return parts.join(" · ");
}
