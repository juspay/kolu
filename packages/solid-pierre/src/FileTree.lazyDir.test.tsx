// @vitest-environment happy-dom
/**
 * Lazily-loaded directory rows — juspay/kolu#2091.
 *
 * The Code tab overlays gitignored entries from `git ls-files --directory`,
 * which COLLAPSES a wholly-ignored directory to a single trailing-slash entry
 * (`out/`) so `node_modules/` costs one row instead of thousands. Pierre
 * renders that entry as a directory row with a working chevron — so the user
 * can expand it — but the collapse means no child path was ever sent, and the
 * wrapper had no way to tell the host an expansion happened. Expanding `out/`
 * therefore opened onto nothing while the directory plainly held files on disk.
 *
 * `lazyDirectories` + `onExpandLazyDirectory` close that: the host names the
 * rows whose children live off-tree, and the wrapper reports each
 * collapsed → expanded transition so the host can fetch one level and fold the
 * result back into `paths`.
 *
 * These tests drive the REAL library rather than a mock, because the subject is
 * precisely Pierre's own behaviour on a childless directory row — that it gets
 * a chevron at all, and that expanding it ticks the store — which is exactly
 * what a mock would have to assume. Expansion is therefore observed the way the
 * app observes it, and asserted on the callback and the painted rows rather
 * than on any internal call.
 */
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/** Pierre renders its rows under an open shadow root nested in the container;
 *  find it the same way the wrapper's own `findShadowRoot` does. */
function findShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  for (const child of el.children) {
    const found = findShadowRoot(child);
    if (found) return found;
  }
  return null;
}

/** Let Solid's deferred effect reach Pierre and Pierre's Preact view repaint —
 *  both are scheduled, not synchronous. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The paths Pierre currently has painted. Sticky header rows repeat a path, so
 *  de-dupe — these assertions are about presence, not row count. */
function paintedRows(root: ShadowRoot): string[] {
  return [
    ...new Set(
      [...root.querySelectorAll("[data-item-path]")].map(
        (n) => (n as HTMLElement).dataset.itemPath as string,
      ),
    ),
  ];
}

function mountTree(
  initial: string[],
  lazyDirectories: string[],
  initialExpansion: "open" | "closed" = "closed",
) {
  const [paths, setPaths] = createSignal(initial);
  const onExpandLazyDirectory = vi.fn<(path: string) => void>();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <FileTree
        paths={paths()}
        lazyDirectories={lazyDirectories}
        onExpandLazyDirectory={onExpandLazyDirectory}
        initialExpansion={initialExpansion}
        search={false}
        onError={(err) => {
          throw err;
        }}
      />
    ),
    host,
  );
  disposers.push(dispose, () => host.remove());
  const container = host.querySelector(
    '[data-testid="pierre-file-tree"]',
  ) as HTMLElement;
  const root = findShadowRoot(container);
  if (!root) throw new Error("Pierre mounted no shadow root");
  return { setPaths, root, onExpandLazyDirectory };
}

/** Click a row the way a user does — Pierre's own row button, inside its shadow
 *  root. `composed` so the event crosses the boundary like a real one. */
function clickRow(root: ShadowRoot, path: string): void {
  const row = root.querySelector(
    `[role="treeitem"][data-item-path="${path}"]`,
  ) as HTMLElement | null;
  if (!row) throw new Error(`no painted row for ${path}`);
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

describe("lazily-loaded directory rows (#2091)", () => {
  it("reports the expansion of a collapsed gitignored directory", async () => {
    const { root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );
    // The bug, as the tree sees it: a directory row owning no children at all,
    // and nothing telling the host the user wants them.
    expect(paintedRows(root)).toContain("out/");
    expect(onExpandLazyDirectory).not.toHaveBeenCalled();

    clickRow(root, "out/");
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("paints the fetched level into the still-expanded directory", async () => {
    // The point of the callback: the host answers it by folding one level into
    // `paths`, replacing the collapsed row. Asserted at the DOM, because "model
    // right, screen empty" is the original defect.
    const { setPaths, root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );

    clickRow(root, "out/");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");

    setPaths(["kept.md", "out/index.html", "out/style.css", "out/assets/"]);
    await flush();

    const rows = paintedRows(root);
    expect(rows).toContain("out/index.html");
    expect(rows).toContain("out/style.css");
    // A child directory arrives collapsed in its turn, so a deep ignored tree
    // stays one cheap level per click rather than one enormous listing.
    expect(rows).toContain("out/assets/");
    // Same shadow root as before the load ⇒ the children were painted into the
    // live tree, not a remount that would trivially show them.
    expect(root.isConnected).toBe(true);
  });

  it("stays silent for directories the host did not mark lazy", async () => {
    // Ordinary tracked directories already carry their children in `paths`;
    // firing for them would put a pointless fetch on every folder click.
    const { root, onExpandLazyDirectory } = mountTree(
      ["src/app.ts", "src/lib/util.ts", "out/"],
      ["out/"],
    );

    clickRow(root, "src/");
    await flush();

    expect(onExpandLazyDirectory).not.toHaveBeenCalled();
  });

  it("re-reports a re-expansion, so a reopened directory refetches", async () => {
    // Nothing watches an ignored directory — the working-tree watcher excludes
    // exactly these paths — so an open row's contents can go stale under it.
    // Collapse-and-reopen is the refresh gesture, and it only works if the
    // second expansion is reported too.
    const { root, onExpandLazyDirectory } = mountTree(["out/"], ["out/"]);

    clickRow(root, "out/"); // expand
    await flush();
    clickRow(root, "out/"); // collapse
    await flush();
    clickRow(root, "out/"); // expand again
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(2);
  });

  it("reports a row that mounts already open", async () => {
    // A restored expansion (`initialExpansion: "open"`, or a reveal replayed
    // through `initialExpandedPaths` across one of the remounts the live
    // fsListAll stream causes) leaves an open, childless folder in front of the
    // user with no click coming. It is the same fact as an expansion, so it is
    // reported the same way.
    const { onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
      "open",
    );
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("reports a directory that only BECOMES lazy after it is open", async () => {
    // The overlay listing that names the lazy directories lands a tick after
    // the tree itself, and a load reveals nested directories that are lazy in
    // their own turn. Pierre's store does not tick for a host prop change, so
    // without a re-probe on `lazyDirectories` those keys would never be read.
    const [lazy, setLazy] = createSignal<string[]>([]);
    const onExpandLazyDirectory = vi.fn<(path: string) => void>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <FileTree
          paths={["kept.md", "out/"]}
          lazyDirectories={lazy()}
          onExpandLazyDirectory={onExpandLazyDirectory}
          initialExpansion="open"
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    );
    disposers.push(dispose, () => host.remove());
    await flush();
    expect(onExpandLazyDirectory).not.toHaveBeenCalled();

    setLazy(["out/"]);
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });
});
