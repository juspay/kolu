/** What a key MEANS while a completion menu is open, and where the highlight
 *  sits — the composer's two menu rules, kept here so both are pinned by tests
 *  instead of by driving a textarea.
 *
 *  The menus used to be mouse-only, and `Enter` always sent. That is not a
 *  missing nicety: typing `@fix` and pressing Enter — the single most natural
 *  way to finish a mention — SENT the half-typed token, and the agent received
 *  a prompt naming a terminal that does not exist. A menu that offers a choice
 *  must take the keys a person uses to make one.
 *
 *  `Enter` is deliberately BOTH accept and send, decided by whether a menu is
 *  open: one key, one meaning at a time, and the meaning is the one that is on
 *  screen. Tab accepts too (and only accepts) — the shell habit — so somebody
 *  who distrusts Enter mid-token has a key that can never send. */

import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  on,
  type Setter,
} from "solid-js";
import type { TokenQuery } from "./mentions";

export type CompletionIntent =
  /** Move the highlight to `index` — the list wraps, so ↓ off the end is the
   *  first row rather than a dead key. */
  | { readonly kind: "move"; readonly index: number }
  /** Complete the token under the caret from the row at `index`. */
  | { readonly kind: "accept"; readonly index: number }
  /** Close the menu, leave the text alone. */
  | { readonly kind: "close" }
  /** Send the prompt. */
  | { readonly kind: "send" }
  /** Not ours — the textarea (or, for `Escape` with no menu, the pane that
   *  leaves the mode) gets the key untouched. */
  | { readonly kind: "pass" };

/** Fold one keypress against the menu's state. `count` is how many rows are
 *  showing (0 = no menu), `selected` is the highlighted index, clamped here so
 *  a caller whose list just shrank cannot accept a row that is gone. */
export function completionIntent(
  key: string,
  shift: boolean,
  count: number,
  selected: number,
): CompletionIntent {
  if (count <= 0) {
    // No menu: Enter is the send key it has always been, and `Escape` belongs
    // to the pane (it leaves the mode).
    return key === "Enter" && !shift ? { kind: "send" } : { kind: "pass" };
  }
  const at = Math.min(Math.max(selected, 0), count - 1);
  switch (key) {
    case "ArrowDown":
      return { kind: "move", index: (at + 1) % count };
    case "ArrowUp":
      return { kind: "move", index: (at - 1 + count) % count };
    case "Tab":
      return { kind: "accept", index: at };
    case "Enter":
      // Shift+Enter stays the newline it is everywhere else in this box; the
      // newline ends the token, which closes the menu on its own.
      return shift ? { kind: "pass" } : { kind: "accept", index: at };
    case "Escape":
      return { kind: "close" };
    default:
      return { kind: "pass" };
  }
}

/** The QUESTION the open menu is answering: its trigger and the letters typed
 *  after it. At most ONE menu is open — a token starts with `@` or with `/`,
 *  never both. `@` with nothing after it is a real question (list every
 *  terminal), so it spells itself `"@"`, and a caret in no token at all spells
 *  itself `""` — two states that must not collapse onto each other. */
export function completionQuestion(
  mention: TokenQuery | null,
  command: TokenQuery | null,
): string {
  if (mention !== null) return `@${mention.query}`;
  if (command !== null) return `/${command.query}`;
  return "";
}

/** The highlighted row, and the one rule that moves it without a keypress: a
 *  NEW QUESTION starts over at the top. Typing one more letter must not leave
 *  a completion armed that you never looked at.
 *
 *  The question — not the match list — is what the reset keys on, and the
 *  difference is the bug this primitive exists to prevent. Each match carries
 *  its terminal's intent, cwd and agent state, so a build finishing two tiles
 *  away rebuilds the array while the menu is open; keying the reset on that
 *  array snapped the highlight back to row 0 mid-`↓↓⏎` and completed whatever
 *  the fleet happened to list first. The person changed the query or they did
 *  not; nothing else gets a vote.
 *
 *  A COMPUTED, not an effect: the reset writes derived state, so it must land
 *  in the same update as the keystroke that changed the question — an effect
 *  would run after the render that already drew a stale highlight. */
export function createCompletionHighlight(
  question: () => string,
): readonly [Accessor<number>, Setter<number>] {
  const asked = createMemo(question);
  const [selected, setSelected] = createSignal(0);
  createComputed(on(asked, () => setSelected(0)));
  return [selected, setSelected];
}
