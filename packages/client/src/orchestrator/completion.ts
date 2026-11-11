/** What a key MEANS while a completion menu is open — the composer's one
 *  keyboard rule, pure so the cases are pinned by tests instead of by driving a
 *  textarea.
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
