// @vitest-environment happy-dom
/** #1763 — the boot-stalled escape surface renders NON-BLANK for every leg. Renders
 *  `BootStalledCanvas` through `solid-js/web`'s `render` (the `dialogLiveness.test.tsx`
 *  idiom) and asserts the leg's copy, the Reload recovery verb, and — for a remote host —
 *  the Switch-to-local escape hatch, all appear. `../wire` is mocked so the surface stack /
 *  socket never boots in the test.
 *
 *  SCOPE (codex-debate F2): this is a COMPONENT render pin, not an App-`<Switch>` integration
 *  test — it would stay green if App.tsx's `boot-stalled` `<Match>` were deleted. The two facts
 *  that surface can't render blank are pinned elsewhere: `useCanvasMode.test.ts` proves the
 *  `boot-stalled` MODE is produced, and this proves the component renders non-blank from it. The
 *  one-line `<Match when={bootStalledMode()}>{(m) => <BootStalledCanvas .../>}</Match>` wiring
 *  between them is deliberately NOT integration-tested here: rendering App.tsx drags the whole
 *  live `wire` socket stack, disproportionate to a one-line reviewed arm. */

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

describe("BootStalledCanvas renders non-blank (component render pin)", () => {
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
