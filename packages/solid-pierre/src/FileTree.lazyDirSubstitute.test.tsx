// @vitest-environment happy-dom
/**
 * Regression: substituting a LONE lazy directory key with its single file
 * child must leave the folder expanded with the child painted — the
 * plain-directory (non-git) Code tab's smallest real tree (`notes/` +
 * `readme.txt`, PR #2138). The e2e signature was: the lazy load resolves OK
 * (twice), yet the folder ends collapsed and the child row never becomes
 * visible. This drives the REAL library through the wrapper exactly as the
 * Code tab does: `paths`/`lazyDirectories` re-derived as fresh arrays per
 * change, the expand callback folding one level back into `paths`.
 */
import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import {
  clickRow,
  disposeAll,
  flush,
  mountInto,
  paintedRows,
} from "./FileTree.testlib.ts";

afterEach(disposeAll);

describe("substituting a lone lazy dir key with its children (#2138)", () => {
  it("keeps the folder expanded and paints the single file child", async () => {
    // Mirrors CodeTab's directoryInventory: a loaded level REPLACES the
    // collapsed key in `paths`, while the key STAYS in `lazyDirectories`
    // (loaded, so a collapse-and-reopen refetches). Fresh array references per
    // recompute, as a memo produces.
    const [loaded, setLoaded] = createSignal<ReadonlyMap<
      string,
      readonly string[]
    > | null>(null);
    const inventory = createMemo(() => {
      const children = loaded()?.get("notes/");
      return children?.length
        ? [...children, "readme.txt"]
        : ["notes/", "readme.txt"];
    });
    const onExpandLazyDirectory = vi.fn(
      (dirPath: string): Promise<void> =>
        Promise.resolve().then(() => {
          setLoaded(new Map([[dirPath, ["notes/inner.txt"]]]));
        }),
    );
    const root = mountInto((host) =>
      render(
        () => (
          <FileTree
            paths={inventory()}
            lazyDirectories={["notes/"]}
            onExpandLazyDirectory={onExpandLazyDirectory}
            initialExpansion="closed"
            search={false}
            onError={(err) => {
              throw err;
            }}
          />
        ),
        host,
      ),
    );

    clickRow(root, "notes/");
    await flush();
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith(
      "notes/",
      expect.any(AbortSignal),
    );
    // Exactly ONE load: the reconcile guard must keep the substitution batch's
    // own store ticks from being mis-read as collapse-then-fresh-expand (the
    // re-fire whose superseding abort collapsed the folder for good).
    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(1);
    const rows = paintedRows(root);
    // The child is painted — which requires the recreated `notes` folder to be
    // expanded, not just present in the model.
    expect(rows).toContain("notes/inner.txt");
    const row = root.querySelector(
      '[role="treeitem"][data-item-path="notes/"]',
    ) as HTMLElement | null;
    expect(row?.getAttribute("aria-expanded")).toBe("true");
  });
});
