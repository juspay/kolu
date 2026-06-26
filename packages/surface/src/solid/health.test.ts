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

import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createSurfaceHealthRegistry, mergeSurfaceHealth } from "./health";

describe("createSurfaceHealthRegistry", () => {
  it("folds an enrolled sub's self-clearing error/pending, then drops it on dispose", () => {
    createRoot((dispose) => {
      const [live, setLive] = createSignal(true);
      const reg = createSurfaceHealthRegistry(live);
      // Empty registry: vacuously live, no subs.
      expect(reg.health()).toEqual({ live: true, subs: [] });

      const [err, setErr] = createSignal<Error | undefined>(undefined);
      const [pending, setPending] = createSignal(true);
      const drop = reg.enroll("connection", { error: err, pending });

      expect(reg.health().subs).toEqual([
        { name: "connection", pending: true, error: undefined },
      ]);

      // A transient blip — the sub's own error() sets.
      const e = new Error("Internal server error");
      setErr(e);
      setPending(false);
      expect(reg.health().subs[0]).toEqual({
        name: "connection",
        pending: false,
        error: e,
      });

      // SELF-HEAL: the sub's error() clears on the next good frame, so health()
      // clears too — no latch. This is the property the whole proposal turns on.
      setErr(undefined);
      expect(reg.health().subs[0]?.error).toBeUndefined();

      // Transport liveness flows through unchanged.
      setLive(false);
      expect(reg.health().live).toBe(false);

      // Dispose drops the sub from the fact (the registry tracks what's live).
      drop();
      expect(reg.health().subs).toEqual([]);
      dispose();
    });
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
      expect(reg.health().subs).toEqual([
        { name: "cores[0]", pending: true, error: undefined },
      ]);
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
      dispose();
    });
  });
});
