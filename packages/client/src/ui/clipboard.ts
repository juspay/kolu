/**
 * Clipboard write with a non-secure-context escape hatch.
 *
 * **The problem.** `navigator.clipboard` is exposed only in a [secure
 * context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
 * `https://…`, `http://localhost`, or `http://127.0.0.1`. Plain `http://` to
 * any other host — typical when Kolu is reached over a LAN address, a
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
 *   safe fallback — the textarea trick is write-only. `SafeClipboardProvider`
 *   below short-circuits read attempts in non-secure contexts; users on
 *   plain HTTP simply can't paste via OSC 52.
 *
 * **Long-term cure.** Serve Kolu over HTTPS (or via `localhost` /
 * port-forward) and `navigator.clipboard` comes back, at which point the
 * fallback never executes. The deprecation pressure on `execCommand`
 * isn't urgent, but the right home for this code is "delete it when we
 * ship TLS by default" — tracked alongside the HTTPS rollout discussion.
 */

import type {
  ClipboardSelectionType,
  IClipboardProvider,
} from "@xterm/addon-clipboard";
import { type Cause, Effect } from "effect";
import { runActionPromise } from "../runAction";

/** The synthetic-selection write — the escape hatch's whole mechanism, and the
 *  step that MUST stay inside the gesture window. `Effect.try` and not
 *  `Effect.sync`: `execCommand` returning `false` is the browser saying no, an
 *  ordinary outcome this file's contract reports on the error channel. */
const execCommandWrite = (text: string): Effect.Effect<void, Cause.UnknownError> =>
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
 *  test to catch it — only `clipboard.feature` / `osc52-clipboard.feature`.
 *  `runAction` forks on the calling stack, so a handler that forks this
 *  immediately is inside the window; one that forks it after other async work is
 *  not.
 *
 *  Toasts are intentionally *not* wrapped — see `.claude/rules/toast-conventions.md`:
 *  toast calls stay colocated with the logic that triggers them, so callers pair
 *  this with their own `toast.success` / `toast.error`. */
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


/** xterm `IClipboardProvider` that uses `writeTextToClipboard` for writes
 *  (survives non-secure contexts) and returns empty on reads when
 *  navigator.clipboard is unavailable. OSC 52 read queries (`?`) are rare
 *  and have no safe fallback.
 *
 *  The one place in this file that is still Promise-shaped, because the shape is
 *  `@xterm/addon-clipboard`'s: `IClipboardProvider` is an interface this repo
 *  implements, not one it defines. `Effect.orDie` before the run edge because
 *  the interface has no error channel either — a failed write was always a
 *  rejection to xterm, and a defect is what a rejection is on this side. */
export class SafeClipboardProvider implements IClipboardProvider {
  public async readText(selection: ClipboardSelectionType): Promise<string> {
    if (selection !== "c") return "";
    if (!navigator.clipboard?.readText) return "";
    return navigator.clipboard.readText();
  }

  public async writeText(
    selection: ClipboardSelectionType,
    text: string,
  ): Promise<void> {
    if (selection !== "c") return;
    await runActionPromise(writeTextToClipboard(text).pipe(Effect.orDie));
  }
}
