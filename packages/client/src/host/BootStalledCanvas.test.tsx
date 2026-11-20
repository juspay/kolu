// @vitest-environment happy-dom
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
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).toBeNull();
  });

  it("a remote connector stall shows the non-terminal copy, names the phase, offers Reconnect + Switch-to-local", () => {
    h.host = { kind: "remote", target: "zest" };
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
    expect(
      document.querySelector('[data-testid="boot-stalled-canvas"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-recovery="connector"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(CONNECTOR_STALLED_COPY.title);
    expect(document.body.textContent).toContain("provisioning");
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).not.toBeNull();
  });

  it("the CONNECTOR arm says how long the campaign has been silent, and what it last said", () => {
    h.host = { kind: "remote", target: "croissant" };
    const line = "croissant: copying path '/nix/store/abc-kolu-2.2.0'…";
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [{ line }],
            logAbsence: undefined,
            quiet: { lastLine: line, silentMs: 14 * 60_000 + 1_000 },
          }}
        />
      ),
      document.body,
    );
    expect(document.body.textContent).toContain(
      `Still provisioning the agent on the host… No new output in the last 14 min. Last line: ${line}`,
    );
  });

  it("the CONNECTOR arm shows the campaign's tail; the CLIENT arm cannot carry one", () => {
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
            logAbsence: undefined,
            quiet: undefined,
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
    h.host = { kind: "remote", target: "zest" };
    const [rec, setRec] = createSignal<BootStalledRecovery>({
      via: "connector",
      phase: "provisioning",
      log: [],
      logAbsence: undefined,
      quiet: undefined,
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

    setRec({
      via: "connector",
      phase: "provisioning",
      log: [],
      logAbsence: undefined,
      quiet: undefined,
    });
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).toBe(btn);
    expect(document.activeElement).toBe(btn);

    setRec({
      via: "connector",
      phase: "connecting",
      log: [],
      logAbsence: undefined,
      quiet: undefined,
    });
    expect(
      document.querySelector('[data-testid="boot-stalled-reconnect"]'),
    ).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(document.body.textContent).toContain("connecting");
  });
});

describe("the card renders the absence it was TOLD, never one it inferred", () => {
  it("a connector leg whose live tail was floored says the output is unavailable", () => {
    dispose = render(
      () => (
        <BootStalledCanvas
          recovery={{
            via: "connector",
            phase: "provisioning",
            log: [],
            logAbsence: "link-down",
            quiet: undefined,
          }}
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

  it("a connector leg with an EMPTY-but-honest tail claims NO link problem", () => {
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
    expect(
      document.querySelector('[data-testid="boot-stalled-log-unavailable"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="boot-stalled-log"]'),
    ).toBeNull();
  });

  it("a client leg renders neither a tail nor the unavailable note", () => {
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
