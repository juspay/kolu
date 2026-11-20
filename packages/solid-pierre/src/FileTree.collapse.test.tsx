// @vitest-environment happy-dom
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
