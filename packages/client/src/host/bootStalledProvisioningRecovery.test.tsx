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
 * Flipped GREEN in PR2 (#1908 D2): the connector-owned card now carries non-terminal
 * "still retrying" copy and routes its recovery verb through `client.hosts.reconnect`.
 * The escape mode is `{ via: "connector", phase }` — a warming REMOTE campaign the
 * resolver hands this component; the old `location.reload()` provisioning card is gone.
 *
 * Mirrors `BootStalledCanvas.test.tsx` (render through `solid-js/web`, mock
 * `../wire` so the socket stack never boots).
 */
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "remote", target: "zest" } as HostKey,
  reconnect: vi.fn(() => Promise.resolve()),
  resetBootDeadline: vi.fn(),
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: h.reconnect } },
}));
// The recovery verb resets THIS host's boot deadline (the deliberate user-retry reset, #1908 R8a).
vi.mock("../kaval/bootDeadline", () => ({
  resetBootDeadline: h.resetBootDeadline,
}));

// Imported AFTER the mock so it binds the mocked `../wire`.
const { default: BootStalledCanvas } = await import("./BootStalledCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.reconnect.mockClear();
  h.resetBootDeadline.mockClear();
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

describe("D2 — boot-stalled connector card is honest + recovers via the connector (#1908)", () => {
  it("connector-card copy is non-terminal while the connector still retries", () => {
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{ via: "connector", phase: "provisioning", log: undefined }}
        />
      ),
      document.body,
    );
    // Honest that the server connector is still working, not a terminal wedge:
    // names the ongoing retry (attempt / still-retrying), from the stream it
    // already reads. NOT the old "reload to keep watching / isn't responding".
    expect(document.body.textContent ?? "").toMatch(
      /retry|retrying|still trying|attempt/i,
    );
    expect(document.body.textContent ?? "").not.toMatch(
      /isn't responding|failed/i,
    );
  });

  it("the recovery verb reaches the server connector (hosts.reconnect), not location.reload(), and resets the deadline only ON SUCCESS", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{ via: "connector", phase: "provisioning", log: undefined }}
        />
      ),
      document.body,
    );
    primaryRecoveryButton().click();
    // The verb must recycle the SERVER connector for this host, not merely
    // reload the browser page.
    expect(h.reconnect).toHaveBeenCalledWith({ host: h.host });
    expect(reload).not.toHaveBeenCalled();
    // …and once the reconnect RESOLVES it resets THIS host's boot deadline, so the card dismisses
    // (a fresh window) rather than staying up on a same-class retry (#1908 R8a, codex F1). Gated on
    // success — a rejected reconnect must NOT reset (codex F9), which the `.then()` chaining ensures.
    await vi.waitFor(() =>
      expect(h.resetBootDeadline).toHaveBeenCalledWith(encodeHostKey(h.host)),
    );
    reload.mockRestore();
  });

  it("a REJECTED reconnect does NOT reset the boot deadline (the card must stay — codex F9)", async () => {
    h.reconnect.mockImplementationOnce(() => Promise.reject(new Error("nope")));
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{ via: "connector", phase: "provisioning", log: undefined }}
        />
      ),
      document.body,
    );
    primaryRecoveryButton().click();
    expect(h.reconnect).toHaveBeenCalledWith({ host: h.host });
    // Let the rejected promise settle; the reset must NOT have fired.
    await vi.waitFor(() => expect(h.reconnect).toHaveBeenCalled());
    await Promise.resolve();
    expect(h.resetBootDeadline).not.toHaveBeenCalled();
  });
});
