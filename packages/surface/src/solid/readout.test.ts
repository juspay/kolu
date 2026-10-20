/**
 * The readout — the fold that decides what a connection indicator may say.
 *
 * Pins the three rules the framework, not any app, owns:
 *   - a LIVE socket over an ERRORING subscription reads `degraded`, and NAMES the
 *     subscription (the lie this whole module exists to make unrenderable: a
 *     stopped collection drawing as an empty one under a green light);
 *   - PENDING does not degrade — a first frame that has not landed is what every
 *     page load looks like, and an indicator that ambered on those is one nobody
 *     reads;
 *   - the transport's own states still win, `retired` included, and `needsReload`
 *     is set for `retired` and for nothing else.
 * Plus the memo's two ergonomic properties: reads are free (the fold runs per
 * CHANGE, not per read) and a healthy fold notifies nobody.
 *
 * And the GRACED down-state — the fact a full-screen overlay gates on: a
 * sub-second drop never presents, a sustained one does, and recovery hides
 * instantly.
 */

import { createComputed, createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubHealth, SurfaceHealth } from "./health";
import type { SurfaceConnectionStatus } from "./liveSignal";
import {
  createSurfaceReadout,
  DISCONNECT_OVERLAY_GRACE_MS,
  type SurfaceReadoutStatus,
  surfaceReadout,
} from "./readout";

const sub = (name: string, over: Partial<SubHealth> = {}): SubHealth => ({
  name,
  pending: false,
  error: undefined,
  ...over,
});

const fact = (live: boolean, subs: SubHealth[] = []): SurfaceHealth => ({
  live,
  subs,
});

describe("surfaceReadout", () => {
  it("degrades a LIVE socket over an erroring sub, and names what stopped", () => {
    const readout = surfaceReadout(
      "live",
      fact(true, [
        sub("preferences"),
        sub("documents.keys", { error: new Error("Internal server error") }),
        sub("activity", { error: new Error("gone") }),
      ]),
      false,
    );
    expect(readout.status).toBe("degraded");
    // The names, in enrolment order — "something is not arriving" is the least
    // useful true thing available, so the evidence is the subscriptions' own
    // names, and the type says there is at least one of them.
    expect(readout.stopped).toEqual(["documents.keys", "activity"]);
    // A degraded surface heals on its own (the fence re-subscribes) — a reload is
    // the heaviest recovery for the lightest failure.
    expect(readout.needsReload).toBe(false);
    // ...and there is no transport down-state to present: the socket is live.
    expect(readout.presentingDown).toBe(false);
  });

  it("does NOT degrade on pending — a first frame is what every page load looks like", () => {
    const readout = surfaceReadout(
      "live",
      fact(true, [
        sub("documents[abc]", { pending: true }),
        sub("preferences"),
      ]),
      false,
    );
    expect(readout.status).toBe("live");
    expect(readout.stopped).toBeUndefined();
  });

  it("reports an error even while a SIBLING sub is pending (pending never masks it)", () => {
    const readout = surfaceReadout(
      "live",
      fact(true, [
        sub("terminals[1]", { pending: true }),
        sub("terminals.keys", { error: new Error("boom") }),
      ]),
      false,
    );
    expect(readout.status).toBe("degraded");
    expect(readout.stopped).toEqual(["terminals.keys"]);
  });

  it("keeps the transport's own state when the wire is the news, and names nothing", () => {
    // A sub erroring while the socket is down is a CONSEQUENCE of the socket
    // being down, not separate news — so `reconnecting` stays `reconnecting`,
    // rather than blaming whichever subscription noticed first.
    for (const status of [
      "connecting",
      "reconnecting",
      "retired",
    ] as const satisfies readonly SurfaceConnectionStatus[]) {
      const readout = surfaceReadout(
        status,
        fact(false, [sub("preferences", { error: new Error("dropped") })]),
        true,
      );
      expect(readout.status).toBe(status);
      expect(readout.stopped).toBeUndefined();
      expect(readout.presentingDown).toBe(true);
    }
  });

  it("sets needsReload for `retired` and for nothing else", () => {
    const needsReload: Record<SurfaceReadoutStatus, boolean> = {
      connecting: surfaceReadout("connecting", fact(false), false).needsReload,
      live: surfaceReadout("live", fact(true), false).needsReload,
      degraded: surfaceReadout(
        "live",
        fact(true, [sub("keys", { error: new Error("x") })]),
        false,
      ).needsReload,
      reconnecting: surfaceReadout("reconnecting", fact(false), false)
        .needsReload,
      retired: surfaceReadout("retired", fact(false), true).needsReload,
    };
    // A `Record` over the five, so a sixth state cannot join without stating its
    // recovery here — the rule lives in one place beside the reload it gates.
    expect(needsReload).toEqual({
      connecting: false,
      live: false,
      degraded: false,
      reconnecting: false,
      retired: true,
    });
  });

  it("refuses green when the FACT says not-live under a live socket (a mirror's upstream is down)", () => {
    // `health.live` carries the readiness legs (a `liveWhen` cell on a MIRRORED
    // surface), and a readiness cell holding a "disconnected" value is neither
    // pending nor erroring — so no sub name covers it. Nothing is arriving and
    // the mirror re-establishes on its own: that is `reconnecting`, one hop up.
    const readout = surfaceReadout(
      "live",
      fact(false, [sub("connection")]),
      true,
    );
    expect(readout.status).toBe("reconnecting");
    expect(readout.presentingDown).toBe(true);
  });
});

