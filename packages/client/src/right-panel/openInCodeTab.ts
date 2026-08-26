/** Front door for "open this file:line in the Code tab". Every producer
 *  — terminal-link click, right-click "Open path:N" context-menu entry,
 *  future surfaces — calls `openInCodeTab(...)` instead of writing the
 *  preferences patch and pending-request signal separately. The function
 *  encapsulates the coordinated writes (terminal focus + tab/browse-mode +
 *  visibility uncollapse + pending request) so the SolidJS effect-ordering
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

import type { CodeTabView } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { batch, createSignal } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { LineRef } from "../ui/lineRef";
import { activeHost } from "../wire";
import type { OpenInCodeTabRequest } from "./codeTabOpenController";
import { useRightPanel } from "./useRightPanel";

export type { OpenInCodeTabRequest } from "./codeTabOpenController";

interface OpenInCodeTabInput {
  /** The terminal whose per-terminal selection and history this request owns. */
  terminalId: TerminalId;
  /** Parsed `path:line[-end]` to navigate to. The path is interpreted
   *  relative to the panel-owning tile's repository (or, when present,
   *  cwd-relative under it) by `CodeTab` via `resolveRef` — which also
   *  recognises a folder path and reveals it in the tree instead of opening a
   *  file. */
  ref: LineRef;
  /** Terminal cwd at the time of the request. Drives the "user typed
   *  `bar.ts:42` while standing in a subdirectory of the repo" case;
   *  undefined falls back to repo-relative interpretation only. */
  cwd?: string;
  /** Which Code-tab sub-mode the request expects to land in.
   *  Producers that don't track an authoring mode pass `"browse"`. */
  targetMode: CodeTabView;
  /** Whether `CodeTab`'s resolver may fall back to a unique-basename
   *  match when `ref.path` isn't found exactly. Defaults to true —
   *  terminal output prints bare basenames (#898). Markdown relative
   *  links (#1161) pass `false`: a `[guide](docs/guide.md)` href carries
   *  GitHub-style exact semantics and must open exactly that path or
   *  fail, never silently open a same-basename file elsewhere. */
  allowBasenameFallback?: boolean;
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
 *  Four reactive writes wrapped in `batch()` so downstream effects see
 *  the changes in one reactive transaction: the issuing terminal becomes the
 *  panel owner, its tab/mode changes (`openCodeAt`), workspace visibility
 *  changes (`rp.reveal()` — uncollapse desktop or open the mobile drawer), and
 *  the producer signal fires (`setPending`). */
export function openInCodeTab(req: OpenInCodeTabInput): void {
  const rp = useRightPanel();
  const terminals = useTerminalStore();
  const target = terminals.getMetadata(req.terminalId);
  if (target === undefined)
    throw new Error(
      `openInCodeTab: no terminal metadata for ${req.terminalId}`,
    );
  // Right-panel chrome is keyed on the ROOT tile — a nested split's true
  // parent may itself be a middle node with no panel state.
  const panelOwnerId = terminals.containingTile(req.terminalId);
  const panelOwner =
    panelOwnerId === req.terminalId
      ? target
      : terminals.getMetadata(panelOwnerId);
  if (panelOwner === undefined)
    throw new Error(
      `openInCodeTab: no panel-owner metadata for ${panelOwnerId}`,
    );
  const repoRoot = panelOwner.git?.repoRoot;
  if (repoRoot === undefined)
    throw new Error(`openInCodeTab: panel owner ${panelOwnerId} has no repo`);
  const request: OpenInCodeTabRequest = {
    ref: req.ref,
    cwd: req.cwd,
    allowBasenameFallback: req.allowBasenameFallback,
    scope: {
      host: activeHost(),
      terminalId: panelOwnerId,
      repoRoot,
      mode: req.targetMode,
    },
  };
  batch(() => {
    terminals.focusTerminalSilently(req.terminalId);
    rp.openCodeAt(request.scope.mode);
    rp.reveal();
    setPending(request);
  });
}
