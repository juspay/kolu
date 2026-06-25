// @vitest-environment happy-dom
/**
 * The empty-vs-error RENDER GATE — the regression guard the whole PR exists for.
 *
 * #1564 was a RENDER lie: a dead backend↔remote mirror left awareness empty and
 * `HostGroup` painted "no terminals" beside a healthy-looking host. The fix gates
 * the terminal body on `effectiveHealth(status, connection).state === "connected"`
 * and renders an honest `ConnectionView` otherwise. `reserve.test.ts` pins the
 * cell VALUE reaching the browser; THIS pins what `HostGroup` actually RENDERS off
 * it — reverting the `<Show>` gate turns these red where the value test stays green.
 *
 * The harness mounts the REAL `HostGroup` (its real `effectiveHealth` fold, real
 * `<Show>` gates, real `ConnectionView`/`FailedCard`) under happy-dom, driving its
 * two inputs through a stand-in surface: the `connection` cell and the awareness
 * key set. The transport `status` is held LIVE so `effectiveHealth` keys off the
 * mirror cell — the leg under test — not a transport shadow.
 */

import {
  type ConnectionInfo,
  DEFAULT_CONNECTION,
} from "@kolu/surface-nix-host/connection";
import type { TerminalId } from "@kolu/terminal-workspace/surface";
import { createSignal, type Setter } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the wire so `HostGroup` reads OUR controllable surface instead of opening a
// ws. `surfaceForHost` returns a stand-in whose `connection` cell + awareness keys
// are signals the test drives; `statusForHost` reports a LIVE transport, so
// `effectiveHealth` resolves to the mirror cell (`source: "mirror"`), exercising
// the exact gate #1564 missed. The hoisted holder is populated per render.
const h = vi.hoisted(() => ({
  app: null as unknown,
  status: () => "live" as const,
}));
vi.mock("./wire.ts", () => ({
  surfaceForHost: () => h.app,
  statusForHost: () => h.status,
}));

import { DEFAULT_FLEET_FILTERS } from "./fleet.ts";
import { HostGroup } from "./HostGroup.tsx";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* best-effort teardown */
    }
  }
  h.app = null;
});

type ErrOpts = { onError?: (e: Error) => void } | undefined;

/** Mount the real `HostGroup` against a stand-in surface; returns the container,
 *  the setters that drive the gate's inputs (the `connection` cell value — what
 *  the session pump writes in production — and the awareness key set), and a
 *  `blip` / `heal` pair that drives a subscription FAILURE the way production
 *  does: `blip` sets the subscription's reactive `error()` AND fires every
 *  `onError` the component wired (both channels fire on a real failure), while
 *  `heal` clears ONLY `error()` (recovery re-delivers a frame; there is no
 *  `onError` on the way back up). That asymmetry is the whole point — a consumer
 *  that latches `onError` never heals; one that reads the self-clearing `error()`
 *  does. So this stays RED on the old latching code and GREEN on the fix. */
function mountHostGroup(): {
  container: HTMLElement;
  setConn: Setter<ConnectionInfo>;
  setKeys: Setter<TerminalId[]>;
  blip: (message: string) => void;
  heal: () => void;
} {
  const [conn, setConn] = createSignal<ConnectionInfo>(DEFAULT_CONNECTION);
  const [keys, setKeys] = createSignal<TerminalId[]>([]);
  // A subscription's OWN reactive, self-clearing error — what `createSubscription`
  // exposes in production. Driven through the connection cell here.
  const [err, setErr] = createSignal<Error | undefined>();
  // Every `onError` the component wires (the LEGACY one-shot channel the old
  // code latched). Captured so `blip` can fire them alongside `error()`.
  const onErrorBus: Array<(e: Error) => void> = [];
  const capture = (opts: ErrOpts): void => {
    if (opts?.onError) onErrorBus.push(opts.onError);
  };
  h.app = {
    collections: {
      awareness: {
        use: (opts: ErrOpts) => {
          capture(opts);
          return { keys: () => keys(), byKey: () => undefined };
        },
      },
    },
    cells: {
      connection: {
        use: (opts: ErrOpts) => {
          capture(opts);
          return { value: () => conn(), error: () => err() };
        },
      },
    },
    streams: {
      activity: {
        use: (_input: unknown, opts: ErrOpts) => {
          capture(opts);
          return Object.assign(() => [] as TerminalId[], {
            error: () => undefined,
          });
        },
      },
    },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <HostGroup
        host="prod"
        filters={DEFAULT_FLEET_FILTERS}
        now={() => 0}
        reportCounts={() => {}}
      />
    ),
    container,
  );
  disposers.push(dispose, () => container.remove());
  const blip = (message: string): void => {
    const e = new Error(message);
    setErr(() => e); // the reactive, self-clearing channel
    for (const fn of onErrorBus) fn(e); // the legacy one-shot channel
  };
  const heal = (): void => setErr(undefined); // recovery clears only error()
  return { container, setConn, setKeys, blip, heal };
}