describe("createSurfaceReadout", () => {
  it("folds once per CHANGE, not once per read", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
      const [error, setError] = createSignal<Error | undefined>(undefined);
      // Stand in for the registry's plain accessor, which re-folds the WHOLE
      // enrolment on every read — the walk this memo exists to stop repeating.
      const health = vi.fn(
        (): SurfaceHealth => fact(true, [sub("keys", { error: error() })]),
      );
      const { readout, dispose: dropReadout } = createSurfaceReadout(
        status,
        health,
      );

      const folds = () => health.mock.calls.length;
      const before = folds();
      // Six reads, as six JSX expressions would be: no new walk.
      for (let i = 0; i < 6; i++) expect(readout().status).toBe("live");
      expect(folds()).toBe(before);

      setError(new Error("boom"));
      expect(readout().stopped).toEqual(["keys"]);
      expect(folds()).toBe(before + 1);

      setStatus("retired");
      expect(readout().needsReload).toBe(true);
      expect(folds()).toBe(before + 2);

      dropReadout();
      dispose();
    });
  });

  it("notifies nobody while the readout still says the same thing", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
      const [subs, setSubs] = createSignal<SubHealth[]>([sub("preferences")]);
      const { readout, dispose: dropReadout } = createSurfaceReadout(
        status,
        () => fact(true, subs()),
      );
      // `createComputed`, not `createEffect`: it tracks in the same synchronous
      // pass as the signal writes below, so each assertion reads a settled list
      // without pumping Solid's effect queue. What is under test is the memo's
      // NOTIFICATION, which is the same either way.
      const painted: SurfaceReadoutStatus[] = [];
      createComputed(() => painted.push(readout().status));
      expect(painted).toEqual(["live"]);

      // Membership churn on a healthy page — a row opens, a terminal
      // re-subscribes — re-folds to the same (empty) evidence, so no indicator
      // bound to the readout re-renders.
      setSubs([sub("preferences"), sub("documents[abc]", { pending: true })]);
      expect(painted).toEqual(["live"]);

      const stopped = sub("documents.keys", { error: new Error("boom") });
      setSubs([sub("preferences"), stopped]);
      expect(painted).toEqual(["live", "degraded"]);

      // Same status AND the same name list: still one paint.
      setSubs([stopped, sub("preferences")]);
      expect(painted).toEqual(["live", "degraded"]);

      // The subscription re-delivers; its own error() self-clears, and so does
      // the readout — nothing latches here that does not latch beneath.
      setSubs([sub("preferences"), sub("documents.keys")]);
      expect(painted).toEqual(["live", "degraded", "live"]);

      setStatus("retired");
      expect(painted).toEqual(["live", "degraded", "live", "retired"]);

      dropReadout();
      dispose();
    });
  });

  it("stops folding once disposed — the memo does not outlive the connection", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
      const health = vi.fn((): SurfaceHealth => fact(true));
      const { readout, dispose: dropReadout } = createSurfaceReadout(
        status,
        health,
      );
      // OBSERVE the memo first, and keep observing after. Without a live reader
      // Solid never re-runs a memo at all, so a `dispose` that did nothing would
      // pass a fold-count assertion just as quietly as one that worked — the
      // reader is what makes the count evidence.
      const painted: SurfaceReadoutStatus[] = [];
      createComputed(() => painted.push(readout().status));
      setStatus("reconnecting");
      expect(painted).toEqual(["live", "reconnecting"]);
      const folds = health.mock.calls.length;

      // Now drop the readout's own root. Its memo is gone, so the observer above
      // is no longer fed and nothing re-walks the fact — which is what keeps a
      // disposed connection from leaving a standing computation on a registry it
      // no longer belongs to.
      dropReadout();
      setStatus("live");
      expect(health.mock.calls.length).toBe(folds);
      expect(painted).toEqual(["live", "reconnecting"]);
      expect(readout().status).toBe("reconnecting");
      dispose();
    });
  });
});

