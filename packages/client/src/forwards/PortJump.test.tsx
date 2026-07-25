// @vitest-environment happy-dom
/**
 * The affordance that takes you from a forwarded port to the terminal serving it.
 *
 * Every surface that shows a forward raises the same question — "what IS this?"
 * — and until now only one of them could answer. The two that could not are the
 * ones where the question is sharpest:
 *
 *  - the host dropdown, where a row is a bare number and an address;
 *  - the Inspector's "also forwarded on this host" group, where a port is *by
 *    definition* served by some terminal OTHER than the one you are inspecting.
 *    That group exists precisely to say "there is more going on here", so
 *    leaving it unnavigable is the worst place to leave it.
 *
 * One component for both, because the interesting part is the pair of states —
 * attributed and not — and two implementations would be two chances to render a
 * dead link for the second.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortJump } from "./PortJump";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(props: { port: number; onJump?: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <PortJump {...props} />, host);
  return {
    button: host.querySelector<HTMLButtonElement>('[data-testid="port-jump"]'),
    root: host,
  };
}

describe("PortJump", () => {
  it("is a button when the scanner attributed the port to a terminal", () => {
    const { button } = mount({ port: 5173, onJump: () => {} });
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("5173");
  });

  it("jumps when clicked", () => {
    const onJump = vi.fn();
    const { button } = mount({ port: 5173, onJump });
    button?.click();
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("renders the number PLAINLY when nothing is attributed — no dead link", () => {
    // A ⌘K forward to a port no terminal serves, or one whose server has died.
    // The row must still render (its door is real and cancellable), but offering
    // a click that goes nowhere is worse than offering none.
    const { button, root } = mount({ port: 9229 });
    expect(button).toBeNull();
    expect(root.textContent).toContain("9229");
  });

  it("says where it goes, for a pointer and a screen reader alike", () => {
    const { button } = mount({ port: 5173, onJump: () => {} });
    expect(button?.getAttribute("title")).toMatch(/terminal/i);
    expect(button?.getAttribute("aria-label")).toMatch(/5173/);
  });

  it("keeps the number in tabular figures either way", () => {
    // The number is a column in both surfaces; proportional digits make a list
    // of ports ragged.
    expect(mount({ port: 5173, onJump: () => {} }).root.innerHTML).toContain(
      "tabular-nums",
    );
    dispose?.();
    host?.remove();
    expect(mount({ port: 5173 }).root.innerHTML).toContain("tabular-nums");
  });
});
