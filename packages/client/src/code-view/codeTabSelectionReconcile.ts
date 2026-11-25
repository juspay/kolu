import type { CodeTabView } from "@kolu/padi-client/surface";
import { type Accessor, createEffect, untrack } from "solid-js";
import {
  codeTabSelectionInventoryVerdict,
  type OpenInCodeTabRequest,
} from "./codeTabOpenController";

/** The history entry a recorded selection writes. */
interface CodeTabNavigation {
  mode: CodeTabView;
  path: string | null;
  ref?: { startLine: number; endLine: number };
}

/** What the selection funnel reads, and the two writes it owns. */
export interface CodeTabSelectIo {
  /** The shown mode — the one whose inventory a write is judged against. */
  view: Accessor<CodeTabView>;
  /** The retained tree inventory AND its readiness, minted together. */
  inventory: Accessor<{ paths: readonly string[]; pending: boolean }>;
  setSelectedFile: (mode: CodeTabView, path: string | null) => void;
  recordNavigation: (loc: CodeTabNavigation) => void;
}

/** How a selection is written. */
export interface CodeTabSelectOptions {
  ref?: { startLine: number; endLine: number };
  /** Skip the history entry: a mechanical clear, or a history replay. */
  record?: boolean;
  /** A direct read just proved this path exists. The retained inventory has
   *  not published it yet, so it must not be grounded away — it is the same
   *  pin the reconcile holds until the inventory catches up. */
  proven?: boolean;
}

/** The single selection funnel: set the shown file AND record it in history.
 *  Recording can never drift from selection because they are one call —
 *  routing every selection-mutation site through here replaces the convention
 *  of placing a paired `recordNavigation` next to each write. Recording is
 *  skipped when `record === false` (mechanical clears, history replay) or when
 *  `path === null` (clearing the slot is not a navigation).
 *
 *  THE WRITE IS GROUNDED. The reconcile below judges a selection on an
 *  inventory frame and on no other, so a write landing BETWEEN frames — a
 *  same-mode back/forward step onto a file the inventory has already dropped —
 *  would otherwise seat a path nothing ever condemns. Judging the written path
 *  here, against the frame standing at the write and through the same verdict,
 *  seats `null` instead: the shown file is never a file the settled inventory
 *  does not list. History still records what was asked for, as it did when the
 *  selection was seated and then cleared a frame later. The one path the
 *  inventory may rightly not list yet is one a direct read just proved, which
 *  the caller declares with `proven` — the writes that mint the pin and seat
 *  the selection share a flush, so the pin itself is not readable here.
 *
 *  Only a write to the SHOWN mode is grounded: another mode's slot is seeded
 *  against an inventory that is not its own (the tree menu's cross-mode jump
 *  writes before `setView`), and that slot is judged by the reconcile on the
 *  first frame the switch publishes.
 *
 *  The inputs are read `untrack`ed: this funnel runs from gestures and from
 *  effect bodies, and reading the inventory must never enrol a caller in it. */
export function createCodeTabSelect(
  io: CodeTabSelectIo,
): (
  mode: CodeTabView,
  path: string | null,
  opts?: CodeTabSelectOptions,
) => void {
  return (mode, path, opts) => {
    io.setSelectedFile(
      mode,
      untrack(() => groundCodeTabSelection(io, mode, path, opts)),
    );
    if (opts?.record === false || path === null) return;
    io.recordNavigation({ mode, path, ref: opts?.ref });
  };
}

/** The written path if the standing inventory frame does not condemn it, else
 *  `null`. Untracked by its caller. */
function groundCodeTabSelection(
  io: CodeTabSelectIo,
  mode: CodeTabView,
  path: string | null,
  opts: CodeTabSelectOptions | undefined,
): string | null {
  if (path === null || opts?.proven === true || mode !== io.view()) return path;
  const { paths, pending } = io.inventory();
  return codeTabSelectionInventoryVerdict(path, pending, paths, null) ===
    "clear"
    ? null
    : path;
}

