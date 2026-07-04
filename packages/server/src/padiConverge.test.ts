/**
 * The convergence policy — the drain-vs-refuse DECISION on both axes, in isolation.
 *
 * `bindPadiOnce` layers the padi-specific convergence over the endpoint's generic
 * adopt-or-spawn-or-refuse, on two independent axes. These unit tests exercise that
 * decision without a real padi — a fake {@link PadiSkewProbe} supplies the running
 * `hello` and observes whether `drain` is called; the endpoint half is a spy (the
 * real endpoint's adopt/spawn/refuse arms are proven in
 * `surface-daemon-supervisor/endpoint.test.ts`).
 *
 * Axis 1 — CONTRACT (`padiSurface` version): a skew where THIS binder is NEWER DRAINS
 * the survivor so the spawn brings up the binder's own newer closure; an OLDER/behind
 * binder REFUSES (never touches the running padi). Behaviours:
 *   1. newer-drains-and-respawns — the decision + the drain→spawn ordering.
 *   2. older-refuses             — no drain, the endpoint's refuse arm runs.
 *   3. no-flap / mixed-version   — two binders at v-lo/v-hi converge to the NEWEST
 *                                  (v-hi drains once), v-lo NEVER drains v-hi's padi.
 * Plus `isBinderNewer`'s ordering, tested directly.
 *
 * Axis 2 — BUILD (same contract, different closure; #1670): when the handshake would
 * ADOPT, a survivor whose baked build id differs from — or is ABSENT vs — this binder's
 * expected id is DRAINED once at boot. Store hashes don't order, so the anti-livelock
 * guarantee is a once-per-binder-boot fence. Behaviours: mismatch-drains, absent==
 * mismatch, same-build-adopts, off-nix-never-drains, reconnect-never-re-drains,
 * older-contract-still-refuses (build can't override the contract), drain-failure-
 * spends-the-fence, and two-binder build no-flap (each drains at most once at its boot).
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import {
  bindPadiOnce,
  createBuildDrainFence,
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
 *  and disposed. `onDrain` lets a caller model "drain → the padi exits" for the
 *  convergence simulation; `buildId` sets the survivor's baked `PADI_BUILD_ID` on the
 *  hello (omit → absent, modelling a survivor that predates the `buildId` field). */
