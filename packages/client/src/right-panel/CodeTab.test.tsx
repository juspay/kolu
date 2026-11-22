// @vitest-environment happy-dom
/** THE CODE VIEW WITHOUT A TERMINAL. A view about a root with no terminal
 *  standing in it still lists the tree, draws a diff and draws a text file —
 *  those are read by path. Only commenting needs a terminal, so there is no
 *  comments tray, no composer and no comment pill. A picture and a download
 *  need one too, and each says so in a line rather than drawing nothing. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import type { Subscription } from "@kolu/surface/solid";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { BrowseFileContent, CodeQueries } from "./codeQueries";
import { type CodeSubject, noTerminalToFetch } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import type { CodeViewState } from "./codeViewState";
import type { CodeDoor } from "./codeDoor";

const h = vi.hoisted(() => ({
  /** The tree's right-click menu, as the view handed it to the tree. */
  menu: null as
    | null
    | ((
        item: { kind: "file"; path: string },
        context: {
          anchorRect: { left: number; top: number };
          close: () => void;
        },
      ) => HTMLElement),
  toastError: vi.fn(),
}));

// Pierre's tree and highlighter are not this test's subject, and load a
// grammar only the app's Vite build can resolve: what is pinned is WHAT the
// view hands them. The tree draws the paths it is given; a diff draws a mark.
vi.mock("@kolu/solid-pierre", async () => {
  // The factory runs before this file's own imports are bound.
  const { For } = await import("solid-js");
  return {
    FileTree: (props: {
      paths: string[];
      contextMenu: { render: NonNullable<typeof h.menu> };
    }) => {
      h.menu = props.contextMenu.render;
      return (
        <ul data-testid="tree">
          <For each={props.paths}>{(path) => <li>{path}</li>}</For>
        </ul>
      );
    },
    CodeView: () => <div data-testid="pierre-diff-view" />,
    diffItems: () => [],
    useCodeViewSelection: () => () => null,
    rowPathsCss: () => "",
    codeViewItemIdAt: () => undefined,
  };
});
vi.mock("./BrowseFileView", () => ({
  default: (props: { content: string }) => (
    <pre data-testid="source-view">{props.content}</pre>
  ),
}));
// The tree's width is the one shared preference; nothing else of the Right
// panel is read by the view.
vi.mock("./useRightPanel", () => ({
  useRightPanel: () => ({
    codeTabTreeSize: () => 0.35,
    setCodeTabTreeSize: () => {},
  }),
}));
vi.mock("../settings/useColorScheme", () => ({
  useColorScheme: () => ({ themeTypeLiteral: () => "dark" }),
}));
vi.mock("../useDeepLinks", () => ({ requestDeepLinkNavigation: () => {} }));
vi.mock("../wire", () => ({ padiRpcOf: () => ({}) }));
vi.mock("solid-sonner", () => ({
  toast: { error: h.toastError, success: () => {} },
}));

import CodeTab from "./CodeTab";

const ROOT = "/srv/code/kestrel/.worktrees/export";

/** A settled read holding `value`. */
const settled = <T,>(value: T | undefined): Subscription<T> =>
  Object.assign(() => value, {
    pending: () => false,
    error: () => undefined,
    complete: () => false,
  });

const status = {
  mode: "local",
  files: [{ path: "src/ledger.rs", status: "M" }],
} as never;

const TEXT: BrowseFileContent = {
  kind: "text",
  content: "plain words",
  truncated: false,
};

const queries = (file: BrowseFileContent): CodeQueries => ({
  localStatus: settled(status),
  branchStatus: settled<never>(undefined),
  activeStatus: settled(status),
  allPaths: settled({
    repoRoot: ROOT,
    paths: ["diagram.png", "notes.txt", "src/ledger.rs"],
  }),
  diskRootLevel: settled<never>(undefined),
  ignoredPaths: settled<never>(undefined),
  diff: settled({
    oldFileName: "src/ledger.rs",
    newFileName: "src/ledger.rs",
    hunks: ["@@ -1 +1 @@\n-old\n+new\n"],
    binary: false,
  }),
  fileContent: settled(file),
  lease: () => {},
});

