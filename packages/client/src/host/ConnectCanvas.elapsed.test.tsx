// @vitest-environment happy-dom
/**
 * #1962 — the connect overlay's elapsed timer ticks on wall clock, independent
 * of log-line / connection-frame arrival. A multi-minute silent NAR copy must
 * still show "2m 6s" → "2m 7s" → … so the UI doesn't look hung.
 *
 * Renders a minimal ConnectCanvas with a mocked connection frame and advances
 * the component-local setInterval via fake timers.
 */

import type { HostKey } from "kolu-common/hostKey";
import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "remote", host: "zest" } as HostKey,
  /** Mutable box the mock reads — not a Solid signal (createSignal can't run
   *  inside `vi.hoisted` before solid-js is initialized). */
  info: undefined as ConnectionInfo | undefined,
}));

vi.mock("../wire", () => ({
  activeHost: () => h.host,
  connectionInfo: () => h.info,
}));

// Imported AFTER the mock so it binds the mocked wire.
const { ConnectCanvas } = await import("./ConnectCanvas");

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  h.info = undefined;
  document.body.innerHTML = "";
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("ConnectCanvas elapsed timer (#1962)", () => {
  it("ticks every second without a new log line or frame", async () => {
    // A building frame that already crossed the ≥1s elapsed guard, with a
    // single frozen log line — the silent-NAR situation from the issue.
    h.info = {
      phase: "building",
      log: [
        {
          source: "local",
          line: "copying path '/nix/store/filjyw…-kolu-1.1.0' from 'https://cache…'",
        },
      ],
      sinceMs: 5_000,
    };

    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );

    const elapsed = () =>
      document.querySelector('[data-testid="connect-elapsed"]')?.textContent ??
      null;

    // First paint: anchored at 5s → "5s".
    expect(elapsed()).toBe("5s");

    // Advance wall clock 3s WITHOUT publishing a new connection frame.
    // Pre-fix the label froze until the next log line; now it climbs.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(elapsed()).toBe("8s");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(elapsed()).toBe("10s");
  });

  it("suppresses the sub-1s flash on a fresh frame", async () => {
    h.info = {
      phase: "connecting",
      log: [],
      sinceMs: 200,
    };
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="connect-elapsed"]'),
    ).toBeNull();
  });
});
