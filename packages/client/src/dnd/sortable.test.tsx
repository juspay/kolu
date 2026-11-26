// @vitest-environment happy-dom
/** A sortable's id is fixed for the lifetime of its owner: dnd-kit registers
 *  the draggable and the droppable once, under the id the hook was given. The
 *  preview slot, which is derived, would follow a changing id while the
 *  registration stayed behind — a drag that moves one item while another
 *  shifts. The hook refuses that instead of acting on it. */

import { createEffect, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import { DragDropProvider } from "./DragDropProvider";
import {
  createSortable,
  type SortableHandle,
  SortableProvider,
} from "./sortable";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function mountSortable(
  id: () => string,
  ids: () => readonly string[] = () => ["a", "b"],
): SortableHandle {
  let handle: SortableHandle | undefined;
  const Item = () => {
    handle = createSortable(id);
    // A real subscriber: `transform` reads `sortedIds`, so the preview memo is
    // observed on every publish, as it is under a mounted item.
    createEffect(
      () => handle?.transform(),
      () => {},
    );
    return null;
  };
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <DragDropProvider onDragEnd={() => {}}>
        <SortableProvider ids={ids()}>
          <Item />
        </SortableProvider>
      </DragDropProvider>
    ),
    host,
  );
  flush();
  if (!handle) throw new Error("sortable did not mount");
  return handle;
}

it("reads its transform while the id it registered with stands", () => {
  const handle = mountSortable(() => "a");
  expect(handle.transform()).toEqual({ x: 0, y: 0 });
});

it("refuses an id that changes under one registration", () => {
  const [id, setId] = createSignal("a");
  const handle = mountSortable(id);
  expect(handle.transform()).toEqual({ x: 0, y: 0 });

  setId("b");
  flush();
  expect(() => handle.transform()).toThrow(/changing id \(a -> b\)/);
});

it("holds the preview order still while an equal id list is republished", () => {
  // Every caller (`Dock.tsx`) hands `ids` in as a FRESH array, so a list that
  // did not change still re-runs `sortedIds`, which returns that fresh array.
  // Four such publishes are Solid's `UNSTABLE_MEMO_OUTPUT`, which
  // `@kolu/solid-test-setup` fails the test on — the `sameIdOrder` gate on
  // `sortedIds` is what this holds.
  const [ids, setIds] = createSignal<readonly string[]>(["a", "b"]);
  const handle = mountSortable(() => "a", ids);

  for (let i = 0; i < 4; i++) {
    setIds(["a", "b"]);
    flush();
  }

  expect(handle.transform()).toEqual({ x: 0, y: 0 });
});
