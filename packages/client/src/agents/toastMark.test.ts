// @vitest-environment happy-dom
/**
 * THE MARK OUTLIVES ITS ROOT. `agentDistroToastIcon` builds the element under
 * a root it disposes at once, and hands the ELEMENT to sonner, which holds it
 * for as long as the toast is on screen — well past that disposal. Four call
 * sites depend on the node still being the mark afterwards: its class, its
 * size and the inlined SVG. The only other test of it mocks it away
 * (`AgentsChooser.test.tsx`), so this is where that holds.
 */

import { flush } from "solid-js";
import { expect, it } from "vitest";
import { agentDistroToastIcon } from "./toastMark";

function mark(): HTMLElement {
  const node = agentDistroToastIcon();
  if (!(node instanceof HTMLElement))
    throw new Error("the toast mark is not an element");
  return node;
}

it("keeps its class, its size and its SVG after the root is disposed", () => {
  const node = mark();

  expect(node.getAttribute("data-testid")).toBe("agent-distro-logo");
  expect(node.getAttribute("aria-hidden")).toBe("true");
  expect(node.className).toContain("inline-flex");
  expect(node.className).toContain("shrink-0");
  expect(node.style.width).toBe("16px");
  expect(node.style.height).toBe("16px");
  expect(node.innerHTML).toContain("<svg");

  // Nothing the disposal queues can take the mark apart afterwards: it is in
  // the document for the life of a toast, and the flush a toast lands on is
  // another one entirely.
  const html = node.innerHTML;
  flush();
  document.body.append(node);
  flush();
  expect(node.className).toContain("inline-flex");
  expect(node.style.width).toBe("16px");
  expect(node.innerHTML).toBe(html);
  node.remove();
});

it("builds a fresh node per toast", () => {
  const first = mark();
  const second = mark();
  expect(first).not.toBe(second);
  expect(second.innerHTML).toBe(first.innerHTML);
});
