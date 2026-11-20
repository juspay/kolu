// @vitest-environment happy-dom

import type { KoluForward } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./useForwards", () => ({ cancelForward: () => Promise.resolve() }));

const { ForwardRow } = await import("./ForwardRows");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

const forward: KoluForward = {
  key: "remote:naiveintent:5173",
  host: { kind: "remote", target: "naiveintent" },
  remotePort: 5173,
  localPort: 5173,
  origin: "auto",
  createdAt: 0,
};

function mount(serving?: { name: string; jump: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <ForwardRow forward={forward} serving={serving} />,
    host,
  );
  return host;
}

describe("ForwardRow — the dropdown surface", () => {
  it("names the serving terminal, and the name is the link", () => {
    const jump = vi.fn();
    const el = mount({ name: "kolu/master", jump });
    const link = el.querySelector<HTMLButtonElement>(
      '[data-testid="terminal-jump"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBe("kolu/master");
    link?.click();
    expect(jump).toHaveBeenCalledOnce();
  });

  it("the link is visibly a link at rest, not styled like the row's text", () => {
    const el = mount({ name: "kolu/master", jump: vi.fn() });
    const cls =
      el.querySelector('[data-testid="terminal-jump"]')?.className ?? "";
    expect(cls).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
  });

  it("says nothing rather than lying when no terminal is attributed", () => {
    const el = mount(undefined);
    expect(el.querySelector('[data-testid="terminal-jump"]')).toBeNull();
    expect(el.textContent).toContain("5173");
  });

  it("leaves the port NUMBER as plain text — no secret click target", () => {
    const el = mount({ name: "kolu/master", jump: vi.fn() });
    expect(el.querySelector('[data-testid="port-jump"]')).toBeNull();
  });
});
