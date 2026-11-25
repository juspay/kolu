/**
 * HOW A WORK CHANGES — every transition, as a pure function of the record.
 *
 * Each takes a work and answers the work it becomes: nothing here reads a
 * clock, a filesystem or a host, and nothing mutates what it was given.
 *
 * THE TIMELINE ONLY GROWS, with three exceptions, each here and each with
 * its reason: the one `append` below keeps it BOUNDED (old agent states fold
 * into one count, except a stop that let go of the work; a merge answer
 * within one check run replaces the one
 * before it; past {@link PR_FACTS_PER_COMMIT} check results, or merge
 * answers, on one commit, the oldest of them between its first and its
 * newest goes), and {@link linkPr} amends a `pr-opened` recorded before kolu
 * kept PR addresses with the address it learns later. Nothing else rewrites a
 * past row.
 *
 * MEMBERSHIP IS NOT HERE any more. A member is a row in the one map keyed by
 * terminal (`./store.ts`), so joining and leaving are a map movement plus the
 * event this module appends — and a work can no longer carry a member of its
 * own that disagrees with that map.
 */

import { Array as Arr, Option } from "effect";
import {
  holdStep,
  isCheckEvent,
  letsGo,
  NOBODY_HOLDS,
  prOf,
  sameHead,
} from "./readings.ts";
import {
  ABOUT_WORK,
  type AnsweredFromFace,
  type AnswerFrom,
  type Asked,
  aboutMember,
  type Decision,
  type EventKind,
  type Header,
  isOnGreen,
  isWorkMode,
  type KeptFile,
  type KoluChoiceKey,
  type Outcome,
  type QuestionFile,
  type RequestWords,
  type Said,
  type Settled,
  type TypedAnswer,
  type Work,
  type WorkEvent,
  type WorkRole,
  type WorkWorktree,
} from "./schema.ts";

/** HOW A TERMINAL'S AGENT STANDS, as events — what a work produces over and
 *  over for as long as it runs, so it is folded past a count. */
export const AGENT_STATE_KINDS = [
  "ready",
  "stopped",
  "asking",
  "exited",
  "asleep",
] as const satisfies ReadonlyArray<EventKind>;

const AGENT_STATE: ReadonlySet<string> = new Set(AGENT_STATE_KINDS);

/** How many agent-state events a work keeps. Thirty is what a card's timeline
 *  can show of them before a reader scrolls past the rest anyway, and the
 *  `folded` event keeps the count of the ones that went. A state that LET GO
 *  of the work (`./readings.ts`'s `letsGo`) is never folded and does not
 *  count: it ends a visit on the work's trail, and a trail with its stops
 *  folded away would put the time somewhere else. */
export const AGENT_STATES_KEPT = 30;

/** THE AGENT STATES THAT MAY FOLD: every one that let go of nothing, read
 *  off the one hand-off rule. Folding one never moves who holds the work —
 *  a state that lets go of nothing is no step for it. */
const foldable = (
  events: ReadonlyArray<WorkEvent>,
): ((one: WorkEvent) => boolean) => {
  const lettingGo = new Set<WorkEvent>();
  events.reduce((holding, one) => {
    if (letsGo(holding, one)) lettingGo.add(one);
    return holdStep(holding, one);
  }, NOBODY_HOLDS);
  return (one) => AGENT_STATE.has(one.kind) && !lettingGo.has(one);
};

/** Drop the oldest foldable agent-state event and count it into the work's
 *  ONE `folded` event — created, on the first fold, exactly where that event
 *  sat, so the timeline's order still says when the folded stretch happened.
 *  Mutates the array the append above has already copied. */
const foldOldest = (
  events: Array<WorkEvent>,
  folds: (one: WorkEvent) => boolean,
): void => {
  const at = events.findIndex(folds);
  if (at < 0) return;
  const dropped = events[at];
  if (dropped === undefined) return;
  events.splice(at, 1);
  const folded = events.findIndex((one) => one.kind === "folded");
  if (folded >= 0) {
    const was = events[folded];
    if (was !== undefined && was.kind === "folded")
      events[folded] = { ...was, count: was.count + 1 };
    return;
  }
  events.splice(at, 0, {
    at: dropped.at,
    by: "kolu",
    kind: "folded",
    about: ABOUT_WORK,
    count: 1,
  });
};

