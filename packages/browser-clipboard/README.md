# @kolu/browser-clipboard

Browser clipboard write that survives non-secure contexts.

`navigator.clipboard` is exposed only in
[secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
`https://…`, `http://localhost`, or `http://127.0.0.1`. Plain
`http://` to any other host — a LAN address, a machine hostname, a
Tailscale IP — gets `navigator.clipboard === undefined`. Reading
`.writeText` on that throws `TypeError`, and there's no permission
prompt to recover with.

The fallback is `document.execCommand("copy")` against a synthetic
off-screen `<textarea>`. The command is formally deprecated but sits
at [caniuse 100/100](https://caniuse.com/mdn-api_document_execcommand_copy)
with no removal timeline — production sites depend on it, and the
Clipboard API has no equivalent fallback for non-secure contexts.

## Exports

- `./` — `writeTextToClipboard(text)`.
- `./xterm` — `SafeClipboardProvider` implementing xterm.js's
  `IClipboardProvider` so OSC 52 writes survive plain HTTP. Read
  side returns empty when `navigator.clipboard.readText` is
  unavailable.

## Caveats

- `execCommand("copy")` requires a [user-activation gesture](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation):
  button click, keypress, etc. Synchronous calls from event handlers
  work; programmatic timer-triggered calls do not.
- Read fallback: none. The textarea trick is write-only. Long-term
  cure is HTTPS / localhost.
