/**
 * Shared DOM scaffolding for the `FileTree` suites that drive the REAL
 * `@pierre/trees` under happy-dom (`FileTree.repaint.test.tsx`,
 * `FileTree.lazyDir.test.tsx`) — the `*.testlib` convention, cf.
 * `@kolu/padi`'s `servePadi.testlib.ts` and `gitRepo.testlib.ts`.
 *
 * These four helpers are the *environment*, not the subject: how Pierre's
 * shadow root is found, how long to wait for a scheduled repaint, and how a
 * painted row is read back. They were copied between the two suites, which
 * meant a change to any of them — Pierre relocating its shadow root, the
 * repaint becoming a microtask, sticky headers changing how rows repeat — had
 * to be found and fixed in every copy.
 *
 * `mountTree` deliberately stays per-suite: each drives a different set of
 * props, and that IS the thing each suite is testing.
 */

/** Disposers to run after each test. A suite registers
 *  `afterEach(disposeAll)` itself, so this module needs no vitest hook of its
 *  own and stays a plain helper. */
export const disposers: Array<() => void> = [];

/** Run and clear every registered disposer. */
export function disposeAll(): void {
  for (const d of disposers.splice(0)) d();
}

/** Pierre renders its rows under an open shadow root nested in the container;
 *  find it the same way the wrapper's own `findShadowRoot` does. */
export function findShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  for (const child of el.children) {
    const found = findShadowRoot(child);
    if (found) return found;
  }
  return null;
}

/** Let Solid's deferred effect push the change into Pierre and Pierre's Preact
 *  view re-render. Both are *scheduled*, not synchronous, so a repaint
 *  assertion has to yield first. Waiting cannot mask a repaint failure: a
 *  change that never bumps the view's revision never repaints, no matter how
 *  long the test waits. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The paths Pierre currently has painted, in DOM order. Sticky header rows
 *  repeat a path, so this de-dupes — these assertions are about presence, not
 *  row count. */
export function paintedRows(root: ShadowRoot): string[] {
  return [
    ...new Set(
      [...root.querySelectorAll("[data-item-path]")].map(
        (n) => (n as HTMLElement).dataset.itemPath as string,
      ),
    ),
  ];
}

/** Mount a host `<div>`, render into it, and hand back Pierre's shadow root.
 *  The caller supplies the element so each suite keeps ownership of the props
 *  it is actually testing. Registers its own teardown in {@link disposers}. */
export function mountInto(
  renderInto: (host: HTMLElement) => () => void,
): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = renderInto(host);
  disposers.push(dispose, () => host.remove());
  const container = host.querySelector(
    '[data-testid="pierre-file-tree"]',
  ) as HTMLElement;
  const root = findShadowRoot(container);
  if (!root) throw new Error("Pierre mounted no shadow root");
  return root;
}
