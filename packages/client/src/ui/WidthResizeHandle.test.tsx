// @vitest-environment happy-dom
/**
 * Dragging a sidebar's edge — the one drag the Dock and the Conductor's
 * sidebar share. What a person keeps is the stored width: written once, when
 * the drag ends; never by a bare click; never by a cancelled pointer; and put
 * back to the default by a double-click.
 */

import { flush } from "solid-js";
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

/** Dispatch an event and let the frame it provokes land: Solid 2 stages the
 *  handler's width writes until the next flush. */
const fire = (target: EventTarget, event: Event) => {
  target.dispatchEvent(event);
  flush();
};

describe("dragging a sidebar's edge", () => {
  it("follows the pointer and stores the width once, when the drag ends", () => {
    const { width, handle, rendered } = mount();
    fire(handle, pointer("pointerdown", 100));
    fire(window, pointer("pointermove", 150));
    fire(window, pointer("pointermove", 180));
    expect(rendered()).toBe(320);
    expect(localStorage.getItem(NAME)).toBeNull();
    fire(window, pointer("pointerup", 180));
    expect(width.stored()).toBe(320);
    expect(localStorage.getItem(NAME)).toBe("320");
  });

  it("clamps the drag into the sidebar's bounds", () => {
    const { handle, rendered } = mount();
    fire(handle, pointer("pointerdown", 100));
    fire(window, pointer("pointermove", 900));
    expect(rendered()).toBe(400);
    fire(window, pointer("pointermove", -900));
    expect(rendered()).toBe(200);
  });

  it("stores nothing for a bare click, and drops a cancelled drag", () => {
    const { width, handle, rendered } = mount();
    fire(handle, pointer("pointerdown", 100));
    fire(window, pointer("pointerup", 100));
    expect(localStorage.getItem(NAME)).toBeNull();
    fire(handle, pointer("pointerdown", 100));
    fire(window, pointer("pointermove", 160));
    fire(window, pointer("pointercancel", 160));
    expect(rendered()).toBe(240);
    expect(width.stored()).toBe(240);
  });

  it("ignores a second pointer while one drags", () => {
    const { handle, rendered } = mount();
    fire(handle, pointer("pointerdown", 100, 1));
    fire(handle, pointer("pointerdown", 100, 2));
    fire(window, pointer("pointermove", 400, 2));
    expect(rendered()).toBe(240);
    fire(window, pointer("pointermove", 130, 1));
    expect(rendered()).toBe(270);
  });

  it("goes back to the default on a double-click", () => {
    const { width, handle } = mount();
    width.set(360);
    // The stored width lands on its own flush — the double-click below resets
    // a width the person has already got.
    flush();
    fire(handle, new MouseEvent("dblclick", { bubbles: true }));
    expect(width.stored()).toBe(240);
  });
});
