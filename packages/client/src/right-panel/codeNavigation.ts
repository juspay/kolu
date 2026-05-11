/** Cross-component code-tab navigation requests.
 *
 *  Terminal link-click handlers (and any future caller that needs to
 *  open a file from outside the right panel) publish a request here;
 *  `CodeTab` observes the signal and reacts — switches to browse mode,
 *  sets `selectedPath`, and forwards the line range to the file view.
 *
 *  The signal is a SolidJS `createSignal` at module scope (no
 *  `createRoot` needed — the value is a plain immutable record, and
 *  the subscribers live inside component owners). Latest request wins;
 *  callers don't need to clear it. */

import { createSignal } from "solid-js";

export interface CodeOpenRequest {
  /** Per-terminal git repo root that the path is relative to (when
   *  relative). Absolute paths beneath this root are also accepted —
   *  the consumer normalizes both shapes. */
  repoRoot: string;
  /** Path as it appeared in the terminal. May be absolute or
   *  repo-relative. */
  rawPath: string;
  startLine: number;
  endLine: number;
  /** Token incremented on every request so two clicks on the same
   *  `path:line` re-trigger the effect (signals dedupe by reference;
   *  identical content with a new token compares unequal). */
  token: number;
}

let nextToken = 1;
const [pending, setPending] = createSignal<CodeOpenRequest | null>(null);

export const pendingCodeOpen = pending;

export function requestCodeOpen(
  req: Omit<CodeOpenRequest, "token">,
): CodeOpenRequest {
  const full: CodeOpenRequest = { ...req, token: nextToken++ };
  setPending(full);
  return full;
}

/** Reset for tests. Production callers don't need this — latest
 *  request wins by token. */
export function _resetCodeOpenForTests(): void {
  setPending(null);
  nextToken = 1;
}
