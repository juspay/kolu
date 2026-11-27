/** Shared line-selection + line-ref-menu wiring for Pierre's file and diff
 *  viewers (`@pierre/diffs`). Both renderers expose `enableLineSelection` +
 *  `onLineSelected`, both surface a context menu offering "Copy path" plus
 *  "Copy <path>:<line>" when a line is selected, and both must drop the
 *  selection when the displayed file changes. Centralizing the protocol
 *  here means new menu entries are a single edit.
 *
 *  Usage:
 *    const sel = useLineSelection(() => props.path);
 *    // wire `sel.handleSelect` into Pierre's `onLineSelected`
 *    // wire `sel.buildItems` into `<CodeContextMenu getItems=...>`
 */

import type { SelectedLineRange } from "@pierre/diffs";
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { CodeContextMenuItem } from "./CodeContextMenu";
import { CopyIcon, OpenIcon } from "./Icons";
import { formatLineRef, type LineRef } from "./lineRef";

export type LineSelection = {
  /** The file the selection and the menu anchor to. It is the view's own
   *  path until `handleSelect` names another one — a view that shows several
   *  files (a type-changed path's diff also shows the files that used to
   *  live under it) anchors to the file the user actually selected in. */
  path: Accessor<string>;
  /** Current selection range — bind to Pierre's `selectedLines` prop
   *  so the visual highlight tracks the controller. */
  range: Accessor<SelectedLineRange | null>;
  /** Bind to Pierre's `onLineSelected` — the renderer fires this on every
   *  selection commit (single-line click or drag end). `path` names the file
   *  the range is in when the view shows more than one; omitted, the range
   *  is in the view's own file. */
  handleSelect: (range: SelectedLineRange | null, path?: string) => void;
  /** Bind to `<CodeContextMenu getItems>`. Returns "Copy path" plus, when
   *  a line is selected, "Copy <path>:<line>" with the rendered ref —
   *  and, when `options.onOpen` is provided, an "Open <path>:<line>"
   *  action entry that dispatches to the host. */
  buildItems: () => CodeContextMenuItem[];
};

export interface LineSelectionOptions {
  /** Externally-driven initial range — caller updates this when a new
   *  navigation request lands (e.g. terminal `path:line` click). The
   *  derivation below folds it into the controller's range, which means
   *  the right-click menu and the Pierre highlight stay in sync. */
  initialRange?: Accessor<SelectedLineRange | null | undefined>;
  /** Accessor — re-read at `buildItems()` time. Returning a handler
   *  adds an "Open <path>:<line>" entry to the menu while a range is
   *  selected; returning undefined omits it. Accessor (not bare
   *  callback) so a host whose prop arrives later in the lifecycle
   *  still flips the item in once it's available. The host is
   *  responsible for routing the ref through the Code-tab open
   *  dispatcher. */
  onOpen?: Accessor<((ref: LineRef) => void) | undefined>;
}

export function useLineSelection(
  scope: Accessor<string>,
  options: LineSelectionOptions = {},
): LineSelection {
  /** THE RESEED, DERIVED. What the controller holds is "the selection this
   *  scope has, until the user makes another one" — a value, so it is
   *  computed, not written from an effect.
   *
   *  As an effect it was a relay: the apply arm wrote `range`, and the
   *  viewer's own binding folds BOTH legs of one path change in a single memo
   *  (`@kolu/solid-pierre`'s `useCodeViewSelection` reads `range()` and
   *  `id()`, the very `() => props.filePath` the reseed is keyed on —
   *  `code-view/BrowseFileView.tsx:56-59`). So each path change ran that memo
   *  twice: once with the new id and the STALE range (Pierre told to
   *  highlight the old file's lines in the new file), and again after the
   *  write relayed the change. Solid grades it `EFFECT_RELAY_TEAR`.
   *
   *  As a WRITABLE MEMO keyed on the scope edge — the same idiom as
   *  `CommandPalette`'s `onOpenEdge` — the reseed arrives in the SAME flush
   *  as the change that caused it, and `handleSelect`'s writes stay exactly
   *  as they were: the edge's own memory (`scope`/`initial`) rides in the
   *  state, so the derivation sees only `prev` and nothing reseeds over a
   *  user selection while both stand still. */
  type SelectionState = {
    /** The scope and the request this state was seeded for — the edge's
     *  memory, so a re-publish of the same pair is not an edge. */
    readonly scope: string;
    readonly initial: SelectedLineRange | null;
    readonly anchor: string | null;
    readonly range: SelectedLineRange | null;
  };
  const [state, setState] = createSignal<SelectionState>(
    (prev?: SelectionState): SelectionState => {
      // Reseed on either trigger — a new file replaces the selection scope (a
      // stale "Copy path:N" entry must not survive), and an external request
      // ticks `initialRange` with the new target. Both seed from the same
      // source, so one keyed state covers both.
      const nextScope = scope();
      const initial = options.initialRange?.() ?? null;
      if (prev && prev.scope === nextScope && prev.initial === initial) {
        return prev;
      }
      return { scope: nextScope, initial, anchor: null, range: initial };
    },
    { name: "lineSelectionState" },
  );
  // Memos, so a reader wakes for a CHANGED value and not for an edge that left
  // it alone (a reseed to the range already shown).
  const range = createMemo(() => state().range, { name: "lineSelectionRange" });
  // The file a selection landed in, when it is not `scope` itself. Held
  // beside `range` and reseeded with it, so the anchor can't outlive the view.
  const path = () => state().anchor ?? scope();

  return {
    path,
    range,
    handleSelect: (r, p) => {
      setState((prev) => ({ ...prev, anchor: p ?? null, range: r }));
    },
    buildItems: () => {
      // The menu is line-anchored: every entry refers to a specific
      // `path:line` ref, so a build without a selected range returns
      // empty. `<CodeContextMenu>`'s `open()` short-circuits on empty
      // items, which means the right-click on whitespace produces no
      // menu — the path-only menu was actionable noise (just one
      // "Copy path" item, redundant with the in-menu Copy entries
      // that ALSO copy the path bundled with the line).
      const r = range();
      if (!r) return [];
      // Snapshot `path()` once so label, copy text, and onActivate
      // capture all agree. Reading the accessor inside `onActivate`
      // would resolve at click time and could disagree with the
      // rendered label if Pierre remounts to a different file between
      // menu-open and click.
      const p = path();
      const refStr = formatLineRef(p, r.start, r.end);
      const items: CodeContextMenuItem[] = [
        { kind: "copy", label: "Copy path", icon: CopyIcon, textToCopy: p },
        {
          kind: "copy",
          label: `Copy ${refStr}`,
          icon: CopyIcon,
          textToCopy: refStr,
        },
      ];
      const onOpen = options.onOpen?.();
      if (onOpen) {
        items.push({
          kind: "action",
          label: `Open ${refStr}`,
          icon: OpenIcon,
          onActivate: () =>
            onOpen({ path: p, startLine: r.start, endLine: r.end }),
        });
      }
      return items;
    },
  };
}
