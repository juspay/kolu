// @vitest-environment happy-dom
/** #1763 — the boot-stalled escape surface must render NON-BLANK (App.tsx's canvas
 *  `<Switch>` has no fallback, so an unwired/blank arm would show nothing). Renders
 *  `BootStalledCanvas` through `solid-js/web`'s `render` (the `dialogLiveness.test.tsx`
 *  idiom) and asserts the leg's copy, the Reload recovery verb, and — for a remote host —
 *  the Switch-to-local escape hatch, all appear. `../wire` is mocked so the surface stack /
 *  socket never boots in the test. */

import type { HostKey } from "kolu-common/hostKey";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootStalledCopy } from "../kaval/bootStalledCopy";

const h = vi.hoisted(() => ({ host: { kind: "local" } as HostKey }));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
}));

// Imported AFTER the mock so it binds the mocked `../wire`.
const { default: BootStalledCanvas } = await import("./BootStalledCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.host = { kind: "local" };
});

describe("BootStalledCanvas renders non-blank (App Switch shell pin)", () => {
  it("a local session-leg stall shows its copy + a Reload verb, no Switch-to-local", () => {
    dispose = render(
      () => <BootStalledCanvas leg="session" phase={undefined} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-canvas"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-stalled-leg="session"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      bootStalledCopy("session").title,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-reload"]'),
    ).not.toBeNull();
    // Local: no escape-hatch button (switching to where you already are is a no-op).
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).toBeNull();
  });

  it("a remote provisioning stall names the phase and offers Switch-to-local", () => {
    h.host = { kind: "remote", target: "zest" };
    dispose = render(
      () => <BootStalledCanvas leg="provisioning" phase="building" />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-canvas"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      bootStalledCopy("provisioning").title,
    );
    // C4 phase render — the wedged build names WHERE it is stuck.
    expect(document.body.textContent).toContain("building");
    expect(
      document.querySelector('[data-testid="boot-stalled-reload"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).not.toBeNull();
  });
});
