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
import type { MemoryNeed } from "kolu-common/conductorMemory";
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
  type StageState,
  type Visit,
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
  workIdOf,
} from "kolu-work";
import { type NonEmpty, nonEmpty } from "nonempty";
import { hostLabel } from "../host/hostChipTone";
import { type ChecksTally, checksProgress, mergeWords } from "./prReadings";

/** THE THREE INKS, by who is being waited on — violet for you, amber for CI,
 *  teal for the agents. One table, read by the standing line, the work
 *  chip's dot, the timeline's dots and the legend, so a wait and the
 *  sentence about it are never two different colours. */
export const WAITER_INK: Record<
  Waiter,
  { readonly text: string; readonly fill: string }
> = {
  agent: { text: "text-accent", fill: "bg-accent" },
  you: { text: "text-alert", fill: "bg-alert" },
  ci: { text: "text-attention", fill: "bg-attention" },
};

/** A WORK'S DOT, by who it waits on — the waiter's fill, pulsing when it is
 *  you, and the finished colour once it is over. */
export const WORK_DOT: Record<Waiter | "done", string> = {
  agent: WAITER_INK.agent.fill,
  you: `${WAITER_INK.you.fill} motion-safe:animate-pulse`,
  ci: WAITER_INK.ci.fill,
  done: "bg-ok",
};

/** What each place is called on the map and the trail — the six stages, the
 *  setup no cell holds, and the two doubts between a pair of stages. */
export const STAGE_LABEL: Record<Filed, string> = {
  setup: "Setup",
  "plan-or-approve": "Plan or Approve",
  "build-or-review": "Build or Review",
  plan: "Plan",
  approve: "Approve",
  build: "Build",
  review: "Review",
  checks: "Checks",
  merge: "Merge",
};

/** THE HATCH — the one ink of a doubt, on the trail, on a map box that may
 *  have been it, and on the doubt's own mark: kolu did not record which of
 *  two stages that time was. */
export const HATCH = {
  fill: "bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--color-fg-3)_45%,transparent)_0_2px,transparent_2px_5px)]",
  edge: "border-dashed border-fg-3",
  tint: "bg-fg-3/20",
} as const;

/** THE COLOUR THAT NAMES A STAGE — the same on the map and on the trail, so a
 *  run of Review and Build visits reads as one at a glance. A stage's hue
 *  (`--color-stage-*`, `@kolu/theme`) says WHICH stage, never whose time it
 *  was: that stays in a stage's title and spoken label. The setup is a quiet
 *  grey, and a doubt is the {@link HATCH}, so it is drawn apart from every
 *  stage. `fill` paints a trail segment (and the hatch a map box), `edge` a
 *  map box's border, and `tint` a map box or doubt mark whose events the
 *  timeline shows. */
export const STAGE_INK: Record<
  Filed,
  { readonly fill: string; readonly edge: string; readonly tint: string }
> = {
  setup: { fill: "bg-fg-3/40", edge: "border-fg-3", tint: "bg-fg-3/20" },
  "plan-or-approve": HATCH,
  "build-or-review": HATCH,
  plan: {
    fill: "bg-stage-plan",
    edge: "border-stage-plan",
    tint: "bg-stage-plan/20",
  },
  approve: {
    fill: "bg-stage-approve",
    edge: "border-stage-approve",
    tint: "bg-stage-approve/20",
  },
  build: {
    fill: "bg-stage-build",
    edge: "border-stage-build",
    tint: "bg-stage-build/20",
  },
  review: {
    fill: "bg-stage-review",
    edge: "border-stage-review",
    tint: "bg-stage-review/20",
  },
  checks: {
    fill: "bg-stage-checks",
    edge: "border-stage-checks",
    tint: "bg-stage-checks/20",
  },
  merge: {
    fill: "bg-stage-merge",
    edge: "border-stage-merge",
    tint: "bg-stage-merge/20",
  },
};

/** THE RING ON WHERE A WORK IS NOW — its stage on the map, its visit on the
 *  trail. */
export const NOW_RING = "ring-2 ring-fg ring-offset-1 ring-offset-surface-0";

/** THE STAGES of a work, under its own policy. */
export function stagesOf(work: Work, now: string): Stages {
  return stages(work, policyOf(work), now);
}

