/** Pins the fresh-remote-connect warm floor (see `pendingWindow.ts`'s header for
 *  the full bug narrative): switching to a brand-new host must get its OWN
 *  pending-window anchor, never inherit the age of a PRIOR wait (boot's, or a
 *  previously-active host's) — that inherited staleness is exactly what made a
 *  freshly-warming remote resolve `pendingTimedOut` true the instant you switched
 *  to it, days into a session, and stick at the `dead`/"kaval didn't start"
 *  surface until a refresh reset the clock. */

import { describe, expect, it } from "vitest";
import {
  isPendingTimedOut,
  type PendingWindow,
  reanchorPendingWindow,
} from "./pendingWindow";

describe("reanchorPendingWindow", () => {
  it("anchors fresh on the very first read (prev undefined)", () => {
    expect(reanchorPendingWindow(undefined, "local", 1_000)).toEqual({
      hostKey: "local",
      anchorMs: 1_000,
    });
  });

  it("holds the SAME window (by reference) while the host key is unchanged", () => {
    const first = reanchorPendingWindow(undefined, "local", 1_000);
    const second = reanchorPendingWindow(first, "local", 500_000);
    expect(second).toBe(first);
  });

  it("re-anchors to NOW the instant the active host switches", () => {
    const bootWindow = reanchorPendingWindow(undefined, "local", 0);
    const afterSwitch = reanchorPendingWindow(
      bootWindow,
      "remote:zest",
      90_000,
    );
    expect(afterSwitch).toEqual({ hostKey: "remote:zest", anchorMs: 90_000 });
  });
});

describe("isPendingTimedOut", () => {
  const window = (hostKey: string, anchorMs: number): PendingWindow => ({
    hostKey,
    anchorMs,
  });

  it("is false whenever not pending, however old the window is", () => {
    expect(isPendingTimedOut(false, window("local", 0), 999_999, 30_000)).toBe(
      false,
    );
  });

  it("is false within the warm window", () => {
    expect(
      isPendingTimedOut(true, window("remote:zest", 90_000), 91_000, 30_000),
    ).toBe(false);
  });

  it("is true once the CURRENT window has outlasted the ceiling", () => {
    expect(
      isPendingTimedOut(true, window("remote:zest", 90_000), 121_001, 30_000),
    ).toBe(true);
  });
});

describe("THE BUG — a fresh remote connect must not inherit a stale (e.g. boot-time) anchor", () => {
  it("red (old single-anchor behavior): measuring against the ORIGINAL boot anchor reads a fresh switch as already timed out", () => {
    // The reported repro: the app has been open for 90s (anchored once at boot,
    // t=0) — comfortably past the 30s ceiling — when the user switches to a
    // brand-new remote host. The OLD code kept exactly ONE `Date.now()` snapshot
    // for the module's whole life, so every read of "how long has THIS wait run"
    // was really "how long has the app been open" — wrongly timed out the instant
    // the switch happens, before the new host's own handshake even starts.
    const bootAnchor: PendingWindow = { hostKey: "local", anchorMs: 0 };
    const oneSecondAfterSwitch = 91_000;
    expect(
      isPendingTimedOut(true, bootAnchor, oneSecondAfterSwitch, 30_000),
    ).toBe(true); // WRONG — this is what the live bug rendered as `dead`
  });

  it("green (the fix): reanchorPendingWindow gives the switched-to host its OWN fresh window, so the same instant reads correctly as still-warming", () => {
    const bootWindow = reanchorPendingWindow(undefined, "local", 0);
    // The user switches to a freshly-connected remote at t=90_000 — 90s into the
    // session, well past the 30s ceiling if (wrongly) measured from boot.
    const switchWindow = reanchorPendingWindow(
      bootWindow,
      "remote:zest",
      90_000,
    );
    const oneSecondAfterSwitch = 91_000;
    // Only 1s into the NEW host's own warm window — must read connecting, not timed out.
    expect(
      isPendingTimedOut(true, switchWindow, oneSecondAfterSwitch, 30_000),
    ).toBe(false);
    // The ceiling still fires honestly once THIS host's own wait genuinely outlasts it.
    expect(isPendingTimedOut(true, switchWindow, 90_000 + 30_001, 30_000)).toBe(
      true,
    );
  });
});
