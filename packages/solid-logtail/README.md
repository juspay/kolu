# @kolu/solid-logtail

**The log-tail block** — the thing a person reads, and copies, while a long job
narrates itself — plus the clipboard write it relies on.

## What it owns

- **`<LogTail lines log testid class onCopyError>`** — one recessed, monospaced
  block: every line **wraps**, the newest line stays in view as lines arrive
  (until the reader scrolls up), and a corner **Copy** button writes the WHOLE
  log it was handed and confirms in place. `lines` is the tail to show; `log` is
  everything the attempt produced — they differ because copying the visible
  window would hide the very output the reader wanted. `onCopyError(message)` is
  **required**: the package cannot decide an app's notification policy, so a
  caller with nothing to say passes a no-op rather than letting a copy that
  failed look like one that worked.
- **`writeTextToClipboard(text)`** — the clipboard volatility: an Effect that
  writes, and falls back to `execCommand` when `navigator.clipboard` is absent or
  rejects. That absence is the normal case over plain `http://` (a LAN address, a
  Tailscale IP), where the primary API does not exist at all.
- **`LogLine` / `NO_LOG_LINES` / `LOG_TAIL_SURFACE` / `LOG_TAIL_LINE`** — the
  chrome and the structural line shape, named once so two tails cannot drift.

## What a consumer needs

Nothing but the import (`@kolu/solid-logtail`); the colours resolve from the
consumer's own theme tokens, and `class` carries the per-surface sizing.

## What it knows nothing about

- Where a line came from (a DTO, a wire payload, a plain string list)
- Sizing, scrolling depth, text scale — the caller's `class`
- Toasts, logging, or any other failure policy (`onCopyError` is the seam)
- Why a tail might be empty-but-unavailable (kolu's `LogAbsence` is its own fact)

## Consumers

- `packages/client/` — the connect overlay, the boot-stalled card, and the
  host-diagnostics popover, plus the app's other copy affordances via
  `writeTextToClipboard`.
