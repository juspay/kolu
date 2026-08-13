/**
 * `SurfaceAppProvider` — the model it hands to `useSurfaceApp()`. Covered here
 * (not in `index.test.ts`) because it pulls in `solid-js` reactive primitives;
 * the pure-kernel suite stays Solid-free. Node env is fine: the provider is
 * built with `createComponent` (no JSX) and driven through the `{ status }`
 * connection source, so there's no DOM, transport, or probe to fake.
 *
 * The focus is `updateReady` — the skew-OR-restart predicate the model owns so
 * consumers read it instead of re-deriving `status() === "restarted" || stale()`.
 */
import { Effect } from "effect";

import {
  type Accessor,
  createComponent,
  createRoot,
  createSignal,
} from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { fakeWire } from "../fakeSocket.testlib";
import { thrownText } from "../index";
import { resolveTree } from "./resolveTree.testlib";
import {
  type ConnectionStatus,
  type ControlPlane,
  DISCONNECT_OVERLAY_GRACE_MS,
  type SurfaceAppModel,
  SurfaceAppProvider,
  useSurfaceApp,
} from "./index";

/** A `controlPlane` whose `buildInfo` cell yields a fixed server commit. */
function fakeControlPlane(serverCommit: string): ControlPlane {
  return {
    cells: {
      buildInfo: {
        use: () => ({ value: () => ({ commit: serverCommit }) }),
      },
    },
  };
}

/** Mount the provider with a caller-supplied `status` accessor and capture the
 *  model a child reads back out of context. */
function mountModel(opts: {
  serverCommit: string;
  clientCommit: string;
  status: Accessor<ConnectionStatus>;
  dispose: () => void;
}): SurfaceAppModel {
  let captured!: SurfaceAppModel;
  createComponent(SurfaceAppProvider, {
    controlPlane: fakeControlPlane(opts.serverCommit),
    clientCommit: opts.clientCommit,
    status: opts.status,
    fault: () => null,
    get children() {
      captured = useSurfaceApp();
      return null;
    },
  });
  return captured;
}

/** Let a probe EFFECT settle through the lifecycle's run edge — see the twin in
 *  `lifecycle.test.ts`. A microtask turn no longer covers it: the probe runs on a
 *  fiber, so the settle lands a scheduler tick later than a bare `Promise` did. */
