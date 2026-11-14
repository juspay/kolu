/**
 * HOW A WORK CHANGES — every transition, as a pure function of the record.
 *
 * The record only grows — with ONE bound, stated here and nowhere else: a work
 * whose agent stops and starts for days would otherwise carry thousands of
 * agent-state events, in `config.json` and on every browser's wire. Past
 * {@link AGENT_STATES_KEPT} of them the oldest is dropped and COUNTED into one
 * `folded` event sitting where it sat, so the timeline still says the time
 * passed and what happened in it is no longer claimed to be remembered.
 * Everything else — questions, answers, files, the PR, membership, who is
 * driving, the end — is never folded, which is what lets a reader trust the
 * timeline it is drawn from.
 */

import type {
  AnswerFrom,
  Decision,
  EventKind,
  KeptFile,
  SetupKey,
  Work,
  WorkEvent,
  WorkOutcome,
  WorkRole,
} from "./schema.ts";

/** HOW A TERMINAL'S AGENT STANDS, as events — the only kinds a work produces
 *  over and over for as long as it runs, and so the only ones bounded. */
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
 *  `folded` event keeps the count of the ones that went. */
export const AGENT_STATES_KEPT = 30;

/** Drop the oldest agent-state event and count it into the work's ONE `folded`
 *  event — created, on the first fold, exactly where that event sat, so the
 *  timeline's order still says when the folded stretch happened. Mutates the
 *  array the append above has already copied. */
const foldOldest = (events: Array<WorkEvent>): void => {
  const oldest = events.findIndex((one) => AGENT_STATE.has(one.kind));
  const removed = events[oldest];
  if (removed === undefined) return;
  events.splice(oldest, 1);
  const folded = events.findIndex((one) => one.kind === "folded");
  const standing = events[folded];
  if (standing !== undefined) {
    events[folded] = {
      ...standing,
      detail: String(Number(standing.detail) + 1),
    };
    return;
  }
  events.splice(oldest, 0, {
    at: removed.at,
    by: "kolu",
    kind: "folded",
    terminal: null,
    detail: "1",
  });
};

/** THE ONE APPEND. Every transition in this module goes through it, so the
 *  bound cannot be forgotten by a caller or by a transition added later. */
const append = (work: Work, event: WorkEvent): Work => {
  const events = [...work.events, event];
  if (AGENT_STATE.has(event.kind)) {
    let kept = 0;
    for (const one of events) if (AGENT_STATE.has(one.kind)) kept += 1;
    // A loop rather than an `if`: a record restored from a file written by an
    // older kolu can be over the bound by more than one.
    while (kept > AGENT_STATES_KEPT) {
      foldOldest(events);
      kept -= 1;
    }
  }
  return { ...work, events };
};

/** A new work, opened on the human's request. `request` is the words kolu
 *  saw the human send ("" when the work was opened off something else). */
export const openWork = (opened: {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly branch: string;
  readonly at: string;
  readonly request: string;
}): Work => ({
  id: opened.id,
  title: opened.title,
  repo: opened.repo,
  branch: opened.branch,
  members: [],
  events: [
    {
      at: opened.at,
      by: "you",
      kind: "requested",
      terminal: null,
      detail: opened.request,
    },
  ],
  decisions: [],
  startedAt: opened.at,
  endedAt: null,
  outcome: null,
  keptFiles: [],
});

/** One question as the Conductor asks it. `given` is an answer the human's
 *  request already carried: it is RECORDED as a decision answered from the
 *  request, and nobody is asked. */
export interface Question {
  readonly id: string;
  readonly key: SetupKey | null;
  /** The question's short header — the label the decision is drawn under.
   *  `""` for a setup question (its key names it) and for an asker that gave
   *  none. */
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly multiple: boolean;
  readonly given?: string | undefined;
}

/** Questions put to the human in ONE ask. A `question` event is appended
 *  only when something is actually being asked — an ask whose every answer
 *  was given is a set of decisions the request made. */
