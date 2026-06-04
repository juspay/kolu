/** Kolu-specific adapter around `@kolu/solid-pierre`'s context-menu hook.
 *
 *  `renderTreeContextMenu` builds the file-tree right-click menu using kolu's
 *  CSS variables and `solid-sonner` toast for clipboard feedback. (The pure
 *  porcelain→word git-status mapping lives in `gitStatusEntries.ts`, kept
 *  toast-free so it stays unit-testable in a plain node env.) */

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@kolu/solid-pierre";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "./clipboard";

/** Pierre wraps the rendered element in a `display:flex; align-items:center`
 *  anchor positioned at the cursor — letting the menu lay out normally
 *  inside that wrapper shifts it off the click point. We pin
 *  `position: fixed` with `context.anchorRect` coords so the menu lands at
 *  the cursor regardless of the wrapper's layout. */
export function renderTreeContextMenu(
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

  addItem("Copy path", () => {
    writeTextToClipboard(item.path)
      .then(() => toast.success(`Copied: ${item.path}`))
      .catch((err: Error) => {
        console.error("Failed to copy path:", err);
        toast.error(`Failed to copy path: ${err.message}`);
      });
  });

  return menu;
}
