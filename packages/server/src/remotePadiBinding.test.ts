/**
 * `RemotePadiSession` unit — the ssh arm's adapter logic, WITHOUT ssh.
 *
 * The transport (provision · ssh · reconnect) is `@kolu/surface-nix-host`'s
 * `HostSession`, proven by its own tests; what THIS arm adds is the padi-specific
 * layer — the control-core `hello` handshake, skew refusal, scoping to
 * `.surface.padi`, identity readouts, and drain. So the "host" here is a hand-
 * driven fake `RemoteMirrorSession` (the same pattern `reServeSurface.test.ts`
 * uses): `setClient` mints a fresh client promise + fires `onState` (a spawn),
 * `drop` clears it (a link death). No process, no ssh, no nix.
 */

import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import type {
  ConnectionState,
  HostSessionState,
  RemoteMirrorSession,
} from "@kolu/surface-nix-host";
import type { AnyContractRouter } from "@orpc/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { createBuildDrainFence } from "@kolu/surface-daemon-supervisor";
import { RemotePadiSession, remotePadiHost } from "./remotePadiBinding.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

const BASE_STATE: HostSessionState = {
  connection: "connecting",
  progressLines: [],
  remoteProgressLines: [],
  lastError: null,
  failureCause: null,
};

let drainCalls = 0;

/** A fake padi COMBINED client: answers the frozen control core (`hello`/`drain`)
 *  and carries a `.surface.padi` marker so `scopePadiSurface` (which returns
 *  `{ surface: client.surface.padi }`) has something to scope to. */
function makeCombined(hello: {
  stateRoot: string;
  surfaceVersion: string;
  controlCoreVersion: string;
  startedAt: number;
  commit?: string;
}): unknown {
  return {
    surface: {
      control: {
        core: {
          hello: async () => hello,
          drain: async () => {
            drainCalls += 1;
          },
        },
      },
      padi: { marker: "padi-scoped" },
    },
  };
}

const helloOk = (
  over: Partial<{
    commit: string;
    startedAt: number;
    buildId: string;
    surfaceVersion: string;
  }> = {},
) => ({
  stateRoot: "/remote/.local/state/padi",
  surfaceVersion: over.surfaceVersion ?? PADI_SURFACE_VERSION,
  controlCoreVersion: "1.0",
  startedAt: over.startedAt ?? 1000,
  commit: over.commit ?? "abc1234",
  buildId: over.buildId ?? "build-base",
});

/** A fake combined client that MODELS the drain→exit: `drain()` flips the daemon
 *  "dead", after which `hello()` rejects — exactly the "link death" the real ssh
 *  leg produces when padi exits, so `drainAndAwaitClose`'s liveness poll returns.
 *  `alive: false` at the drain does NOT die (models a drain that did not take). */
function makeDrainable(
  hello: ReturnType<typeof helloOk>,
  opts: { diesOnDrain?: boolean; graceHellos?: number } = {},
): {
  client: unknown;
  drainCount: () => number;
} {
  const dies = opts.diesOnDrain ?? true;
  let grace = opts.graceHellos ?? 0;
  let drained = false;
  let drains = 0;
  return {
    drainCount: () => drains,
    client: {
      surface: {
        control: {
          core: {
            hello: async () => {
              // After the drain, a daemon that "dies" answers `graceHellos` MORE
              // times (modelling the ssh link taking several polls to tear down),
              // then rejects — so drainAndAwaitClose's multi-poll success loop and
              // its post-sleep boundary are exercised, not just synchronous death.
              if (drained && dies) {
                if (grace <= 0) throw new Error("link dead (padi exited)");
                grace -= 1;
              }
              return hello;
            },
            drain: async () => {
              drains += 1;
              drained = true;
            },
          },
        },
        padi: { marker: "padi-scoped" },
      },
    },
  };
}

/** A hand-driven `RemoteMirrorSession` standing in for the ssh `HostSession`. */
class FakeHost implements RemoteMirrorSession<AnyContractRouter> {
  private clientPromise: Promise<unknown> | null = null;
  private state: HostSessionState = BASE_STATE;
  private readonly listeners = new Set<(s: HostSessionState) => void>();
  destroyed = false;
  pinCount = 0;
  markConnectedCount = 0;

