/**
 * The NEWEST-WINS convergence policy — the drain-vs-refuse DECISION, in isolation.
 *
 * `bindPadiOnce` layers the padi-specific version ORDERING over the endpoint's
 * generic adopt-or-spawn-or-refuse: a `padiSurface` skew where THIS binder is
 * NEWER than the running padi DRAINS it (persist + exit) so the spawn path brings
 * up the binder's own newer closure; a skew where the binder is OLDER / behind
 * REFUSES (never touches the running padi). These unit tests exercise that
 * decision without a real padi — a fake {@link PadiSkewProbe} supplies the running
 * `hello` and observes whether `drain` is called; the endpoint half is a spy (the
 * real endpoint's adopt/spawn/refuse arms are proven in
 * `surface-daemon-supervisor/endpoint.test.ts`). The three mandated behaviours:
 *
 *   1. newer-drains-and-respawns — the decision + the drain→spawn ordering.
 *   2. older-refuses             — no drain, the endpoint's refuse arm runs, the
 *                                  running padi is untouched.
 *   3. no-flap / mixed-version   — two binders at v-lo/v-hi contending converge to
 *                                  the NEWEST (v-hi drains once), and v-lo NEVER
 *                                  drains v-hi's padi (the anti-livelock proof).
 *
 * Plus `isBinderNewer`'s ordering, tested directly.
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import {
  bindPadiOnce,
  isBinderNewer,
  type PadiSkewProbe,
} from "./padiBinding.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A fake probe of a running padi at `running`, recording whether it was drained
 *  and disposed. `onDrained` lets a caller model "drain → the padi exits" for the
 *  convergence simulation. */
function fakeProbe(
  running: string,
  hooks: { onDrain?: () => void } = {},
): PadiSkewProbe & { drained: boolean; disposed: boolean } {
  const p = {
    drained: false,
    disposed: false,
    hello: {
      stateRoot: "sr",
      surfaceVersion: running,
      controlCoreVersion: "1.0",
      startedAt: 0,
    },
    drain: async () => {
      p.drained = true;
      hooks.onDrain?.();
    },
    dispose: () => {
      p.disposed = true;
    },
  };
  return p;
}

describe("isBinderNewer — the version ordering", () => {
  it("same major, higher minor → newer", () => {
    expect(isBinderNewer("1.1", "1.0")).toBe(true);
    expect(isBinderNewer("1.10", "1.2")).toBe(true); // numeric, not lexical
  });

  it("same major, lower minor → NOT newer", () => {
    expect(isBinderNewer("1.0", "1.1")).toBe(false);
  });

  it("higher major → newer, even with a lower minor (major dominates)", () => {
    expect(isBinderNewer("2.0", "1.9")).toBe(true);
  });

  it("lower major → NOT newer, even with a higher minor (major dominates)", () => {
    expect(isBinderNewer("1.9", "2.0")).toBe(false);
  });

  it("equal versions → NOT strictly newer (the defensive floor; can't happen on a real skew)", () => {
    expect(isBinderNewer("1.0", "1.0")).toBe(false);
    expect(isBinderNewer("2.3", "2.3")).toBe(false);
  });

  it("fails fast (throws) on an unparseable version — never silently mis-orders", () => {
    expect(() => isBinderNewer("garbage", "1.0")).toThrow();
    expect(() => isBinderNewer("1.0", "")).toThrow();
    expect(() => isBinderNewer("1", "1.0")).toThrow(); // must be major.minor
  });

  it("tolerates a trailing patch/prerelease suffix (only major.minor is load-bearing)", () => {
    expect(isBinderNewer("1.2.7", "1.1")).toBe(true);
    expect(isBinderNewer("1.1-rc.1", "1.2")).toBe(false);
  });
});

