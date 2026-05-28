/** Front door for "open this file:line in the Code tab". Every producer
 *  — terminal-link click, right-click "Open path:N" context-menu entry,
 *  future surfaces — calls `openInCodeTab(...)` instead of writing the
 *  preferences patch and pending-request signal separately. The function
 *  encapsulates the paired writes (tab + browse-mode + visibility
 *  uncollapse + pending request) so the SolidJS effect-ordering
 *  invariant lives here, not at every call site.
 *
 *  Visibility (desktop uncollapse / mobile drawer open) is dispatched
 *  imperatively from here rather than via a deferred `createEffect(on(
 *  pendingOpen, ...))` subscriber. The deferred-effect shape worked in
 *  dev but lost subsequent fires under the production Solid build —
 *  even with `equals: false` on the signal — when the same `req` value
 *  flowed through twice with a manual collapse in between (the
 *  `file-ref-link.feature` "re-click after collapse" canary). Driving
 *  visibility from the producer call itself sidesteps that elision
 *  path entirely; the `pendingOpen` signal remains for the *content*
 *  consumer (`CodeTab` re-paints the highlight when the same `ref`
 *  arrives twice).
 *
 *  Latest request wins; callers don't clear it. Each call mints a fresh
 *  request object — two clicks on the same `path:line` are distinct by
 *  reference, which is what lets `CodeTab` tell them apart even when
 *  their `ref` content matches and re-paint the highlight. */

import type { LineRef } from "@kolu/file-line-ref";
import type { CodeTabView } from "kolu-common/surface";
import { batch, createSignal } from "solid-js";
import { isMobile } from "../useMobile";
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
// regardless of value identity — `CodeTab` re-paints the highlight on
// every fire, even when the user clicks the same `path:line` twice
// in a row.
const [pending, setPending] = createSignal<OpenInCodeTabRequest | null>(null, {
  equals: false,
});

export const pendingOpen = pending;

/** Open the right panel's Code tab at `req.targetMode` showing `req.ref`.
 *  Three reactive writes wrapped in `batch()` so downstream effects see
 *  the changes in one reactive transaction: per-terminal tab/mode
 *  (`openCodeAt`), workspace visibility (uncollapse desktop / open mobile
 *  drawer), and the producer signal (`setPending`). */
export function openInCodeTab(req: OpenInCodeTabRequest): void {
  const rp = useRightPanel();
  batch(() => {
    rp.openCodeAt(req.targetMode);
    if (isMobile()) {
      rp.setDrawerOpen(true);
    } else if (rp.collapsed()) {
      rp.expandPanel();
    }
    setPending(req);
  });
}
