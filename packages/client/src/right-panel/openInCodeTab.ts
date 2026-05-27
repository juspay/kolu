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

// Module-level singleton. Right-panel state is a singleton in Kolu —
// one panel, one CodeTab — and the navigation request is meant for
// the unique consumer. If kolu ever mounts multiple CodeTab instances
// (split panels, multi-window), this signal must move into a
// SolidJS context or scope to a per-panel store, otherwise concurrent
// consumers will race on each other's pending requests.
//
// `equals: false` forces every `setPending(req)` to notify subscribers
// regardless of value identity. Without it, the Solid production
// build could elide a re-fire on rapid consecutive clicks where the
// pre-built bundle's reactive tracking saw the second `req` reference
// as "no change" — `file-ref-link.feature`'s "Re-clicking the same
// file-ref after closing the panel" was the canary.
const [pending, setPending] = createSignal<OpenInCodeTabRequest | null>(null, {
  equals: false,
});

export const pendingOpen = pending;

/** Open the right panel's Code tab at `req.targetMode` showing `req.ref`.
 *  The two reactive writes (preferences patch + pending-request signal)
 *  are wrapped in `batch()` so downstream effects see both changes in
 *  the same reactive transaction — one tick instead of two. Pure
 *  optimization since the `resetKey`-vs-pendingOpen race was removed
 *  (selection is now per-slot, so no effect clears `selectedPath`);
 *  kept because the merged tick still avoids a flash of intermediate
 *  state during navigation. */
export function openInCodeTab(req: OpenInCodeTabRequest): void {
  batch(() => {
    useRightPanel().openCodeAt(req.targetMode);
    setPending(req);
  });
}
