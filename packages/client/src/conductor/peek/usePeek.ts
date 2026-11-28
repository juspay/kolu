import type { TerminalId } from "kolu-common/surface";
import type { WorkMember, WorkRole } from "kolu-work";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { splitMemberRef } from "../memberRef";
import { membersIn } from "../workReadings";

/** The terminal the peek is on: its encoded host key and its id. */
export interface PeekTarget {
  readonly host: string;
  readonly id: TerminalId;
}

/** A window's typing derivation, BOXED: `createSignal`'s function form is a
 *  writable memo, so an accessor has to be carried as a value. */
interface TypingSource {
  readonly read: Accessor<boolean>;
}

/** No window is up, so nobody is typing in one. */
const NOT_TYPING: TypingSource = { read: () => false };

const [target, setTarget] = createSignal<PeekTarget | null>(null);
/** THE OPEN WINDOW'S OWN TYPING DERIVATION, not a copy of its answer: the
 *  window hands `focused() && mayType()` up here for as long as it is up
 *  (`usePeekTyping`), so a reader here is in the same flush as the window's
 *  own readers. Relaying the VALUE through an effect would paint the Esc
 *  hint and the dialog's Esc gate a flush behind the terminal that took the
 *  keyboard. `ownedWrite`: the window registers from its body. */
const [typingSource, setTypingSource] = createSignal<TypingSource>(NOT_TYPING, {
  ownedWrite: true,
});

export const peekTarget: Accessor<PeekTarget | null> = target;

/** Point the peek at a terminal, moving it there if it is open on another. */
export function openPeek(next: PeekTarget): void {
  setTarget(next);
}

/** Close the peek, dropping the typing lock with it. The Fit width choice is
 *  NOT the window's: it is the one shared by every pane (`../fitWidth`). */
export function closePeek(): void {
  setTarget(null);
  setTypingSource(NOT_TYPING);
}

/** Does the peek's terminal hold the keyboard? */
export const peekTyping: Accessor<boolean> = () => typingSource().read();

/** Hand the window's typing derivation up for the length of the window. */
export function usePeekTyping(source: Accessor<boolean>): void {
  const mine: TypingSource = { read: source };
  setTypingSource(mine);
  onCleanup(() =>
    setTypingSource((current) => (current === mine ? NOT_TYPING : current)),
  );
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

/** Does this key, landing outside the terminal, raise the lock's Take over card? */
export function keyRaisesLockOffer(i: {
  key: string;
  modified: boolean;
  onButton: boolean;
  terminalFocused: boolean;
  mayType: boolean;
}): boolean {
  if (i.terminalFocused || i.mayType || i.modified) return false;
  if (i.onButton && (i.key === "Enter" || i.key === " ")) return false;
  return i.key.length === 1 || i.key === "Enter" || i.key === "Backspace";
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
