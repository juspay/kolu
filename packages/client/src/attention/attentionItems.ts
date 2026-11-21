/** THE WORDS OF EVERY ALERT — each source's item, as pure values.
 *
 *  A source knows what it is telling the human and where a click on it goes,
 *  and nothing else. Whether it rings, and whether the human is already
 *  looking at the place it lives, is the one path's business
 *  (`attention/attend.ts`). Keeping the words here rather than in the module
 *  that decides WHEN is what lets them be tested without a page. */

import type { MemoryNeed } from "kolu-common/conductorMemory";
import type { TerminalId } from "kolu-common/surface";
import type { NeedsYou } from "kolu-work";
import type { TerminalSubject } from "../terminal/terminalSubject";
import type { AttentionItem } from "./attend";

/** A TERMINAL that finished its turn or is blocked on the human. Titled with
 *  the terminal's subject where the active host can give one, and with the
 *  host where it cannot. */
export function terminalItem(args: {
  encHost: string;
  hostLabel: string;
  id: TerminalId;
  asking: boolean;
  subject: TerminalSubject | undefined;
}): AttentionItem {
  const { encHost, hostLabel, id, asking, subject } = args;
  const title = subject
    ? asking
      ? `${subject.title} needs your input`
      : `${subject.title} finished`
    : asking
      ? `An agent needs your input on ${hostLabel}`
      : `An agent finished on ${hostLabel}`;
  return {
    tag: `${encHost}/${id}`,
    title,
    body: subject?.description,
    click: { kind: "terminal", host: encHost, terminalId: id },
    inFront: false,
  };
}

/** A PIECE OF WORK WAITING ON THE HUMAN — a question put about it, or a green
 *  PR handed over. `inFront` is that card, or that question, in view in a
 *  focused window. */
export function workItem(need: NeedsYou, inFront: boolean): AttentionItem {
  return {
    tag: `work:${need.key}`,
    title: need.title,
    body: need.wanted,
    click: {
      kind: "work",
      work: need.work,
      ask: need.why.why === "question" ? need.why.ask : null,
    },
    inFront,
  };
}

/** THE CONVERSATION'S OWN QUESTION — the one that belongs to no work. */
export function conversationItem(
  open: number,
  inFront: boolean,
): AttentionItem {
  return {
    tag: "conductor",
    title: "The conductor needs you",
    body:
      open === 1 ? "One question is waiting" : `${open} questions are waiting`,
    click: { kind: "conductor" },
    inFront,
  };
}

/** PROPOSALS the Conductor would like to remember. */
export function memoryItem(
  memory: MemoryNeed,
  inFront: boolean,
): AttentionItem {
  return {
    tag: "memory",
    title: "The Conductor would like to remember something",
    body:
      memory.title !== null
        ? memory.title
        : `${memory.count} proposals are waiting`,
    click: { kind: "memory" },
    inFront,
  };
}
