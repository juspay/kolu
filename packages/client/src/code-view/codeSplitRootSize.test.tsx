// @vitest-environment happy-dom
/**
 * THE CODE TAB'S SPLIT AGAINST THE SIZE ITS ROOT IS MEASURED AT.
 *
 * The dev lane reports the Code tab's resizable as the victim of a relay
 * tear: the element spread of `@corvu-next/utils`' `Dynamic` runs twice for
 * one write of the selection the split's arrangement is derived from. The one
 * effect-origin write in the resizable's size path was `@corvu-next/utils`'
 * `createSize`, which measured the root from an effect's apply arm — so
 * everything derived from the root's size arrived a flush after the element
 * it describes, and the panels registered against a root of no size at all.
 * The measurement is derived now, which is what this file pins from kolu's
 * side: corvu's own suite does not run in kolu's CI.
 *
 * The shape is the Code tab's (`CodeTab.tsx:1304-1512`): one `Resizable`
 * whose `orientation` and controlled `sizes` both follow the store the tab
 * keeps its per-terminal selection in, a tree panel, the inner handle with
 * `startIntersection={false}`, and a content panel.
 *
 * The root's size is stubbed on the element itself, because happy-dom lays
 * nothing out and its `ResizeObserver` never calls back: the memo's reading
 * of the element is the only measurement a test can see, so a panel bound in
 * pixels is how the measurement becomes observable.
 */

import Resizable from "@corvu-next/resizable";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { controlledSizes } from "../ui/corvuResizable";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

it("gives the split's panels the root size of the flush the selection changed in", () => {
  // The driver: the per-terminal selection the Code tab's arrangement is
  // derived from, in the store the tab keeps it in.
  const [selection, setSelection] = createStore<{ mode: "stacked" | "beside" }>(
    { mode: "stacked" },
  );
  const orientation = () =>
    selection.mode === "stacked"
      ? ("vertical" as const)
      : ("horizontal" as const);
  const sizes = controlledSizes(() => [0.5, 0.5]);

  // The element applies all of its props in one effect, so counting the reads
  // of one of them counts how often the tree panel was written.
  let applies = 0;
  const treeLabel = () => {
    applies++;
    return `tree ${orientation()}`;
  };

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Resizable
        orientation={orientation()}
        sizes={sizes()}
        ref={(element: HTMLElement) => {
          // 200px across and 800px down, so the dimension the root is
          // measured in decides whether half the layout is the tree panel's
          // own 100px collapsed size.
          Object.defineProperty(element, "offsetWidth", { value: 200 });
          Object.defineProperty(element, "offsetHeight", { value: 800 });
        }}
      >
        <Resizable.Panel
          as="div"
          data-testid="diff-file-list"
          collapsible
          collapsedSize="100px"
          aria-label={treeLabel()}
        />
        <Resizable.Handle as="button" startIntersection={false} />
        <Resizable.Panel as="div" data-testid="diff-content" />
      </Resizable>
    ),
    host,
  );
  flush();

  const tree = host.querySelector("[data-testid='diff-file-list']")!;

  // Beside the panels, the root is 200px across, and half of it is the tree
  // panel's collapsed size — the panels registered against the measured root,
  // not against a root of zero.
  setSelection((draft) => {
    draft.mode = "beside";
  });
  flush();
  expect(tree.hasAttribute("data-collapsed")).toBe(true);

  const appliesPerChange: number[] = [];
  const collapsedPerChange: boolean[] = [];
  for (const mode of ["stacked", "beside", "stacked"] as const) {
    applies = 0;
    setSelection((draft) => {
      draft.mode = mode;
    });
    flush();
    appliesPerChange.push(applies);
    collapsedPerChange.push(tree.hasAttribute("data-collapsed"));
  }

  // One write of the element per write of the selection, each carrying the
  // size the root has in that very flush.
  expect(appliesPerChange).toEqual([1, 1, 1]);
  expect(collapsedPerChange).toEqual([false, true, false]);
});
