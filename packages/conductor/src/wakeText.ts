/**
 * WHAT THE AGENT IS ACTUALLY HANDED when kolu wakes it — the whole account, in
 * one message.
 *
 * A wake is a turn kolu starts, so these words are the entire input the model
 * gets: the transcript row beside them is for a PERSON, and the agent is
 * reading a conversation rebuilt from its own store, which carries the words
 * and not the row's mark. So the account opens by saying WHO IS SPEAKING —
 * `[kolu]`, the same mark the standing prompt and a message's terminal
 * references wear — and then says, per terminal, everything an agent needs to
 * decide what to do without asking a question first: its `host/id` (the name
 * every tool takes), WHICH PIECE OF WORK it belongs to and in what role, what
 * it is called, which machine it is on, which agent is in it, and how it
 * stands.
 *
 * The work and the role are said because they are the thing the Conductor acts
 * ON: "the planner of «a stored piece of work»" tells it which brief this
 * terminal is holding, where to look for the plan, and what the next step of
 * that work is — none of which a bare reference does.
 *
 * AND WHAT TO DO ABOUT IT, because the one thing that must not happen here is
 * the Conductor going back to sleep on a terminal that needs it. The closing
 * lines name the verbs that answer a wake — read the screen, say something to
 * the agent, let a member go — and then say the rule the whole design rests
 * on: END THE TURN. kolu rings again when something else happens.
 *
 * PURE, and its own file, so what the agent reads is a string a test can
 * compare rather than something only reachable by waking a real conversation.
 */

import type { ConductorWakeEvent } from "kolu-common/conductor";
import type { AnsweredFromFace, Said, WorkRole } from "kolu-work";

/** How each level reads in the account — a whole clause, because what the
 *  agent has to decide from is the SITUATION and not a one-word enum it has to
 *  interpret. */
const STANDS: Readonly<Record<ConductorWakeEvent["level"], string>> = {
  stopped: "its agent STOPPED — the turn ended and the output went quiet",
  asking: "its agent is ASKING someone — it is waiting on an answer",
  gone: "the terminal is GONE — it left its host while that host was answering",
  ready:
    "its agent is UP and has not been told anything yet — this is the moment to brief it",
  asleep:
    "the terminal was PUT TO SLEEP — the agent in it is gone with it, and whatever it was doing stopped there",
  ended:
    "the command it was started with ENDED — it is back at a shell prompt and no agent was ever seen in it, so the agent you asked for never came up",
  exited:
    "its agent EXITED — the program is gone from the foreground and the terminal is back at its shell prompt, so nothing more will come from it; read the screen to see why it went",
  "taken-over":
    "the person TOOK IT OVER — they are typing into it themselves now, so do not send it input, do not act on what it does, and leave it alone until kolu says it was handed back",
  "handed-back":
    "the person HANDED IT BACK — it is yours again, so read the screen before you act on it: what is on it now may be their work rather than the agent's",
};

/** WHAT A MEMBER TERMINAL IS — the work it belongs to and the part it plays,
 *  looked up by the host that holds the record. `null` for a terminal whose
 *  work has ended under it, which is a thing a late reading can be about. */
export interface WakeMembership {
  readonly role: WorkRole;
  readonly title: string;
}

/** WHERE A PERSON WAS when they answered, in the words the account uses. The
 *  Conductor is told because it decides what to do next: an answer given in
 *  the reader is one somebody gave with the plan in front of them.
 *
 *  The four FACES and nothing else: an answer the request itself gave is a
 *  decision the Conductor made in its own call, and nobody is woken about it. */
const FACES: Readonly<Record<AnsweredFromFace, string>> = {
  card: "on the work's card",
  chat: "in this conversation",
  reader: "in the reader, with the file open",
  popout: "in the reader, in a window of its own",
};

/** WHAT A PERSON SAID to one question, as the news carries it — the record's
 *  own two shapes and no third: one of kolu's words for a setup question, and
 *  what was picked and typed for a question about the work. An answer ALWAYS
 *  has a value, so there is no arm here for "answered with nothing". */
export type NewsSaid =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "said"; readonly said: Said };

/** ONE QUESTION OF AN ASK, as the news tells it — a SUM, because the four
 *  ways a question can stand after a reply are four different things to do
 *  about it:
 *
 *   - `answered` — filled in, and it carries WHAT WAS SAID;
 *   - `open` — left blank, so it is STILL ASKED: in the same ask, on the
 *     card and in the chat, and the Conductor is told so rather than left to
 *     read an empty answer as one;
 *   - `declined` — they would not say;
 *   - `dropped` — nobody answered and the question went away. */
