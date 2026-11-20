import type { TerminalId } from "kolu-common/surface";
import type { WorkMember, WorkRole } from "kolu-work";
import { type Accessor, batch, createSignal } from "solid-js";
import { splitMemberRef } from "../memberRef";
import { membersIn } from "../workReadings";

/** The terminal the peek is on: its encoded host key and its id. */
export interface PeekTarget {
  readonly host: string;
  readonly id: TerminalId;
}

const [target, setTarget] = createSignal<PeekTarget | null>(null);
const [fit, setFit] = createSignal(false);
const [typing, setTyping] = createSignal(false);

export const peekTarget: Accessor<PeekTarget | null> = target;

/** Point the peek at a terminal, moving it there if it is open on another. */
export function openPeek(next: PeekTarget): void {
  setTarget(next);
}

/** Close the peek, dropping the fit and the typing lock with it. */
export function closePeek(): void {
  batch(() => {
    setTarget(null);
    setFit(false);
    setTyping(false);
  });
}

export const peekFit: Accessor<boolean> = fit;

/** Shrink the font until every column fits, or go back to the terminal's size. */
export function togglePeekFit(): void {
  setFit((was) => !was);
}

export const peekTyping: Accessor<boolean> = typing;

/** Record whether the terminal currently holds the keyboard. */
export function setPeekTyping(value: boolean): void {
  setTyping(value);
}

/** One tab of the peek: a member of the target's work. */
export interface PeekTab {
  readonly ref: string;
  readonly host: string;
  readonly id: TerminalId;
  readonly role: WorkRole;
  readonly openable: boolean;
}

/** The work's members as the peek's tabs, in the order the work runs them. */
export function peekTabs(
  members: ReadonlyMap<string, WorkMember>,
  ref: string,
  isOpenable: (host: string, id: TerminalId) => boolean,
): ReadonlyArray<PeekTab> {
  const mine = members.get(ref);
  if (mine === undefined) return [];
  const tabs: PeekTab[] = [];
  for (const row of membersIn(members, mine.work)) {
    const split = splitMemberRef(row.terminal);
    if (split === null) continue;
    tabs.push({
      ref: row.terminal,
      host: split.host,
      id: split.id,
      role: row.member.role,
      openable: isOpenable(split.host, split.id),
    });
  }
  return tabs;
}

/** The sentence under the peek's terminal: who drives it, and what Esc does. */
export function peekFootWords(i: {
  driver: "conductor" | "you" | "nobody";
  typing: boolean;
  name: string;
  touch: boolean;
}): string {
  const whose =
    i.driver === "you" ? "You’re driving" : "Nobody is driving this terminal";
  const esc = i.touch ? "" : " Esc closes.";
  if (i.driver === "conductor")
    return `Read-only while the Conductor drives it. Scroll to read back, drag to select.${esc}`;
  if (i.typing)
    return i.touch
      ? `${whose}: keys go to ${i.name}.`
      : `${whose}: keys go to ${i.name}, Esc included. Close with × or a click outside.`;
  return `${whose}. ${i.touch ? "Tap" : "Click"} the terminal to type in it.${esc}`;
}