export const askQuestions = (
  work: Work,
  asked: {
    readonly ask: string;
    readonly at: string;
    readonly questions: ReadonlyArray<Question>;
  },
): Work => {
  const decisions: Decision[] = asked.questions.map((one) => ({
    id: one.id,
    ask: asked.ask,
    at: asked.at,
    key: one.key,
    header: one.header,
    question: one.question,
    options: [...one.options],
    multiple: one.multiple,
    answer:
      one.given === undefined
        ? null
        : {
            at: asked.at,
            how: "answered",
            picked: one.options.includes(one.given) ? [one.given] : [],
            text: one.options.includes(one.given) ? null : one.given,
            from: "request",
          },
  }));
  const withDecisions: Work = {
    ...work,
    decisions: [...work.decisions, ...decisions],
  };
  return decisions.some((one) => one.answer === null)
    ? append(withDecisions, {
        at: asked.at,
        by: "agent",
        kind: "question",
        terminal: null,
        detail: asked.ask,
      })
    : withDecisions;
};

/** The human's answer to one ask, per question id. A value among the
 *  question's options is a PICK; anything else is text they typed. Questions
 *  of the ask the answer does not mention are answered with nothing picked. */
export const answerAsk = (
  work: Work,
  answered: {
    readonly ask: string;
    readonly at: string;
    readonly from: AnswerFrom | null;
    /** `null` declines the whole ask. */
    readonly values: ReadonlyMap<string, ReadonlyArray<string>> | null;
  },
): Work => {
  if (!hasOpenAsk(work, answered.ask)) return work;
  const decisions = work.decisions.map((one): Decision => {
    if (one.ask !== answered.ask || one.answer !== null) return one;
    if (answered.values === null)
      return {
        ...one,
        answer: {
          at: answered.at,
          how: "declined",
          picked: [],
          text: null,
          from: answered.from,
        },
      };
    const values = answered.values.get(one.id) ?? [];
    const picked = values.filter((value) => one.options.includes(value));
    const typed = values
      .filter((value) => !one.options.includes(value))
      .join("\n")
      .trim();
    return {
      ...one,
      answer: {
        at: answered.at,
        how: "answered",
        picked,
        text: typed === "" ? null : typed,
        from: answered.from,
      },
    };
  });
  return append(
    { ...work, decisions },
    {
      at: answered.at,
      by: "you",
      kind: "answered",
      terminal: null,
      detail: answered.ask,
    },
  );
};

/** An ask that went away unanswered: the conversation that asked it is gone
 *  (a restart, a cleared conversation, a cancelled turn). */
export const dropAsk = (work: Work, ask: string, at: string): Work => {
  if (!hasOpenAsk(work, ask)) return work;
  return append(
    {
      ...work,
      decisions: work.decisions.map((one) =>
        one.ask === ask && one.answer === null
          ? {
              ...one,
              answer: {
                at,
                how: "dropped",
                picked: [],
                text: null,
                from: null,
              },
            }
          : one,
      ),
    },
    { at, by: "kolu", kind: "question-dropped", terminal: null, detail: ask },
  );
};

/** Whether this ask has a question still waiting on the human. */
export const hasOpenAsk = (work: Work, ask: string): boolean =>
  work.decisions.some((one) => one.ask === ask && one.answer === null);

/** The asks still waiting on the human, in the order they were asked. */
export const openAsks = (work: Work): ReadonlyArray<string> => [
  ...new Set(
    work.decisions.filter((one) => one.answer === null).map((one) => one.ask),
  ),
];

/** A terminal joins the work in a role. A terminal already an ACTIVE member
 *  is left as it is: the role it was given first is the role it has. */
export const joinWork = (
  work: Work,
  joined: {
    readonly terminal: string;
    readonly role: WorkRole;
    readonly at: string;
  },
): Work => {
  if (activeMember(work, joined.terminal) !== undefined) return work;
  return append(
    {
      ...work,
      members: [
        ...work.members,
        {
          terminal: joined.terminal,
          role: joined.role,
          joinedAt: joined.at,
          leftAt: null,
          worktree: null,
        },
      ],
    },
    {
      at: joined.at,
      by: "kolu",
      kind: "joined",
      terminal: joined.terminal,
      detail: joined.role,
    },
  );
};

