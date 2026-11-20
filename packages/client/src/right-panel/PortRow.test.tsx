// @vitest-environment happy-dom

import type { KoluForward } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../forwards/useForwards", () => ({
  cancelForward: () => Promise.resolve(),
  createForward: () =>
    Promise.resolve({
      key: "local:8080",
      host: { kind: "local" },
      remotePort: 8080,
      localPort: 61003,
      origin: "manual",
      createdAt: 0,
    }),
}));

const { PortRow } = await import("./PortRow");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

const forward: KoluForward = {
  key: "local:8080",
  host: { kind: "local" },
  remotePort: 8080,
  localPort: 61003,
  origin: "manual",
  createdAt: 0,
};

function mountOrphan(serving?: { name: string; jump: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <PortRow
        row={{ kind: "orphan", port: 8080, forward }}
        action={{ kind: "forward" }}
        host={{ kind: "local" }}
        forwardReason={undefined}
        serving={serving}
      />
    ),
    host,
  );
  return host;
}

describe("PortRow — the trailing 'also forwarded' row", () => {
  it("names the serving terminal in place of the category phrase", () => {
    const jump = vi.fn();
    const el = mountOrphan({ name: "kolu/master", jump });
    const link = el.querySelector<HTMLButtonElement>(
      '[data-testid="terminal-jump"]',
    );
    expect(link?.textContent?.trim()).toBe("kolu/master");
    expect(el.textContent).not.toContain("also forwarded on this host");
    link?.click();
    expect(jump).toHaveBeenCalledOnce();
  });

  it("reads as a link at rest, not as the row's own muted text", () => {
    const el = mountOrphan({ name: "kolu/master", jump: vi.fn() });
    const cls =
      el.querySelector('[data-testid="terminal-jump"]')?.className ?? "";
    expect(cls).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
  });

  it("keeps the honest sentence when no terminal is attributed", () => {
    const el = mountOrphan(undefined);
    expect(el.querySelector('[data-testid="terminal-jump"]')).toBeNull();
    expect(el.textContent).toContain("also forwarded on this host");
  });
});
