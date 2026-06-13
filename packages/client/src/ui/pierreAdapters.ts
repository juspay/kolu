/** Kolu-specific adapter around `@kolu/solid-pierre`'s context-menu hook.
 *
 *  `makeTreeContextMenu` builds the file-tree right-click menu using kolu's
 *  CSS variables and `solid-sonner` toast for clipboard feedback. It's a
 *  factory closing over the Code tab's current view + a navigate callback so
 *  the menu can offer "jump to another view" entries (All files ⇄ git diff)
 *  alongside "Copy path". Pierre snapshots the `contextMenu` config once at
 *  mount, but invokes `render` fresh on every right-click — so reading
 *  `nav.view()` inside `render` reflects the live mode at click time. (The
 *  pure porcelain→word git-status mapping lives in `gitStatusEntries.ts`, kept
 *  toast-free so it stays unit-testable in a plain node env.) */

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@kolu/solid-pierre";
import { type CodeTabView, viewLabel } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "./clipboard";

/** Hooks the menu needs from the Code tab to offer view-switch entries. */
export type TreeContextMenuNav = {
  /** Current Code-tab view — read at right-click time, not factory time. */
  view: () => CodeTabView;
  /** Switch the Code tab to `target`. A non-null `path` becomes that view's
   *  selection (the clicked file rides along). `null` (directory right-click —
   *  directories aren't selectable) leaves the target's selection slot
   *  untouched, so it restores its own last pick per the per-slot design. */
  navigate: (target: CodeTabView, path: string | null) => void;
};

/** Menu text for jumping to `target`: "Open in All files" for the browse
 *  view, "Open <Local|Branch> diff" for a git-diff view. */
function navEntryLabel(target: CodeTabView): string {
  return target === "browse"
    ? `Open in ${viewLabel(target)}`
    : `Open ${viewLabel(target)} diff`;
}

/** Canonical view order, matching the scope switcher's `scopeSegments` ordering.
 *  `navEntriesFor` derives its entries from this list, so adding a view is a
 *  one-line edit and "exactly the other views, in canonical order" stays
 *  mechanical instead of hand-tabulated. */
const VIEW_ORDER = ["browse", "local", "branch"] as const;

/** View-switch entries offered for the current `view`: every other view in
 *  canonical order. Browse (All files) jumps into either git-diff view; either
 *  git-diff view can return to All files or flip to its sibling diff. The
 *  entry text is composed from `viewLabel` (via `navEntryLabel`), the single
 *  source the mode picker also renders, so the destination is named
 *  identically in both surfaces.
 *
 *  Browse lists the *whole repo*, so a clicked file may be unmodified, an
 *  untracked add, or a tracked edit. Local (working tree vs HEAD) is the
 *  always-available diff — no remote needed, and it's the only one that
 *  shows untracked files — so it leads. Branch (vs `origin/<default>`) can
 *  be base-less or exclude the file; offering it explicitly lets the user
 *  pick, rather than hard-coding a single git target that may not hold the
 *  file (which would just clear the selection or surface the Branch error). */
function navEntriesFor(
  view: CodeTabView,
): readonly { label: string; target: CodeTabView }[] {
  return VIEW_ORDER.filter((target) => target !== view).map((target) => ({
    label: navEntryLabel(target),
    target,
  }));
}

/** Pierre wraps the rendered element in a `display:flex; align-items:center`
 *  anchor positioned at the cursor — letting the menu lay out normally
 *  inside that wrapper shifts it off the click point. We pin
 *  `position: fixed` with `context.anchorRect` coords so the menu lands at
 *  the cursor regardless of the wrapper's layout. */
export function makeTreeContextMenu(nav: TreeContextMenuNav) {
  return function renderTreeContextMenu(
    item: ContextMenuItem,
    context: ContextMenuOpenContext,
  ): HTMLElement {
    const menu = document.createElement("div");
    menu.style.cssText = [
      "position:fixed",
      `left:${context.anchorRect.left}px`,
      `top:${context.anchorRect.top}px`,
      "background:var(--color-surface-1)",
      "border:1px solid var(--color-edge)",
      "border-radius:6px",
      "padding:4px",
      "min-width:160px",
      "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
      "font-size:11px",
      "color:var(--color-fg)",
    ].join(";");

    const addItem = (label: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.style.cssText = [
        "display:block",
        "width:100%",
        "text-align:left",
        "padding:4px 8px",
        "border:0",
        "background:transparent",
        "color:inherit",
        "cursor:pointer",
        "border-radius:4px",
        "font:inherit",
      ].join(";");
      btn.addEventListener(
        "mouseenter",
        () => (btn.style.background = "var(--color-surface-2)"),
      );
      btn.addEventListener(
        "mouseleave",
        () => (btn.style.background = "transparent"),
      );
      btn.addEventListener("click", () => {
        onClick();
        context.close();
      });
      menu.appendChild(btn);
    };

    const addSeparator = () => {
      const hr = document.createElement("div");
      hr.style.cssText =
        "height:1px;margin:4px 4px;background:var(--color-edge)";
      menu.appendChild(hr);
    };

    // View-switch entries first — the primary intent behind a right-click on a
    // file row is "take me to this file in another view". Carry the path as
    // the destination's selection only for files; directories aren't selectable
    // (they never appear in the tree's `paths`), so they just switch the view.
    const selection = item.kind === "file" ? item.path : null;
    for (const entry of navEntriesFor(nav.view())) {
      addItem(entry.label, () => nav.navigate(entry.target, selection));
    }
    addSeparator();

    addItem("Copy path", () => {
      writeTextToClipboard(item.path)
        .then(() => toast.success(`Copied: ${item.path}`))
        .catch((err: Error) => {
          console.error("Failed to copy path:", err);
          toast.error(`Failed to copy path: ${err.message}`);
        });
    });

    return menu;
  };
}