function fakeProbe(
  running: string,
  hooks: { onDrain?: () => void; buildId?: string } = {},
): PadiSkewProbe & { drained: boolean; disposed: boolean } {
  const p = {
    drained: false,
    disposed: false,
    hello: {
      stateRoot: "sr",
      surfaceVersion: running,
      controlCoreVersion: "1.0",
      startedAt: 0,
      buildId: hooks.buildId,
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
      binderBuildId: "", // off-nix: the build axis stays dormant (contract-only test)
      buildDrainFence: createBuildDrainFence(),
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
      binderBuildId: "", // off-nix: the build axis stays dormant (contract-only test)
      buildDrainFence: createBuildDrainFence(),
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
      binderBuildId: "", // off-nix: the build axis stays dormant (contract-only test)
      buildDrainFence: createBuildDrainFence(),
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
      binderBuildId: "", // off-nix: the build axis stays dormant (contract-only test)
      buildDrainFence: createBuildDrainFence(),
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
      binderBuildId: "", // off-nix: the build axis stays dormant (contract-only test)
      buildDrainFence: createBuildDrainFence(),
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

    const binder = (binderVersion: string) => {
      // One fence per binder PROCESS, shared across its reconnects (unused here — the
      // survivors carry no buildId, so the build axis never fires; this is the pure
      // CONTRACT-flap model).
      const buildDrainFence = createBuildDrainFence();
      return () =>
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
          binderBuildId: "", // off-nix: contract-only flap model
          buildDrainFence,
          log: silentLog,
        });
    };

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

describe("bindPadiOnce — drain-on-build-mismatch (#1670)", () => {
  it("same contract, DIFFERENT build → drains ONCE then spawns this binder's own build", async () => {
    const seq: string[] = [];
    const probe = fakeProbe("1.1", {
      onDrain: () => seq.push("drain"),
      buildId: "build-OLD",
    });
    // After the drain the survivor is gone, so the real endpoint would take the
    // fresh-spawn path. Assert the ORDERING — drain before the endpoint binds.
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        seq.push("bind");
        return false; // fresh spawn of THIS binder's build → nothing adopted
      },
    };
    const fence = createBuildDrainFence();

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1", // same contract → the handshake would ADOPT…
      binderBuildId: "build-NEW", // …but a different build → drain
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(probe.drained).toBe(true);
    expect(seq).toEqual(["drain", "bind"]); // drain BEFORE the spawn/bind
    expect(fence.hasFired()).toBe(true);
    expect(probe.disposed).toBe(true);
    expect(adopted).toBe(false); // spawned fresh, nothing to reconcile
  });

  it("same contract, SAME build → no drain, ADOPTS the survivor (same pid)", async () => {
    const probe = fakeProbe("1.1", { buildId: "build-SAME" });
    const endpoint = { adoptOrSpawnOrRefuse: async () => true };
    const fence = createBuildDrainFence();

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1",
      binderBuildId: "build-SAME",
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(probe.drained).toBe(false);
    expect(fence.hasFired()).toBe(false);
    expect(adopted).toBe(true); // adopted the compatible same-build survivor
  });

  it("ABSENT build id (a survivor predating the field) is a MISMATCH → drained + respawned", async () => {
    // The load-bearing first-upgrade case: the running padi predates the `buildId`
    // hello field, so its hello carries none. A nix-built binder must treat that as an
    // OLDER build and DRAIN — not adopt — or the fix never fires on the first deploy
    // past a pre-field padi (the zest class it exists for).
    const probe = fakeProbe("1.1"); // no buildId → hello.buildId is absent
    const endpoint = { adoptOrSpawnOrRefuse: async () => false };
    const fence = createBuildDrainFence();

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1",
      binderBuildId: "build-NEW", // a real (nix-baked) expected id
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(probe.drained).toBe(true); // absent == mismatch → drained
    expect(fence.hasFired()).toBe(true);
    expect(adopted).toBe(false); // spawned this binder's own build
  });

  it("off-nix binder (no expected build id) NEVER drains on build grounds — adopts", async () => {
    // A from-source (dev/e2e) binder has no baked PADI_BUILD_ID (""), so it cannot
    // judge builds and must adopt — the e2e terminals are never build-drained.
    const probe = fakeProbe("1.1", { buildId: "build-OLD" });
    const endpoint = { adoptOrSpawnOrRefuse: async () => true };
    const fence = createBuildDrainFence();

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1",
      binderBuildId: "", // off-nix binder
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(probe.drained).toBe(false);
    expect(fence.hasFired()).toBe(false);
    expect(adopted).toBe(true);
  });

  it("a reconnect within the SAME binder NEVER re-drains (the once-per-boot fence)", async () => {
    // One fence, reused across bind attempts — the binder-process lifetime. Model a
    // survivor that stays build-OLD every attempt (as if a foreign binder keeps
    // reviving the old build): the fence must still cap draining at ONE, ever.
    const fence = createBuildDrainFence();
    let drains = 0;
    const endpoint = { adoptOrSpawnOrRefuse: async () => false };
    const call = () =>
      bindPadiOnce({
        endpoint,
        probe: async () =>
          fakeProbe("1.1", { onDrain: () => drains++, buildId: "build-OLD" }),
        binderVersion: "1.1",
        binderBuildId: "build-NEW",
        buildDrainFence: fence,
        log: silentLog,
      });

    await call(); // boot: mismatch → drain once
    await call(); // reconnect: SAME fence → must NOT re-drain
    await call();

    expect(drains).toBe(1);
    expect(fence.hasFired()).toBe(true);
  });

  it("an OLDER-contract binder still REFUSES and never drains — a build mismatch cannot override the contract refuse", async () => {
    // The contract axis is evaluated FIRST: on a skew where the binder is older, the
    // build id must be irrelevant (never drained), preserving the #1313 inversion.
    const probe = fakeProbe("2.0", { buildId: "build-OLD" }); // running is a NEWER contract
    let bindCalled = false;
    const endpoint = {
      adoptOrSpawnOrRefuse: async () => {
        bindCalled = true;
        return false; // the real endpoint refuses here (degraded)
      },
    };
    const fence = createBuildDrainFence();

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.5", // older contract than the running 2.0…
      binderBuildId: "build-NEW", // …and a different build (which must NOT matter)
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(probe.drained).toBe(false); // contract axis wins: refuse, never drain
    expect(fence.hasFired()).toBe(false); // build axis never reached
    expect(bindCalled).toBe(true);
    expect(adopted).toBe(false);
  });

  it("a build-mismatch drain that FAILS spends the fence and does NOT throw — the endpoint still adopts the old build (degraded)", async () => {
    const fence = createBuildDrainFence();
    const probe: PadiSkewProbe & { disposed: boolean } = {
      disposed: false,
      hello: {
        stateRoot: "sr",
        surfaceVersion: "1.1",
        controlCoreVersion: "1.0",
        startedAt: 0,
        buildId: "build-OLD",
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
        return true; // survivor still standing + compatible contract → ADOPTED (old build)
      },
    };

    const adopted = await bindPadiOnce({
      endpoint,
      probe: async () => probe,
      binderVersion: "1.1",
      binderBuildId: "build-NEW",
      buildDrainFence: fence,
      log: silentLog,
    });

    expect(bindCalled).toBe(true);
    expect(fence.hasFired()).toBe(true); // spent even on failure → no reconnect re-drains
    expect(probe.disposed).toBe(true);
    expect(adopted).toBe(true); // degraded to the still-standing old build, logged loudly
  });
});

