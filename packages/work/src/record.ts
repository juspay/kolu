/**
 * HOW A WORK CHANGES — every transition, as a pure function of the record.
 *
 * Each takes a work and answers the work it becomes: nothing here reads a
 * clock, a filesystem or a host, and nothing mutates what it was given. The
 * timeline is append-only and BOUNDED here, in the one `append` below, so a
 * transition added later cannot forget the bound.
 *
 * MEMBERSHIP IS NOT HERE any more. A member is a row in the one map keyed by
 * terminal (`./store.ts`), so joining and leaving are a map movement plus the
 * event this module appends — and a work can no longer carry a member of its
 * own that disagrees with that map.
 */

import type {
  AnswerFrom,
  Decision,
  EventKind,
  KeptFile,
  Outcome,
  SetupKey,
  Work,
  WorkEvent,
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
  const at = events.findIndex((one) => AGENT_STATE.has(one.kind));
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
    terminal: null,
    count: 1,
  });
};

/** THE ONE APPEND. Every transition in this module goes through it, so the
 *  bound cannot be forgotten by a caller or by a transition added later. */
const append = (work: Work, event: WorkEvent): Work => {
  const events = [...work.events, event];
  if (AGENT_STATE.has(event.kind)) {
    let states = events.filter((one) => AGENT_STATE.has(one.kind)).length;
    while (states > AGENT_STATES_KEPT) {
      foldOldest(events);
      states -= 1;
    }
  }
  return { ...work, events };
};

/** A new work, opened on the human's request. `request` is the words kolu
 *  saw the human send ("" when the work was opened off something else).
 *
 *  It is OPEN: there is no arm of {@link Work.state} a newly opened work
 *  could be in that is not. */
export const openWork = (opened: {
  readonly key: Work["key"];
  readonly title: string;
  readonly at: string;
  readonly request: string;
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
      terminal: null,
      text: opened.request,
    },
  ],
  state: { kind: "open" },
});

/** One question as the Conductor asks it. `given` is an answer the human's
 *  request already carried: it is RECORDED as a decision answered from the
 *  request, and nobody is asked. */
export interface Question {
  readonly id: string;
  readonly key: SetupKey | null;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  readonly multiple: boolean;
  readonly file: string;
  readonly given?: string | undefined;
}

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
  let open = false;
  for (const one of asked.questions) {
    const common = {
      id: one.id,
      ask: asked.ask,
      at: asked.at,
      key: one.key,
      header: one.header,
      question: one.question,
      options: [...one.options],
      multiple: one.multiple,
      file: one.file,
    };
    if (one.given === undefined) {
      open = true;
      decisions.push({ kind: "asked", ...common });
      continue;
    }
    decisions.push({
      kind: "answered",
      ...common,
      answer: {
        at: asked.at,
        how: "answered",
        picked: one.options.includes(one.given) ? [one.given] : [],
        text: one.options.includes(one.given) ? null : one.given,
        from: "request",
      },
    });
  }
  const asking = { ...work, decisions };
  return open
    ? append(asking, {
        at: asked.at,
        by: "agent",
        kind: "question",
        terminal: null,
        ask: asked.ask,
      })
    : asking;
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
    if (one.ask !== answered.ask || one.kind === "answered") return one;
    if (answered.values === null)
      return {
        ...one,
        kind: "answered",
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
      kind: "answered",
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
      ask: answered.ask,
    },
  );
};

/** An ask that went away unanswered: the conversation that asked it is gone
 *  (a restart, a cleared conversation, a cancelled turn). */
export const dropAsk = (work: Work, ask: string, at: string): Work => {
  let dropped = false;
  const decisions = work.decisions.map((one): Decision => {
    if (one.ask !== ask || one.kind === "answered") return one;
    dropped = true;
    return {
      ...one,
      kind: "answered",
      answer: { at, how: "dropped", picked: [], text: null, from: null },
    };
  });
  if (!dropped) return work;
  return append(
    { ...work, decisions },
    { at, by: "kolu", kind: "question-dropped", terminal: null, ask },
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
    terminal: joined.terminal,
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
    terminal: left.terminal,
    why: left.why,
  });

/** Append one observation. */
export const recordEvent = (work: Work, event: WorkEvent): Work =>
  append(work, event);

/** THE PERSON TOOK THE KEYS to a member terminal: from here on it is theirs
 *  to type into and the Conductor keeps its hands off, until they hand it
 *  back. */
export const takeOver = (work: Work, terminal: string, at: string): Work =>
  append(work, { at, by: "you", kind: "taken-over", terminal });

/** ... and gave them back. */
export const handBack = (work: Work, terminal: string, at: string): Work =>
  append(work, { at, by: "you", kind: "handed-back", terminal });

/** THE WORK ENDS — the forge said its PR merged or closed, or somebody
 *  stopped it. Ending an ended work changes nothing.
 *
 *  The caller removes its members in the same step: there is no arm of this
 *  function that leaves a finished work with terminals, because there is
 *  nowhere in the record for them to be. */
export const endWork = (
  work: Work,
  ended: { readonly outcome: Outcome; readonly at: string },
): Work => {
  if (work.state.kind === "ended") return work;
  return append(
    {
      ...work,
      state: { kind: "ended", at: ended.at, outcome: ended.outcome, kept: [] },
    },
    {
      at: ended.at,
      by: "kolu",
      kind: "ended",
      terminal: null,
      outcome: ended.outcome,
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
    { at, by: "kolu", kind: "reopened", terminal: null },
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
      terminal: null,
      count: kept.files.length,
    },
  );
};

/** Copying the files failed — said on the timeline rather than swallowed. */
export const keepFailed = (work: Work, why: string, at: string): Work =>
  append(work, { at, by: "kolu", kind: "keep-failed", terminal: null, why });
