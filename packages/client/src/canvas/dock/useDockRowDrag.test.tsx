// @vitest-environment happy-dom
/** A dock row's drag sockets are registered with dnd-kit once, under the id
 *  the hook was given. The hover verdict and the live gate are derived and
 *  would follow a changing id while that registration stayed behind — the drag
 *  acting for one row while the verdict spoke for another. The hook refuses
 *  that instead of acting on it. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { DragDropProvider } from "../../dnd";
import type { DockRowDrag } from "./useDockRowDrag";
import { useDockRowDrag } from "./useDockRowDrag";

vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    parentEdge: () => undefined,
    getMetadata: () => undefined,
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
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