/** WHERE A MEMBER IS WORKING, as the first reading that said it. Nothing is
 *  appended to the timeline — a worktree is not something that HAPPENED, it is
 *  where everything else did — and the first answer sticks: a terminal is in
 *  one worktree for the life of its membership, and the path has to outlive
 *  the terminal for the work's files to be found when it ends. */
export const sawWorktree = (
  work: Work,
  terminal: string,
  worktree: string,
): Work => {
  const member = activeMember(work, terminal);
  if (member === undefined || member.worktree !== null) return work;
  return {
    ...work,
    members: work.members.map((one) =>
      one.terminal === terminal && one.leftAt === null
        ? { ...one, worktree }
        : one,
    ),
  };
};

/** A member leaves: its terminal was closed, released, or went away. */
export const leaveWork = (
  work: Work,
  left: {
    readonly terminal: string;
    readonly at: string;
    readonly why: "closed" | "released" | "gone";
  },
): Work => {
  if (activeMember(work, left.terminal) === undefined) return work;
  return append(
    {
      ...work,
      members: work.members.map((one) =>
        one.terminal === left.terminal && one.leftAt === null
          ? { ...one, leftAt: left.at }
          : one,
      ),
    },
    {
      at: left.at,
      by: "kolu",
      kind: "left",
      terminal: left.terminal,
      detail: left.why,
    },
  );
};

/** The member a terminal is right now, if it is one. */
export const activeMember = (work: Work, terminal: string) =>
  work.members.find((one) => one.terminal === terminal && one.leftAt === null);

/** Whether every member that ever joined has left — the work has nobody
 *  doing it. A work nobody has joined yet is NOT deserted: it is starting. */
export const deserted = (work: Work): boolean =>
  work.members.length > 0 && work.members.every((one) => one.leftAt !== null);

/** Append one observation. */
export const recordEvent = (work: Work, event: WorkEvent): Work =>
  append(work, event);

/** THE PERSON TOOK THE KEYS to a member terminal: from here on it is theirs
 *  to type into and the Conductor keeps its hands off, until
 *  {@link handBack}. Stated as an event rather than a flag so it is read the
 *  way everything else about a work is ({@link driverOf}), survives a restart
 *  with the record, and ends by itself when the member leaves or the work
 *  does. The caller refuses the cases this cannot see (not a driven member,
 *  already in that state).  */
export const takeOver = (work: Work, terminal: string, at: string): Work =>
  append(work, { at, by: "you", kind: "taken-over", terminal, detail: "" });

/** ... and gave them back. */
export const handBack = (work: Work, terminal: string, at: string): Work =>
  append(work, { at, by: "you", kind: "handed-back", terminal, detail: "" });

/** The work ends. Ending an ended work changes nothing. */
export const endWork = (
  work: Work,
  ended: { readonly outcome: WorkOutcome; readonly at: string },
): Work => {
  if (work.endedAt !== null) return work;
  return append(
    { ...work, endedAt: ended.at, outcome: ended.outcome },
    {
      at: ended.at,
      by: "kolu",
      kind: "ended",
      terminal: null,
      detail: ended.outcome,
    },
  );
};

/** The files copied when the work ended. */
export const keepFiles = (
  work: Work,
  kept: { readonly files: ReadonlyArray<KeptFile>; readonly at: string },
): Work =>
  append(
    { ...work, keptFiles: [...kept.files] },
    {
      at: kept.at,
      by: "kolu",
      kind: "kept",
      terminal: null,
      detail: String(kept.files.length),
    },
  );

/** Copying the files failed — said on the timeline rather than swallowed. */
export const keepFailed = (work: Work, why: string, at: string): Work =>
  append(work, {
    at,
    by: "kolu",
    kind: "keep-failed",
    terminal: null,
    detail: why,
  });
