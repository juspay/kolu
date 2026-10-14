/**
 * Clipboard write with a non-secure-context escape hatch.
 *
 * **The problem.** `navigator.clipboard` is exposed only in a [secure
 * context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
 * `https://…`, `http://localhost`, or `http://127.0.0.1`. Plain `http://` to
 * any other host — typical when an app is reached over a LAN address, a
 * machine hostname, or a Tailscale IP — gets `navigator.clipboard ===
 * undefined`. Reading `.writeText` on that throws
 * `TypeError: Cannot read properties of undefined (reading 'writeText')`,
 * and there's no permission prompt to recover with — the API just isn't
 * there.
 *
 * **The escape hatch.** `document.execCommand("copy")` operates on the
 * current text selection rather than a string argument, so this helper
 * builds the selection synthetically: insert an off-screen `<textarea>`,
 * `.select()` its contents, run the command, remove the element. The
 * command is formally deprecated (and MDN warns it may go away), but as
 * of 2025 it sits at [caniuse 100/100](https://caniuse.com/mdn-api_document_execcommand_copy):
 * Chrome 4+, Firefox 9+, Safari all, Edge all. There is no removal
 * timeline — browsers can't drop it because too many production sites
 * depend on it, and the Clipboard API itself has no equivalent fallback
 * for non-secure contexts. It is the only portable write path that
 * survives plain HTTP.
 *
 * **Caveats.**
 *
 * - The command requires a [user-activation
 *   gesture](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation) —
 *   button click, keypress, etc. Every caller in this codebase fires from
 *   one (`onClick`, command-palette dispatch, OSC 52 from a keystroke), so
 *   the constraint is satisfied by construction. Don't bury this helper
 *   inside a `setTimeout` or post-await tail — outside a gesture window,
 *   both branches fail.
 * - We fall through to the textarea path when `navigator.clipboard.writeText`
 *   *exists but rejects* (permission denied, document not focused, etc.) —
 *   not just when the property is undefined. That covers the long tail of
 *   user-agent quirks that surface as a rejection rather than a missing API.
 * - Reads (`navigator.clipboard.readText`, OSC 52 paste queries) have no
 *   safe fallback — the textarea trick is write-only. A consumer that needs a
 *   read (kolu's xterm `IClipboardProvider`) short-circuits it in a non-secure
 *   context itself; users on plain HTTP simply can't paste via OSC 52.
 *
 * **Long-term cure.** Serve the app over HTTPS (or via `localhost` /
 * port-forward) and `navigator.clipboard` comes back, at which point the
 * fallback never executes. The deprecation pressure on `execCommand`
 * isn't urgent, but the right home for this code is "delete it when we
 * ship TLS by default" — tracked alongside the HTTPS rollout discussion.
 */

import { type Cause, Effect } from "effect";

/** The synthetic-selection write — the escape hatch's whole mechanism, and the
 *  step that MUST stay inside the gesture window. `Effect.try` and not
 *  `Effect.sync`: `execCommand` returning `false` is the browser saying no, an
 *  ordinary outcome this file's contract reports on the error channel. */
const execCommandWrite = (
  text: string,
): Effect.Effect<void, Cause.UnknownError> =>
  Effect.try(() => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    try {
      textarea.select();
      const ok = document.execCommand("copy");
      if (!ok) throw new Error("clipboard access blocked");
    } finally {
      document.body.removeChild(textarea);
    }
  });

/** Write `text` to the system clipboard, falling back to execCommand when
 *  navigator.clipboard is unavailable or rejects. FAILS if both paths fail.
 *
 *  An `Effect`, and the fallback ladder is what it always wanted to be: the
 *  primary write recovered into the secondary, rather than a `try`/`catch`
 *  around an `await` with a `return` in the middle of it.
 *
 *  **This effect must not be delayed.** The `execCommand` leg needs an active
 *  user activation, so composing an `Effect.sleep` (or anything asynchronous
 *  that is not the clipboard call itself) before it breaks copying with no unit
 *  test to catch it — only kolu's `clipboard.feature` / `osc52-clipboard.feature`.
 *  Running it on the caller's own stack (a fork in the click handler) is inside
 *  the window; running it after other async work is not.
 *
 *  A toast is deliberately NOT part of this: what a failed copy says is the
 *  consumer's decision (see `LogTail`'s `onCopyError`), and a library that
 *  reached for a toast library would drag one into every consumer. */
export function writeTextToClipboard(
  text: string,
): Effect.Effect<void, Cause.UnknownError> {
  if (!navigator.clipboard?.writeText) return execCommandWrite(text);
  return Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
    Effect.catch((err) =>
      // Fall through to execCommand — navigator.clipboard can reject for
      // reasons other than missing secure context (permission denied,
      // document-not-focused, etc.). Log so the original rejection isn't
      // invisible if the fallback also fails.
      Effect.sync(() => {
        console.debug(
          "navigator.clipboard.writeText rejected; trying execCommand fallback:",
          err,
        );
      }).pipe(Effect.andThen(() => execCommandWrite(text))),
    ),
  );
}