  /** A fresh spawn: a NEW client promise (so a cursor advances on identity) + a
   *  state fire. */
  setClient(client: unknown, connection: ConnectionState = "connected"): void {
    this.clientPromise = Promise.resolve(client);
    this.state = {
      ...this.state,
      connection,
      lastError: null,
      failureCause: null,
    };
    this.fire();
  }

  /** The link died: no client, a disconnected frame. */
  drop(): void {
    this.clientPromise = null;
    this.state = {
      ...this.state,
      connection: "disconnected",
      lastError: "link dropped",
      failureCause: "network",
    };
    this.fire();
  }

  pin(): Promise<unknown> {
    this.pinCount += 1;
    return this.clientPromise ?? Promise.reject(new Error("no client yet"));
  }
  currentClient(): Promise<unknown> | null {
    return this.destroyed ? null : this.clientPromise;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  onState(cb: (s: HostSessionState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state); // snapshot-then-delta, like HostSession.
    return () => {
      this.listeners.delete(cb);
    };
  }
  markConnected(): void {
    this.markConnectedCount += 1;
  }
  destroy(): void {
    this.destroyed = true;
    this.clientPromise = null;
    this.fire();
  }
  private fire(): void {
    for (const cb of [...this.listeners]) cb(this.state);
  }
}

const newSession = (): { host: FakeHost; rp: RemotePadiSession } => {
  const host = new FakeHost();
  // binderBuildId "" — an off-nix binder that never drains on build grounds — so
  // these handshake/scope/skew/reconnect cases ADOPT deterministically regardless of
  // the ambient PADI_BUILD_ID; the build-convergence path has its own describe below.
  const rp = new RemotePadiSession(
    host as RemoteMirrorSession<never>,
    "remote-e2e",
    { binderBuildId: "" },
  );
  return { host, rp };
};

beforeEach(() => {
  drainCalls = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RemotePadiSession — the ssh arm's handshake + scope + drain", () => {
  it("handshakes a fresh spawn, scopes to .surface.padi, and reads identity", async () => {
    const { host, rp } = newSession();
    host.setClient(
      makeCombined(helloOk({ commit: "deadbee", startedAt: 4242 })),
    );

    const client = (await rp.currentClient()) as { surface: unknown };
    // scopePadiSurface = { surface: combined.surface.padi } — the re-serve mirrors
    // `.surface.padi.<member>`, so the scoped client's surface IS padi's.
    expect(client.surface).toEqual({ marker: "padi-scoped" });

    // Identity is read off the control-core hello (the daemonInventory + rail cells).
    expect(rp.padiSurfaceVersion()).toBe(PADI_SURFACE_VERSION);
    expect(rp.padiBuildCommit()).toBe("deadbee");
    expect(rp.padiStartedAt()).toBe(4242);
  });

  it("refuses an incompatible padiSurface LOUDLY (skew) — rejects the client, degrades the cell, never a kill", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined({ ...helloOk(), surfaceVersion: "99.0" }));

    // The mirrored client REJECTS so the pump's cursor keeps waiting (no crash).
    await expect(rp.currentClient()).rejects.toThrow(/skew/i);

    // …and the connection cell reads a loud, honest degraded/remote frame — never a
    // silent "connected but empty".
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
    expect(rp.padiSurfaceVersion()).toBeNull();
  });

