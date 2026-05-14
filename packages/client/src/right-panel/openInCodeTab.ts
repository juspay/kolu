/** Front door for "open this file:line in the Code tab". Every producer
 *  — terminal-link click, right-click "Open path:N" context-menu entry,
 *  future surfaces — calls `openInCodeTab(...)` instead of writing the
 *  preferences patch and pending-request signal separately. The function
 *  encapsulates the paired writes (panel-uncollapse + tab + browse-mode +
 *  pending request) so the SolidJS effect-ordering invariant lives here,
 *  not at every call site.
 *
 *  Latest request wins; callers don't clear it. Each call mints a fresh
 *  request object — two clicks on the same `path:line` are distinct by
 *  reference, which is what lets `CodeTab` tell them apart even when
 *  their `ref` content matches and re-paint the highlight. */

import type { CodeTabView } from "kolu-common/surface";
import { batch, createSignal } from "solid-js";
import type { LineRef } from "../ui/lineRef";
import { useRightPanel } from "./useRightPanel";

export interface OpenInCodeTabRequest {
  /** Parsed `path:line[-end]` to navigate to. The path is interpreted
   *  relative to `repoRoot` (or, when present, cwd-relative under
   *  `repoRoot`) by `CodeTab` via `resolveLineRefPath`. */
  ref: LineRef;
  /** Per-terminal git repo root that `ref.path` is relative to (when
   *  relative). Absolute paths beneath this root are also accepted —
   *  the resolver normalizes both shapes. */
  repoRoot: string;
  /** Terminal cwd at the time of the request. Drives the "user typed
   *  `bar.ts:42` while standing in a subdirectory of the repo" case;
   *  undefined falls back to repo-relative interpretation only. */
  cwd?: string;
  /** Which Code-tab sub-mode the request expects to land in.
   *  Producers that don't track an authoring mode pass `"browse"`. */
  targetMode: CodeTabView;
}

const [pending, setPending] = createSignal<OpenInCodeTabRequest | null>(null);

export const pendingOpen = pending;

/** Open the right panel's Code tab at `req.targetMode` showing `req.ref`.
 *  The two reactive writes (preferences patch + pending-request signal)
 *  are wrapped in `batch()` so SolidJS defers all dependent effects
 *  until both have committed. Without the batch, the preferences
 *  optimistic update ticks `view()` first, which fires `CodeTab`'s
 *  `resetKey` effect — at that moment `pendingOpen()` is still null
 *  (setPending hasn't run yet), the guard fails, and selectedPath gets
 *  cleared. The Terminal call site used to escape this by being inside
 *  a JSX click handler (Solid's event delegation auto-batches), but
 *  once the writes moved into a standalone function the implicit batch
 *  was lost. */
export function openInCodeTab(req: OpenInCodeTabRequest): void {
  batch(() => {
    useRightPanel().openCodeAt(req.targetMode);
    setPending(req);
  });
}