const flushProbe = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("SurfaceAppProvider — updateReady", () => {
  it("flips on a `restarted` status (deploy caught live), even when not stale", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<ConnectionStatus>("live");
      // Same commit on both sides → never stale; only the status drives it.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "0784979",
        status,
        dispose,
      });

      expect(model.stale()).toBe(false);
      expect(model.updateReady()).toBe(false);

      setStatus("restarted");
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });

  it("reads a RETIRED wire as `restarted` through the turnkey `{ wire, probe }` source", async () => {
    const w = fakeWire();
    await createRoot(async (dispose) => {
      let captured!: SurfaceAppModel;
      createComponent(SurfaceAppProvider, {
        controlPlane: fakeControlPlane("0784979"),
        clientCommit: "0784979",
        wire: w.wire,
        probe: () => Effect.succeed({ processId: "p1" }),
        fault: () => null,
        get children() {
          captured = useSurfaceApp();
          return null;
        },
      });

      w.set("open");
      await flushProbe();
      expect(captured.status()).toBe("live");

      // The link classified the server's stale close as TERMINAL and retired the
      // wire; the lifecycle surfaces that as `restarted` — the turnkey path
      // matches the manual one, with no close code and no socket to retire by
      // hand (the link stopped re-dialling and fails every call itself).
      w.set("retired");
      expect(captured.status()).toBe("restarted");
      expect(captured.updateReady()).toBe(true);

      dispose();
    });
  });

  // The `onProcessId` forward is GONE with the option: nothing outside
  // `createSurfaceSocket` feeds the `pid` echo any more, so the provider has no
  // observation to publish and a turnkey caller has nothing to wire.

  it("starts a heartbeat in the turnkey source — a half-open wire forces a reconnect", async () => {
    vi.useFakeTimers();
    try {
      const w = fakeWire();
      await createRoot(async (dispose) => {
        // The open probe resolves (lifecycle goes live); the NEXT probe — the
        // heartbeat's — hangs, modelling a silently half-open wire.
        let calls = 0;
        const probe = (): Effect.Effect<{ processId: string }> => {
          calls += 1;
          return calls === 1
            ? Effect.succeed({ processId: "p1" })
            : (Effect.never as Effect.Effect<{ processId: string }>);
        };
        createComponent(SurfaceAppProvider, {
          controlPlane: fakeControlPlane("0784979"),
          clientCommit: "0784979",
          wire: w.wire,
          probe,
          fault: () => null,
          get children() {
            useSurfaceApp();
            return null;
          },
        });
        w.set("open");
        await vi.advanceTimersByTimeAsync(0); // flush the open probe
        expect(w.reconnects()).toBe(0);
        // One heartbeat interval (default 15s) fires a probe that never answers;
        // after the default 10s timeout the watchdog forces a reconnect — the
        // turnkey consumer (drishti's admin wire) gets this with zero wiring.
        await vi.advanceTimersByTimeAsync(15_000 + 10_000);
        expect(w.reconnects()).toBe(1);
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("flips on staleness (cached old bundle) while the link is otherwise live", () => {
    createRoot((dispose) => {
      // Two clean refs that disagree → stale, even though status stays `live`.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "abc1234",
        status: () => "live",
        dispose,
      });

      expect(model.status()).toBe("live");
      expect(model.stale()).toBe(true);
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });
});

describe("SurfaceAppProvider — presentingDown (the #1598 disconnect-overlay grace, WIRED)", () => {
  it("holds the overlay back for a sub-second blip, raises it for a sustained outage", async () => {
    // The #1598 producer (`gracedDown`) is unit-tested in isolation, but the MODEL
    // wiring it — `presentingDown = gracedDown(() => status() === "down", GRACE)`,
    // read by kolu's `TransportOverlay` — was pinned by NO test, so reverting the
    // model derivation to raw `status` (or the overlay to read `status()` instead of
    // `presentingDown()`) would silently re-introduce the sub-second "Disconnected"
    // flash on every forced reconnect (half-open watchdog recovering, Wi-Fi roam).
    // This drives the model boundary so that revert turns RED — the producer-consumed
    // invariant: a test must fail when the WIRING is removed, not only the producer.
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        const [status, setStatus] = createSignal<ConnectionStatus>("live");
        const model = mountModel({
          serverCommit: "c",
          clientCommit: "c",
          status,
          dispose,
        });
        // Flush the provider's initial effect run (deferred to the end of
        // createRoot's batch); thereafter a top-level `setStatus` re-runs the
        // gracedDown effect synchronously, so the timer arms before the fake clock
        // advances (mirrors `gracedDown.test.ts`).
        await Promise.resolve();
        expect(model.presentingDown()).toBe(false);

        // Down, then recover WITHIN the grace window: the overlay must never flash.
        // Flush the gracedDown effect (arm/clear its timer) before advancing the
        // fake clock — each `setStatus` schedules the effect on the microtask queue.
        setStatus("down");
        await Promise.resolve();
        vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 100);
        expect(model.presentingDown()).toBe(false); // still inside the grace
        setStatus("live");
        await Promise.resolve();
        vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS);
        expect(model.presentingDown()).toBe(false); // recovered → never flashed

        // A sustained outage past the grace window DOES surface the overlay.
        setStatus("down");
        await Promise.resolve();
        vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS + 50);
        expect(model.presentingDown()).toBe(true);

        // status() itself stays INSTANT (gates the header dot / heartbeat), distinct
        // from the graced overlay signal.
        expect(model.status()).toBe("down");

        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SurfaceAppProvider — the required `fault` LOOK is WIRED", () => {
  it("draws a throwing shell with the app's LOOK, handed the printed fault", () => {
    // The prop being required is the type-level half; this is the runtime half:
    // the provider must actually compose `SurfaceFaultBoundary` over its
    // children, or the required LOOK is a prop that routes nowhere and a shell
    // throw is still a white tab. (The boundary's error signal is written in
    // the root's own batch, so the LOOK renders when it flushes — assert after
    // `createRoot` returns; see `fault.test.ts`.)
    vi.spyOn(console, "error").mockImplementation(() => {});
    let seen: string | undefined;
    const err = new Error("undefined is not an object");
    err.stack = "renderShell@app.js:8:2";
    const dispose = createRoot((d) => {
      const el = createComponent(SurfaceAppProvider, {
        controlPlane: fakeControlPlane("0784979"),
        clientCommit: "0784979",
        status: () => "live" as const,
        fault: (text: string) => {
          seen = text;
          return null;
        },
        get children() {
          throw err;
          // biome-ignore lint/correctness/noUnreachable: the getter's type still wants a value
          return null;
        },
      });
      resolveTree(el);
      return d;
    });
    // The PRINTED text — proving the boundary between provider and children is
    // the real one, printer included. Asserted THROUGH `thrownText` (whose own
    // litany is pinned in `index.test.ts`) rather than as a third literal; the
    // Safari-shaped stack keeps printed ≠ `String(err)`, so a boundary that
    // skipped the printer still fails here.
    expect(seen).toBe(thrownText(err));
    expect(seen).not.toBe(String(err));
    dispose();
    vi.restoreAllMocks();
  });
});