/** TWO READINGS OF THE STAGES THAT SAY THE SAME THING — field by field, as
 *  the map, the trail and the timeline read them. The fold walks the whole
 *  timeline again on every move of the record and on every tick of the clock,
 *  and mints every cell, every filing and every visit fresh, so nothing
 *  smaller than this can close the gate on it. */
export const sameStages = (a: Stages, b: Stages): boolean => {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind !== "staged" || b.kind !== "staged") return true;
  return (
    a.where.kind === b.where.kind &&
    a.where.place === b.where.place &&
    sameLists(a.events, b.events, (one, other) => one === other) &&
    sameLists(
      a.stages,
      b.stages,
      (one, other) =>
        one.name === other.name && sameStageState(one.state, other.state),
    ) &&
    sameLists(a.trail, b.trail, sameVisit)
  );
};

const sameLists = <T>(
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  same: (one: T, other: T) => boolean,
): boolean => {
  if (a.length !== b.length) return false;
  return a.every((one, at) => {
    const other = b[at];
    return other !== undefined && same(one, other);
  });
};

const sameStageState = (a: StageState, b: StageState): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "done" && b.kind === "done")
    return a.ms === b.ms && a.who === b.who;
  if (a.kind === "now" && b.kind === "now")
    return a.ms === b.ms && a.here === b.here && a.who === b.who;
  return true;
};

const sameVisit = (a: Visit, b: Visit): boolean =>
  a.stage === b.stage &&
  a.from === b.from &&
  Option.getOrUndefined(a.until) === Option.getOrUndefined(b.until) &&
  a.time.agent === b.time.agent &&
  a.time.you === b.time.you &&
  a.time.ci === b.time.ci &&
  a.events.from === b.events.from &&
  a.events.until === b.events.until;

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
  return membersByWork(members).get(work) ?? [];
}

/** EVERY WORK'S MEMBERS, in one pass over the map — each work's in the order
 *  {@link membersIn} gives. For a reader that wants many works at once. */
