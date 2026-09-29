/** The tree right-click menu's item composition. Two decisions gate the
 *  Download entry — the row is a file, and the file still has bytes on disk
 *  (the active view's git status does not mark it deleted) — plus the hook
 *  call itself. happy-dom (this package's test env) runs the real renderer, so
 *  the assertions are on the menu the user would see. */

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@kolu/solid-pierre";
import { describe, expect, it, vi } from "vitest";
import {
  makeTreeContextMenu,
  type TreeContextMenuHooks,
} from "./pierreAdapters";

const CONTEXT: ContextMenuOpenContext = {
  anchorElement: document.createElement("div"),
  anchorRect: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  },
  close: () => {},
  restoreFocus: () => {},
};

const FILE_ROW: ContextMenuItem = {
  kind: "file",
  name: "handler.ts",
  path: "api/handler.ts",
};

/** Render the menu for `item` and read back its button labels in order. */
function renderMenu(
  item: ContextMenuItem,
  hooks: Partial<TreeContextMenuHooks> = {},
) {
  const download = vi.fn();
  const render = makeTreeContextMenu({
    view: () => "browse",
    navigate: () => {},
    gitStatus: () => undefined,
    download,
    ...hooks,
  });
  const menu = render(item, CONTEXT);
  const labels = [...menu.querySelectorAll("button")].map(
    (button) => button.textContent,
  );
  const click = (label: string) => {
    const button = [...menu.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`no menu item ${label}; got ${labels}`);
    button.click();
  };
  return { labels, click, download };
}

describe("makeTreeContextMenu", () => {
  it("offers Download on a file row and saves that path when clicked", () => {
    const { labels, click, download } = renderMenu(FILE_ROW);
    expect(labels).toContain("Download");
    click("Download");
    expect(download).toHaveBeenCalledExactlyOnceWith("api/handler.ts");
  });

  it("offers no Download on a directory row", () => {
    const { labels } = renderMenu({
      kind: "directory",
      name: "api",
      path: "api",
    });
    expect(labels).not.toContain("Download");
  });

  it("offers no Download for a file the view marks deleted", () => {
    // A diff view lists changed files, including deletions — a path with no
    // bytes left behind it.
    const { labels } = renderMenu(FILE_ROW, {
      gitStatus: () => [{ path: "api/handler.ts", status: "deleted" }],
    });
    expect(labels).not.toContain("Download");
  });

  it("still offers Download for a file whose row is a non-deletion", () => {
    const { labels } = renderMenu(FILE_ROW, {
      gitStatus: () => [{ path: "api/handler.ts", status: "modified" }],
    });
    expect(labels).toContain("Download");
  });
});
