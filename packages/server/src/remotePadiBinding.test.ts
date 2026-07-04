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
import { describe, expect, it } from "vitest";
import { RemotePadiSession, remotePadiHost } from "./remotePadiBinding.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

const BASE_STATE: HostSessionState = {
  connection: "connecting",
  progressLines: [],
  remoteProgressLines: [],
  lastError: null,
  failureCause: null,
};

/** A fake padi COMBINED client: answers the frozen control core (`hello`/`drain`)
 *  and carries a `.surface.padi` marker so `scopePadiSurface` (which returns
 *  `{ surface: client.surface.padi }`) has something to scope to. Its `hello` NEVER
 *  rejects (a live daemon), so the drain-and-await-close poll never sees an exit — a
 *  handshake/scope/skew fixture, not a drain one (the drain paths use
 *  {@link makeDrainable}, which models the link death). */
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
          drain: async () => {},
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

    // M2: a STANDING skew must yield a NULL client on subsequent live-client reads — NOT
    // the rejected memo hammered forever. `readPadiMemoryOnce` (index.ts) polls off
    // `currentClient()` every 5s; over a still-up transport a rejected-through-live client
    // would spam 'poll failed' + log.error, where the LOCAL arm (which nulls its client)
    // reports honest 'absent'. currentClient() must match that: null, not a rejected promise.
    expect(rp.currentClient()).toBeNull();
  });

  it("drains the bound padi and WAITS for its exit (the restart verb) — resolves only once the link dies", async () => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: "", // off-nix → adopt on bind, no build drain
        drainTeardownCeilingMs: 200,
        drainPollMs: 10,
      },
    );
    const d = makeDrainable(helloOk()); // dies on drain (graceHellos 0)
    host.setClient(d.client);
    await rp.currentClient(); // adopt → bound
    await rp.drainBoundPadi(); // resolves only after the modelled link death
    expect(d.drainCount()).toBe(1);
  });

  it("drainBoundPadi THROWS when the padi does not exit in the window (never a phantom success)", async () => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: "",
        drainTeardownCeilingMs: 40,
        drainPollMs: 10,
      },
    );
    // The daemon keeps answering after drain (the drain did not take) — the fail-fast
    // window elapses and the restart verb THROWS rather than reporting a success that
    // did not happen. Never a kill.
    const stubborn = makeDrainable(helloOk(), { diesOnDrain: false });
    host.setClient(stubborn.client);
    await rp.currentClient();
    await expect(rp.drainBoundPadi()).rejects.toThrow(
      /did not (complete|exit)/i,
    );
    expect(stubborn.drainCount()).toBe(1); // attempted once, no kill
  });

  it("throws on drain when unbound (no crash, an honest error)", async () => {
    const { rp } = newSession();
    await expect(rp.drainBoundPadi()).rejects.toThrow(/not bound/i);
  });

  it("refuses to drain a padi it only REFUSED for a skew — honors the bind verdict, never downgrades it", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined({ ...helloOk(), surfaceVersion: "99.0" }));
    await expect(rp.currentClient()).rejects.toThrow(/skew/i);
    // The restart verb must NOT reach the raw host client for a padi we never adopted:
    // an older binder draining a refused newer padi would DOWNGRADE it (anti-monotonic).
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
  // Inject a specific binder build id so the drain path runs without two real nix
  // builds — the same shape the local arm's bindPadiOnce is unit-tested at. The build
  // fence is now keyed by daemon INSTANCE (startedAt), not a global boolean, so tests
  // drive convergence with the survivor's startedAt + a small per-instance budget.
  const make = (
    deps: {
      binderBuildId?: string;
      binderVersion?: string;
      maxBuildDrains?: number;
    } = {},
  ) => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: deps.binderBuildId,
        binderVersion: deps.binderVersion,
        maxBuildDrainsPerInstance: deps.maxBuildDrains,
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

  it("build MISMATCH → drains the survivor, then adopts the respawned build (fresh instance, matched build)", async () => {
    const { host, rp } = make({ binderBuildId: "build-NEW" });

    // Spawn 1 — the survivor is an OLD build (instance startedAt 1000). The mismatch
    // drains + rejects (the pump cursor waits) to reconnect. This is the flagship #1670
    // redeploy, over ssh.
    const old = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 1000 }),
    );
    host.setClient(old.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(old.drainCount()).toBe(1);

    // Spawn 2 — the drain TOOK: the HostSession reconnect respawned a FRESH instance
    // (startedAt 2000) running THIS binder's build. It matches → ADOPT, no second drain.
    const fresh = makeDrainable(
      helloOk({ buildId: "build-NEW", startedAt: 2000 }),
    );
    host.setClient(fresh.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(fresh.drainCount()).toBe(0);
  });

  it("reset-on-adopt: adopting a matched build CLEARS the instance tracker, so a LATER mismatch drains AFRESH (the drain budget resets across a genuine converge)", async () => {
    // Pins `this.drainedInstance = null; this.drainAttempts = 0` on the ADOPT path
    // (the matched-build branch of handshakeAndScope). Without that reset, the tracker
    // would still hold the FIRST drained instance after a genuine converge, and a later,
    // unrelated build change would be misread as a two-supervisor treadmill (a DIFFERENT
    // instance still wrong "this boot") and degrade LOUDLY instead of draining — turning
    // a normal redeploy into a wedged canvas.
    const { host, rp } = make({ binderBuildId: "build-NEW" });

    // 1. A build-MISMATCH survivor (instance startedAt 1000, build-OLD) → drain took →
    //    reject to reconnect. Tracker now: drainedInstance=1000, drainAttempts=1.
    const old = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 1000 }),
    );
    host.setClient(old.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(old.drainCount()).toBe(1);

    // 2. The reconnect brings up a MATCHED build (build-NEW, a fresh instance) → ADOPT.
    //    Reaching the matched build proves the earlier drain genuinely took, so the adopt
    //    path CLEARS the tracker (drainedInstance=null, drainAttempts=0) — the reset.
    const matched = makeDrainable(
      helloOk({ buildId: "build-NEW", startedAt: 2000 }),
    );
    host.setClient(matched.client);
    const scoped = (await rp.currentClient()) as { surface: unknown };
    expect(scoped.surface).toEqual({ marker: "padi-scoped" });
    expect(matched.drainCount()).toBe(0);

    // 3. LATER a NEW mismatched instance appears (startedAt 3000, build-OLD again) — e.g. a
    //    subsequent redeploy or a transient old survivor. BECAUSE the tracker was cleared on
    //    adopt, this is a FRESH convergence: it must DRAIN AFRESH (drainCount 1, /build
    //    mismatch/), NOT trip anti-livelock as a "different instance still wrong this boot".
    //    A missing reset would instead throw /anti-livelock/ with drainCount 0 here.
    const laterOld = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 3000 }),
    );
    host.setClient(laterOld.client);
    await expect(rp.currentClient()).rejects.toThrow(/build mismatch/i);
    expect(laterOld.drainCount()).toBe(1);
  });

  it("a link BLIP misread as an exit → the SAME instance RE-DRAINS (never a silent stale adopt), then degrades LOUDLY on budget exhaustion", async () => {
    // Over ssh a `hello()` rejection during the post-drain poll can be a transient LINK
    // BLIP, not a daemon exit — the daemon survives and the reconnect re-adopts the SAME
    // instance (same startedAt). A global once-per-boot fence would have "spent" on the
    // first blip and then SILENTLY ADOPTED THE STALE BUILD FOREVER (the bug this guards).
    // The instance-keyed fence must instead re-drain the same never-exited instance, and
    // on budget exhaustion degrade LOUDLY — never adopt the stale build.
    const { host, rp } = make({
      binderBuildId: "build-NEW",
      maxBuildDrains: 2,
    });

    // Blip 1: survivor is build-OLD, instance startedAt 5000. drain → hello rejects (the
    // blip reads as "took") → the binder throws to reconnect. Drained once, NOT adopted.
    const blip1 = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 5000 }),
    );
    host.setClient(blip1.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(blip1.drainCount()).toBe(1);

    // The daemon SURVIVED the blip: the reconnect re-adopts the SAME instance (startedAt
    // 5000), still build-OLD. It must RE-DRAIN (never adopt the stale build).
    const blip2 = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 5000 }),
    );
    host.setClient(blip2.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(blip2.drainCount()).toBe(1); // re-drained the SAME instance, not adopted

    // Budget (2) exhausted for instance 5000: the SAME instance again → LOUD degraded
    // (unconverged), REJECTS, never a silent stale adopt, never a pointless re-drain.
    const blip3 = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 5000 }),
    );
    host.setClient(blip3.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /flapping|will not converge/i,
    );
    expect(blip3.drainCount()).toBe(0);
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
    expect(rp.padiSurfaceVersion()).toBeNull();
  });

  it("a DIFFERENT instance still build-mismatched after a drain → degrades LOUDLY (anti-livelock), never treadmills", async () => {
    const { host, rp } = make({ binderBuildId: "build-NEW" });
    // Drain instance 1000 (build-OLD) → throw to reconnect.
    const first = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 1000 }),
    );
    host.setClient(first.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(first.drainCount()).toBe(1);
    // The reconnect brings up a DIFFERENT instance (startedAt 2000) STILL build-OLD — two
    // supervisors, or the absent-id dev loop. Do NOT treadmill: degrade LOUDLY, no drain.
    const different = makeDrainable(
      helloOk({ buildId: "build-OLD", startedAt: 2000 }),
    );
    host.setClient(different.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /anti-livelock|treadmill/i,
    );
    expect(different.drainCount()).toBe(0); // never drained the fresh mismatched instance
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

  it("off-nix binder (binderBuildId='') → never drains on build grounds", async () => {
    const { host, rp } = make({ binderBuildId: "" });
    const old = makeDrainable(helloOk({ buildId: "build-OLD" }));
    host.setClient(old.client);
    await rp.currentClient(); // adopts
    expect(old.drainCount()).toBe(0);
  });

  it("build-mismatch drain that does NOT take (daemon keeps answering) → degrades LOUDLY (unconverged), never a silent stale adopt, never a kill", async () => {
    const { host, rp } = make({ binderBuildId: "build-NEW" });
    // `diesOnDrain: false` — the daemon keeps answering after drain (the drain didn't
    // take). The fail-fast window elapses → LOUD degraded (unconverged, REJECTS), NOT a
    // silent adopt of the stale build, never a kill.
    const stubborn = makeDrainable(helloOk({ buildId: "build-OLD" }), {
      diesOnDrain: false,
    });
    host.setClient(stubborn.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /did not take|kept answering/i,
    );
    expect(stubborn.drainCount()).toBe(1); // attempted once, no kill
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
  });

  it("contract skew, binder NEWER → drains (newest-wins), instance-keyed bounded", async () => {
    const { host, rp } = make({ binderVersion: "9.0", binderBuildId: "b" });
    const oldContract = makeDrainable(helloOk({ surfaceVersion: "1.1" }));
    host.setClient(oldContract.client);
    await expect(rp.currentClient()).rejects.toThrow(/newer contract/i);
    expect(oldContract.drainCount()).toBe(1);
  });

  it("contract-skew TREADMILL: a DIFFERENT skewed instance after a drain → degrades LOUDLY (anti-livelock), never drains forever (M1)", async () => {
    // The remote host's OWN older kolu-server respawns its old-contract padi after each
    // of our drains — a two-supervisor treadmill. Before M1 the contract axis had no
    // bound, and markConnected-on-hello resets the give-up budget every cycle, so it would
    // drain forever. The shared admitDrain must catch the FRESH skewed instance and go
    // loud-terminal unconverged, never a kill, never an endless treadmill.
    const { host, rp } = make({ binderVersion: "9.0", binderBuildId: "b" });
    // Drain instance 1000 (old contract 1.1) → took → reconnect.
    const first = makeDrainable(
      helloOk({ surfaceVersion: "1.1", startedAt: 1000 }),
    );
    host.setClient(first.client);
    await expect(rp.currentClient()).rejects.toThrow(/newer contract/i);
    expect(first.drainCount()).toBe(1);
    // Reconnect brings up a DIFFERENT instance (startedAt 2000), STILL old contract — the
    // remote supervisor respawned it. Do NOT re-drain: LOUD terminal unconverged.
    const different = makeDrainable(
      helloOk({ surfaceVersion: "1.1", startedAt: 2000 }),
    );
    host.setClient(different.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /anti-livelock|treadmill/i,
    );
    expect(different.drainCount()).toBe(0); // never drained the fresh skewed instance
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

  it("contract skew, binder NEWER, drain does NOT take → degrades LOUDLY (unconverged), never adopts an incompatible contract", async () => {
    const { host, rp } = make({ binderVersion: "9.0", binderBuildId: "b" });
    const stubborn = makeDrainable(helloOk({ surfaceVersion: "1.1" }), {
      diesOnDrain: false,
    });
    host.setClient(stubborn.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /did not take|kept answering|skew/i,
    );
    expect(stubborn.drainCount()).toBe(1); // attempted once, no kill
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
    expect(rp.padiSurfaceVersion()).toBeNull();
  });

  it("stays BOUNDED when the post-drain liveness probe HANGS (a wedged link never blocks past the ceiling)", async () => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: "build-NEW",
        drainTeardownCeilingMs: 40,
        drainPollMs: 10,
      },
    );
    // After the drain the daemon's `hello` NEVER settles — a wedged ssh link that
    // neither answers nor rejects. A bare `await hello()` would hang the whole handshake
    // forever; the per-probe ceiling race must instead give up within the window and
    // ADOPT the old build (degraded), never a hang, never a kill.
    let drained = false;
    const wedged = {
      surface: {
        control: {
          core: {
            hello: async () =>
              drained
                ? new Promise(() => {}) // hang forever (link wedged post-drain)
                : helloOk({ buildId: "build-OLD" }),
            drain: async () => {
              drained = true;
            },
          },
        },
        padi: { marker: "padi-scoped" },
      },
    };
    host.setClient(wedged);
    // Build mismatch → drain → the probe hangs → the ceiling elapses → did-not-take →
    // degrade LOUDLY (unconverged, REJECTS), never a silent adopt. The `rejects`
    // RESOLVING at all is the bound-ceiling proof (an unbounded probe would time out the
    // test).
    await expect(rp.currentClient()).rejects.toThrow(
      /did not take|kept answering/i,
    );
  });

  it("build-mismatch drain converges when the link takes SEVERAL polls to die (multi-poll success loop, not just synchronous death)", async () => {
    const host = new FakeHost();
    const rp = new RemotePadiSession(
      host as RemoteMirrorSession<never>,
      "rmt",
      {
        binderBuildId: "build-NEW",
        drainTeardownCeilingMs: 500,
        drainPollMs: 10,
      },
    );
    // The daemon answers 4 more hellos after the drain, then dies — drainAndAwaitClose
    // must still detect the exit ("took" → throw to reconnect) rather than time out.
    const slow = makeDrainable(helloOk({ buildId: "build-OLD" }), {
      graceHellos: 4,
    });
    host.setClient(slow.client);
    await expect(rp.currentClient()).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(slow.drainCount()).toBe(1);
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