export function membersByWork(
  members: ReadonlyMap<string, WorkMember>,
): ReadonlyMap<string, ReadonlyArray<WorkMemberRow>> {
  const by = new Map<string, WorkMemberRow[]>();
  for (const [terminal, member] of members) {
    const rows = by.get(member.work);
    if (rows === undefined) by.set(member.work, [{ terminal, member }]);
    else rows.push({ terminal, member });
  }
  for (const rows of by.values())
    rows.sort((a, b) => roleRank(a.member.role) - roleRank(b.member.role));
  return by;
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

/** IS THE CONDUCTOR DRIVING THIS TERMINAL — the same rule as
 *  {@link inputAllowed}, asked of the membership index by fleet ref. The
 *  Conductor answers its own agents (it is woken about them), so a terminal
 *  it drives makes no sound and no popup, and gets no unread mark and no
 *  place in its host tab's unread count. Blocked on a prompt, it still
 *  counts as needs-you. One the human has taken over, a member of a watch
 *  and a terminal in no work reach the person as any terminal does. */
export function drivenByConductor(
  membership: ReadonlyMap<string, Membership>,
  encHost: string,
  id: string,
): boolean {
  return !inputAllowed(
    Option.fromUndefinedOr(membership.get(fleetTerminalRef(encHost, id))),
  );
}

/** EVERY TERMINAL THE CONDUCTOR DRIVES, by fleet ref — {@link
 *  drivenByConductor}'s rule over the whole index, for a reader that must act
 *  as a terminal comes under the Conductor (attention lifts its unread mark
 *  then). Strings, so a list over it keeps each terminal's entry while others
 *  come and go. */
export function drivenRefs(
  membership: ReadonlyMap<string, Membership>,
): string[] {
  const refs: string[] = [];
  for (const [ref, at] of membership)
    if (!inputAllowed(Option.some(at))) refs.push(ref);
  return refs;
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

/** WHERE A WORK IS, as its key says it: a branch work's repository (named by
 *  its last segment) and branch — the two words the card paints in the
 *  Dock's identity colours — or a watch, which has neither. */
export type WorkWhere =
  | { readonly kind: "branch"; readonly repo: string; readonly branch: string }
  | { readonly kind: "watch" };

export function workWhere(work: Work): WorkWhere {
  return work.key.kind === "branch"
    ? { kind: "branch", repo: repoName(work.key.repo), branch: work.key.branch }
    : { kind: "watch" };
}

/** The line under a card's title, in its two halves: WHERE the work is
 *  ({@link workWhere}) and the REST — the host as a person names it, the
 *  mode, and the PR once there is one (`draft PR #7` while it is an open
 *  draft). Each word is dropped when it is not known yet rather than drawn
 *  as a blank or a dash. */
export interface WorkSubtitleParts {
  readonly where: WorkWhere;
  readonly rest: ReadonlyArray<string>;
}

export function workSubtitleParts(
  work: Work,
  hostName: Option.Option<string>,
): WorkSubtitleParts {
  const setup = setupOf(work);
  const where = workWhere(work);
  return {
    where,
    rest: [
      ...Option.toArray(hostName),
      // A watch's mode is its key: the lead already says "watching".
      ...(where.kind === "watch" ? [] : Option.toArray(setup.mode)),
      ...Option.toArray(
        Option.map(
          prOf(work),
          (pr) => `${isOpenDraft(pr) ? "draft " : ""}PR #${pr.number}`,
        ),
      ),
    ].filter((part) => part !== ""),
  };
}

/** The same line as words: `repo · branch` for a branch work and
 *  "watching" for a watch, then the rest. */
export function workSubtitle(
  work: Work,
  hostName: Option.Option<string>,
): ReadonlyArray<string> {
  const { where, rest } = workSubtitleParts(work, hostName);
  const lead =
    where.kind === "branch" ? [where.repo, where.branch] : ["watching"];
  return [...lead.filter((part) => part !== ""), ...rest];
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
      switch (outcome.by) {
        case "you":
          return "Stopped by you";
        case "conductor":
          return "Stopped by the Conductor";
        case "kolu":
          return "Stopped by kolu: its branch runs as another work";
        default:
          return outcome.by satisfies never;
      }
  }
}

/** WHY A WORK IS STILL UNDER ITS OLD KEY — the card's line. A work whose
 *  root's key already belonged to another work when git first answered for
 *  it keeps its old key, `held`; the line names the work holding the branch
 *  now — by its title, or "another work" once that one has dropped off the
 *  finished list. A key that is not held reads none. */
export const heldWords = (
  work: Work,
  works: ReadonlyMap<WorkId, Work>,
): Option.Option<string> => {
  const key = work.key;
  if (key.kind !== "branch" || key.repoBy.kind !== "held") return Option.none();
  const root = key.repoBy.root;
  const holder = works.get(workIdOf({ ...key, repo: root }));
  const who = holder === undefined ? "another work" : `«${holder.title}»`;
  return Option.some(
    `Kept under its old key: ${who} holds ${key.branch} in ${repoName(root)}`,
  );
};

/** WHERE IT STANDS, in the words the card draws: a lead that names the waiter
 *  and the detail after it.
 *
 *  `standing()` answers a TOKEN — who is waited on and why — and every word
 *  below is this module's, beside the other word tables, except what a wait
 *  on the human ASKS FOR: that is `kolu-work`'s `wantedWords`, the words the
 *  palette and the notification say too. */
export interface StandingLine {
  readonly who: Waiter | "done";
  readonly lead: string;
  /** The detail after the lead — none for a wait that has none to give (the
   *  agents are simply at work), which the card draws as nothing at all
   *  rather than as an empty clause. */
  readonly what: Option.Option<string>;
  readonly since: string;
  /** HOW THE CLOCK AFTER IT READS — a plain duration, `asked … ago` for a
   *  question, `green for …` for a merge, `… ago` for a work that is over. */
  readonly clock: "for" | "asked" | "green" | "ended";
}

/** TWO STANDING LINES THAT SAY THE SAME THING. The fold builds a fresh line
 *  (and a fresh `Option` inside it) on every move of the record, so the only
 *  comparison that can close a gate on it is this one, field by field. */
export const sameStandingLine = (
  a: StandingLine | undefined,
  b: StandingLine | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.who === b.who &&
    a.lead === b.lead &&
    a.since === b.since &&
    a.clock === b.clock &&
    Option.getOrUndefined(a.what) === Option.getOrUndefined(b.what));

/** THE WORDS FOR WHERE A WORK STANDS — the lead beside the dot, by the reason
 *  `standing()` gives. `question` and `merge` share "Needs you": what differs
 *  is what is wanted after it. A work that is over is led by how it ended
 *  ({@link outcomeWords}), once, so it has no word here. */
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

/** WHO A WORK WAITS ON, off its own record alone — the standing line's dot,
 *  for a face that draws the dot and nothing else (a work's chip). The live
 *  checks change only the standing line's words, never who it waits on. */
export const waiterOf = (work: Work): Waiter | "done" =>
  WAITER_OF[standing(work, policyOf(work)).why];

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
    // The LIVE tally is the only honest detail while checks run: the timeline
    // says they are running, how many have landed is true only for the
    // instant it is read.
    case "ci":
      return line(WHY_LEAD[at.why], Option.map(checks, checksProgress), "for");
    // The agents are simply at work: no detail to give.
    case "watching":
    case "working":
      return line(WHY_LEAD[at.why], Option.none(), "for");
    // HOW it ended, which for a stopped work is the whole fact: a person
    // reading "Stopped" wants to know whether they did it.
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
      // A HAND-OFF: the Conductor gave the work to this member.
      case "told":
        return `Handed to the ${part}`;
      case "hand-offs-kept":
        return "kolu began keeping who holds the work";
      default:
        return event satisfies never;
    }
  };
}

