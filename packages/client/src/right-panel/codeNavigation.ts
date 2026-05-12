/** Cross-component code-tab navigation requests.
 *
 *  Terminal link-click handlers (and any future caller that needs to
 *  open a file from outside the right panel) publish a request here;
 *  `CodeTab` observes the signal and reacts. Latest request wins;
 *  callers don't need to clear it. Each call mints a fresh request
 *  object, so two clicks on the same `path:line` are distinct by
 *  reference — that's what lets `CodeTab` tell them apart even when
 *  their `ref` content matches. */

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
  /** Code-tab mode the request expects to land in. Today only
   *  `"browse"` makes sense (highlighting a line in a diff doesn't
   *  generalize), but encoding the assumption on the type lets the
   *  consumer guard explicitly instead of relying on the click
   *  handler having pre-called `openCodeBrowser` in the right order. */
  targetMode: "browse";
}

const [pending, setPending] = createSignal<CodeOpenRequest | null>(null);

export const pendingCodeOpen = pending;

export function requestCodeOpen(req: CodeOpenRequest): void {
  setPending(req);
}
