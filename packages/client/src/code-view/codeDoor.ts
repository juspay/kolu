/** "Open this file:line in a Code view" — the DOOR every Code view is handed.
 *
 *  A Code view is handed its own {@link CodeDoor}: its own pending request
 *  (the content consumer — the view re-paints the highlight when the same
 *  `ref` arrives twice) and its own way to make one. Every open made INSIDE a
 *  view — back/forward to a line, a comment jump, "Open path:N" on a diff
 *  line, a link in a rendered document — asks the view it is in, so a request
 *  made in one view is never seen by another.
 *
 *  Latest request wins; callers don't clear it. Each open mints a fresh
 *  request object — two clicks on the same `path:line` are distinct by
 *  reference, which is what lets the view tell them apart even when their
 *  `ref` content matches and re-paint the highlight.
 *
 *  The Right panel's front door, which a terminal link and a deep link call
 *  from outside any view, is `openInCodeTab.ts`. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import { type Accessor, createSignal } from "solid-js";
import type { LineRef } from "../ui/lineRef";
import type {
  CodeTabScope,
  OpenInCodeTabRequest,
} from "./codeTabOpenController";

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

/** The one shape of a pending-request cell. `equals: false` forces every
 *  write to notify regardless of value identity — the view re-paints the
 *  highlight on every fire, even when the same `path:line` is clicked twice
 *  in a row. */
export function pendingRequest() {
  return createSignal<OpenInCodeTabRequest | null>(null, {
    equals: false,
    name: "codeDoor.pendingRequest",
  });
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
