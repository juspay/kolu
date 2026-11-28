// @vitest-environment happy-dom
/** Two rules of a dock row's drag sockets.
 *
 *  ONE: the sockets are registered with dnd-kit once, under the id the hook was
 *  given. The hover verdict and the live gate are derived and would follow a
 *  changing id while that registration stayed behind — the drag acting for one
 *  row while the verdict spoke for another. The hook refuses that instead of
 *  acting on it.
 *
 *  TWO: a LIVE row drags by its grip, a SLEEPING one does not drag at all. The
 *  grip is rendered only while the row is live, so the draggable says the rule
 *  itself (`disabled`) rather than leaning on the grip's absence, and the grip
 *  element is unbound with the row that owned it — a detached grip left bound
 *  is the element every later press would have to land on. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush, Show } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { DragDropProvider, useDragDropScope } from "../../dnd";
import type { DragDropScope } from "../../dnd/DragDropProvider";
import { rowDragId } from "./dockReparent";
import type { DockRowDrag } from "./useDockRowDrag";
import { useDockRowDrag } from "./useDockRowDrag";

/** The one terminal fact these sockets read, driven per test. */
const store = vi.hoisted(() => ({
  metadataOf: (_id: string): TerminalMetadata | undefined => undefined,
}));

vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    parentEdge: () => undefined,
    getMetadata: (id: string) => store.metadataOf(id),
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
  store.metadataOf = () => undefined;
});

function mountRow(id: () => TerminalId): DockRowDrag {
  let drag: DockRowDrag | undefined;
  const Row = () => {
    drag = useDockRowDrag(id);
    return null;
  };
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <DragDropProvider onDragEnd={() => {}}>
        <Row />
      </DragDropProvider>
    ),
    host,
  );
  flush();
  if (!drag) throw new Error("row drag did not mount");
  return drag;
}

it("answers its live gate while the id it registered with stands", () => {
  const drag = mountRow(() => "t1" as TerminalId);
  // No metadata, so no live arm: the grip is absent, and that is an answer.
  expect(drag.handle).toBeUndefined();
});

it("refuses an id that changes under one registration", () => {
  const [id, setId] = createSignal("t1" as TerminalId);
  const drag = mountRow(id);
  expect(drag.handle).toBeUndefined();

  setId("t2" as TerminalId);
  flush();
  expect(() => drag.handle).toThrow(/changing id \(t1 -> t2\)/);
});

/** One row wired the way the dock wires it: the row element is the draggable,
 *  and the grip the package renders under `<Show when={handle}>` is what a
 *  press starts the drag on. */
function mountWiredRow(id: TerminalId): {
  scope: DragDropScope;
  row: HTMLElement;
  grip: () => HTMLElement | null;
} {
  let scope: DragDropScope | undefined;
  let row: HTMLElement | undefined;
  const Row = () => {
    scope = useDragDropScope();
    const drag = useDockRowDrag(() => id);
    return (
      <div
        ref={(el) => {
          row = el;
          drag.ref(el);
        }}
        data-testid="row"
      >
        <Show when={drag.handle}>
          {/* The handle is read in `<Show>`'s tracked children and handed to
           *  `ref` as the function it is — a ref callback is not a tracking
           *  scope. The package's own grip binds it the same way. */}
          <button type="button" data-testid="grip" ref={drag.handle} />
        </Show>
      </div>
    );
  };
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <DragDropProvider onDragEnd={() => {}}>
        <Row />
      </DragDropProvider>
    ),
    host,
  );
  flush();
  if (!scope || !row) throw new Error("row did not mount");
  return {
    scope,
    row,
    grip: () =>
      host?.querySelector<HTMLElement>('[data-testid="grip"]') ?? null,
  };
}

/** The dnd-kit draggable the hook registered, which is what the pointer sensor
 *  reads: its `handle` is the element a press must land on, and `disabled`
 *  whether a press starts anything at all. */
function registered(scope: DragDropScope, id: TerminalId) {
  const draggable = scope.manager.registry.draggables.get(rowDragId(id));
  if (!draggable) throw new Error("row draggable was not registered");
  return draggable;
}

function press(el: Element): void {
  el.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
      clientX: 60,
      clientY: 60,
    }),
  );
  flush();
}

function lift(): void {
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 1,
    }),
  );
  flush();
}

it("drags a live row by its grip", () => {
  const id = "t1" as TerminalId;
  store.metadataOf = () => ({ state: "active" }) as TerminalMetadata;
  const { scope, grip } = mountWiredRow(id);

  const el = grip();
  expect(el).not.toBeNull();
  const draggable = registered(scope, id);
  expect(draggable.disabled).toBe(false);
  expect(draggable.handle).toBe(el);

  if (el) press(el);
  expect(scope.activeId()).toBe(rowDragId(id));
  lift();
});

it("starts nothing on a sleeping row, and keeps no detached grip", () => {
  const id = "t1" as TerminalId;
  const [live, setLive] = createSignal(true);
  store.metadataOf = () =>
    ({ state: live() ? "active" : "sleeping" }) as TerminalMetadata;
  const { scope, row, grip } = mountWiredRow(id);
  const wasGrip = grip();
  expect(wasGrip).not.toBeNull();

  setLive(false);
  flush();
  const draggable = registered(scope, id);
  // The grip went with the row's live arm, and went from the draggable too:
  // nothing detached is left as the element a press would have to land on.
  expect(grip()).toBeNull();
  expect(wasGrip?.isConnected).toBe(false);
  expect(draggable.handle).toBeUndefined();
  // And the rule itself, not merely the missing affordance.
  expect(draggable.disabled).toBe(true);

  press(row);
  expect(scope.activeId()).toBeNull();
  lift();
});