/** WHETHER A NEW MERGE ANSWER REPLACES THE LAST ONE rather than joining the
 *  timeline: both are about the same PR at the same commit, and that commit's
 *  checks were already running when the last one was recorded and still are.
 *  GitHub flips between blocked and mergeable while required checks land, and
 *  none of those answers decides anything — CI holds the work while its checks
 *  run (`./folds.ts`), so a running check outranks any merge answer — so the
 *  run keeps only its latest. Anything between the two that moves the PR
 *  (a check, the PR opening, merging or closing, a reopen) keeps both. */
const replacesLastMerge = (
  events: ReadonlyArray<WorkEvent>,
  event: WorkEvent,
): number => {
  if (event.kind !== "merge-state") return -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const one = events[index];
    if (one === undefined) return -1;
    switch (one.kind) {
      case "merge-state": {
        if (one.pr !== event.pr || !sameHead(one.head, event.head)) return -1;
        // The check reading it was recorded under: the last check event
        // before it, which must be this commit's checks running.
        for (let back = index - 1; back >= 0; back -= 1) {
          const earlier = events[back];
          if (earlier === undefined) return -1;
          if (isCheckEvent(earlier))
            return earlier.kind === "checks-running" &&
              earlier.pr === event.pr &&
              sameHead(earlier.head, event.head)
              ? index
              : -1;
          if (MOVES_A_PR.has(earlier.kind)) return -1;
        }
        return -1;
      }
      default:
        if (isCheckEvent(one) || MOVES_A_PR.has(one.kind)) return -1;
    }
  }
  return -1;
};

/** The events that move a PR other than its checks and merge answers. A
 *  draft flip is one: it is somebody's act, so it is neither bounded nor ever
 *  replaced, and the merge answer after it is a new one. */
const MOVES_A_PR: ReadonlySet<string> = new Set([
  "pr-opened",
  "draft-state",
  "merged",
  "pr-closed",
  "reopened",
]);

/** HOW MANY CHECK RESULTS, AND HOW MANY MERGE ANSWERS, ONE COMMIT KEEPS. A
 *  commit's checks change a few times — the quick ones pass, the real run
 *  starts, it fails, a re-run passes — and two suites reporting out of phase
 *  would otherwise write a row per poll (juspay/kolu#2376's shape). GitHub
 *  recomputes its merge answer every time the base moves (`unsettled`, then
 *  `can` again), on a work that may sit for days. */
export const PR_FACTS_PER_COMMIT = 8;

/** THE ROW A NEW CHECK RESULT OR MERGE ANSWER CROWDS OUT, if its commit
 *  already holds {@link PR_FACTS_PER_COMMIT} of that kind: the oldest one
 *  between the commit's first and its newest. Never the newest — it is the
 *  word the work reads now, and the time since it (a green PR waiting on a
 *  person) is filed by it — and never the first, which says when the commit's
 *  checks, or GitHub's answers, began. What goes is a flip in the middle that
 *  a later one already superseded. */
const crowdedOut = (
  events: ReadonlyArray<WorkEvent>,
  event: WorkEvent,
): number => {
  if (!isCheckEvent(event) && event.kind !== "merge-state") return -1;
  const factOf = (one: WorkEvent) => (isCheckEvent(one) ? "check" : one.kind);
  const mine = events.flatMap((one, index) =>
    (isCheckEvent(one) || one.kind === "merge-state") &&
    factOf(one) === factOf(event) &&
    one.pr === event.pr &&
    sameHead(one.head, event.head)
      ? [index]
      : [],
  );
  return mine.length >= PR_FACTS_PER_COMMIT ? (mine[1] ?? -1) : -1;
};

