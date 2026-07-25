// @vitest-environment happy-dom
/**
 * The host dropdown's forward row — one of the two surfaces that showed a
 * forwarded port with no way to reach the terminal serving it.
 *
 * It had the mechanism wired but spent it on a bare `↗` glyph at ten pixels,
 * beside three other glyphs, which is indistinguishable from decoration. The
 * port NUMBER is the row's subject, so the number is the affordance.
 */

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

function mount(onOpenTerminal?: () => void) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <ForwardRow forward={forward} onOpenTerminal={onOpenTerminal} />,
    host,
  );
  return host;
}

describe("ForwardRow — the dropdown surface", () => {
  it("makes the port number jump to the serving terminal", () => {
    const onJump = vi.fn();
    const el = mount(onJump);
    const jump = el.querySelector<HTMLButtonElement>(
      '[data-testid="port-jump"]',
    );
    expect(jump).not.toBeNull();
    jump?.click();
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("renders the number plainly when no terminal is attributed", () => {
    const el = mount(undefined);
    expect(el.querySelector('[data-testid="port-jump"]')).toBeNull();
    expect(el.textContent).toContain("5173");
  });
});
