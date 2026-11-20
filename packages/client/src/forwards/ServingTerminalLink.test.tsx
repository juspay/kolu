// @vitest-environment happy-dom

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
    const link = mount({ name: "kolu/master", onJump: vi.fn() });
    const cls = link?.className ?? "";
    expect(cls).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
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