/** THE ONE APPEND. Every transition in this module goes through it, so the
 *  bounds cannot be forgotten by a caller or by a transition added later:
 *  agent states fold past {@link AGENT_STATES_KEPT} (a stop that let go of
 *  the work never does), a merge answer given
 *  while its commit's checks run replaces the last one
 *  ({@link replacesLastMerge}), and a commit's check results or merge answers
 *  past {@link PR_FACTS_PER_COMMIT} lose one from the middle
 *  ({@link crowdedOut}). */
const append = (work: Work, event: WorkEvent): Work => {
  const merge = replacesLastMerge(work.events, event);
  if (merge >= 0)
    return {
      ...work,
      events: [
        ...work.events.slice(0, merge),
        ...work.events.slice(merge + 1),
        event,
      ],
    };
  const events = [...work.events, event];
  const crowded = crowdedOut(work.events, event);
  if (crowded >= 0) events.splice(crowded, 1);
  if (AGENT_STATE.has(event.kind)) {
    const folds = foldable(events);
    let states = events.filter(folds).length;
    while (states > AGENT_STATES_KEPT) {
      foldOldest(events, folds);
      states -= 1;
    }
  }
  return { ...work, events };
};

/** A new work, opened on the human's request — the words kolu saw them send,
 *  or none when it was opened off something else.
 *
 *  It is OPEN: there is no arm of {@link Work.state} a newly opened work
 *  could be in that is not. */
export const openWork = (opened: {
  readonly key: Work["key"];
  readonly title: string;
  readonly at: string;
  readonly request: RequestWords;
}): Work => ({
  key: opened.key,
  title: opened.title,
  startedAt: opened.at,
  decisions: [],
  events: [
    {
      at: opened.at,
      by: "you",
      kind: "requested",
      about: ABOUT_WORK,
      request: opened.request,
    },
  ],
  state: { kind: "open" },
  // Git has not been asked where its branch is checked out yet.
  worktree: { kind: "unread" },
});

/** WHERE THE WORK IS WORKING, as git last answered it for the work's own key
 *  — the one writer's step. An answer equal to what the work holds hands the
 *  same work back. For a branch work the answer is git's, asked by the key
 *  (the branch's checkout, or none); for a watch, it is the watched terminal's
 *  own folder. Never a member's: a member may stand anywhere. */
export const recordWorktree = (work: Work, worktree: WorkWorktree): Work => {
  const held = work.worktree;
  if (held.kind === worktree.kind) {
    if (held.kind !== "at") return work;
    if (worktree.kind === "at" && worktree.path === held.path) return work;
  }
  return { ...work, worktree };
};

/** WHAT THE REQUEST ALREADY SAID for a setup question — nothing, so the human
 *  is asked, or the value they gave, recorded as answered from the request
 *  and asked of nobody. */
export type Given<V extends string> =
  | { readonly kind: "ask" }
  | { readonly kind: "given"; readonly value: V };

/** One question as it is put, by what it is about. A setup question may
 *  carry what the request already {@link Given | gave}; a question kolu draws
 *  the options for carries none, and its given value was checked against
 *  kolu's own options before it got here. A question about the work is
 *  always asked. */
export type Question = { readonly id: string; readonly question: string } & (
  | {
      /** The two setup questions kolu offers words for. The options are
       *  narrowed to those words where the question is written down
       *  ({@link askedOf}), so no caller has to narrow them twice. */
      readonly topic: "setup";
      readonly key: "mode" | "on-green";
      readonly options: ReadonlyArray<string>;
      readonly given: Given<string>;
    }
  | {
      readonly topic: "setup";
      readonly key: KoluChoiceKey;
      readonly given: Given<string>;
    }
  | {
      readonly topic: "work";
      readonly header: Header;
      readonly options: ReadonlyArray<string>;
      readonly multiple: boolean;
      readonly file: QuestionFile;
    }
);

/** Whether a question is put to the human, rather than answered by the
 *  request. */
export const isPut = (one: Question): boolean =>
  one.topic === "work" || one.given.kind === "ask";

