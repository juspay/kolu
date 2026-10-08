// @vitest-environment happy-dom
/**
 * A folder the user collapsed under an active filter stays collapsed.
 *
 * The Code tab hands `FileTree` its props through ONE changing object per tick
 * (`frame` in `CodeTab.tsx`: paths, the filter's open folders, git status,
 * selection, …), read through a non-keyed `<Show>`. Every new frame notifies
 * every prop read off it, even when `paths` and `expandPaths` are the very same
 * arrays — and the paths effect used to answer each notification by re-opening
 * `expandPaths`. So a git-status frame landing after the user collapsed a
 * matching folder re-opened it: the e2e "Folder collapse during active filter
 * persists the filter" flake.
 *
 * Driven against the REAL library, the way `FileTree.lazyDir.test.tsx` is,
 * because the subject is Pierre's own expansion state as painted.
 */
import type { GitStatusEntry } from "@pierre/trees";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { FileTree } from "./FileTree";
import {
  disposeAll,
  flush,
  mountInto,
  paintedRows,
} from "./FileTree.testlib.ts";

afterEach(disposeAll);

interface Frame {
  readonly paths: string[];
  readonly expanded: readonly string[];
  readonly gitStatus: GitStatusEntry[];
}

/** Mount the tree the way `CodeTab.tsx` does: one frame object, non-keyed. */
function mountFramed(initial: Frame) {
  const [frame, setFrame] = createSignal<Frame>(initial);
  const root = mountInto((host) =>
    render(
      () => (
        <Show when={frame()}>
          {(current) => (
            <FileTree
              paths={current().paths}
              expandPaths={current().expanded}
              gitStatus={current().gitStatus}
              initialExpansion="closed"
              search={false}
              onError={(err) => {
                throw err;
              }}
            />
          )}
        </Show>
      ),
      host,
    ),
  );
  return { frame, setFrame, root };
}

function clickRow(root: ShadowRoot, path: string): void {
  const row = root.querySelector(
    `[role="treeitem"][data-item-path="${path}"]`,
  ) as HTMLElement | null;
  if (!row) throw new Error(`no painted row for ${path}`);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

const MATCHES = ["src/alpha-one.txt", "src/alpha-two.txt"];

describe("a folder collapsed under a filter", () => {
  it("stays collapsed when a frame changes only the git status", async () => {
    const { frame, setFrame, root } = mountFramed({
      paths: MATCHES,
      expanded: ["src/"],
      gitStatus: [],
    });
    await flush();
    expect(paintedRows(root)).toEqual(
      expect.arrayContaining(["src/", ...MATCHES]),
    );

    clickRow(root, "src/");
    await flush();
    expect(paintedRows(root)).not.toContain("src/alpha-one.txt");

    // Same paths, same open folders — only the decoration moved.
    setFrame({
      ...frame(),
      gitStatus: MATCHES.map((path) => ({ path, status: "untracked" })),
    });
    await flush();

    const rows = paintedRows(root);
    expect(rows).toContain("src/");
    expect(rows).not.toContain("src/alpha-one.txt");
    expect(rows).not.toContain("src/alpha-two.txt");
  });

  it("re-opens it when the filter's answer itself changes", async () => {
    // The other half of the contract: a genuinely new projection (the user
    // typed more) reveals its matches again.
    const { setFrame, root } = mountFramed({
      paths: MATCHES,
      expanded: ["src/"],
      gitStatus: [],
    });
    await flush();
    clickRow(root, "src/");
    await flush();
    expect(paintedRows(root)).not.toContain("src/alpha-one.txt");

    setFrame({
      paths: ["src/alpha-one.txt"],
      expanded: ["src/"],
      gitStatus: [],
    });
    await flush();

    expect(paintedRows(root)).toContain("src/alpha-one.txt");
  });
});
