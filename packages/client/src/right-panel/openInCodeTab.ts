/** "Open this file:line in a Code view" — the DOOR every Code view is handed,
 *  and the Right panel's FRONT door.
 *
 *  A Code view is handed its own {@link CodeDoor}: its own pending request
 *  (the content consumer — the view re-paints the highlight when the same
 *  `ref` arrives twice) and its own way to make one. Every open made INSIDE a
 *  view — back/forward to a line, a comment jump, "Open path:N" on a diff
 *  line, a link in a rendered document — asks the view it is in, so a request
 *  made in one view is never seen by another.
 *
 *  The Right panel's door is the front door, `openInCodeTab(...)`, which a
 *  terminal link and a deep link call from outside any view. It encapsulates
 *  the coordinated writes (terminal focus + tab/browse-mode + visibility
 *  uncollapse + pending request) so the SolidJS effect-ordering invariant
 *  lives here, not at every call site.
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
 *  consumer.
 *
 *  Latest request wins; callers don't clear it. Each call mints a fresh
 *  request object — two clicks on the same `path:line` are distinct by
 *  reference, which is what lets the view tell them apart even when
 *  their `ref` content matches and re-paint the highlight. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, batch, createSignal } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { LineRef } from "../ui/lineRef";
import { activeHost } from "../wire";
import type {
  CodeTabScope,
  OpenInCodeTabRequest,
} from "./codeTabOpenController";
import { useRightPanel } from "./useRightPanel";

export type { OpenInCodeTabRequest } from "./codeTabOpenController";

/** What an open asks for, wherever it is made. */
export interface CodeOpenInput {
  /** Parsed `path:line[-end]` to navigate to. The path is interpreted
   *  relative to the view's own root (or, when present, cwd-relative under
   *  it) by the view via `resolveRef` — which also recognises a folder path
   *  and reveals it in the tree instead of opening a file. */
  ref: LineRef;
  /** Terminal cwd at the time of the request. Drives the "user typed
   *  `bar.ts:42` while standing in a subdirectory of the repo" case;
   *  undefined falls back to repo-relative interpretation only. */
  cwd?: string;
  /** Which Code-tab sub-mode the request expects to land in.
   *  Producers that don't track an authoring mode pass `"browse"`. */
  targetMode: CodeTabView;
  /** Whether the view's resolver may fall back to a unique-basename
   *  match when `ref.path` isn't found exactly. Defaults to true —
   *  terminal output prints bare basenames (#898). Markdown relative
   *  links (#1161) pass `false`: a `[guide](docs/guide.md)` href carries
   *  GitHub-style exact semantics and must open exactly that path or
   *  fail, never silently open a same-basename file elsewhere. */
  allowBasenameFallback?: boolean;
}

/** Make an open request. */
export type CodeOpen = (req: CodeOpenInput) => void;

/** A Code view's door: the request pending for it, and how to make one. */
export interface CodeDoor {
  readonly pending: Accessor<OpenInCodeTabRequest | null>;
  readonly open: CodeOpen;
}

interface OpenInCodeTabInput extends CodeOpenInput {
  /** The terminal whose per-terminal selection and history this request owns —
   *  and whose repo the path resolves against. May be a split. */
  terminalId: TerminalId;
}

/** The one shape of a pending-request cell. `equals: false` forces every
 *  write to notify regardless of value identity — the view re-paints the
 *  highlight on every fire, even when the same `path:line` is clicked twice
 *  in a row. */
function pendingRequest() {
  return createSignal<OpenInCodeTabRequest | null>(null, { equals: false });
}

/** A Code view's OWN door. A request names the scope `scopeFor` gives for
 *  its target mode and is seen by this door's view alone. Touches nothing
 *  else: no focus, no tab, no panel. */
export function createCodeDoor(
  scopeFor: (mode: CodeTabView) => CodeTabScope,
): CodeDoor {
  const [pending, setPending] = pendingRequest();
  return {
    pending,
    open: (req) =>
      setPending({
        ref: req.ref,
        cwd: req.cwd,
        allowBasenameFallback: req.allowBasenameFallback,
        scope: scopeFor(req.targetMode),
      }),
  };
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
      owner: { kind: "pane", terminalId: req.terminalId },
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