const text = (c: HTMLElement): string => c.textContent ?? "";
const waitForText = (c: HTMLElement, needle: string): Promise<void> =>
  vi.waitFor(() => expect(text(c)).toContain(needle));

describe("HostGroup — the empty-vs-error render gate (#1564 regression guard)", () => {
  it("a FAILED mirror with empty awareness renders the error card, NOT 'no terminals'", async () => {
    const { container, setConn } = mountHostGroup();
    setConn({
      state: "failed",
      lastError: "exited with code 1",
      failureCause: "remote",
      progressLines: ["[remote] kaval speaks pty-host 3.2, pulam needs 3.3"],
    });
    // The honest failure card — heading, the REAL error, the log tail, Reconnect.
    await waitForText(container, "Remote connection failed");
    expect(text(container)).toContain("exited with code 1");
    expect(text(container)).toContain("pty-host 3.2");
    expect(text(container)).toContain("Reconnect");
    // The old lie must NEVER appear for a down mirror.
    expect(text(container)).not.toContain("no terminals");
  });

  it("a CONNECTED mirror with empty awareness renders 'no terminals' (the truthful empty)", async () => {
    const { container, setConn } = mountHostGroup();
    setConn({
      state: "connected",
      lastError: null,
      failureCause: null,
      progressLines: [],
    });
    // Only an effectively-connected host reaches the body, where empty is honest.
    await waitForText(container, "no terminals");
    expect(text(container)).not.toContain("Remote connection failed");
  });

  it("a DISCONNECTED mirror with a `network` cause renders the per-cause `messageFor` line", async () => {
    const { container, setConn } = mountHostGroup();
    setConn({
      state: "disconnected",
      lastError: null,
      failureCause: "network",
      progressLines: [],
    });
    // The (state × cause) branch in `connectionStates.ts`: a network fault means
    // the host is unreachable, so `messageFor("network")` overrides the base
    // "Reconnecting…" — the only place that per-cause line is exercised.
    await waitForText(container, "Host unreachable — retrying…");
    expect(text(container)).not.toContain("no terminals");
  });

  it("a CONNECTING mirror (the gate-closed default) renders 'Connecting…', never empty", async () => {
    const { container } = mountHostGroup();
    // No `setConn` — the seeded `DEFAULT_CONNECTION` (`connecting`) is what a host
    // reads before its first session frame. It must show the in-flight line, not a
    // healthy-empty fleet.
    await waitForText(container, "Connecting…");
    expect(text(container)).not.toContain("no terminals");
  });

  it("a TRANSIENT subscription error CLEARS when the stream recovers — no stale-error latch", async () => {
    // The sleep/wake sighting on zest: a launchd crash-restart of pulam-web made a
    // live subscription 500, oRPC-masked as "Internal server error". The OLD code
    // latched that into a local signal (`prev ?? err.message`) sitting ABOVE the
    // connection-health gate, so the host froze on the stale error even after the
    // mirror reconnected — a reload was the only cure. The fix reads each
    // subscription's self-clearing `error()`, so the host heals on its own.
    const { container, setConn, blip, heal } = mountHostGroup();
    setConn({
      state: "connected",
      lastError: null,
      failureCause: null,
      progressLines: [],
    });
    // A blip during the backend restart — the masked 500 reaches the browser.
    blip("Internal server error");
    await waitForText(container, "Internal server error");
    // The backend recovers; the subscription re-delivers and clears its own error.
    heal();
    // The host heals on its own: the connected-empty body returns, no reload — and
    // the stale error is GONE (the old latch would still be showing it here).
    await waitForText(container, "no terminals");
    expect(text(container)).not.toContain("Internal server error");
  });
});
