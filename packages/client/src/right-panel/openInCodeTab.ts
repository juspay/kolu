/** The Right panel's FRONT door: "open this file:line in the Right panel's
 *  Code tab", which a terminal link and a deep link call from outside any
 *  view, and the door the panel's own Code view is handed. Every other Code
 *  view has a door of its own (`codeDoor.ts`).
 *
 *  `openInCodeTab(...)` encapsulates the coordinated writes (terminal focus +
 *  tab/browse-mode + visibility uncollapse + pending request) so the SolidJS
 *  effect-ordering invariant lives here, not at every call site.
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
 *  consumer. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, batch } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activeHost } from "../wire";
import { type CodeDoor, type CodeOpenInput, pendingRequest } from "./codeDoor";
import { paneCodeOwner } from "./hostCodeTab";
import type { OpenInCodeTabRequest } from "./codeTabOpenController";
import { useRightPanel } from "./useRightPanel";

interface OpenInCodeTabInput extends CodeOpenInput {
  /** The terminal whose per-terminal selection and history this request owns —
   *  and whose repo the path resolves against. May be a split. */
  terminalId: TerminalId;
}

// The Right panel's pending request. One panel, one Code view over it: the
// request is meant for that view alone (another view has its own door).
const [pending, setPending] = pendingRequest();

export const pendingOpen = pending;

/** Open the right panel's Code tab at `req.targetMode` showing `req.ref`.
 *  Four reactive writes wrapped in `batch()` so downstream effects see
 *  the changes in one reactive transaction: the issuing terminal becomes the
 *  FOCUSED PANE (and so the panel's subject), its tab/mode changes
 *  (`openCodeAt`), workspace visibility changes (`rp.reveal()` — uncollapse
 *  desktop or open the mobile drawer), and the producer signal fires
 *  (`setPending`).
 *
 *  The request is scoped to the issuing terminal ITSELF and its own
 *  `git.repoRoot` — no containing-tile indirection. The panel follows focus,
 *  so a `path:line` clicked in a split resolves against THAT split's repo and
 *  opens in THAT split's panel state; running it against the tile's main
 *  terminal would resolve the path in the wrong repository. */
export function openInCodeTab(req: OpenInCodeTabInput): void {
  const rp = useRightPanel();
  const terminals = useTerminalStore();
  const target = terminals.getMetadata(req.terminalId);
  if (target === undefined)
    throw new Error(
      `openInCodeTab: no terminal metadata for ${req.terminalId}`,
    );
  if (target.git.kind !== "repo")
    throw new Error(
      `openInCodeTab: terminal ${req.terminalId} has no repo (git ${target.git.kind})`,
    );
  const repoRoot = target.git.info.repoRoot;
  const request: OpenInCodeTabRequest = {
    ref: req.ref,
    cwd: req.cwd,
    allowBasenameFallback: req.allowBasenameFallback,
    scope: {
      host: activeHost(),
      owner: paneCodeOwner(req.terminalId),
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

/** The Right panel's door, as its Code view is handed it — and as a reader
 *  that opens into the Right panel hands it on: the panel's one pending
 *  request, and an open that goes through {@link openInCodeTab} for
 *  `terminal()`, the pane the view shows. Opening with no pane is a defect
 *  of the caller, and throws. */
export function rightPanelCodeDoor(
  terminal: Accessor<TerminalId | null>,
): CodeDoor {
  return {
    pending: pendingOpen,
    open: (req) => {
      const terminalId = terminal();
      if (terminalId === null)
        throw new Error("openInCodeTab: no pane to open the file in");
      openInCodeTab({ ...req, terminalId });
    },
  };
}
