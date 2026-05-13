/** All comment-mode state, handlers, and derived signals for the Code
 *  tab. CodeTab.tsx mounts the JSX (popover, bubbles, tray) and threads
 *  the API into the line-selection menu — everything else is in here.
 *
 *  Single source of truth for "what is the comment system currently
 *  doing": one `intent` signal, three kinds. The popover, the Pierre
 *  selection seed, and the orphan-clear effects all derive from it. */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import type { Comment } from "./commentSerialize";
import type { InlineEditTarget } from "./InlineCommentPopover";
import { commentModeEnabled, toggleCommentMode } from "./useCommentMode";
import { type CommentsApi, useComments } from "./useComments";

/** What the comment system is doing right now.
 *  - `new`: composer open at a fresh range (from "+" bubble or right-click menu).
 *  - `edit`: composer open over an existing comment (from "💬" bubble or tray pencil).
 *  - `jump`: navigate Pierre to a comment's range, no composer (tray jump). */
export type ComposerIntent =
  | { kind: "new"; path: string; range: SelectedLineRange }
  | { kind: "edit"; comment: Comment }
  | { kind: "jump"; comment: Comment };

/** A seed for Pierre's `setSelectedLines` — produced for every intent
 *  kind, regardless of whether a composer is open. */
export type NavSeed = {
  path: string;
  start: number;
  end: number;
};

function seedFromIntent(intent: ComposerIntent): NavSeed {
  if (intent.kind === "new") {
    return {
      path: intent.path,
      start: intent.range.start,
      end: intent.range.end,
    };
  }
  return {
    path: intent.comment.path,
    start: intent.comment.startLine,
    end: intent.comment.endLine,
  };
}

export interface UseCommentInteractionArgs {
  /** Active terminal's worktree root — keys the persisted comment
   *  bucket. Null when no terminal is active. */
  repoRoot: Accessor<string | null>;
  /** Currently-displayed file path. Reading: handlers consult this to
   *  scope intents to the visible file. Writing: tray jump / pencil
   *  switch files, so the hook calls the setter on those flows. */
  selectedPath: Accessor<string | null>;
  setSelectedPath: (path: string) => void;
  /** Which right-panel tab is active. The hook clears any open composer
   *  when this is not "code" (orphan guard for #818). */
  activeTabKind: Accessor<string>;
}

export interface UseCommentInteractionResult {
  /** Comments store API — pass-through from `useComments`. */
  api: CommentsApi;
  /** Pierre's latest user-driven line selection — drives "+" bubble
   *  visibility. Distinct from `intent`, which is the composer/nav
   *  state. */
  currentRange: Accessor<SelectedLineRange | null>;
  /** Active composer/nav intent, or null when idle. */
  intent: Accessor<ComposerIntent | null>;
  /** Composer target derived from `intent` — null for "jump" (nav-only)
   *  and idle. Pass to `<InlineCommentPopover target=...>`. */
  composerTarget: Accessor<InlineEditTarget | null>;
  /** Programmatic Pierre selection target — for tray-jump / pencil /
   *  bubble-edit flows. Caller folds this into the `initialSelectedLines`
   *  prop of `CodeMenuFrame`. */
  navSeed: Accessor<NavSeed | null>;
  /** Paths with at least one queued comment — for the file-tree
   *  decoration `●` badge. */
  commentedPaths: Accessor<Set<string>>;
  // ── Handlers ──
  handleAddComment: (range: SelectedLineRange) => void;
  handleSelectionChange: (range: SelectedLineRange | null) => void;
  handleBubbleAddNew: () => void;
  handleBubbleEdit: (comment: Comment) => void;
  handlePopoverSubmit: (text: string) => void;
  handlePopoverClose: () => void;
  handleTrayJumpTo: (comment: Comment) => void;
  handleTrayEdit: (comment: Comment) => void;
}