/** Questions put to the human in ONE ask. A `question` event is appended
 *  only when something is actually being asked — an ask whose every answer
 *  was given is a set of decisions the request made. */
export const askQuestions = (
  work: Work,
  asked: {
    readonly ask: string;
    readonly questions: ReadonlyArray<Question>;
    readonly at: string;
  },
): Work => {
  const decisions: Decision[] = [...work.decisions];
  for (const one of asked.questions) {
    const asking = askedOf(one, asked.ask, asked.at);
    if (one.topic === "work" || one.given.kind === "ask") {
      decisions.push(asking);
      continue;
    }
    const given = one.given.value;
    decisions.push(
      Option.getOrThrowWith(
        answeredWith(asking, asked.at, "request", [given]),
        () =>
          new Error(
            `askQuestions: ${one.key} was given ${JSON.stringify(given)}, which is no answer to it — the caller checks a given value before it gets here`,
          ),
      ),
    );
  }
  const asking = { ...work, decisions };
  return asked.questions.some(isPut)
    ? append(asking, {
        at: asked.at,
        by: "agent",
        kind: "question",
        about: ABOUT_WORK,
        ask: asked.ask,
      })
    : asking;
};

/** What a face sent for ONE question — values judged by the question's own
 *  options (a value among them is a pick), or the one answer the person typed
 *  to one of kolu's own questions ({@link TypedAnswer}), which is never read
 *  as a pick. */
export type SentAnswer = ReadonlyArray<string> | TypedAnswer;

/** The one value `sent` gives a single-answer question — the first non-empty
 *  value, or the words typed — none when it gives none. */
export const sentValue = (sent: SentAnswer): Option.Option<string> =>
  "typed" in sent
    ? Option.liftPredicate(sent.typed.trim(), (text) => text !== "")
    : Arr.findFirst(sent, (value) => value !== "");

/** WHAT THE HUMAN DID WITH ONE ASK: declined the whole of it, or answered
 *  with what was sent per question id. */
export type AskReply =
  | { readonly kind: "declined" }
  | {
      readonly kind: "answered";
      readonly values: ReadonlyMap<string, SentAnswer>;
    };

/** The human's reply to one ask.
 *
 *  A DECLINE settles every question still open in it. An ANSWER settles the
 *  questions it gives a value for and LEAVES THE REST ASKED: a question left
 *  blank is not answered, it is still a question, in the same ask, on every
 *  face — so "still to be asked" needs no second rule. The event says which:
 *  `answered` once nothing in the ask is open, `answered-part` while
 *  something is. A reply that settles nothing changes nothing. */
export const answerAsk = (
  work: Work,
  answered: {
    readonly ask: string;
    readonly at: string;
    readonly from: AnsweredFromFace;
    readonly reply: AskReply;
  },
): Work => {
  let moved = false;
  const decisions = work.decisions.map((one): Decision => {
    if (one.ask !== answered.ask || one.kind === "settled") return one;
    const settledAs =
      answered.reply.kind === "declined"
        ? Option.some(
            settle(one, {
              how: "declined",
              at: answered.at,
              from: answered.from,
            }),
          )
        : Option.flatMap(
            Option.fromUndefinedOr(answered.reply.values.get(one.id)),
            (values) => answeredWith(one, answered.at, answered.from, values),
          );
    if (Option.isNone(settledAs)) return one;
    moved = true;
    return settledAs.value;
  });
  if (!moved) return work;
  const next = { ...work, decisions };
  return append(next, {
    at: answered.at,
    by: "you",
    kind: hasOpenAsk(next, answered.ask) ? "answered-part" : "answered",
    about: ABOUT_WORK,
    ask: answered.ask,
  });
};

/** A question as it is first written down: asked, in the shape its topic
 *  says — a question kolu draws the options for has none to write. */
