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

/** Mount the real `HostGroup` against a stand-in surface; returns the container,
 *  the setters that drive the gate's inputs (the `connection` cell value — what
 *  the session pump writes in production — and the awareness key set), and the
 *  `blip`/`heal` (+ `blipKeys`/`healKeys`) pairs that drive a subscription FAILURE
 *  the way production does: each sets a subscription's reactive, self-clearing
 *  `error()`, and `heal` clears it (recovery re-delivers a frame). HostGroup reads
 *  those errors through the framework's `client.health()` FACT — the same fold the
 *  real `surfaceClient` registry performs — so a transient blip clears the instant
 *  the stream re-delivers. This stays RED on the old hand-latched fold and GREEN
 *  on the self-clearing read. */
function mountHostGroup(): {
  container: HTMLElement;
  setConn: Setter<ConnectionInfo>;
  setKeys: Setter<TerminalId[]>;
  setLive: Setter<boolean>;
  blip: (message: string) => void;
  heal: () => void;
  blipKeys: (message: string) => void;
  healKeys: () => void;
} {
  const [conn, setConn] = createSignal<ConnectionInfo>(DEFAULT_CONNECTION);
  const [keys, setKeys] = createSignal<TerminalId[]>([]);
  // The framework fact's transport-liveness leg — what `connectSurface` threads
  // from the socket in production (`health().live === (status() === "live")`).
  // Held `true` for the existing gate tests; the dedicated test below drives it
  // to prove the body gate reads THIS, not the transport `status` alone.
  const [live, setLive] = createSignal(true);
  // The connection cell's OWN reactive, self-clearing error — what
  // `createSubscription` exposes in production; `blip`/`heal` drive it.
  const [err, setErr] = createSignal<Error | undefined>();
  // The awareness KEYS stream's own self-clearing error — the channel that, when
  // set, turns a default-keys collection into a silent empty set. `blipKeys`/
  // `healKeys` drive it, distinct from the connection cell's.
  const [keysErr, setKeysErr] = createSignal<Error | undefined>();
  h.app = {
    collections: {
      awareness: {
        use: () => ({
          keys: () => keys(),
          byKey: () => undefined,
        }),
      },
    },
    cells: {
      connection: {
        use: () => ({ value: () => conn(), error: () => err() }),
      },
    },
    streams: {
      activity: {
        use: (_input: unknown) =>
          Object.assign(() => [] as TerminalId[], { error: () => undefined }),
      },
    },
    // The framework's `client.health()` FACT — folds every subscription's own
    // self-clearing error() exactly as the real `surfaceClient` registry does:
    // the connection cell (`connection`), the awareness keys-stream
    // (`awareness.keys`), and the activity stream (`activity`). HostGroup reads
    // THIS now instead of a hand-rolled per-channel fold, so driving `err()` /
    // `keysErr()` here is what reaches its error gate.
    //
    // `live` folds BOTH legs the way the real registry now does (round-5 "complete
    // the fact"): the transport leg (`live()`) AND the `connection` cell's
    // `liveWhen` predicate (`state === "connected"`). In production `surfaceClient`
    // folds the cell's `liveWhen` into `health().live` BY CONSTRUCTION, so a
    // non-`connected` mirror flips `live` false WITHOUT any consumer hand-ANDing
    // it — HostGroup's gate reads ONLY `health().live`. The mock folds the same
    // mirror leg, or the gate would open over a failed/connecting mirror.
    health: () => ({
      live: live() && conn().state === "connected",
      subs: [
        { name: "connection", pending: false, error: err() },
        { name: "awareness.keys", pending: false, error: keysErr() },
        { name: "activity", pending: false, error: undefined },
      ],
    }),
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
  // Each `blip` sets a subscription's self-clearing `error()`; `heal` clears it
  // (recovery re-delivers a frame). HostGroup folds both through `health()`.
  const blip = (message: string): void => {
    setErr(() => new Error(message));
  };
  const heal = (): void => setErr(undefined);
  const blipKeys = (message: string): void => {
    setKeysErr(() => new Error(message));
  };
  const healKeys = (): void => setKeysErr(undefined);
  return {
    container,
    setConn,
    setKeys,
    setLive,
    blip,
    heal,
    blipKeys,
    healKeys,
  };
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

  it("the body gate DRINKS from health().live: a dead transport closes it even with a `connected` mirror", async () => {
    // 🔴1: `connectSurface` threads the socket's liveness into `health().live`,
    // and pulam-web's gate now reads THAT (its `connected()` is `app.health().live
    // && connInfo.state === "connected"`), not a second read of the transport
    // `status`. The harness drives `health().live` and `status` separately, so
    // this proves WHICH the gate reads: hold the transport `status` LIVE and the
    // mirror cell `connected` (the OLD gate, off `effectiveHealth(status,…)`,
    // would paint the body), then flip the FACT's `live` false. The body must
    // fail closed — if the threaded leg weren't load-bearing here, nothing would
    // consume it and #1564's lie would survive one level up.
    const { container, setConn, setLive } = mountHostGroup();
    setConn({
      state: "connected",
      lastError: null,
      failureCause: null,
      progressLines: [],
    });
    await waitForText(container, "no terminals");
    // The framework fact says the transport is down (a half-open/reconnecting ws),
    // while the mirror cell is still frozen at its last `connected`.
    setLive(false);
    await vi.waitFor(() =>
      expect(text(container)).not.toContain("no terminals"),
    );
    // Recovers when the fact reports the transport live again.
    setLive(true);
    await waitForText(container, "no terminals");
  });

  it("a failing awareness KEYS stream surfaces an error, not a silent empty fleet — and clears on recovery", async () => {
    // The keys-stream leg F1 caught: a failing `awareness.keys` subscription
    // collapses `keys()` to its empty fallback (`sub() ?? []`), so a connected
    // host with a dead keys stream would otherwise read as "no terminals" with
    // NO visible error — the same empty/stale lie this PR kills, one stream over.
    const { container, setConn, blipKeys, healKeys } = mountHostGroup();
    setConn({
      state: "connected",
      lastError: null,
      failureCause: null,
      progressLines: [],
    });
    // Healthy: the connected-empty body shows.
    await waitForText(container, "no terminals");
    // The keys stream 500s. The error must win over the empty body, not vanish.
    blipKeys("Internal server error");
    await waitForText(container, "Internal server error");
    expect(text(container)).not.toContain("no terminals");
    // The keys stream re-delivers; its self-clearing error clears and the host
    // heals on its own — no stale-error latch.
    healKeys();
    await waitForText(container, "no terminals");
    expect(text(container)).not.toContain("Internal server error");
  });
});