describe("bindPadiOnce — drain-vs-refuse decision", () => {
  it("newer-drains-and-respawns: a NEWER binder over an OLDER survivor DRAINS it, THEN spawns (ordering)", async () => {
    const seq: string[] = [];
    const probe = fakeProbe("1.0", { onDrain: () => seq.push("drain") });
    // The endpoint spy: after the drain the survivor is gone, so its real
    // `adoptOrSpawnOrRefuse` would take the fresh-spawn path. Here we assert the
    // ORDERING — the drain must happen before the endpoint is asked to bind.
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        seq.push("bind");
        return false; // fresh spawn → nothing adopted
      },
    };

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1", // strictly newer than the running 1.0
      log: silentLog,
    });

    expect(probe.drained).toBe(true); // drained the older survivor
    expect(seq).toEqual(["drain", "bind"]); // drain BEFORE the spawn/bind
    expect(probe.disposed).toBe(true); // probe socket dropped
    expect(adopted).toBe(false); // spawned fresh, nothing to reconcile
  });

  it("older-refuses: an OLDER binder over a NEWER survivor does NOT drain — the endpoint's refuse arm runs, the padi is untouched", async () => {
    const probe = fakeProbe("2.0"); // running padi is NEWER (v2)
    let bindCalled = false;
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        // In production the real endpoint REFUSES here (its connect throws
        // DaemonContractSkewError → degraded, survivor left standing). We only need
        // to prove bindPadiOnce delegated WITHOUT having drained.
        bindCalled = true;
        return false;
      },
    };

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.5", // OLDER major than the running 2.0
      log: silentLog,
    });

    expect(probe.drained).toBe(false); // the running padi was NEVER drained
    expect(bindCalled).toBe(true); // delegated to the endpoint's refuse arm
    expect(probe.disposed).toBe(true);
    expect(adopted).toBe(false);
  });

  it("compatible survivor (minor-forward): no drain — the endpoint ADOPTS it", async () => {
    // A 1.0 binder dialing a 1.1 padi is COMPATIBLE (minor is backward-forward),
    // so it never reaches the skew arms: no drain, straight to adopt.
    const probe = fakeProbe("1.1");
    const endpoint = { adoptOrSpawnOrRefuse: async () => true };

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.0",
      log: silentLog,
    });

    expect(probe.drained).toBe(false);
    expect(adopted).toBe(true); // adopted the compatible survivor
  });

  it("no survivor: no probe, no drain — straight to the spawn path", async () => {
    let bindCalled = false;
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        bindCalled = true;
        return false;
      },
    };

    await bindPadiOnce({
      endpoint,
      probe: async () => null, // nothing answering the socket
      binderVersion: "1.1",
      log: silentLog,
    });

    expect(bindCalled).toBe(true); // delegated to the fresh-spawn path
  });

  it("drain FAILURE is fail-fast, never kill: the drain rejects, the padi stays standing, the endpoint still runs (refuses)", async () => {
    // Model a wedged padi: drain rejects (socket never closes in the window). The
    // arm must NOT throw out of bindPadiOnce and must NOT skip the endpoint — the
    // following adopt-or-spawn-or-refuse re-probes the still-skewed survivor and
    // REFUSES (degraded), so the reconnect loop keeps trying without a SIGKILL.
    const probe: PadiSkewProbe & { disposed: boolean } = {
      disposed: false,
      hello: {
        stateRoot: "sr",
        surfaceVersion: "1.0",
        controlCoreVersion: "1.0",
        startedAt: 0,
      },
      drain: async () => {
        throw new Error("drain never landed (padi did not exit)");
      },
      dispose() {
        this.disposed = true;
      },
    };
    let bindCalled = false;
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        bindCalled = true;
        return false; // refuse arm (survivor still standing + skewed)
      },
    };

    // Must resolve (not reject) despite the drain failure — no livelock, no crash.
    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1",
      log: silentLog,
    });

    expect(bindCalled).toBe(true); // endpoint STILL ran → emits degraded → retry
    expect(probe.disposed).toBe(true); // probe cleaned up even on the failure path
    expect(adopted).toBe(false);
  });
});

describe("bindPadiOnce — no-flap / mixed-version stability (anti-livelock)", () => {
  /**
   * A shared in-memory model of "the running padi": which `padiSurface` version it
   * serves, or `null` when it has exited. A binder's `bindPadiOnce`:
   *   - probes the current running version (or null → no survivor);
   *   - drain sets running = null (padi exited);
   *   - the endpoint spy: null → spawn THIS binder's own closure (running =
   *     binderVersion); else compatible → adopt (unchanged), skew → refuse
   *     (unchanged). This is exactly the real endpoint's arm set, modelled purely.
   * We then contend two binders (v-lo, v-hi) and prove convergence to the newest
   * with only ONE drain, ever — the older binder never drains the newer's padi.
   */
  function makeCluster(startRunning: string) {
    const state = { running: startRunning as string | null };
    const drains: string[] = []; // binderVersion of each drain that fired

    const binder = (binderVersion: string) => () =>
      bindPadiOnce({
        endpoint: {
          adoptOrSpawnOrRefuse: async () => {
            if (state.running === null) {
              // No survivor → the spawn path brings up THIS binder's own closure.
              state.running = binderVersion;
              return false;
            }
            // Survivor present: adopt iff compatible, else refuse — either way the
            // running padi is UNCHANGED (no kill, no respawn).
            return isContractVersionCompatible(state.running, binderVersion);
          },
        },
        probe: async () =>
          state.running === null
            ? null
            : fakeProbe(state.running, {
                onDrain: () => {
                  drains.push(binderVersion);
                  state.running = null; // padi exited
                },
              }),
        binderVersion,
        log: silentLog,
      });

    return { state, drains, binder };
  }

  it("v-hi drains a v-lo padi exactly ONCE and converges; v-lo NEVER drains v-hi's padi (no oscillation)", async () => {
    const { state, drains, binder } = makeCluster("1.0"); // a v-lo (1.0) padi is up
    const lo = binder("1.0");
    const hi = binder("1.1");

    // The newer binder arrives: it drains the 1.0 padi and spawns its own 1.1.
    await hi();
    expect(state.running).toBe("1.1"); // converged UP to the newest
    expect(drains).toEqual(["1.1"]); // exactly one drain, by the newer binder

    // Now hammer the two binders in both orders many times. The v-lo binder must
    // NEVER drain the v-1.1 padi (1.0 is not newer than 1.1 → refuse-or-adopt), and
    // the v-hi binder finds its own version already running (compatible → adopt).
    for (let i = 0; i < 10; i++) {
      await lo();
      await hi();
      await hi();
      await lo();
    }

    expect(state.running).toBe("1.1"); // still converged — no flap back to 1.0
    expect(drains).toEqual(["1.1"]); // STILL exactly one drain ever — no oscillation
  });

  it("across a MAJOR skew: v2 drains a v1 padi once; the v1 binder never drains the v2 padi back", async () => {
    const { state, drains, binder } = makeCluster("1.5"); // a v1 padi is up
    const v1 = binder("1.5");
    const v2 = binder("2.0");

    await v2(); // v2 is newer (major) → drains the v1 padi, spawns v2
    expect(state.running).toBe("2.0");
    expect(drains).toEqual(["2.0"]);

    // The v1 binder now dials the v2 padi: 2.0 is not compatible with a 1.5 binder
    // (major skew) AND 1.5 is not newer than 2.0 → REFUSE, no drain. Repeatedly.
    for (let i = 0; i < 10; i++) {
      await v1();
      await v2();
    }
    expect(state.running).toBe("2.0"); // converged to v2, stable
    expect(drains).toEqual(["2.0"]); // v1 NEVER drained the v2 padi (monotonicity)
  });
});
