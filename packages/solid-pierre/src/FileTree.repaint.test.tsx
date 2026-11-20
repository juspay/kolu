// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { GitStatusEntry } from "@pierre/trees";
import { FileTree } from "./FileTree";
import {
  disposeAll,
  flush,
  mountInto,
  paintedRows,
} from "./FileTree.testlib.ts";

afterEach(disposeAll);

function mountTree(initial: string[], gitStatus?: GitStatusEntry[]) {
  const [paths, setPaths] = createSignal(initial);
  const [status, setStatus] = createSignal(gitStatus);
  const root = mountInto((host) =>
    render(
      () => (
        <FileTree
          paths={paths()}
          gitStatus={status()}
          initialExpansion="open"
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    ),
  );
  return { setPaths, setStatus, root };
}

describe("mounted FileTree repaints on a live change (#1534)", () => {
  it("paints an added file into the SAME mounted tree", async () => {
    const { setPaths, root } = mountTree(["src/a.ts", "src/b.ts"]);
    expect(paintedRows(root)).toContain("src/a.ts");
    expect(paintedRows(root)).not.toContain("src/c.ts");

    setPaths(["src/a.ts", "src/b.ts", "src/c.ts"]);
    await flush();

    expect(paintedRows(root)).toContain("src/c.ts");
    expect(root.isConnected).toBe(true);
  });

  it("removes a deleted file's row in place", async () => {
    const { setPaths, root } = mountTree(["src/a.ts", "src/b.ts"]);
    expect(paintedRows(root)).toContain("src/b.ts");

    setPaths(["src/a.ts"]);
    await flush();

    expect(paintedRows(root)).not.toContain("src/b.ts");
    expect(paintedRows(root)).toContain("src/a.ts");
  });

  it("repaints a same-shape change — one file swapped for another", async () => {
    const { setPaths, root } = mountTree(["src/a.ts", "src/b.ts"]);

    setPaths(["src/a.ts", "src/c.ts"]);
    await flush();

    const rows = paintedRows(root);
    expect(rows).toContain("src/c.ts");
    expect(rows).not.toContain("src/b.ts");
  });

  it("repaints the git-change roll-up on a live gitStatus change", async () => {
    const { setStatus, root } = mountTree(["src/a.ts", "lib/b.ts"]);
    const marked = () =>
      [...root.querySelectorAll("[data-item-contains-git-change]")].map(
        (n) => (n as HTMLElement).dataset.itemPath,
      );
    expect(marked()).toHaveLength(0);

    setStatus([{ path: "src/a.ts", status: "modified" }]);
    await flush();

    expect(marked()).toContain("src/");
  });
});

it("applies a standing selection when its path arrives in the retained tree", async () => {
  const [paths, setPaths] = createSignal<string[]>([]);
  const root = mountInto((host) =>
    render(
      () => (
        <FileTree
          paths={paths()}
          selectedPath="src/a.ts"
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    ),
  );
  setPaths(["src/a.ts", "src/b.ts"]);
  await flush();
  expect(
    root.querySelector('[data-item-path="src/a.ts"][aria-selected="true"]'),
  ).not.toBeNull();
  setPaths([]);
  setPaths(["src/a.ts", "src/b.ts"]);
  await flush();
  expect(
    root.querySelector('[data-item-path="src/a.ts"][aria-selected="true"]'),
  ).not.toBeNull();
  expect(root.isConnected).toBe(true);
});
