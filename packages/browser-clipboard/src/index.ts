/**
 * Clipboard write with a non-secure-context escape hatch.
 *
 * `navigator.clipboard` is exposed only in secure contexts
 * (`https://…`, `http://localhost`, or `http://127.0.0.1`). Plain
 * `http://` to a LAN address / hostname / Tailscale IP returns
 * `navigator.clipboard === undefined`, and `.writeText` on that
 * throws `TypeError`.
 *
 * Fallback: `document.execCommand("copy")` against a synthetic
 * off-screen `<textarea>`. Formally deprecated but
 * [caniuse 100/100](https://caniuse.com/mdn-api_document_execcommand_copy)
 * with no removal timeline. Requires a user-activation gesture
 * (click, keypress) — synchronous calls from event handlers work,
 * timer-triggered calls don't.
 */
export async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // Fall through — navigator.clipboard can reject for reasons
      // other than missing secure context (permission denied,
      // document-not-focused, etc.). Log so the original rejection
      // isn't invisible if the fallback also fails.
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