/** ... and the one row a run of files written into one folder becomes
 *  (`./timelineView.ts`'s folder row): `Wrote mockup/ · 49 files`, spelled
 *  beside the `Wrote …` of a single file. */
export const folderRowWords = (folder: string, files: number): string =>
  `Wrote ${waterfallFileName(folder)} · ${files} files`;

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

/** TWO READINGS OF ONE DECISION ROW. The fold mints a row — and the topic,
 *  the source and the list inside it — on every run, so a card's rows are
 *  compared by what they SAY and by which decisions they stand for. */
export const sameDecisionRow = (a: DecisionRow, b: DecisionRow): boolean =>
  a.id === b.id &&
  a.label === b.label &&
  a.answer === b.answer &&
  a.rest === b.rest &&
  a.topic.kind === b.topic.kind &&
  (a.topic.kind !== "setup" ||
    (b.topic.kind === "setup" && a.topic.key === b.topic.key)) &&
  Option.getOrUndefined(a.from) === Option.getOrUndefined(b.from) &&
  a.decisions.length === b.decisions.length &&
  a.decisions.every((one, at) => b.decisions[at] === one);

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

/** Two readings of one setup part — minted by the same fold, and so never
 *  the object it was. */
export const sameSetupPart = (a: SetupPart, b: SetupPart): boolean =>
  a.key === b.key &&
  a.text === b.text &&
  a.answer === b.answer &&
  Option.getOrUndefined(a.from) === Option.getOrUndefined(b.from);

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

/** WHAT A MEMBER RUNS, for its row — `omp/Opus 5.5`. The harness is the one
 *  the setup chose for its role, else the agent kolu sees in the terminal;
 *  the model is the one the agent's SESSION reports (the Dock's reading),
 *  else the one the setup chose. Either half is left out while it is not
 *  known, and the whole is none when neither is. */
export function roleRuns(
  work: Work,
  role: WorkRole,
  seen: {
    readonly agent: string | undefined;
    readonly model: string | undefined;
  },
): Option.Option<string> {
  const chosen = roleSetupOf(work, role);
  const harness = chosen.kind === "not-chosen" ? seen.agent : chosen.harness;
  const model =
    seen.model ??
    (chosen.kind === "harness-and-model" ? chosen.model : undefined);
  const parts = [harness, model].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  return parts.length === 0 ? Option.none() : Option.some(parts.join("/"));
}

/** HOW MANY THINGS WAIT ON THE HUMAN — the tab's one number.
 *
 *  Every item of the one needs-you reading (`kolu-work`'s `needsYou`: a work
 *  waiting on you counts once however many questions it holds, the card is
 *  the one place to go), plus every question the conversation asks about NO
 *  work — `ownAsks`, the conductor cell's own list, which never holds a
 *  work's question — plus ONE for memory while any proposal waits, however
 *  many (`memoryNeed`): the Memory sheet is the one place to go. */
export function waitingCount(
  needs: ReadonlyArray<NeedsYou>,
  ownAsks: ReadonlyArray<string>,
  memory: MemoryNeed | null | undefined,
): number {
  return (
    needs.length +
    ownAsks.length +
    (memory === null || memory === undefined ? 0 : 1)
  );
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
