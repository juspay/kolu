// @vitest-environment happy-dom
/**
 * THE KOLU-SIDE GUARD FOR CORVU'S HANDLE REGISTRATION.
 *
 * kolu mounts two resizables of differing orientation at once — the Code
 * tab's tree/content split inside the app's own split (`CodeTab.tsx:1304`,
 * `App.tsx`) — and corvu pairs the handles of differing orientation whose
 * rectangles touch, writing each one's intersection signal from the other's
 * registration (`@corvu-next/resizable` `lib/handleManager.ts`). Registering
 * from a computation makes that write a write from an owned scope, which
 * Solid refuses and throws on: the handle keeps no drag callbacks and never
 * unregisters.
 *
 * In happy-dom every rectangle is zeros, so any two handles of differing
 * orientation touch — which is what lets kolu's own lane hold the pin to
 * that, rather than only corvu's suite, which kolu's CI never runs.
 *
 * The product's own opt-out is kept: both handles pass
 * `startIntersection={false}`, so the pairing that remains is the end one,
 * exactly the arm that fires in the product.
 */

import Resizable from "@corvu-next/resizable";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

it("a handle still drags with a resizable of the other orientation mounted", () => {
  let innerHandle!: HTMLElement;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Resizable orientation="horizontal">
        <Resizable.Panel as="div" />
        <Resizable.Handle as="button" startIntersection={false} />
        <Resizable.Panel as="div">
          <Resizable orientation="vertical">
            <Resizable.Panel as="div" />
            <Resizable.Handle
              as="button"
              startIntersection={false}
              ref={(element: HTMLElement) => {
                innerHandle = element;
              }}
            />
            <Resizable.Panel as="div" />
          </Resizable>
        </Resizable.Panel>
      </Resizable>
    ),
    host,
  );
  flush();

  // The inner handle registered after the outer one, so it is the one whose
  // registration pairs the two. A registration that threw leaves it without
  // the callbacks its pointer handler drags through.
  innerHandle.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }),
  );
  flush();

  expect(innerHandle.hasAttribute("data-dragging")).toBe(true);
});