export type NewsQuestion = { readonly question: string } & (
  | { readonly how: "answered"; readonly said: NewsSaid }
  | { readonly how: "open" }
  | { readonly how: "declined" }
  | { readonly how: "dropped" }
);

/** ONE ASK, as the wake carries it.
 *
 *  Not a {@link ConductorWakeEvent}: a wake event is a reading of a TERMINAL,
 *  and this is a thing a PERSON did to the record. They ride one queue
 *  because they are one kind of news — something happened that the Conductor
 *  has to decide about — and they are one turn for the same reason several
 *  terminals are: everything that landed while it was busy should be decided
 *  about in one pass.
 *
 *  A SUM on how the ask was replied to, so the face a person answered from is
 *  carried only where there was one: a DROPPED ask is one nobody answered. */
export type AnsweredNews = {
  readonly work: string;
  readonly title: string;
  readonly ask: string;
  readonly at: string;
  /** The questions this reply was about — each as it stands NOW. */
  readonly questions: ReadonlyArray<NewsQuestion>;
} & (
  | { readonly how: "answered"; readonly from: AnsweredFromFace }
  | { readonly how: "declined"; readonly from: AnsweredFromFace }
  | { readonly how: "dropped" }
);

/** What one question was answered with, in one phrase: kolu's own word for a
 *  setup question, or what they pressed and what they typed. Every arm has
 *  something to print — an answer with no value is not a value this takes. */
const saidOf = (said: NewsSaid): string => {
  switch (said.kind) {
    case "value":
      return said.value;
    case "said":
      return wordsOf(said.said);
    default:
      return said satisfies never;
  }
};

const wordsOf = (said: Said): string => {
  switch (said.kind) {
    case "picked":
      return said.picked.join(" · ");
    case "typed":
      return `“${said.text}”`;
    case "picked-and-typed":
      return [...said.picked, `“${said.text}”`].join(" · ");
    default:
      return said satisfies never;
  }
};

/** One question's line — what it came to, in the words the Conductor acts on.
 *  A question left blank says it is still open and where it still is, because
 *  what the agent must NOT do about it is ask it again. */
const questionLine = (one: NewsQuestion): string => {
  switch (one.how) {
    case "answered":
      return `    · ${one.question}: ${saidOf(one.said)}`;
    case "open":
      return `    · ${one.question}: STILL OPEN — left blank, still on the work's card and in this conversation`;
    case "declined":
      return `    · ${one.question}: — they would not say`;
    case "dropped":
      return `    · ${one.question}: — nobody answered it`;
    default:
      return one satisfies never;
  }
};

/** One ask's lines. They name the WORK rather than a terminal, because that
 *  is what the Conductor acts on next: the decision is already on the record,
 *  and what is left is to get on with the work it was holding up.
 *
 *  An answer that left something blank says so in its first line as well as
 *  on the question: PART of the form came back, and the rest is still in
 *  front of the human. */
const answerLine = (news: AnsweredNews): string => {
  const open = news.questions.filter((one) => one.how === "open");
  const head =
    news.how === "answered"
      ? open.length === 0
        ? `the human ANSWERED ${FACES[news.from]}`
        : `the human ANSWERED PART of it ${FACES[news.from]} — ${open.length === 1 ? "one question is" : `${open.length} questions are`} still open`
      : news.how === "declined"
        ? `the human DECLINED to answer ${FACES[news.from]} — they would not say`
        : "the question was DROPPED — the work ended under it and nobody answered";
  return [
    `- «${news.title}» (${news.work}) — ${head} (${news.at}):`,
    ...news.questions.map(questionLine),
  ].join("\n");
};

/** A PIECE OF WORK WITH NOBODY DOING IT — every member terminal is gone, and
 *  the work is still OPEN, because kolu failing to see a terminal is not an
 *  ending. Said ONCE per emptying.
 *
 *  Its own news rather than a terminal's: the terminals it would name are the
 *  ones that are no longer there, and what the Conductor has to act on is the
 *  WORK — adopt terminals back into it, or stop it. */
export interface NoTerminalsNews {
  readonly work: string;
  readonly title: string;
  readonly at: string;
}

const noTerminalsLine = (news: NoTerminalsNews): string =>
  `- «${news.title}» (${news.work}) — NO TERMINALS: every terminal that was working on it is gone (${news.at}). The work is still open and everything it decided is still on it.`;