  it("drains the bound padi over the COMBINED control-core client (the restart verb)", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk()));
    await rp.currentClient();

    await rp.drainBoundPadi();
    expect(drainCalls).toBe(1);
  });

  it("throws on drain when unbound (no crash, an honest error)", async () => {
    const { rp } = newSession();
    await expect(rp.drainBoundPadi()).rejects.toThrow(/not bound/i);
  });

  it("re-handshakes a NEW spawn on reconnect, refreshing identity", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk({ commit: "aaa1111" })));
    await rp.currentClient();
    expect(rp.padiBuildCommit()).toBe("aaa1111");

    // Link drops: identity clears to the honest "unknown".
    host.drop();
    expect(rp.padiBuildCommit()).toBeNull();
    expect(rp.currentClient()).toBeNull();

    // A fresh spawn (a respawned/re-adopted padi) re-handshakes with fresh identity.
    host.setClient(makeCombined(helloOk({ commit: "bbb2222" })));
    await rp.currentClient();
    expect(rp.padiBuildCommit()).toBe("bbb2222");
  });

  it("advances currentClient identity per spawn, but stays STABLE within one (no cursor spin)", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk()));
    const a = rp.currentClient();
    const b = rp.currentClient();
    // Stable within a spawn — the memoized promise, so makeClientCursor keeps
    // waiting instead of busy-spinning on a fresh object each poll.
    expect(a).toBe(b);

    host.setClient(makeCombined(helloOk()));
    const c = rp.currentClient();
    // A genuinely new spawn → a new promise identity → the cursor advances.
    expect(c).not.toBe(a);
    await Promise.all([a, c]);
  });

  it("pin() kicks the host spawn; markConnected + destroy forward", () => {
    const { host, rp } = newSession();
    void rp.pin().catch(() => {});
    expect(host.pinCount).toBe(1);

    rp.markConnected();
    expect(host.markConnectedCount).toBe(1);

    rp.destroy();
    expect(host.destroyed).toBe(true);
    expect(rp.isDestroyed()).toBe(true);
    expect(rp.currentClient()).toBeNull();
  });
});

