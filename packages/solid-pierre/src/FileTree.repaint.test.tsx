// @vitest-environment happy-dom
/**
 * Live-repaint invariant for a MOUNTED file tree — juspay/kolu#1534.
 *
 * The Code tab's goal is a tree that updates *in place* while it stays mounted
 * (flicker-free live fs/git updates). Today's git-status stream hides any
 * repaint bug by fully REMOUNTING the tree on every change, so nothing in the
 * suite would notice if a live path change stopped reaching the DOM: the
 * sibling `FileTree.gesture.test.tsx` mocks `@pierre/trees` away entirely (it
 * tests the wrapper's selection contract, not rendering), and
 * `FileTree.gitStatus.test.ts` only inspects a one-shot SSR payload. Nothing
 * drives the wrapper's in-place mutation path against the REAL library.
 *
 * That is the gap these tests close, and the wrapper's `batch(add/remove)`
 * delta path in `FileTree.tsx` is the subject: deleting the `t.batch(pathOps)`
 * apply turns three of these four red. The tests are deliberately at the DOM
 * level rather than asserting Pierre called some method, because "value right,
 * screen stale" is precisely a failure that a method-call assertion passes.
 *
 * Row identity is read from `data-item-path`, the attribute Pierre stamps on
 * each rendered row (the same one `FileTree.gitStatus.test.ts` asserts against
 * the SSR payload). Re-reading the shadow root captured BEFORE the mutation is
 * what makes this a *repaint* test rather than a remount test — a remounted
 * tree would build a fresh root and trivially show the new rows.
 *
 * NOTE on #1534's proposed dependency patch: the issue attributes stale
 * repaints to `@pierre/trees` swallowing the first controller emit after
 * subscribe, and asks for that guard to be patched out. On the version this
 * repo ships that guard is inert and the patch was deliberately NOT taken —
 * `FileTreeController.subscribe` invokes the listener synchronously at
 * registration, so the swallowed emit is always that subscribe-time replay and
 * never a mutation; and the repaint rides `update()` → `setLayoutState`, not
 * the revision counter, so disabling the counter outright leaves these tests
 * green. See the PR that added this file for the full evidence.
 */
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { GitStatusEntry } from "@pierre/trees";
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

/** Let Solid's deferred effect push the change into Pierre and Pierre's Preact
 *  view re-render. Both are *scheduled*, not synchronous, so a repaint
 *  assertion has to yield first. Waiting cannot mask the failure this file
 *  guards: a change that never bumps the view's revision never repaints, no
 *  matter how long the test waits. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The paths Pierre currently has painted, in DOM order. */
function paintedRows(root: ShadowRoot): string[] {
  return [...root.querySelectorAll("[data-item-path]")].map(
    (n) => (n as HTMLElement).dataset.itemPath as string,
  );
}

/** Mount a real Pierre tree driven by a reactive `paths` signal, and hand back
 *  the setter plus Pierre's shadow root so a test can mutate and re-read. */
function mountTree(initial: string[], gitStatus?: GitStatusEntry[]) {
  const [paths, setPaths] = createSignal(initial);
  const [status, setStatus] = createSignal(gitStatus);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
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
  );
  disposers.push(dispose, () => host.remove());
  const container = host.querySelector(
    '[data-testid="pierre-file-tree"]',
  ) as HTMLElement;
  const root = findShadowRoot(container);
  if (!root) throw new Error("Pierre mounted no shadow root");
  return { setPaths, setStatus, root };
}

describe("mounted FileTree repaints on a live change (#1534)", () => {
  it("paints an added file into the SAME mounted tree", async () => {
    const { setPaths, root } = mountTree(["src/a.ts", "src/b.ts"]);
    expect(paintedRows(root)).toContain("src/a.ts");
    expect(paintedRows(root)).not.toContain("src/c.ts");

    setPaths(["src/a.ts", "src/b.ts", "src/c.ts"]);
    await flush();

    // The row must be in the DOM, not merely in Pierre's model — this is the
    // "value right, screen stale" failure the issue is about.
    expect(paintedRows(root)).toContain("src/c.ts");
    // Still the same shadow root we captured before the mutation, and still in
    // the document ⇒ the tree was never torn down and rebuilt, so the new row
    // is a genuine in-place repaint rather than a remount.
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
    // Same row COUNT and same directory shape: the case a naive "did the length
    // change?" repaint heuristic would miss.
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

    // `src/` must now be tinted in the DOM without a remount.
    expect(marked()).toContain("src/");
  });
});
