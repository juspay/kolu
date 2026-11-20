import type { ConductorWakeEvent } from "kolu-common/conductor";
import type { AnsweredFromFace, Said, WorkRole } from "kolu-work";

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

export interface WakeMembership {
  readonly role: WorkRole;
  readonly title: string;
}

const FACES: Readonly<Record<AnsweredFromFace, string>> = {
  card: "on the work's card",
  chat: "in this conversation",
  reader: "in the reader, with the file open",
  popout: "in the reader, in a window of its own",
};

export type NewsSaid =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "said"; readonly said: Said };

export type NewsQuestion = { readonly question: string } & (
  | { readonly how: "answered"; readonly said: NewsSaid }
  | { readonly how: "open" }
  | { readonly how: "declined" }
  | { readonly how: "dropped" }
);

export type AnsweredNews = {
  readonly work: string;
  readonly title: string;
  readonly ask: string;
  readonly at: string;
  readonly questions: ReadonlyArray<NewsQuestion>;
} & (
  | { readonly how: "answered"; readonly from: AnsweredFromFace }
  | { readonly how: "declined"; readonly from: AnsweredFromFace }
  | { readonly how: "dropped" }
);

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

export interface NoTerminalsNews {
  readonly work: string;
  readonly title: string;
  readonly at: string;
}

const noTerminalsLine = (news: NoTerminalsNews): string =>
  `- «${news.title}» (${news.work}) — NO TERMINALS: every terminal that was working on it is gone (${news.at}). The work is still open and everything it decided is still on it.`;

const lineOf = (
  event: ConductorWakeEvent,
  member: WakeMembership | null,
): string =>
  `- ${event.ref} — ${
    member === null
      ? "no longer a member of any work in progress"
      : `the ${member.role} of «${member.title}»`
  }, ${event.name === "" ? "an unnamed terminal" : `“${event.name}”`} on ${event.hostName}, ${event.agent === "" ? "no agent in it" : `running ${event.agent}`}: ${STANDS[event.level]} (seen ${event.at}).`;

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