describe("createSurfaceReadout — the graced down-state (presentingDown)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Observe a readout's `presentingDown` as a painted list under a root. The
   *  `await Promise.resolve()` after the mount and after each write flushes
   *  `gracedDown`'s deferred `createEffect` (Solid runs effects at the end of a
   *  batch), so its timer arms before the fake clock advances — the pattern
   *  `gracedDown.test.ts` documents. */
  async function watch(initial: SurfaceConnectionStatus) {
    return createRoot(async (dispose) => {
      const [status, setStatus] =
        createSignal<SurfaceConnectionStatus>(initial);
      const { readout } = createSurfaceReadout(status, () => fact(true));
      const painted: boolean[] = [];
      createComputed(() => painted.push(readout().presentingDown));
      await Promise.resolve();
      return { setStatus, painted, readout, dispose };
    });
  }

  it("never presents a sub-second drop — the watchdog's own recovery window", async () => {
    const w = await watch("live");
    expect(w.readout().presentingDown).toBe(false);
    w.setStatus("reconnecting");
    await Promise.resolve();
    // Inside the grace: still false.
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 100);
    expect(w.readout().presentingDown).toBe(false);
    // Recovered before the window elapsed: never painted true once.
    w.setStatus("live");
    await Promise.resolve();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS * 4);
    expect(w.readout().presentingDown).toBe(false);
    expect(w.painted).not.toContain(true);
    w.dispose();
  });

  it("presents a SUSTAINED down-state once the grace elapses", async () => {
    const w = await watch("live");
    w.setStatus("reconnecting");
    await Promise.resolve();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 1);
    expect(w.readout().presentingDown).toBe(false);
    vi.advanceTimersByTime(1);
    expect(w.readout().presentingDown).toBe(true);
    // The instantaneous status never moved with the grace — the dot/probe/client
    // read `reconnecting` from the instant it dropped.
    expect(w.readout().status).toBe("reconnecting");
    w.dispose();
  });

  it("hides INSTANTLY on recovery — no second window on the way down", async () => {
    const w = await watch("live");
    w.setStatus("reconnecting");
    await Promise.resolve();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS);
    expect(w.readout().presentingDown).toBe(true);
    w.setStatus("live");
    await Promise.resolve();
    // No timer advance: the falling edge is instant.
    expect(w.readout().presentingDown).toBe(false);
    expect(w.readout().status).toBe("live");
    w.dispose();
  });

  it("presents `retired` once graced like any other non-live state", async () => {
    const w = await watch("live");
    w.setStatus("retired");
    await Promise.resolve();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS);
    expect(w.readout().presentingDown).toBe(true);
    expect(w.readout().needsReload).toBe(true);
    w.dispose();
  });
});
