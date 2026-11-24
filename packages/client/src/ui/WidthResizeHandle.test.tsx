// @vitest-environment happy-dom
/**
 * Dragging a sidebar's edge — the one drag the Dock and the Conductor's
 * sidebar share. What a person keeps is the stored width: written once, when
 * the drag ends; never by a bare click; never by a cancelled pointer; and put
 * back to the default by a double-click.
 */

import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resizableWidth } from "./resizableWidth";
import { createWidthDrag, WidthResizeHandle } from "./WidthResizeHandle";

const NAME = "kolu-test-sidebar-width";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => localStorage.clear());
afterEach(() => {
  dispose?.();
  root?.remove();
});

function mount() {
  const width = resizableWidth(NAME, {
    defaultPx: 240,
    minPx: 200,
    maxPx: 400,
    reservePx: 300,
  });
  let rendered!: () => number;
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => {
    const drag = createWidthDrag(width, () => null);
    rendered = drag.rendered;
    return <WidthResizeHandle drag={drag} testId="handle" />;
  }, root);
  const handle = root.querySelector<HTMLElement>('[data-testid="handle"]');
  if (handle === null) throw new Error("no handle");
  return { width, handle, rendered: () => rendered() };
}

const pointer = (type: string, clientX: number, pointerId = 1) =>
  new PointerEvent(type, { clientX, pointerId, button: 0, bubbles: true });

describe("dragging a sidebar's edge", () => {
  it("follows the pointer and stores the width once, when the drag ends", () => {
    const { width, handle, rendered } = mount();
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 150));
    window.dispatchEvent(pointer("pointermove", 180));
    expect(rendered()).toBe(320);
    expect(localStorage.getItem(NAME)).toBeNull();
    window.dispatchEvent(pointer("pointerup", 180));
    expect(width.stored()).toBe(320);
    expect(localStorage.getItem(NAME)).toBe("320");
  });

  it("clamps the drag into the sidebar's bounds", () => {
    const { handle, rendered } = mount();
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 900));
    expect(rendered()).toBe(400);
    window.dispatchEvent(pointer("pointermove", -900));
    expect(rendered()).toBe(200);
  });

  it("stores nothing for a bare click, and drops a cancelled drag", () => {
    const { width, handle, rendered } = mount();
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointerup", 100));
    expect(localStorage.getItem(NAME)).toBeNull();
    handle.dispatchEvent(pointer("pointerdown", 100));
    window.dispatchEvent(pointer("pointermove", 160));
    window.dispatchEvent(pointer("pointercancel", 160));
    expect(rendered()).toBe(240);
    expect(width.stored()).toBe(240);
  });

  it("ignores a second pointer while one drags", () => {
    const { handle, rendered } = mount();
    handle.dispatchEvent(pointer("pointerdown", 100, 1));
    handle.dispatchEvent(pointer("pointerdown", 100, 2));
    window.dispatchEvent(pointer("pointermove", 400, 2));
    expect(rendered()).toBe(240);
    window.dispatchEvent(pointer("pointermove", 130, 1));
    expect(rendered()).toBe(270);
  });

  it("goes back to the default on a double-click", () => {
    const { width, handle } = mount();
    width.set(360);
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(width.stored()).toBe(240);
  });
});