/** What the reconcile reads and what it is allowed to do about it. */
export interface CodeTabSelectionReconcileIo {
  /** The shown file in the shown mode. */
  selectedPath: Accessor<string | null>;
  /** The repo slot the shown file belongs to (`codeTabRepoSlotKey`). */
  repoSlotKey: Accessor<string | null>;
  /** The retained tree inventory AND its readiness, minted together. */
  inventory: Accessor<{ paths: readonly string[]; pending: boolean }>;
  /** The pin a fresh read left: the request it proved, and the path. */
  freshSelection: Accessor<{
    request: OpenInCodeTabRequest;
    path: string;
  } | null>;
  /** The view's pending open request — what a pin is still addressed to. */
  pendingRequest: Accessor<OpenInCodeTabRequest | null>;
  /** The shown mode, read once per decision. */
  view: Accessor<CodeTabView>;
  /** Drop the pin: the retained inventory has caught up. */
  consumeFreshSelection: () => void;
  /** Clear the shown file in `mode` — a mechanical clear, not a navigation. */
  clearSelection: (mode: CodeTabView) => void;
}

/** Reconcile the shown file with the retained tree inventory.
 *
 *  Track membership rather than the `paths` array identity: browse paths come
 *  from a reconciled store array whose contents can change in place. Gate on
 *  the inventory's OWN readiness — taken from the same value as the paths, so
 *  the guard can never check a half-loaded tree against a settled flag. When a
 *  stream resubscribes (e.g. on right-panel tab switch, since its inputFn
 *  returns a fresh object literal), the value briefly resets to undefined and
 *  the inventory collapses to `[]`. Treating that transient empty as "selected
 *  file is missing" would null the selection on every resubscribe and lose it
 *  across tab toggles. Once the stream has delivered (`!pending`), an empty
 *  paths set IS authoritative — the file truly went away (commit cleared local
 *  diff, rm deleted it) — except for a path a direct fresh read just proved
 *  exists. That result can beat the retained stream's repo-change pulse, so
 *  `freshSelection` pins the path until the retained inventory first contains
 *  it. From that point the normal removal rule is authoritative again.
 *
 *  THE INVENTORY IS THE TRIGGER, and it is the only authority: a selection is
 *  judged on the frame the listing that could condemn it moves, and on no
 *  other. Both values this effect WRITES — the pin it consumes and the
 *  selection it clears — are therefore read `untrack`ed, the same split `view`
 *  has below. Tracked, each write fed straight back into this compute: a second
 *  run for one inventory frame, with the pre-write verdict painted in between
 *  (`EFFECT_WRITES_OWN_SOURCE`). Nothing is missed by it: a selection written
 *  between frames is judged at the write instead, by `createCodeTabSelect`
 *  above, and a slot restored with a stale pick is judged on its first settled
 *  frame (`pending` falling is a frame like any other).
 *
 *  Bail on the tick where `repoSlotKey` itself just changed: the shared paths /
 *  pending signals can momentarily expose the previous repo's snapshot before
 *  the query blanks for the new input, so the new slot's selection would be
 *  checked against the previous repo's tree and falsely cleared. The next tick
 *  (after the reset effect runs) re-evaluates with the authoritative values for
 *  the new slot. (A pane switch inside one repo does not move this key — the
 *  inventory is the same repo's — so no bail is needed there.) */
export function createCodeTabSelectionReconcile(
  io: CodeTabSelectionReconcileIo,
): void {
  createEffect(
    () => {
      // The pin and the selection are this effect's OWN outputs: read once per
      // inventory frame, never subscribed to (see the header).
      const s = untrack(io.selectedPath);
      const sk = io.repoSlotKey();
      const { paths, pending } = io.inventory();
      const fresh = untrack(io.freshSelection);
      const freshPath =
        fresh !== null && fresh.request === untrack(io.pendingRequest)
          ? fresh.path
          : null;
      return {
        s,
        sk,
        // Read once, without depending on it: the mode a clear is addressed
        // to is the one showing when the verdict lands, and a mode switch is
        // not itself a reason to re-decide.
        view: untrack(io.view),
        verdict: codeTabSelectionInventoryVerdict(s, pending, paths, freshPath),
      };
    },
    (cur, prev) => {
      if (prev && prev.sk !== cur.sk) return;
      if (cur.verdict === "confirm-fresh") {
        io.consumeFreshSelection();
      } else if (cur.s && cur.verdict === "clear") {
        io.clearSelection(cur.view);
      }
    },
    { defer: true },
  );
}