const askedOf = (one: Question, ask: string, at: string): Asked => {
  const common = { id: one.id, ask, at, question: one.question };
  switch (one.topic) {
    case "work":
      return {
        ...common,
        kind: "asked",
        topic: "work",
        header: one.header,
        options: [...one.options],
        multiple: one.multiple,
        file: one.file,
      };
    case "setup":
      switch (one.key) {
        case "mode":
          return {
            ...common,
            kind: "asked",
            topic: "setup",
            key: "mode",
            options: one.options.filter(isWorkMode),
          };
        case "on-green":
          return {
            ...common,
            kind: "asked",
            topic: "setup",
            key: "on-green",
            options: one.options.filter(isOnGreen),
          };
        default:
          return { ...common, kind: "asked", topic: "setup", key: one.key };
      }
    default:
      return one satisfies never;
  }
};

/** An asked decision, settled WITHOUT a value — declined or dropped, which
 *  every shape of question may be. */
const settle = (
  one: Asked,
  answer:
    | {
        readonly how: "declined";
        readonly at: string;
        readonly from: AnsweredFromFace;
      }
    | { readonly how: "dropped"; readonly at: string },
): Settled => ({ ...one, kind: "settled", answer });

/** What was said to a question about the work: a value among its options is
 *  a PICK, anything else is words typed — or none, when neither is there. */
const saidOf = (
  options: ReadonlyArray<string>,
  values: ReadonlyArray<string>,
): Option.Option<Said> => {
  const picked = values.filter((value) => options.includes(value));
  const typed = values
    .filter((value) => !options.includes(value))
    .join("\n")
    .trim();
  if (Arr.isReadonlyArrayNonEmpty(picked))
    return Option.some(
      typed === ""
        ? { kind: "picked", picked }
        : { kind: "picked-and-typed", picked, text: typed },
    );
  return typed === ""
    ? Option.none()
    : Option.some({ kind: "typed", text: typed });
};

/** AN ASKED DECISION, ANSWERED WITH WHAT WAS SENT — or none, when it gives
 *  the question no value, which leaves it asked. A question kolu drew the
 *  options for has ONE answer, already checked where it arrived
 *  (`unofferedAnswers`), and records how it was chosen: typed when the person
 *  typed it, picked otherwise; the mode and what to do on green are kolu's
 *  own words or no answer; for a question about the work a value among its
 *  options is a PICK and anything else is words typed. */
export const answeredWith = (
  one: Asked,
  at: string,
  from: AnswerFrom,
  sent: SentAnswer,
): Option.Option<Settled> => {
  if (one.topic === "work")
    return Option.map(
      "typed" in sent
        ? Option.map(sentValue(sent), (text): Said => ({ kind: "typed", text }))
        : saidOf(one.options, sent),
      (said): Settled => ({
        ...one,
        kind: "settled",
        answer: { how: "answered", at, from, said },
      }),
    );
  const given = sentValue(sent);
  if (Option.isNone(given)) return Option.none();
  const value = given.value;
  switch (one.key) {
    case "mode":
      return isWorkMode(value)
        ? Option.some({
            ...one,
            kind: "settled",
            answer: { how: "answered", at, from, value },
          })
        : Option.none();
    case "on-green":
      return isOnGreen(value)
        ? Option.some({
            ...one,
            kind: "settled",
            answer: { how: "answered", at, from, value },
          })
        : Option.none();
    default:
      return Option.some({
        ...one,
        kind: "settled",
        answer: {
          how: "answered",
          at,
          from,
          value,
          chosen: "typed" in sent ? "typed" : "picked",
        },
      });
  }
};

/** An ask that went away unanswered: the conversation that asked it is gone
 *  (a restart, a cleared conversation, a cancelled turn). */
export const dropAsk = (work: Work, ask: string, at: string): Work => {
  let dropped = false;
  const decisions = work.decisions.map((one): Decision => {
    if (one.ask !== ask || one.kind === "settled") return one;
    dropped = true;
    return settle(one, { how: "dropped", at });
  });
  if (!dropped) return work;
  return append(
    { ...work, decisions },
    { at, by: "kolu", kind: "question-dropped", about: ABOUT_WORK, ask },
  );
};

