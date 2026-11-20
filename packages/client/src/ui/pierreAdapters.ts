/** Kolu-specific adapter around `@kolu/solid-pierre`'s context-menu hook.
 *  Pierre snapshots the `contextMenu` config once at mount but invokes
 *  `render` fresh on every right-click, so reading `nav.view()` /
 *  `nav.gitStatus()` inside `render` reflects the live mode at click time. */

import {
  CODE_TAB_VIEW_ORDER,
  type CodeTabView,
  viewLabel,
} from "@kolu/padi-client/surface";
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  GitStatusEntry,
} from "@kolu/solid-pierre";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { writeTextToClipboard } from "@kolu/solid-logtail";

/** Hooks the menu needs from the Code tab: the view-switch entries, and the
 *  two facts that decide a file row's Download entry. */
export type TreeContextMenuHooks = {
  /** Current Code-tab view — read at right-click time, not factory time. */
  view: () => CodeTabView;
  /** Switch the Code tab to `target`. A non-null `path` becomes that view's
   *  selection; `null` leaves the target's selection slot untouched. */
  navigate: (target: CodeTabView, path: string | null) => void;
  /** Whether the other views exist for this root, read at right-click time. */
  viewsAvailable: () => boolean;
  /** The active view's git decoration, read at right-click time. A `deleted`
   *  row withholds the Download entry. */
  gitStatus: () => readonly GitStatusEntry[] | undefined;
  /** Save a file row's bytes through the browser's download flow. */
  download: (path: string) => void;
};

/** Menu text for jumping to `target`: "Open in All files" for the browse
 *  view, "Open <Local|Branch> diff" for a git-diff view. */
function navEntryLabel(target: CodeTabView): string {
  return target === "browse"
    ? `Open in ${viewLabel(target)}`
    : `Open ${viewLabel(target)} diff`;
}

/** View-switch entries offered for the current `view`: every other view in
 *  canonical order, labelled through `viewLabel`. */
function navEntriesFor(
  view: CodeTabView,
): readonly { label: string; target: CodeTabView }[] {
  return CODE_TAB_VIEW_ORDER.filter((target) => target !== view).map(
    (target) => ({
      label: navEntryLabel(target),
      target,
    }),
  );
}

/** Pierre wraps the rendered element in a `display:flex; align-items:center`
 *  anchor positioned at the cursor, so the menu is pinned `position: fixed`
 *  at `context.anchorRect` instead of laying out inside that wrapper. */
export function makeTreeContextMenu(nav: TreeContextMenuHooks) {
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

    const selection = item.kind === "file" ? item.path : null;
    if (nav.viewsAvailable()) {
      for (const entry of navEntriesFor(nav.view())) {
        addItem(entry.label, () => nav.navigate(entry.target, selection));
      }
      addSeparator();
    }

    addItem("Copy path", () => {
      runAction(
        "copy path",
        writeTextToClipboard(item.path).pipe(
          Effect.tap(() =>
            Effect.sync(() => toast.success(`Copied: ${item.path}`)),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              console.error("Failed to copy path:", err);
              toast.error(`Failed to copy path: ${toError(err).message}`);
            }),
          ),
        ),
      );
    });

    if (
      item.kind === "file" &&
      !(nav.gitStatus() ?? []).some(
        (entry) => entry.path === item.path && entry.status === "deleted",
      )
    ) {
      addItem("Download", () => nav.download(item.path));
    }

    return menu;
  };
}
