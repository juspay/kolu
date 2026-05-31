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
 *   safe fallback — the textarea trick is write-only. `@kolu/solid-xterm`'s
 *   `createSafeClipboardProvider` wraps this writer for xterm's OSC 52 path
 *   and short-circuits reads in non-secure contexts; users on plain HTTP
 *   simply can't paste via OSC 52.
 *
 * **Long-term cure.** Serve Kolu over HTTPS (or via `localhost` /
 * port-forward) and `navigator.clipboard` comes back, at which point the
 * fallback never executes. The deprecation pressure on `execCommand`
 * isn't urgent, but the right home for this code is "delete it when we
 * ship TLS by default" — tracked alongside the HTTPS rollout discussion.
 */

/** Write `text` to the system clipboard, falling back to execCommand when
 *  navigator.clipboard is unavailable or rejects. Throws if both paths fail.
 *
 *  Toasts are intentionally *not* wrapped — see `.claude/rules/toast-conventions.md`:
 *  toast calls stay colocated with the logic that triggers them, so callers
 *  pair this with their own `toast.success` / `toast.error` on the await
 *  boundary. */
export async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Fall through to execCommand — navigator.clipboard can reject for
      // reasons other than missing secure context (permission denied,
      // document-not-focused, etc.). Log so the original rejection isn't
      // invisible if the fallback also fails.
      console.debug(
        "navigator.clipboard.writeText rejected; trying execCommand fallback:",
        err,
      );
    }
  }
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
}