/** One terminal's line. The ref comes first because it is what every tool
 *  takes; the prose after it is what a person would say about the same thing.
 *  An EMPTY agent is the `ended` case — no agent was ever in it — and the line
 *  says so rather than naming one that never existed.
 *
 *  An EMPTY NAME is the same kind of answer about a different fact: nothing
 *  kolu has read says what the terminal is for (no intent, no branch). It is
 *  SAID in words, because a pair of quotes with nothing between them reads as
 *  a terminal somebody called "" — a name the agent would then try to use. */
const lineOf = (
  event: ConductorWakeEvent,
  member: WakeMembership | null,
): string =>
  `- ${event.ref} — ${
    member === null
      ? "no longer a member of any work in progress"
      : `the ${member.role} of «${member.title}»`
  }, ${event.name === "" ? "an unnamed terminal" : `“${event.name}”`} on ${event.hostName}, ${event.agent === "" ? "no agent in it" : `running ${event.agent}`}: ${STANDS[event.level]} (seen ${event.at}).`;

/**
 * The account, for one wake carrying one or more terminals AND whatever the
 * human answered while the Conductor was away.
 *
 * Several things arrive together whenever they landed while a turn was
 * running ({@link ./held.ts}), and they are one message rather than several
 * turns on purpose: the Conductor should see everything that happened while it
 * was busy at once, and decide about all of it in one pass.
 *
 * `about` is read per terminal rather than carried on the event, because the
 * event is what was OBSERVED and the membership is what kolu knows now — a
 * member that left between the ring and the wake is described as it stands.
 *
 * AN ANSWER IS NEWS LIKE ANY OTHER. The Conductor asked, said what it had
 * asked, and ended its turn; this is where the answer reaches it. The lines
 * say who answered, from where, and what — and nothing about waiting, because
 * nothing waited.
 */
export const wakeText = (
  events: ReadonlyArray<ConductorWakeEvent>,
  about: (ref: string) => WakeMembership | null,
  answered: ReadonlyArray<AnsweredNews> = [],
  emptied: ReadonlyArray<NoTerminalsNews> = [],
): string => {
  const subjects: string[] = [];
  if (events.length > 0) {
    subjects.push(
      events.length === 1
        ? "a terminal working on one of your pieces of work needs you"
        : `${events.length} terminals working on your pieces of work need you`,
    );
  }
  if (answered.length > 0) {
    subjects.push(
      answered.length === 1
        ? "the human answered a question you asked"
        : `the human answered ${answered.length} questions you asked`,
    );
  }
  if (emptied.length > 0) {
    subjects.push(
      emptied.length === 1
        ? "a piece of work has no terminals left"
        : `${emptied.length} pieces of work have no terminals left`,
    );
  }
  const parts: string[] = [
    `[kolu] I am waking you: ${subjects.join(", and ")}. You did not ask for this turn — kolu started it.`,
  ];
  if (answered.length > 0) {
    parts.push(answered.map(answerLine).join("\n"));
  }
  if (emptied.length > 0) {
    parts.push(emptied.map(noTerminalsLine).join("\n"));
    parts.push(
      "Nothing ended: kolu failing to see a terminal is not a work finishing. Bring terminals back to it with `work_adopt` (the work is named above — do NOT open a second one for the same branch), or `work_stop` it if it is really over.",
    );
  }
  if (events.length > 0) {
    parts.push(
      events.map((event) => lineOf(event, about(event.ref))).join("\n"),
    );
    parts.push(
      "Look before you act: `screen_text` reads a terminal's screen. To brief, answer or redirect the agent in one, use `agent_say` — kolu does the keystrokes that agent needs, idle or working; a terminal that is READY is one waiting for exactly that. Use `work_leave` when a member's part is done, and `work_adopt` to bring a terminal the human points at into a piece of work. A question for the human about one of these works goes through `work_ask`, so the answer is kept with the work.",
    );
  }
  if (answered.length > 0) {
    parts.push(
      "The answer is already on the work as a decision — read it back there if you need it again, and get on with what it unblocks. A question of your own goes through `work_ask`: it is put to the human and answers you at once, and kolu wakes you like this when they say.",
    );
  }
  parts.push(
    "Then END YOUR TURN. Do not wait on anything: kolu wakes you again the moment a member terminal's agent comes up, stops, asks, sleeps, exits, ends or goes away — or the human answers something you asked.",
  );
  return parts.join("\n\n");
};
