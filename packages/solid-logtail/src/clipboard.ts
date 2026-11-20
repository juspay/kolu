/**
 * Clipboard write with a non-secure-context escape hatch.
 *
 * `navigator.clipboard` is exposed only in a [secure
 * context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
 * `https://…`, `http://localhost`, or `http://127.0.0.1`. Plain `http://` to
 * any other host — a LAN address, a machine hostname, a Tailscale IP — gets
 * `navigator.clipboard === undefined`, with no permission prompt to recover
 * with.
 *
 * `document.execCommand("copy")` operates on the current text selection rather
 * than on a string argument, which is why the fallback below builds a selection
 * synthetically. It is formally deprecated, yet sits at [caniuse
 * 100/100](https://caniuse.com/mdn-api_document_execcommand_copy) and is the
 * only write the Clipboard API has no non-secure-context equivalent for. It
 * runs only inside a live [user-activation
 * gesture](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation).
 */

import { Cause, Effect } from "effect";

const clipboardFailure = (cause: unknown): Cause.UnknownError =>
  new Cause.UnknownError(
    cause,
    cause instanceof Error ? cause.message : String(cause),
  );

const execCommandWrite = (
  text: string,
): Effect.Effect<void, Cause.UnknownError> =>
  Effect.try({
    try: () => {
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
    },
    catch: clipboardFailure,
  });

/** Write `text` to the system clipboard, falling back to `execCommand` when
 *  `navigator.clipboard` is unavailable or rejects. Fails when both paths fail,
 *  and the failure's own `message` is the browser error's sentence. */
export function writeTextToClipboard(
  text: string,
): Effect.Effect<void, Cause.UnknownError> {
  if (!navigator.clipboard?.writeText) return execCommandWrite(text);
  return Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
    Effect.catch((err) =>
      Effect.sync(() => {
        console.debug(
          "navigator.clipboard.writeText rejected; trying execCommand fallback:",
          err,
        );
      }).pipe(Effect.andThen(() => execCommandWrite(text))),
    ),
  );
}