describe("bindPadiOnce — build no-flap / two binders at different builds", () => {
  /**
   * A shared in-memory model of "the running padi's BUILD": which build id it serves,
   * or `null` when it has exited. All at ONE contract (the build axis in isolation).
   * Each binder owns its OWN fence (its process), drains at most once at its boot, and
   * spawns its own build on a fresh-spawn. We contend two binders (build-X, build-Y)
   * and prove each drains at most ONCE ever — convergence to last-booted, no flap.
   */
  function makeBuildCluster(startBuild: string) {
    const state = { runningBuild: startBuild as string | null };
    const drains: string[] = []; // the binderBuildId of each drain that fired

    const binder = (binderBuildId: string) => {
      const buildDrainFence = createBuildDrainFence(); // one per binder process
      return () =>
        bindPadiOnce({
          endpoint: {
            adoptOrSpawnOrRefuse: async () => {
              if (state.runningBuild === null) {
                state.runningBuild = binderBuildId; // spawn THIS binder's build
                return false;
              }
              return true; // survivor present (now build-matching) → adopt
            },
          },
          probe: async () =>
            state.runningBuild === null
              ? null
              : fakeProbe("1.1", {
                  buildId: state.runningBuild,
                  onDrain: () => {
                    drains.push(binderBuildId);
                    state.runningBuild = null; // padi exited
                  },
                }),
          binderVersion: "1.1", // one contract throughout — the BUILD axis in isolation
          binderBuildId,
          buildDrainFence,
          log: silentLog,
        });
    };

    return { state, drains, binder };
  }

  it("each binder drains at most ONCE at its own boot — converges to last-booted, never flaps", async () => {
    const { state, drains, binder } = makeBuildCluster("build-X");
    const x = binder("build-X");
    const y = binder("build-Y");

    await y(); // Y boots over X's padi → drains X once, spawns build-Y
    expect(state.runningBuild).toBe("build-Y");
    expect(drains).toEqual(["build-Y"]);

    await x(); // X boots over Y's padi → drains Y once (X's first & only drain), spawns build-X
    expect(state.runningBuild).toBe("build-X");
    expect(drains).toEqual(["build-Y", "build-X"]);

    // Both fences now spent. Hammer both in every order: NO further drains, stable.
    for (let i = 0; i < 10; i++) {
      await x();
      await y();
      await y();
      await x();
    }
    expect(drains).toEqual(["build-Y", "build-X"]); // still exactly two — one per binder boot
    expect(state.runningBuild).toBe("build-X"); // stable (the last binder to fire its fence)
  });
});
