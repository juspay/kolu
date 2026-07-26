// @vitest-environment happy-dom
/**
 * The link back to the terminal serving a forwarded port.
 *
 * It replaced an underlined port NUMBER, which the field verdict was blunt
 * about: *"the terminal link is invisible — I could not find it at all."* A
 * dotted underline at 40% opacity on a monospace number reads as plain text,
 * and a number is not a name — even found, it answered "go where?" with a digit.
 *
 * So the ATTRIBUTION carries the affordance now: the row says which terminal
 * serves the port, and that name IS the link. These tests pin the two halves of
 * that — it names the terminal, and it is visibly interactive at REST, before
 * any hover.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServingTerminalLink } from "./ServingTerminalLink";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(props: { name: string; onJump: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ServingTerminalLink {...props} />, host);
  return host.querySelector<HTMLElement>('[data-testid="terminal-jump"]');
}

describe("ServingTerminalLink", () => {
  it("shows the terminal's NAME, not the port number", () => {
    const link = mount({ name: "kolu/master", onJump: vi.fn() });
    expect(link?.textContent?.trim()).toBe("kolu/master");
  });

  it("reads as interactive AT REST — accent-coloured and underlined", () => {
    // The whole finding: a resting state indistinguishable from plain text is
    // not an affordance. A hover-only reveal fails the same way, because the
    // user has to already suspect the link to find it.
    const link = mount({ name: "kolu/master", onJump: vi.fn() });
    const cls = link?.className ?? "";
    expect(cls).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
    // …and not the previous cut's whisper: a dotted rule at 40% opacity.
    expect(cls).not.toMatch(/decoration-dotted/);
  });

  it("is a real button, and jumping is what it does", () => {
    const onJump = vi.fn();
    const link = mount({ name: "kolu/master", onJump });
    expect(link?.tagName).toBe("BUTTON");
    link?.click();
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("names the terminal in the tooltip and the accessible label", () => {
    const link = mount({ name: "kolu/master", onJump: vi.fn() });
    expect(link?.getAttribute("title")).toContain("kolu/master");
    expect(link?.getAttribute("aria-label")).toContain("kolu/master");
  });
});
