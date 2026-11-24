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

import { createEffect, createRoot, createSignal, flush } from "solid-js";
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
    const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
    const [error, setError] = createSignal<Error | undefined>(undefined);
    // Stand in for the registry's plain accessor, which re-folds the WHOLE
    // enrolment on every read — the walk this memo exists to stop repeating.
    const health = vi.fn(
      (): SurfaceHealth => fact(true, [sub("keys", { error: error() })]),
    );
    // The signals are driven from OUTSIDE the root, where a transport's frames
    // and a subscription's errors come from; a write under an owner is
    // REACTIVE_WRITE_IN_OWNED_SCOPE. Each write is observed after its `flush()`.
    const { readout, dropReadout, dispose } = createRoot((dispose) => {
      const { readout, dispose: dropReadout } = createSurfaceReadout(
        status,
        health,
      );
      return { readout, dropReadout, dispose };
    });

    const folds = () => health.mock.calls.length;
    const before = folds();
    // Six reads, as six JSX expressions would be: no new walk.
    for (let i = 0; i < 6; i++) expect(readout().status).toBe("live");
    expect(folds()).toBe(before);

    setError(new Error("boom"));
    flush();
    expect(readout().stopped).toEqual(["keys"]);
    expect(folds()).toBe(before + 1);

    setStatus("retired");
    flush();
    expect(readout().needsReload).toBe(true);
    expect(folds()).toBe(before + 2);

    dropReadout();
    dispose();
  });

  it("notifies nobody while the readout still says the same thing", () => {
    const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
    const [subs, setSubs] = createSignal<SubHealth[]>([sub("preferences")]);
    // A split `createEffect`: the compute reads the memo (so it has a live
    // observer), the effect phase records what it read. Each flush paints at
    // most once, so the list is the memo's NOTIFICATIONS, not its recomputes.
    const painted: SurfaceReadoutStatus[] = [];
    const { dropReadout, dispose } = createRoot((dispose) => {
      const { readout, dispose: dropReadout } = createSurfaceReadout(status, () =>
        fact(true, subs()),
      );
      createEffect(
        () => readout().status,
        (status) => {
          painted.push(status);
        },
      );
      return { dropReadout, dispose };
    });
    flush(); // the effect's first run lands on the flush after creation
    expect(painted).toEqual(["live"]);

    // Membership churn on a healthy page — a row opens, a terminal
    // re-subscribes — re-folds to the same (empty) evidence, so no indicator
    // bound to the readout re-renders.
    setSubs([sub("preferences"), sub("documents[abc]", { pending: true })]);
    flush();
    expect(painted).toEqual(["live"]);

    const stopped = sub("documents.keys", { error: new Error("boom") });
    setSubs([sub("preferences"), stopped]);
    flush();
    expect(painted).toEqual(["live", "degraded"]);

    // Same status AND the same name list: still one paint.
    setSubs([stopped, sub("preferences")]);
    flush();
    expect(painted).toEqual(["live", "degraded"]);

    // The subscription re-delivers; its own error() self-clears, and so does
    // the readout — nothing latches here that does not latch beneath.
    setSubs([sub("preferences"), sub("documents.keys")]);
    flush();
    expect(painted).toEqual(["live", "degraded", "live"]);

    setStatus("retired");
    flush();
    expect(painted).toEqual(["live", "degraded", "live", "retired"]);

    dropReadout();
    dispose();
  });

  it("stops folding once disposed — the memo does not outlive the connection", () => {
    const [status, setStatus] = createSignal<SurfaceConnectionStatus>("live");
    const health = vi.fn((): SurfaceHealth => fact(true));
    // OBSERVE the memo first, and keep observing after. Without a live reader
    // Solid never re-runs a memo at all, so a `dispose` that did nothing would
    // pass a fold-count assertion just as quietly as one that worked — the
    // reader is what makes the count evidence.
    const painted: SurfaceReadoutStatus[] = [];
    const { readout, dropReadout, dispose } = createRoot((dispose) => {
      const { readout, dispose: dropReadout } = createSurfaceReadout(
        status,
        health,
      );
      createEffect(
        () => readout().status,
        (status) => {
          painted.push(status);
        },
      );
      return { readout, dropReadout, dispose };
    });
    flush();
    setStatus("reconnecting");
    flush();
    expect(painted).toEqual(["live", "reconnecting"]);
    const folds = health.mock.calls.length;

    // Now drop the readout's own root. Its memo is gone, so the observer above
    // is no longer fed and nothing re-walks the fact — which is what keeps a
    // disposed connection from leaving a standing computation on a registry it
    // no longer belongs to.
    dropReadout();
    setStatus("live");
    flush();
    expect(health.mock.calls.length).toBe(folds);
    expect(painted).toEqual(["live", "reconnecting"]);
    expect(readout().status).toBe("reconnecting");
    dispose();
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
   *  status is written from OUTSIDE the root (a write under an owner is
   *  REACTIVE_WRITE_IN_OWNED_SCOPE), and every write is followed by `flush()`:
   *  writes are staged until it and an effect's run is part of it, so
   *  `gracedDown`'s timer arms before the fake clock advances, and the show the
   *  timer writes is readable only after the next one — the pattern
   *  `gracedDown.test.ts` documents. */
  function watch(initial: SurfaceConnectionStatus) {
    const [status, setStatus] = createSignal<SurfaceConnectionStatus>(initial);
    const painted: boolean[] = [];
    const { readout, dispose } = createRoot((dispose) => {
      const { readout } = createSurfaceReadout(status, () => fact(true));
      createEffect(
        () => readout().presentingDown,
        (presenting) => {
          painted.push(presenting);
        },
      );
      return { readout, dispose };
    });
    flush();
    return { setStatus, painted, readout, dispose };
  }

  it("never presents a sub-second drop — the watchdog's own recovery window", () => {
    const w = watch("live");
    expect(w.readout().presentingDown).toBe(false);
    w.setStatus("reconnecting");
    flush();
    // Inside the grace: still false.
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 100);
    flush();
    expect(w.readout().presentingDown).toBe(false);
    // Recovered before the window elapsed: never painted true once.
    w.setStatus("live");
    flush();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS * 4);
    flush();
    expect(w.readout().presentingDown).toBe(false);
    expect(w.painted).not.toContain(true);
    w.dispose();
  });

  it("presents a SUSTAINED down-state once the grace elapses", () => {
    const w = watch("live");
    w.setStatus("reconnecting");
    flush();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS - 1);
    flush();
    expect(w.readout().presentingDown).toBe(false);
    vi.advanceTimersByTime(1);
    flush();
    expect(w.readout().presentingDown).toBe(true);
    // The instantaneous status never moved with the grace — the dot/probe/client
    // read `reconnecting` from the instant it dropped.
    expect(w.readout().status).toBe("reconnecting");
    w.dispose();
  });

  it("hides INSTANTLY on recovery — no second window on the way down", () => {
    const w = watch("live");
    w.setStatus("reconnecting");
    flush();
    vi.advanceTimersByTime(DISCONNECT_OVERLAY_GRACE_MS);
    flush();
    expect(w.readout().presentingDown).toBe(true);
    w.setStatus("live");
    flush();
    // No timer advance: the falling edge is instant.
    expect(w.readout().presentingDown).toBe(false);
    expect(w.readout().status).toBe("live");
    w.dispose();
  });

  it("presents `retired` IMMEDIATELY — terminal, so the grace window is bypassed", () => {
    const w = watch("live");
    w.setStatus("retired");
    flush();
    // No timer advance: a retired wire never re-dials, so there is nothing the
    // grace window could hold back. This matches the frozen disposed-connection
    // readout (`connectSurfaces`' `retiredReadout`), which is also `true`.
    expect(w.readout().presentingDown).toBe(true);
    expect(w.readout().needsReload).toBe(true);
    w.dispose();
  });
});