export function useCommentInteraction(
  args: UseCommentInteractionArgs,
): UseCommentInteractionResult {
  const api = useComments(args.repoRoot);
  const [intent, setIntent] = createSignal<ComposerIntent | null>(null);
  const [currentRange, setCurrentRange] =
    createSignal<SelectedLineRange | null>(null);

  const composerTarget = createMemo<InlineEditTarget | null>(() => {
    const i = intent();
    if (!i) return null;
    if (i.kind === "jump") return null;
    return i;
  });

  const navSeed = createMemo<NavSeed | null>(() => {
    const i = intent();
    return i ? seedFromIntent(i) : null;
  });

  const commentedPaths = createMemo(
    () => new Set(api.comments().map((c) => c.path)),
  );

  // Right-click "Add comment on path:Lrange" → bypass the bubble, open
  // the composer directly. The user already made an explicit choice
  // through the menu, so requiring a second click would be theater.
  const handleAddComment = (range: SelectedLineRange) => {
    const path = args.selectedPath();
    if (!path) return;
    if (!commentModeEnabled()) toggleCommentMode();
    setIntent({ kind: "new", path, range });
  };

  // Pierre fires selection commits here. We track the latest range for
  // the "+" bubble; we don't open a composer (that's the bubble's job).
  // Null commits (file switch, tear-down) clear any open new-composer
  // so a stale "+" doesn't float over the new file.
  const handleSelectionChange = (range: SelectedLineRange | null) => {
    if (range === null) {
      setCurrentRange(null);
      if (intent()?.kind === "new") setIntent(null);
      return;
    }
    setCurrentRange(range);
  };

  const handleBubbleAddNew = () => {
    const path = args.selectedPath();
    const range = currentRange();
    if (!path || !range) return;
    setIntent({ kind: "new", path, range });
  };

  const handleBubbleEdit = (comment: Comment) => {
    setIntent({ kind: "edit", comment });
    if (!commentModeEnabled()) toggleCommentMode();
  };

  const handlePopoverSubmit = (text: string) => {
    const i = intent();
    if (!i) return;
    if (i.kind === "edit") {
      api.updateComment(i.comment.id, text);
    } else if (i.kind === "new") {
      api.addComment({
        path: i.path,
        startLine: i.range.start,
        endLine: i.range.end,
        text,
      });
    }
    setIntent(null);
  };

  const handlePopoverClose = () => setIntent(null);

  // Tray jump / pencil — stay in whatever mode the user picked
  // (`browse` / `local` / `branch`). All three modes push
  // `initialSelectedLines` through CodeMenuFrame and forward
  // `selectedLines` to Pierre (FileDiff + FileView both honor it),
  // so the popover anchors regardless of which view is active.
  const handleTrayJumpTo = (comment: Comment) => {
    args.setSelectedPath(comment.path);
    setIntent({ kind: "jump", comment });
  };

  const handleTrayEdit = (comment: Comment) => {
    args.setSelectedPath(comment.path);
    setIntent({ kind: "edit", comment });
    if (!commentModeEnabled()) toggleCommentMode();
  };

  // Orphan guards. CodeTab stays mounted across right-panel tab toggles
  // and panel collapse (#818), and the popover lives in a Portal mounted
  // to `<body>`. Without these effects, the composer would float over
  // the canvas after the user switches to the Inspector tab or to a
  // different worktree terminal.
  //
  // Mode toggle off → close any open composer (intent was annotation;
  // explicit disable contradicts that). Tray-pencil re-enables mode, so
  // this only fires on explicit disable.
  createEffect(() => {
    if (!commentModeEnabled()) setIntent(null);
  });

  // Tab switch → close any open composer (user changed context). Does
  // NOT clear `currentRange` — that lets the "+" bubble reappear at the
  // same line when the user returns to the Code tab without re-clicking.
  // Bubble visibility itself gates on `activeTabKind === "code"`.
  createEffect(() => {
    if (args.activeTabKind() !== "code") setIntent(null);
  });

  // Terminal switch (`repoRoot` change) is a harder reset: file tree,
  // selection, and any in-flight compose state belong to the old
  // worktree.
  createEffect(() => {
    void args.repoRoot();
    setIntent(null);
    setCurrentRange(null);
  });

  return {
    api,
    currentRange,
    intent,
    composerTarget,
    navSeed,
    commentedPaths,
    handleAddComment,
    handleSelectionChange,
    handleBubbleAddNew,
    handleBubbleEdit,
    handlePopoverSubmit,
    handlePopoverClose,
    handleTrayJumpTo,
    handleTrayEdit,
  };
}