/** SOME QUESTIONS that went away unanswered, by decision id — a setup
 *  question a newer form asks again. Each ask they leave with nothing open is
 *  dropped on the timeline the way a whole ask is; an ask with something
 *  still open stays open. */
export const dropQuestions = (
  work: Work,
  ids: ReadonlySet<string>,
  at: string,
): Work => {
  const asks = new Set<string>();
  const decisions = work.decisions.map((one): Decision => {
    if (!ids.has(one.id) || one.kind === "settled") return one;
    asks.add(one.ask);
    return settle(one, { how: "dropped", at });
  });
  return [...asks]
    .filter(
      (ask) =>
        !decisions.some((one) => one.ask === ask && one.kind === "asked"),
    )
    .reduce<Work>(
      (next, ask) =>
        append(next, {
          at,
          by: "kolu",
          kind: "question-dropped",
          about: ABOUT_WORK,
          ask,
        }),
      { ...work, decisions },
    );
};

/** Whether this ask has a question still waiting on the human. */
export const hasOpenAsk = (work: Work, ask: string): boolean =>
  work.decisions.some((one) => one.ask === ask && one.kind === "asked");

/** THE ASKS STILL WAITING ON THE HUMAN, in the order they were asked —
 *  derived from the decisions and stored nowhere, which is why a second list
 *  of open asks cannot disagree with them. */
export const openAsks = (work: Work): ReadonlyArray<string> => [
  ...new Set(
    work.decisions.filter((one) => one.kind === "asked").map((one) => one.ask),
  ),
];

/** A terminal joined the work in a role — the EVENT. The member row itself is
 *  the store's (`./store.ts`), which is what makes "this terminal is in one
 *  work" structural. */
export const joinWork = (
  work: Work,
  joined: {
    readonly terminal: string;
    readonly role: WorkRole;
    readonly at: string;
  },
): Work =>
  append(work, {
    at: joined.at,
    by: "kolu",
    kind: "joined",
    about: aboutMember(joined.terminal),
    role: joined.role,
  });

/** A member left: its terminal was closed, released, or went away. The row is
 *  removed by the store; this is the line on the timeline. */
export const leaveWork = (
  work: Work,
  left: {
    readonly terminal: string;
    readonly why: "closed" | "released" | "gone";
    readonly at: string;
  },
): Work =>
  append(work, {
    at: left.at,
    by: "kolu",
    kind: "left",
    about: aboutMember(left.terminal),
    why: left.why,
  });

/** THE EVENTS THAT ARE ONLY OBSERVATIONS — every kind but the ones a
 *  transition of its own appends: an ending ({@link endWork}, {@link prEnded}),
 *  a reopening, a member joining or leaving, files kept or not kept, a take
 *  over or a hand back, a fold, the request. Appending one of those bare would
 *  record a move the work did not make. */
export type RecordableEvent = Exclude<
  WorkEvent,
  {
    readonly kind:
      | "ended"
      | "reopened"
      | "joined"
      | "left"
      | "kept"
      | "keep-failed"
      | "taken-over"
      | "handed-back"
      | "folded"
      | "hand-offs-kept"
      | "requested"
      | "merged"
      | "pr-closed";
  }
>;

/** Append one observation. */
export const recordEvent = (work: Work, event: RecordableEvent): Work =>
  append(work, event);

/** THE FORGE SAYS THE WORK'S PR MERGED, OR WAS CLOSED — the event on the
 *  timeline and the ending, in one step, both naming the number the timeline
 *  reads ({@link prOf}): the outcome's PR cannot differ from the timeline's.
 *  A work with no PR on its timeline is returned unchanged. */
export const prEnded = (
  work: Work,
  how: "merged" | "closed",
  at: string,
): Work =>
  Option.match(prOf(work), {
    onNone: () => work,
    onSome: (pr) =>
      ended(
        append(
          work,
          how === "merged"
            ? {
                at,
                by: "kolu",
                kind: "merged",
                about: ABOUT_WORK,
                pr: pr.number,
              }
            : {
                at,
                by: "kolu",
                kind: "pr-closed",
                about: ABOUT_WORK,
                pr: pr.number,
              },
        ),
        { outcome: { kind: how, pr: pr.number }, at },
      ),
  });

