/**
 * The subscription-health registry — the `system.live` twin's fact-fold.
 *
 * Pins the two load-bearing properties from `./health`:
 *   - SELF-CLEARING: a sub's error appears in `health()` and then DISAPPEARS the
 *     instant the sub's own `error()` clears — the un-latchable-by-construction
 *     property that ends the per-consumer #1564 fold.
 *   - TOTAL + lifecycle-correct: an enrolled sub shows up; a disposed one drops;
 *     membership and each sub's error/pending are both reactive.
 * Plus `mergeSurfaceHealth` for the multi-surface (Leak D) shape.
 */

import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSurfaceHealthRegistry, mergeSurfaceHealth } from "./health";

describe("createSurfaceHealthRegistry", () => {
  it("folds an enrolled sub's self-clearing error/pending, then drops it on dispose", () => {
    const [live, setLive] = createSignal(true);
    const [err, setErr] = createSignal<Error | undefined>(undefined);
    const [pending, setPending] = createSignal(true);
    // The registry and the enrolment live under a root — enrolment rides the
    // consumer's owner, which is what retracts it. The sub's OWN signals are
    // written from outside it, where a frame arriving writes them (a write under
    // an owner is REACTIVE_WRITE_IN_OWNED_SCOPE), and each write is read back
    // after its `flush()`, which is when a consumer would see it.
    //
    // MEMBERSHIP is read back after a `flush()` for the same reason: the fact is
    // folded in the registry's own memos (so no READING scope is wide), and a
    // memo re-folds on the flush the enrolment's bump schedules. A consuming
    // computation is re-run by that same flush, so it never reads the older
    // roster; an imperative reader asks after it.
    const { reg, drop, dispose } = createRoot((dispose) => {
      const reg = createSurfaceHealthRegistry(live);
      // Empty registry: vacuously live, no subs.
      expect(reg.health()).toEqual({ live: true, subs: [] });
      const drop = reg.enroll("connection", { error: err, pending });
      return { reg, drop, dispose };
    });

    flush();
    expect(reg.health().subs).toEqual([
      { name: "connection", pending: true, error: undefined },
    ]);

    // A transient blip — the sub's own error() sets.
    const e = new Error("Internal server error");
    setErr(e);
    setPending(false);
    flush();
    expect(reg.health().subs[0]).toEqual({
      name: "connection",
      pending: false,
      error: e,
    });

    // SELF-HEAL: the sub's error() clears on the next good frame, so health()
    // clears too — no latch. This is the property the whole proposal turns on.
    setErr(undefined);
    flush();
    expect(reg.health().subs[0]?.error).toBeUndefined();

    // Transport liveness flows through unchanged.
    setLive(false);
    flush();
    expect(reg.health().live).toBe(false);

    // Dispose drops the sub from the fact (the registry tracks what's live).
    drop();
    flush();
    expect(reg.health().subs).toEqual([]);
    // The fold lives in a DETACHED root (a consumer's owner must not be able to
    // end it), so the registry's own disposer is what ends it — `surfaceClient`
    // hands it to its `dispose()`.
    reg.disposeFold();
    dispose();
  });

  it("keeps two same-named subs distinct (id-keyed, not name-keyed)", () => {
    createRoot((dispose) => {
      const reg = createSurfaceHealthRegistry(() => true);
      const e1 = new Error("first");
      const dropA = reg.enroll("cores[0]", {
        error: () => e1,
        pending: () => false,
      });
      reg.enroll("cores[0]", { error: () => undefined, pending: () => true });
      // Both slots survive — a name-keyed map would have clobbered one.
      expect(reg.health().subs).toHaveLength(2);
      dropA();
      flush();
      expect(reg.health().subs).toEqual([
        { name: "cores[0]", pending: true, error: undefined },
      ]);
      reg.disposeFold();
      dispose();
    });
  });

  it("merges several clients — AND-reduces live, prefixes sub names by surface key", () => {
    createRoot((dispose) => {
      const regA = createSurfaceHealthRegistry(() => true);
      const regB = createSurfaceHealthRegistry(() => false);
      const eA = new Error("a down");
      regA.enroll("conn", { error: () => eA, pending: () => false });
      regB.enroll("conn", { error: () => undefined, pending: () => true });

      const merged = mergeSurfaceHealth([
        ["hostA", regA.health],
        ["hostB", regB.health],
      ]);
      // AND-reduce: hostB's link is down, so the composed fact is not live.
      expect(merged.live).toBe(false);
      expect(merged.subs).toEqual([
        { name: "hostA/conn", pending: false, error: eA },
        { name: "hostB/conn", pending: true, error: undefined },
      ]);
      regA.disposeFold();
      regB.disposeFold();
      dispose();
    });
  });
});
