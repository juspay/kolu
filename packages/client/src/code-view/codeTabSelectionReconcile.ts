import type { CodeTabView } from "@kolu/padi-client/surface";
import { type Accessor, createMemo, untrack } from "solid-js";
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
 *  THE WRITE IS GROUNDED. The derivation below decides what is SHOWN; this
 *  guard decides what is STORED, so a write landing on a file the settled
 *  inventory has already dropped — a same-mode back/forward step onto it —
 *  does not seat a dead path in the slot (and in the record the next session
 *  restores). Judging the written path here, against the frame standing at
 *  the write and through the same verdict, seats `null` instead. History
 *  still records what was asked for, as it did when the selection was seated
 *  and then cleared a frame later. The one path the inventory may rightly not
 *  list yet is one a direct read just proved, which the caller declares with
 *  `proven` — the writes that mint the pin and seat the selection share a
 *  flush, so the pin itself is not readable here.
 *
 *  Only a write to the SHOWN mode is grounded: another mode's slot is seeded
 *  against an inventory that is not its own (the tree menu's cross-mode jump
 *  writes before `setView`), and that slot is judged by the derivation on the
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

/** What the shown-selection derivation reads. Every field is a READ: the
 *  shown file is derived, so nothing here is written back. */
export interface CodeTabShownSelectionIo {
  /** The STORED pick of the shown mode — the slot's own record. */
  selectedPath: Accessor<string | null>;
  /** The repo slot that pick belongs to (`codeTabRepoSlotKey`). */
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
}

/** What the derivation carries from one frame to the next: the slot it last
 *  judged for, the pin it has already seen the inventory catch up with, and
 *  the file to SHOW. */
interface CodeTabShownSelection {
  slot: string | null;
  retiredPin: OpenInCodeTabRequest | null;
  path: string | null;
}

/** THE SHOWN FILE: the stored pick, unless the retained tree inventory
 *  condemns it.
 *
 *  This is a DERIVATION, not a reconcile that writes. The stored slot keeps
 *  its pick; a file the settled inventory does not list simply stops being
 *  shown, in the SAME pass that publishes the inventory. Deriving it is what
 *  removes the frame that used to paint a dead file: an effect that wrote the
 *  clear ran after the readers of the landed paths, so the tree was handed a
 *  `selected` path its own `paths` no longer contained, and corrected on the
 *  next flush (`EFFECT_RELAY_TEAR`). The server-side record keeps the dead
 *  path until the next pick, where this same derivation judges it again — so
 *  nothing observable rides on the write that is gone.
 *
 *  Track membership rather than the `paths` array identity: browse paths come
 *  from a reconciled store array whose contents can change in place. Gate on
 *  the inventory's OWN readiness — taken from the same value as the paths, so
 *  the guard can never check a half-loaded tree against a settled flag. When a
 *  stream resubscribes (e.g. on right-panel tab switch, since its inputFn
 *  returns a fresh object literal), the value briefly resets to undefined and
 *  the inventory collapses to `[]`. Treating that transient empty as "selected
 *  file is missing" would hide the selection on every resubscribe and lose it
 *  across tab toggles. Once the stream has delivered (`!pending`), an empty
 *  paths set IS authoritative — the file truly went away (commit cleared local
 *  diff, rm deleted it) — except for a path a direct fresh read just proved
 *  exists. That result can beat the retained stream's repo-change pulse, so
 *  `freshSelection` pins the path until the retained inventory first contains
 *  it; `retiredPin` is that "first contains it", kept here because the door
 *  holds its request until the next open (nothing consumes it any more). From
 *  that point the normal removal rule is authoritative again.
 *
 *  HOLD THE PICK ON THE FRAME THE REPO SLOT ITSELF MOVES. The shared paths /
 *  pending signals can momentarily expose the previous repo's snapshot before
 *  the query re-keys, so the new slot's pick would be judged against the
 *  previous repo's tree and falsely hidden. The frame that sees both slots
 *  shows the pick; the next one judges it against the values for its own slot.
 *  (A pane switch inside one repo does not move this key — the inventory is
 *  the same repo's — so nothing is held there.) The inventory's own
 *  `scope` stamp cannot serve as this gate: it is minted for the browse
 *  listings alone, and the diff modes' changed-file inventory carries none,
 *  so gating on it would stop ever hiding a committed file in Local/Branch.
 *
 *  Every input is read BEFORE that hold returns, so a held frame still
 *  subscribes to the inventory that will settle it. */
export function codeTabShownSelection(
  io: CodeTabShownSelectionIo,
): Accessor<string | null> {
  const shownSelection = createMemo<CodeTabShownSelection>(
    (previous) => {
      const slot = io.repoSlotKey();
      const path = io.selectedPath();
      const fresh = io.freshSelection();
      const pendingRequest = io.pendingRequest();
      const { paths, pending } = io.inventory();
      const retiredPin = previous?.retiredPin ?? null;
      const pinned =
        fresh !== null &&
        fresh.request === pendingRequest &&
        fresh.request !== retiredPin
          ? fresh.path
          : null;
      if (previous !== undefined && previous.slot !== slot)
        return { slot, retiredPin, path };
      const verdict = codeTabSelectionInventoryVerdict(
        path,
        pending,
        paths,
        pinned,
      );
      return {
        slot,
        retiredPin:
          verdict === "confirm-fresh" && fresh !== null
            ? fresh.request
            : retiredPin,
        path: verdict === "clear" ? null : path,
      };
    },
    {
      // The value is a fresh record per frame; consumers read the shown path
      // through the accessor below, so an unchanged verdict must stay silent.
      equals: (a, b) =>
        a.path === b.path && a.slot === b.slot && a.retiredPin === b.retiredPin,
    },
  );
  return () => shownSelection().path;
}