/** A PR'S ADDRESS, LEARNED LATE: a `pr-opened` recorded before kolu kept the
 *  address (the 1.57.0 rung's `unrecorded`) takes the one the forge now gives.
 *  Nothing else about the event moves, and a recorded address is never
 *  replaced. The same work back when there is nothing to learn. */
export const linkPr = (work: Work, pr: number, href: string): Work => {
  const at = work.events.findIndex(
    (one) =>
      one.kind === "pr-opened" &&
      one.pr === pr &&
      one.url.kind === "unrecorded",
  );
  const opened = work.events[at];
  if (opened === undefined || opened.kind !== "pr-opened") return work;
  const events = [...work.events];
  events[at] = { ...opened, url: { kind: "link", href } };
  return { ...work, events };
};

/** THE PERSON TOOK THE KEYS to a member terminal: from here on it is theirs
 *  to type into and the Conductor keeps its hands off, until they hand it
 *  back. */
export const takeOver = (work: Work, terminal: string, at: string): Work =>
  append(work, {
    at,
    by: "you",
    kind: "taken-over",
    about: aboutMember(terminal),
  });

/** ... and gave them back. */
export const handBack = (work: Work, terminal: string, at: string): Work =>
  append(work, {
    at,
    by: "you",
    kind: "handed-back",
    about: aboutMember(terminal),
  });

/** HOW A WORK IS STOPPED — the one ending a person, the Conductor or kolu
 *  writes. A merge or a close is the forge's, and goes through
 *  {@link prEnded}, which names the timeline's own PR. */
export type Stopped = Extract<Outcome, { readonly kind: "stopped" }>;

/** THE WORK IS STOPPED — by you, the Conductor, or kolu. Ending an ended
 *  work changes nothing.
 *
 *  The caller removes its members in the same step: there is no arm of this
 *  function that leaves a finished work with terminals, because there is
 *  nowhere in the record for them to be. */
export const endWork = (
  work: Work,
  stopped: { readonly outcome: Stopped; readonly at: string },
): Work => ended(work, stopped);

/** THE ENDING ITSELF, any outcome — reached only through {@link endWork}
 *  and {@link prEnded}. */
const ended = (
  work: Work,
  end: { readonly outcome: Outcome; readonly at: string },
): Work => {
  if (work.state.kind === "ended") return work;
  return append(
    {
      ...work,
      state: { kind: "ended", at: end.at, outcome: end.outcome, kept: [] },
    },
    {
      at: end.at,
      by: "kolu",
      kind: "ended",
      about: ABOUT_WORK,
      outcome: end.outcome,
    },
  );
};

/** THE WORK IS BEING DONE AGAIN — it was opened again, or the forge says its
 *  PR is open after all. Decisions and timeline are kept whole: this is the
 *  same work, and the only thing that moves is the state. Reopening an open
 *  work changes nothing. */
export const reopenWork = (work: Work, at: string): Work => {
  if (work.state.kind === "open") return work;
  return append(
    { ...work, state: { kind: "open" } },
    { at, by: "kolu", kind: "reopened", about: ABOUT_WORK },
  );
};

/** The files copied when the work ended. Only an ENDED work has anywhere to
 *  put them, so an open one is returned untouched. */
export const keepFiles = (
  work: Work,
  kept: { readonly files: ReadonlyArray<KeptFile>; readonly at: string },
): Work => {
  if (work.state.kind !== "ended") return work;
  return append(
    { ...work, state: { ...work.state, kept: [...kept.files] } },
    {
      at: kept.at,
      by: "kolu",
      kind: "kept",
      about: ABOUT_WORK,
      count: kept.files.length,
    },
  );
};

/** Copying the files failed — said on the timeline rather than swallowed. */
export const keepFailed = (work: Work, why: string, at: string): Work =>
  append(work, { at, by: "kolu", kind: "keep-failed", about: ABOUT_WORK, why });