describe("RemotePadiSession — build/contract convergence at the remote bind (mirrors drainSupersededSurvivor, over ssh)", () => {
  // Inject a specific binder build id + a shared fence so the drain path runs without
  // two real nix builds — the same shape the local arm's bindPadiOnce is unit-tested at.
  const make = (
    deps: {
      binderBuildId?: string;
      binderVersion?: string;
      fence?: ReturnType<typeof createBuildDrainFence>;
    } = {},
  ) => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: deps.binderBuildId,
        binderVersion: deps.binderVersion,
        buildDrainFence: deps.fence,
        // Fast fail-fast window so a drain-that-doesn't-take test isn't slow.
        drainTeardownCeilingMs: 60,
        drainPollMs: 10,
      },
    );
    return { host, rp };
  };

  it("same build → ADOPTS, no drain", async () => {
    const { host, rp } = make({ binderBuildId: "build-X" });
    const c = makeDrainable(helloOk({ buildId: "build-X" }));
    host.setClient(c.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(c.drainCount()).toBe(0);
  });

  it("build MISMATCH → drains ONCE (fence fires), then adopts the respawned build", async () => {
    const fence = createBuildDrainFence();
    const { host, rp } = make({ binderBuildId: "build-NEW", fence });

    // Spawn 1 — the survivor is an OLD build. The mismatch drains + rejects (the pump
    // cursor waits), fence fires. This is the flagship #1670 redeploy, over ssh.
    const old = makeDrainable(helloOk({ buildId: "build-OLD" }));
    host.setClient(old.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(old.drainCount()).toBe(1);
    expect(fence.hasFired()).toBe(true);

    // Spawn 2 — the HostSession reconnect respawned THIS binder's build. Now it matches
    // → ADOPT, no second drain.
    const fresh = makeDrainable(helloOk({ buildId: "build-NEW" }));
    host.setClient(fresh.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(fresh.drainCount()).toBe(0);
  });

  it("ABSENT buildId (a pre-field survivor) → drains as an older build", async () => {
    const { host, rp } = make({ binderBuildId: "build-NEW" });
    // A hello with NO buildId field — `?? ""` folds it to "", which never equals the
    // binder's non-empty id, so it drains (a pre-field padi is an older build).
    const preField = makeDrainable({
      stateRoot: "/remote/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: "1.0",
      startedAt: 1000,
      commit: "abc",
    } as ReturnType<typeof helloOk>);
    host.setClient(preField.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(preField.drainCount()).toBe(1);
  });

  it("fence already fired → ADOPTS a mismatch (no re-drain — anti-livelock)", async () => {
    const fence = createBuildDrainFence();
    fence.markFired();
    const { host, rp } = make({ binderBuildId: "build-NEW", fence });
    const old = makeDrainable(helloOk({ buildId: "build-OLD" }));
    host.setClient(old.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(old.drainCount()).toBe(0);
  });

  it("off-nix binder (binderBuildId='') → never drains on build grounds", async () => {
    const { host, rp } = make({ binderBuildId: "" });
    const old = makeDrainable(helloOk({ buildId: "build-OLD" }));
    host.setClient(old.client);
    await rp.currentClient(); // adopts
    expect(old.drainCount()).toBe(0);
  });

  it("build-mismatch drain that does NOT take → ADOPTS the old build (degraded), fence spent, never a kill", async () => {
    const fence = createBuildDrainFence();
    const { host, rp } = make({ binderBuildId: "build-NEW", fence });
    // `diesOnDrain: false` — the daemon keeps answering after drain (the drain didn't
    // take). The fail-fast window elapses → ADOPT the old build, never a kill.
    const stubborn = makeDrainable(helloOk({ buildId: "build-OLD" }), {
      diesOnDrain: false,
    });
    host.setClient(stubborn.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(stubborn.drainCount()).toBe(1); // attempted once
    expect(fence.hasFired()).toBe(true); // fence spent even on failure — no re-drain
  });

  it("contract skew, binder NEWER → drains (newest-wins), never a fence", async () => {
    const { host, rp } = make({ binderVersion: "9.0", binderBuildId: "b" });
    const oldContract = makeDrainable(helloOk({ surfaceVersion: "1.1" }));
    host.setClient(oldContract.client);
    await expect(rp.currentClient()).rejects.toThrow(/newer contract/i);
    expect(oldContract.drainCount()).toBe(1);
  });

  it("marks the HostSession connected on a drain — resets its give-up budget so an INTENDED drain always respawns (never terminal 'failed')", async () => {
    // Regression: an intended drain REJECTS the mirrored client, so the pump never
    // folds a frame and never calls markConnected — leaving the drain-induced clean
    // child-exit classified as a bounded "remote" fault that, after prior failures,
    // tripped the HostSession's give-up gate to terminal 'failed' with no respawn. The
    // fix marks connected on the successful hello, BEFORE the drain.
    const { host, rp } = make({ binderBuildId: "build-NEW" });
    host.setClient(makeDrainable(helloOk({ buildId: "build-OLD" })).client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(host.markConnectedCount).toBeGreaterThanOrEqual(1);
  });

  it("contract skew, binder NEWER, drain does NOT take → REFUSES (degraded), never adopts an incompatible contract", async () => {
    const { host, rp } = make({ binderVersion: "9.0", binderBuildId: "b" });
    const stubborn = makeDrainable(helloOk({ surfaceVersion: "1.1" }), {
      diesOnDrain: false,
    });
    host.setClient(stubborn.client);
    await expect(rp.currentClient()).rejects.toThrow(/skew|refus/i);
    expect(stubborn.drainCount()).toBe(1); // attempted once, no kill
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
    expect(rp.padiSurfaceVersion()).toBeNull();
  });

  it("build-mismatch drain converges when the link takes SEVERAL polls to die (multi-poll success loop, not just synchronous death)", async () => {
    const fence = createBuildDrainFence();
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: "build-NEW",
        buildDrainFence: fence,
        drainTeardownCeilingMs: 500,
        drainPollMs: 10,
      },
    );
    // The daemon answers 4 more hellos after the drain, then dies — drainAndAwaitClose
    // must still return true (the drain took) rather than adopt the old build.
    const slow = makeDrainable(helloOk({ buildId: "build-OLD" }), {
      graceHellos: 4,
    });
    host.setClient(slow.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(slow.drainCount()).toBe(1);
    expect(fence.hasFired()).toBe(true);
  });
});

describe("remotePadiHost — the KOLU_PADI_HOST knob", () => {
  const prior = process.env.KOLU_PADI_HOST;

  it("is undefined when unset or blank (→ local arm)", () => {
    delete process.env.KOLU_PADI_HOST;
    expect(remotePadiHost()).toBeUndefined();
    process.env.KOLU_PADI_HOST = "   ";
    expect(remotePadiHost()).toBeUndefined();
    if (prior === undefined) delete process.env.KOLU_PADI_HOST;
    else process.env.KOLU_PADI_HOST = prior;
  });

  it("returns the trimmed host when set (→ remote arm)", () => {
    process.env.KOLU_PADI_HOST = "  nix@prod  ";
    expect(remotePadiHost()).toBe("nix@prod");
    if (prior === undefined) delete process.env.KOLU_PADI_HOST;
    else process.env.KOLU_PADI_HOST = prior;
  });
});
