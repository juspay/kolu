// @vitest-environment happy-dom
/** A sortable's id is fixed for the lifetime of its owner: dnd-kit registers
 *  the draggable and the droppable once, under the id the hook was given. The
 *  preview slot, which is derived, would follow a changing id while the
 *  registration stayed behind — a drag that moves one item while another
 *  shifts. The hook refuses that instead of acting on it. */

import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it } from "vitest";
import { DragDropProvider } from "./DragDropProvider";
import { createSortable, type SortableHandle, SortableProvider } from "./sortable";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function mountSortable(id: () => string): SortableHandle {
  let handle: SortableHandle | undefined;
  const Item = () => {
    handle = createSortable(id);
    return null;
  };
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <DragDropProvider onDragEnd={() => {}}>
        <SortableProvider ids={["a", "b"]}>
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