const state = (mode: CodeTabView, browsing: string): CodeViewState => {
  const [codeMode, setCodeMode] = createSignal(mode);
  const selected: Record<CodeTabView, string | null> = {
    browse: browsing,
    local: "src/ledger.rs",
    branch: null,
  };
  return {
    codeMode,
    setCodeMode,
    selectedFile: (m) => selected[m],
    setSelectedFile: () => {},
    recordNavigation: () => {},
    navigateBack: () => null,
    navigateForward: () => null,
    canNavigateBack: () => false,
    canNavigateForward: () => false,
  };
};

const subject: CodeSubject = {
  owner: codeOwner("test-view", "export"),
  host: { kind: "local" },
  git: { kind: "repo", root: ROOT, lister: "git" },
  terminalId: null,
};

const door: CodeDoor = { pending: () => null, open: () => {} };

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  h.menu = null;
  h.toastError.mockClear();
});

const show = (
  mode: CodeTabView,
  opts: { browsing?: string; file?: BrowseFileContent } = {},
): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Shown.Provider value={() => true}>
        <CodeTab
          subject={subject}
          state={state(mode, opts.browsing ?? "notes.txt")}
          queries={queries(opts.file ?? TEXT)}
          door={door}
        />
      </Shown.Provider>
    ),
    host,
  );
  return host;
};

const noCommenting = (host: HTMLElement) => {
  expect(host.querySelector("[data-testid=kolu-comments-tray]")).toBeNull();
  expect(host.querySelector("[data-testid=kolu-comment-pill]")).toBeNull();
  expect(
    document.querySelector("[data-testid=kolu-comment-composer]"),
  ).toBeNull();
};

describe("a Code view with a root and no terminal", () => {
  it("lists the tree and draws a text file", () => {
    const host = show("browse");
    const tree = host.querySelector(
      "[data-code-tree-mode=browse] [data-testid=tree]",
    );
    expect(
      Array.from(tree?.querySelectorAll("li") ?? [], (li) => li.textContent),
    ).toEqual(["diagram.png", "notes.txt", "src/ledger.rs"]);
    expect(host.querySelector("[data-testid=source-view]")?.textContent).toBe(
      "plain words",
    );
    noCommenting(host);
  });

  it("draws a diff", () => {
    const host = show("local");
    expect(
      host.querySelector("[data-code-tree-mode=local] li")?.textContent,
    ).toBe("src/ledger.rs");
    expect(host.querySelector("[data-testid=pierre-diff-view]")).not.toBeNull();
    noCommenting(host);
  });

  it("says in a line why a picture cannot be shown", () => {
    const host = show("browse", {
      browsing: "diagram.png",
      file: { kind: "binary", previewTag: "tag-1" },
    });
    expect(host.querySelector("[data-testid=diff-content]")?.textContent).toBe(
      `Error: ${noTerminalToFetch("diagram.png")}`,
    );
  });

  it("says why Download cannot fetch the file, and does not throw", () => {
    show("browse");
    const menu = h.menu;
    if (menu === null) throw new Error("the tree was handed no menu");
    const close = vi.fn();
    const drawn = menu(
      { kind: "file", path: "notes.txt" },
      { anchorRect: { left: 0, top: 0 }, close },
    );
    const download = Array.from(drawn.querySelectorAll("button")).find(
      (button) => button.textContent === "Download",
    );
    if (download === undefined) throw new Error("no Download entry");

    expect(() => download.click()).not.toThrow();
    expect(h.toastError).toHaveBeenCalledWith(noTerminalToFetch("notes.txt"));
    expect(close).toHaveBeenCalledOnce();
  });
});
