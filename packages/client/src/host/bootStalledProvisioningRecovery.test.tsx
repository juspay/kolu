// @vitest-environment happy-dom
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "remote", target: "zest" } as HostKey,
  reconnect: vi.fn((): Effect.Effect<void, Error> => Effect.void),
  resetBootDeadline: vi.fn(),
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: h.reconnect } },
}));
vi.mock("../kaval/bootDeadline", () => ({
  resetBootDeadline: h.resetBootDeadline,
}));

const { default: BootStalledCanvas } = await import("./BootStalledCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.reconnect.mockClear();
  h.resetBootDeadline.mockClear();
});

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
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [],
            logAbsence: undefined,
            quiet: undefined,
          }}
        />
      ),
      document.body,
    );
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
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [],
            logAbsence: undefined,
            quiet: undefined,
          }}
        />
      ),
      document.body,
    );
    primaryRecoveryButton().click();
    expect(h.reconnect).toHaveBeenCalledWith({ host: h.host });
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(h.resetBootDeadline).toHaveBeenCalledWith(encodeHostKey(h.host)),
    );
    reload.mockRestore();
  });

  it("a REJECTED reconnect does NOT reset the boot deadline (the card must stay — codex F9)", async () => {
    h.reconnect.mockImplementationOnce(() => Effect.fail(new Error("nope")));
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [],
            logAbsence: undefined,
            quiet: undefined,
          }}
        />
      ),
      document.body,
    );
    primaryRecoveryButton().click();
    expect(h.reconnect).toHaveBeenCalledWith({ host: h.host });
    await vi.waitFor(() => expect(h.reconnect).toHaveBeenCalled());
    await Promise.resolve();
    expect(h.resetBootDeadline).not.toHaveBeenCalled();
  });
});
