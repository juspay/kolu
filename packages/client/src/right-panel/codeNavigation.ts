/** Cross-component code-tab navigation requests.
 *
 *  Terminal link-click handlers (and any future caller that needs to
 *  open a file from outside the right panel) publish a request here;
 *  `CodeTab` observes the signal and reacts. Latest request wins;
 *  callers don't need to clear it. */

import { createSignal } from "solid-js";
import type { LineRef } from "../ui/lineRef";

export interface CodeOpenRequest {
  /** Parsed `path:line[-end]` the user clicked. */
  ref: LineRef;
  /** Per-terminal git repo root that `ref.path` is relative to (when
   *  relative). Absolute paths beneath this root are also accepted —
   *  the resolver normalizes both shapes. */
  repoRoot: string;
  /** Terminal cwd at the time of click. Drives the "user typed
   *  `bar.ts:42` while standing in a subdirectory of the repo" case;
   *  undefined falls back to repo-relative interpretation only. */
  cwd: string | undefined;
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
