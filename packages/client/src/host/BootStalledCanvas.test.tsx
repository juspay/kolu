// @vitest-environment happy-dom
/** #1763 + #1908 D2 — the boot-stalled escape surface renders NON-BLANK for both recovery
 *  shapes. Renders `BootStalledCanvas` through `solid-js/web`'s `render` (the
 *  `dialogLiveness.test.tsx` idiom) and asserts, per shape, the copy, the recovery verb, and —
 *  for a remote host — the Switch-to-local escape hatch, all appear. `../wire` is mocked so the
 *  surface stack / socket never boots in the test.
 *
 * SCOPE (codex-debate F2): this is a COMPONENT render pin, not an App-`<Switch>` integration
 * test — it would stay green if App.tsx's `boot-stalled` `<Match>` were deleted. That the
 * `boot-stalled` MODE (with its honest recovery verdict) is produced is pinned in
 * `useCanvasMode.test.ts` / `canvasModeResolver.test.ts`; this proves the component renders
 * non-blank from it. The one-line `<Match>` wiring between them is deliberately NOT
 * integration-tested here (rendering App.tsx drags the whole live `wire` socket stack).
 */

import type { HostKey } from "kolu-common/hostKey";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bootStalledCopy,
  CONNECTOR_STALLED_COPY,
} from "../kaval/bootStalledCopy";
import type { BootStalledRecovery } from "../kaval/canvasModeResolver";

const h = vi.hoisted(() => ({ host: { kind: "local" } as HostKey }));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: () => Promise.resolve() } },
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
  it("a local client session-leg stall shows its copy + a Reload verb, no Switch-to-local", () => {
    dispose = render(
      () => <BootStalledCanvas recovery={{ via: "client", leg: "session" }} />,
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

  it("a remote connector stall shows the non-terminal copy, names the phase, offers Reconnect + Switch-to-local", () => {
    h.host = { kind: "remote", target: "zest" };
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{ via: "connector", phase: "provisioning", log: undefined }}
        />
      ),
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-canvas"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-recovery="connector"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(CONNECTOR_STALLED_COPY.title);
    // Phase detail — the wedged-but-retrying build names WHERE it is.
    expect(document.body.textContent).toContain("provisioning");
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).not.toBeNull();
  });

  it("the CONNECTOR arm shows the campaign's tail; the CLIENT arm cannot carry one", () => {
    // The tail rides the connector arm of `BootStalledRecovery`, so the client arm has no
    // `log` to pass — "a settled connect log over a client-side stall" is a TYPE error, not
    // a ternary the card has to remember. Asserted here as the two renders it produces.
    h.host = { kind: "remote", target: "zest" };
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [
              { line: "error: builder for '/nix/store/…-kolu.drv' failed" },
            ],
          }}
        />
      ),
      document.body,
    );
    const tail = document.querySelector('[data-testid="boot-stalled-log"]');
    expect(tail).not.toBeNull();
    expect(tail?.textContent).toContain("builder for");

    dispose();
    dispose = undefined;
    document.body.innerHTML = "";

    dispose = render(
      () => <BootStalledCanvas recovery={{ via: "client", leg: "session" }} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-canvas"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="boot-stalled-log"]'),
    ).toBeNull();
  });

  it("keeps each button's DOM identity + focus across a fresh-but-equal recovery object and a phase change (codex F2 — no per-tick focus loss)", () => {
    // `canvasMode` hands this component a FRESH `recovery` object every ~1s monotonic re-resolve.
    // If the card rebuilt its buttons each time, a keyboard user would lose focus every second.
    h.host = { kind: "remote", target: "zest" };
    const [rec, setRec] = createSignal<BootStalledRecovery>({
      via: "connector",
      phase: "provisioning",
      log: undefined,
    });
    dispose = render(
      () => <BootStalledCanvas recovery={rec()} />,
      document.body,
    );
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-testid="boot-stalled-reconnect"]',
    );
    if (!btn) throw new Error("no reconnect button rendered");
    btn.focus();
    expect(document.activeElement).toBe(btn);

    // A fresh-but-EQUAL recovery object (the every-tick case): same DOM node, focus intact.
    setRec({ via: "connector", phase: "provisioning", log: undefined });
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).toBe(btn);
    expect(document.activeElement).toBe(btn);

    // A phase change narrates a new detail but must NOT rebuild the button.
    setRec({ via: "connector", phase: "connecting", log: undefined });
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(document.body.textContent).toContain("connecting");
  });
});

describe("the two absences render differently (lens valve-2 adjudication)", () => {
  it("a connector leg whose live tail was floored says the output is unavailable", () => {
    // `undefined` on the connector arm = the map's liveness floor dropped the live
    // `connection` word. Output exists; we cannot see it. The card must SAY that — a
    // distinction no reader can observe is dead weight, which is the whole argument for
    // keeping `undefined` and `[]` apart in the prop's type.
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{ via: "connector", phase: "provisioning", log: undefined }}
        />
      ),
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-log-unavailable"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="boot-stalled-log"]'),
    ).toBeNull();
  });

  it("a client leg renders neither a tail nor the unavailable note", () => {
    // A client-side stall has no connector campaign, so there is no output and we KNOW
    // it — `[]`, not `undefined`. Claiming a link problem here would be a lie.
    dispose = render(
      () => <BootStalledCanvas recovery={{ via: "client", leg: "session" }} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="boot-stalled-log-unavailable"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="boot-stalled-log"]'),
    ).toBeNull();
  });
});
