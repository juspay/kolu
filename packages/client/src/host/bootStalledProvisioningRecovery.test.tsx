// @vitest-environment happy-dom
/**
 * D2 RED pins (#1908) — the boot-stalled provisioning card must be HONEST while
 * the server connector is still retrying, and its recovery verb must reach that
 * connector.
 *
 * The field bewilderment: the #1898 boot-stalled card appeared over a connector
 * that was STILL retrying (the wedge cleared on its own at 19:14:41, card still on
 * screen). Two defects on the `provisioning` leg's card:
 *   1. Copy framing. The card offers only "reload to keep watching" — no honest
 *      "still retrying" attempt/phase truth drawn from the connection stream it
 *      already reads (the session's `log`/`phase`), so a live, self-healing
 *      process reads as a terminal wedge.
 *   2. Recovery verb. `[Reload]` is `location.reload()`, which recycles only the
 *      BROWSER — it cannot recycle the server-side connector that owns the dial.
 *      The host-failed card's `client.hosts.reconnect({ host })` is the existing
 *      pattern (`HostDownCanvas.tsx`), and IS the path that force-cycles the
 *      server session.
 *
 * `it.fails` per the repo's RED convention: today the provisioning copy carries no
 * retry truth and the verb is `location.reload()`, so each body throws and
 * `it.fails` is GREEN on the RED commit. Phase C makes the copy non-terminal and
 * routes the verb through `client.hosts.reconnect`, then flips `it.fails` → `it`.
 *
 * Mirrors `BootStalledCanvas.test.tsx` (render through `solid-js/web`, mock
 * `../wire` so the socket stack never boots).
 */
import type { HostKey } from "kolu-common/hostKey";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "remote", target: "zest" } as HostKey,
  reconnect: vi.fn(() => Promise.resolve()),
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: h.reconnect } },
}));

// Imported AFTER the mock so it binds the mocked `../wire`.
const { default: BootStalledCanvas } = await import("./BootStalledCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.reconnect.mockClear();
});

/** The card's primary recovery button (tone: "primary") — the one action that is
 *  NOT the neutral switch-to-local escape hatch. Selected by exclusion so the pin
 *  survives the recovery verb's testid changing across the flip. */
function primaryRecoveryButton(): HTMLButtonElement {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="boot-stalled-canvas"] button',
    ),
  );
  const primary = buttons.find(
    (b) => b.getAttribute("data-testid") !== "switch-to-local",
  );
  if (!primary) throw new Error("no primary recovery button rendered");
  return primary;
}

describe("D2 — boot-stalled provisioning card is honest + recovers via the connector (#1908)", () => {
  it.fails("provisioning-leg copy is non-terminal while the connector still retries", () => {
    dispose = render(
      () => <BootStalledCanvas leg="provisioning" phase="building" />,
      document.body,
    );
    // Honest that the server connector is still working, not a terminal wedge:
    // names the ongoing retry (attempt / still-retrying), from the stream it
    // already reads. Today the copy offers only "reload to keep watching".
    expect(document.body.textContent ?? "").toMatch(
      /retry|retrying|still trying|attempt/i,
    );
  });

  it.fails("the recovery verb reaches the server connector (hosts.reconnect), not location.reload()", () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    dispose = render(
      () => <BootStalledCanvas leg="provisioning" phase="building" />,
      document.body,
    );
    primaryRecoveryButton().click();
    // The verb must recycle the SERVER connector for this host, not merely
    // reload the browser page.
    expect(h.reconnect).toHaveBeenCalledWith({ host: h.host });
    expect(reload).not.toHaveBeenCalled();
    reload.mockRestore();
  });
});
