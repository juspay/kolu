import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import { PADI_SURFACE_VERSION } from "@kolu/padi-client/surface";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  convergeAdmit,
  createConnectorDrainBudget,
  daemonBuild,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";
import {
  type ClosedInfo,
  type ConnectContext,
  ConnectError,
  type Connection,
  type SessionState,
  type SshProv,
} from "@kolu/surface-remote";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { padiConvergencePolicyForBinding } from "./padiConvergence.ts";
import { type PadiSession, padiFailureOf } from "./padiSession.ts";
import {
  composePadiExtraArgs,
  ensureRemotePadiBinding,
  generationBoundAdmitDrainPlugs,
  KOLU_PADI_HOST_ENV,
  parseKoluPadiHostSeed,
  type RemotePadiSessionDeps,
} from "./remotePadiBinding.ts";

const hoisted = vi.hoisted(() => ({
  nextConnector: null as
    | null
    | ((ctx: ConnectContext) => Promise<Connection<unknown>>),
}));
vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
  return {
    ...actual,
    sshConnector: () => (ctx: ConnectContext) => hoisted.nextConnector?.(ctx),
  };
});

type HelloOver = Partial<{
  surfaceVersion: string;
  startedAt: number;
  commit: string;
  buildId: string;
}>;

function helloVals(over: HelloOver = {}) {
  return {
    stateRoot: "/remote/.local/state/padi",
    surfaceVersion: over.surfaceVersion ?? PADI_SURFACE_VERSION,
    controlCoreVersion: "1.0",
    startedAt: over.startedAt ?? 1000,
    commit: over.commit ?? "abc1234",
    buildId: over.buildId ?? "build-base",
  } as {
    stateRoot: string;
    surfaceVersion: string;
    controlCoreVersion: string;
    startedAt: number;
    commit?: string;
    buildId?: string;
  };
}

type Hello = ReturnType<typeof helloVals>;

function servedIdentity(hello: Hello) {
  return {
    kind: "identified" as const,
    startedAt: hello.startedAt,
    baked: {
      contractVersion: hello.surfaceVersion,
      buildId: hello.buildId ?? "",
      commit:
        hello.commit && hello.commit !== ""
          ? { kind: "commit" as const, sha: hello.commit }
          : { kind: "dev" as const },
    },
  };
}

type PostDrainBehaviour =
  | { kind: "exits"; graceHellos: number }
  | { kind: "wedges" }
  | { kind: "keeps-serving" }
  | { kind: "link-lost"; closeKind: ClosedInfo["kind"] };

const EXITS_ON_DRAIN: PostDrainBehaviour = { kind: "exits", graceHellos: 0 };
const exitsAfterHellos = (graceHellos: number): PostDrainBehaviour => ({
  kind: "exits",
  graceHellos,
});

type ServeOpts = {
  helloGate?: Promise<void>;
  postDrain?: PostDrainBehaviour;
};
type SpawnSpec =
  | ({ kind: "serve"; hello: Hello } & ServeOpts)
  | { kind: "reject"; cause: "remote" | "network"; reason: string }
  | { kind: "gate-refused"; reason: string; anomaly: unknown }
  | { kind: "silent-peer" };

interface SpawnHandle {
  drainCount: number;
  kill: () => void;
}

const serve = (hello: Hello, opts: ServeOpts = {}): SpawnSpec => ({
  kind: "serve",
  hello,
  ...opts,
});

const sessions: PadiSession[] = [];

interface Arm {
  session: PadiSession;
  enqueue: (spec: SpawnSpec) => void;
  handles: SpawnHandle[];
  dialCount: () => number;
}

const PINGER_KILL_MS = 10_000;

function makeArm(deps: RemotePadiSessionDeps = {}): Arm {
  const queue: SpawnSpec[] = [];
  const handles: SpawnHandle[] = [];
  let dials = 0;

  hoisted.nextConnector = async (
    ctx: ConnectContext,
  ): Promise<Connection<unknown>> => {
    dials += 1;
    const spec = queue.shift();
    if (spec === undefined)
      throw new ConnectError("no more spawns queued (test)", "network");
    if (spec.kind === "reject") throw new ConnectError(spec.reason, spec.cause);
    if (spec.kind === "gate-refused") {
      throw new ConnectError(spec.reason, "remote", false, spec.anomaly);
    }
    if (spec.kind === "silent-peer") {
      let killSilent!: (info: ClosedInfo) => void;
      const silentClosed = new Promise<ClosedInfo>((r) => {
        killSilent = r;
      });
      setTimeout(
        () => killSilent({ kind: "transport-failed" }),
        PINGER_KILL_MS,
      );
      const mute = () => new Promise<never>(() => {});
      const silentHandlers: SurfaceHandlers = Object.assign(
        Object.create(null) as SurfaceHandlers,
        { "surface/control/core/hello": () => Effect.promise(mute) },
      );
      ctx.connecting();
      return {
        client: { surface: { control: { core: { hello: mute } } } },
        dispatch: directDispatch({ handlers: silentHandlers }),
        closed: silentClosed,
        isAlive: mute,
        teardown: () => killSilent({ kind: "transport-failed" }),
      };
    }

    const hello = spec.hello;
    const postDrain = spec.postDrain ?? EXITS_ON_DRAIN;
    let graceLeft = postDrain.kind === "exits" ? postDrain.graceHellos : 0;
    let drained = false;
    const handle: SpawnHandle = { drainCount: 0, kill: () => {} };
    handles.push(handle);

    const combined = {
      surface: {
        control: {
          core: {
            hello: async (): Promise<Hello> => {
              await spec.helloGate;
              if (!drained) return hello;
              if (postDrain.kind === "wedges")
                return new Promise<Hello>(() => {});
              if (postDrain.kind === "exits") {
                if (graceLeft <= 0) throw new Error("link dead (padi exited)");
                graceLeft -= 1;
              }
              return hello;
            },
            drain: async (): Promise<void> => {
              handle.drainCount += 1;
              drained = true;
              if (
                postDrain.kind === "wedges" ||
                postDrain.kind === "keeps-serving"
              )
                return;
              const graceMs =
                (postDrain.kind === "exits" ? postDrain.graceHellos : 0) * 20 +
                5;
              setTimeout(() => {
                if (postDrain.kind === "exits") {
                  resolveClosed({ kind: "exit", code: 0, signal: null });
                } else if (postDrain.closeKind === "spawn-error") {
                  resolveClosed({
                    kind: "spawn-error",
                    message: "spawn failed",
                  });
                } else if (postDrain.closeKind === "exit") {
                  resolveClosed({ kind: "exit", code: 0, signal: null });
                } else {
                  resolveClosed({ kind: postDrain.closeKind });
                }
              }, graceMs);
            },
          },
        },
        padi: {
          system: {
            identity: async () => servedIdentity(hello),
            clockNow: async () => ({ epochMs: Date.now() }),
          },
        },
      },
    };

    const fakeHandlers: SurfaceHandlers = Object.assign(
      Object.create(null) as SurfaceHandlers,
      {
        "surface/control/core/hello": () =>
          Effect.promise(() => combined.surface.control.core.hello()),
        "surface/control/core/drain": () =>
          Effect.promise(() => combined.surface.control.core.drain()),
        "surface/padi/system/identity": () =>
          Effect.promise(() => combined.surface.padi.system.identity()),
        "surface/padi/system/clockNow": () =>
          Effect.promise(() => combined.surface.padi.system.clockNow()),
      },
    );

    let resolveClosed!: (info: ClosedInfo) => void;
    const closed = new Promise<ClosedInfo>((r) => {
      resolveClosed = r;
    });
    handle.kill = () =>
      resolveClosed({ kind: "exit", code: null, signal: null });

    ctx.connecting();
    return {
      client: combined,
      dispatch: directDispatch({ handlers: fakeHandlers }),
      closed,
      isAlive: () =>
        combined.surface.control.core.hello().then(() => undefined),
      teardown: () => resolveClosed({ kind: "exit", code: null, signal: null }),
    };
  };

  const session = ensureRemotePadiBinding({ host: "rmt" }, deps);
  sessions.push(session);
  return {
    session,
    enqueue: (s) => queue.push(s),
    handles,
    dialCount: () => dials,
  };
}

function expectPadiScoped(scoped: unknown): void {
  const face = (scoped as { surface: Record<string, unknown> }).surface;
  expect(Object.keys(face)).toEqual(
    expect.arrayContaining(["lifecycle", "terminals", "system"]),
  );
  expect(face.core).toBeUndefined();
}

function down(
  s: SessionState<SshProv>,
): Extract<SessionState, { phase: "disconnected" | "failed" }> {
  if (s.phase !== "disconnected" && s.phase !== "failed") {
    throw new Error(`expected a DOWN session state, got phase=${s.phase}`);
  }
  return s;
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

const CEIL = 60;
const RECONNECT = 2600;

async function pinAdopt(session: PadiSession): Promise<unknown> {
  const p = session.pin();
  p.catch(() => {});
  await flush(CEIL);
  await flush();
  return await p;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.destroy();
  hoisted.nextConnector = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("remote padi arm — the ssh arm's handshake + scope + drain", () => {
  it("a post-hello superseded generation cannot fire a build-mismatch drain or produce a verdict", async () => {
    await Promise.resolve(helloVals({ buildId: "build-old" }));
    const generation = new AbortController();
    const fireDrain = vi.fn(() => {});
    const plugs = generationBoundAdmitDrainPlugs(generation.signal, {
      drain: Effect.sync(fireDrain),
      awaitExit: Effect.void,
    });
    generation.abort();

    const budget = createConnectorDrainBudget(
      padiConvergencePolicyForBinding({
        contractVersion: PADI_SURFACE_VERSION,
        binderBuildId: "build-current",
        maxBuildDrainsPerInstance: 1,
      }),
    );
    await expect(
      Effect.runPromise(
        convergeAdmit({
          running: {
            contractVersion: PADI_SURFACE_VERSION,
            build: daemonBuild("build-old"),
            instanceKey: instanceKeyFromStartedAt(1),
          },
          budget,
          drain: plugs.drain,
          awaitExit: plugs.awaitExit,
          ceilingMs: CEIL,
          log: collectLogger(() => {}),
        }),
      ),
    ).rejects.toThrow(/superseded/i);
    expect(fireDrain).not.toHaveBeenCalled();
  });

  it("handshakes a fresh spawn, scopes to .surface.padi, and reads identity", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ commit: "deadbee", startedAt: 4242 })));

    const scoped = await pinAdopt(session);
    expectPadiScoped(scoped);

    const id = session.identity();
    expect(id.kind).toBe("identified");
    if (id.kind !== "identified") throw new Error("expected identified");
    expect(id.baked.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(id.baked.commit).toEqual({ kind: "commit", sha: "deadbee" });
    expect(id.startedAt).toBe(4242);
    expect(session.convergence()).toBeNull();
  });

  it("refuses an incompatible padiSurface LOUDLY (skew) — WITHHOLDS the client, degrades the cell, never a kill", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ surfaceVersion: "99.0" })));

    const p = session.pin();
    p.catch(() => {});
    await flush();
    await expect(p).rejects.toThrow(/skew/i);
    await flush();

    const s = session.currentState();
    expect(s.phase).toBe("disconnected");
    expect(down(s).cause).toBe("remote");
    expect(session.identity().kind).toBe("disconnected");

    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /skew/i,
    );

    expect(session.convergence()?.kind).toBe("skew-refused");
    expect(session.convergence()?.detail).toMatch(/contract skew|refusing/i);

    expect(session.entryFailedDetail()).toMatchObject({
      cause: "contract-skew-refused",
      running: "99.0",
    });
  });

  it("a TERMINAL link failure (host unreachable / provisioning failed) surfaces as a standing link-failed state, canvas dead", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    for (let i = 0; i < 5; i++)
      enqueue({
        kind: "reject",
        cause: "remote",
        reason: "testhost: remote-store 'nix build' exited with code 1",
      });

    const p = session.pin();
    p.catch(() => {});
    await expect(p).rejects.toThrow(/nix build|exited with code/i);
    await flush(60_000);

    expect(session.currentState().phase).toBe("failed");
    expect(session.currentClient()).toBeNull();
    const conv = session.convergence();
    expect(conv?.kind).toBe("link-failed");
    expect(conv?.detail).toMatch(/nix build|exited with code/i);
    expect(session.entryFailedDetail()).toBeNull();
    const state = session.currentState();
    if (state.phase !== "failed") throw new Error("expected a failed session");
    expect(
      padiFailureOf(true, session.entryFailedDetail(), state),
    ).toMatchObject({ cause: "host-setup-failed" });
  });

  it("a gate REFUSAL counts as `remote`, goes terminal within the give-up budget, and stands up the typed epoch verdict", async () => {
    const anomaly = {
      kind: "unconverged",
      running: null,
      expected: {
        contractVersion: PADI_SURFACE_VERSION,
        build: { kind: "off-nix" },
      },
      cause: {
        kind: "unspeakable-protocol",
        socketPath: "/run/user/1000/padi-abc/padi.sock",
        gatePath: "/run/user/1000/padi-abc/padi.pid",
        pid: 25494,
      },
      detail:
        "the daemon at this rendezvous speaks a protocol epoch this supervisor cannot decode",
    };
    const { session, enqueue, dialCount } = makeArm({ binderBuildId: "" });
    for (let i = 0; i < 6; i++) {
      enqueue({
        kind: "gate-refused",
        reason:
          "padi on rmt: the peer refused to serve — this host's padi speaks a previous protocol epoch",
        anomaly,
      });
    }

    const p = session.pin();
    p.catch(() => {});
    await expect(p).rejects.toThrow(/previous protocol epoch/i);
    await flush(60_000);

    expect(session.currentState().phase).toBe("failed");
    expect(dialCount()).toBeLessThanOrEqual(5);
    expect(session.currentClient()).toBeNull();

    const conv = session.convergence();
    expect(conv?.kind).toBe("unconverged");
    expect(conv?.kind === "unconverged" && conv.cause).toMatchObject({
      kind: "unspeakable-protocol",
      pid: 25494,
    });

    expect(session.entryFailedDetail()).toMatchObject({
      cause: "previous-protocol-epoch",
    });
  });

  it("FALSIFIER: the PRE-FIX blind attach never goes terminal — a silent peer loops forever (the incident's signature)", async () => {
    const { session, enqueue, dialCount } = makeArm({ binderBuildId: "" });
    for (let i = 0; i < 20; i++) enqueue({ kind: "silent-peer" });
    const seenDownCauses = new Set<string>();
    session.onState((s) => {
      if (s.phase === "disconnected" || s.phase === "failed") {
        seenDownCauses.add(down(s).cause);
      }
    });

    const p = session.pin();
    p.catch(() => {});
    await flush(600_000);

    expect(session.currentState().phase).not.toBe("failed");
    expect(dialCount()).toBeGreaterThan(5);
    expect(seenDownCauses).toEqual(new Set(["network"]));
    expect(session.entryFailedDetail()).toBeNull();
  });

  it("P1: a fresh spawn under a STANDING link-failed does not float an unhandled handshake rejection (no fatal process.exit)", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    for (let i = 0; i < 5; i++)
      enqueue({
        kind: "reject",
        cause: "remote",
        reason: "provisioning failed",
      });
    enqueue(serve(helloVals({ surfaceVersion: "99.0" })));

    const p = session.pin();
    p.catch(() => {});
    await flush(60_000);
    expect(session.convergence()?.kind).toBe("link-failed");

    const rejections: unknown[] = [];
    const onUnhandled = (r: unknown): void => {
      rejections.push(r);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      session.reconnect();
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(rejections).toEqual([]);
  });

  it("drains the bound padi and WAITS for its exit (the restart verb) — resolves only once the link dies", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "",
      drainTeardownCeilingMs: 200,
    });
    enqueue(serve(helloVals()));
    await pinAdopt(session);

    const r = Effect.runPromise(session.renew());
    r.catch(() => {});
    await flush(200);
    await r;
    expect(handles[0]!.drainCount).toBe(1);
  });

  it("renew drains the current generation when a superseded admit settles late", async () => {
    let releaseFirstHello!: () => void;
    const firstHello = new Promise<void>((resolve) => {
      releaseFirstHello = resolve;
    });
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-current",
      drainTeardownCeilingMs: 200,
    });
    enqueue(
      serve(helloVals({ startedAt: 1, buildId: "build-old" }), {
        helloGate: firstHello,
      }),
    );

    const firstPin = session.pin();
    firstPin.catch(() => {});
    await flush();
    expect(handles).toHaveLength(1);

    enqueue(serve(helloVals({ startedAt: 2, buildId: "build-current" })));
    session.recheck();
    await flush(CEIL);
    await flush();
    expect(handles).toHaveLength(2);
    expect(session.currentState().phase).toBe("connected");

    releaseFirstHello();
    await flush();
    await expect(firstPin).rejects.toThrow(/superseded/i);

    const renewed = Effect.runPromise(session.renew());
    renewed.catch(() => {});
    await flush(200);
    await renewed;
    expect(handles.map((handle) => handle.drainCount)).toEqual([0, 1]);
  });

  it("renew() THROWS when the padi does not exit in the window (never a phantom success)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "",
      drainTeardownCeilingMs: 40,
    });
    enqueue(serve(helloVals(), { postDrain: { kind: "keeps-serving" } }));
    await pinAdopt(session);

    const r = Effect.runPromise(session.renew());
    r.catch(() => {});
    await flush(80);
    await expect(r).rejects.toThrow(/did not (complete|exit)/i);
    expect(handles[0]!.drainCount).toBe(1);
  });

  it("throws on drain when unbound (no crash, an honest error)", async () => {
    const { session } = makeArm({ binderBuildId: "" });
    await expect(Effect.runPromise(session.renew())).rejects.toThrow(
      /not bound|cannot drain/i,
    );
  });

  it("refuses to drain a padi it only REFUSED for a skew — honors the bind verdict, never downgrades it", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ surfaceVersion: "99.0" })));
    const p = session.pin();
    p.catch(() => {});
    await flush();
    await expect(p).rejects.toThrow(/skew/i);
    await flush();
    await expect(Effect.runPromise(session.renew())).rejects.toThrow(
      /not bound|cannot drain/i,
    );
  });

  it("re-handshakes a NEW spawn on reconnect, refreshing identity", async () => {
    const { session, enqueue, handles } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ commit: "aaa1111" })));
    await pinAdopt(session);
    const first = session.identity();
    if (first.kind !== "identified") throw new Error("expected identified");
    expect(first.baked.commit).toEqual({ kind: "commit", sha: "aaa1111" });

    handles[0]!.kill();
    await flush();
    expect(session.identity().kind).toBe("disconnected");
    expect(session.currentClient()).toBeNull();

    enqueue(serve(helloVals({ commit: "bbb2222" })));
    await flush(RECONNECT);
    await flush();
    const second = session.identity();
    if (second.kind !== "identified") throw new Error("expected identified");
    expect(second.baked.commit).toEqual({ kind: "commit", sha: "bbb2222" });
  });

  it("advances currentClient identity per spawn, but stays STABLE within one (no cursor spin)", async () => {
    const { session, enqueue, handles } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals()));
    await pinAdopt(session);
    const a = session.currentClient();
    const b = session.currentClient();
    expect(a).toBe(b);

    handles[0]!.kill();
    await flush();
    enqueue(serve(helloVals()));
    await flush(RECONNECT);
    await flush();
    const c = session.currentClient();
    expect(c).not.toBe(a);
    await Promise.all([a, c]);
  });

  it("pin() kicks a fresh spawn; markConnected + destroy forward", async () => {
    const { session, enqueue, handles } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals()));
    expect(handles.length).toBe(0);

    await pinAdopt(session);
    expect(handles.length).toBe(1);
    expect(session.currentState().phase).toBe("connected");

    session.markConnected();
    expect(session.currentState().phase).toBe("connected");

    session.destroy();
    expect(session.isDestroyed()).toBe(true);
    expect(session.currentClient()).toBeNull();
  });
});

describe("remote padi arm — build/contract convergence at the bind (over ssh)", () => {
  it("same build → ADOPTS, no drain", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-X",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-X" })));
    const scoped = await pinAdopt(session);
    expectPadiScoped(scoped);
    expect(handles[0]!.drainCount).toBe(0);
  });

  it("build MISMATCH → drains the survivor, then adopts the respawned build (fresh instance, matched build)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(handles[0]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ buildId: "build-NEW", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    expectPadiScoped(await session.currentClient());
    expect(handles[1]!.drainCount).toBe(0);
  });

  it("budget SURVIVES adopts: a drained build reappearing under a foreign instance is cross-supervisor (not a fresh drain)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(handles[0]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ buildId: "build-NEW", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    expectPadiScoped(await session.currentClient());
    expect(handles[1]!.drainCount).toBe(0);

    handles[1]!.kill();
    await flush();
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 3000 })));
    await flush(RECONNECT);
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /another supervisor|cross-supervisor|DIFFERENT instance/i,
    );
    expect(handles[2]!.drainCount).toBe(0);
    expect(session.convergence()?.kind).toBe("cross-supervisor");
    expect(session.entryFailedDetail()).toEqual({ cause: "cross-supervisor" });
  });

  it("a link BLIP misread as an exit → the SAME instance RE-DRAINS, then ADOPTS LOUDLY on budget exhaustion (M4)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      maxBuildDrainsPerInstance: 2,
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 5000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    expect(handles[0]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 5000 })));
    await flush(RECONNECT);
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(handles[1]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 5000 })));
    await flush(RECONNECT);
    await flush();
    const client = await session.currentClient();
    expect(client).toBeTruthy();
    expect(handles[2]!.drainCount).toBe(0);
    const conv = session.convergence();
    expect(conv?.kind).toBe("adopted-stale");
    if (conv?.kind === "adopted-stale") {
      expect(conv.running.build).toEqual({ kind: "known", id: "build-OLD" });
      expect(conv.expected.build).toEqual({ kind: "known", id: "build-NEW" });
    }
    expect(conv?.detail).toMatch(
      /flapping|will not converge|riding the resident/i,
    );
    expect(session.currentState().phase).toBe("connected");
    const id = session.identity();
    expect(id.kind === "identified" && id.baked.contractVersion).toBe(
      PADI_SURFACE_VERSION,
    );
  });

  it("D3: a DIFFERENT instance still build-mismatched after a drain → CROSS-SUPERVISOR fail-honest (another supervisor is fighting; stop, never ride a contested build)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    expect(handles[0]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /anti-livelock|respawning/i,
    );
    expect(handles[1]!.drainCount).toBe(0);
    expect(session.convergence()?.kind).toBe("cross-supervisor");
    expect(session.entryFailedDetail()).toEqual({ cause: "cross-supervisor" });
  });

  it("renew() restarts an ADOPTED-STALE resident (a live adopted daemon), not a false 'not bound' error", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      maxBuildDrainsPerInstance: 1,
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 7000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 7000 })));
    await flush(RECONNECT);
    await flush();
    await session.currentClient();
    expect(session.convergence()?.kind).toBe("adopted-stale");

    const r = Effect.runPromise(session.renew());
    r.catch(() => {});
    await flush(CEIL);
    await r;
    expect(handles[1]!.drainCount).toBe(1);
  });

  it("ABSENT identity pair (a pre-field survivor) → drains as an older build", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    const h = {
      ...helloVals({ startedAt: 1000 }),
      buildId: undefined,
      commit: undefined,
    };
    enqueue(serve(h));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(handles[0]!.drainCount).toBe(1);
  });

  it("off-nix binder (binderBuildId='') → never drains on build grounds", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD" })));
    await pinAdopt(session);
    expect(handles[0]!.drainCount).toBe(0);
  });

  it("build-mismatch drain that does NOT take (daemon keeps answering) → ADOPTS LOUDLY the resident, never a kill (M4)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), {
        postDrain: { kind: "keeps-serving" },
      }),
    );
    const client = await pinAdopt(session);
    expect(client).toBeTruthy();
    expect(handles[0]!.drainCount).toBe(1);
    const conv = session.convergence();
    expect(conv?.kind).toBe("adopted-stale");
    expect(conv?.detail).toMatch(/did not take|kept answering/i);
    expect(session.currentState().phase).toBe("connected");
  });

  it("F3: transport-failed ClosedInfo during drain is NOT process exit → drain-not-taken (real adapter)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
      maxBuildDrainsPerInstance: 1,
    });
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), {
        postDrain: { kind: "link-lost", closeKind: "transport-failed" },
      }),
    );
    const client = await pinAdopt(session);
    expect(client).toBeTruthy();
    expect(handles[0]!.drainCount).toBe(1);
    const conv = session.convergence();
    expect(conv?.kind).toBe("adopted-stale");
    if (conv?.kind === "adopted-stale") {
      expect(conv.detail).toMatch(/did not take|not take|kept answering/i);
    }
  });

  it("contract skew, binder NEWER → drains (newest-wins), instance-keyed bounded", async () => {
    const { session, enqueue, handles } = makeArm({
      binderVersion: "9.0",
      binderBuildId: "b",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ surfaceVersion: "1.1" })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/newer contract/i);
    expect(handles[0]!.drainCount).toBe(1);
  });

  it("P4: contract drain → respawn on a COMPATIBLE contract → ADOPTS (newest-wins convergence completes)", async () => {
    const { session, enqueue } = makeArm({
      binderVersion: "5.0",
      binderBuildId: "",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ surfaceVersion: "1.1", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/newer contract/i);

    enqueue(serve(helloVals({ surfaceVersion: "5.0", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    const client = await session.currentClient();
    expect(client).toBeTruthy();
    const id = session.identity();
    expect(id.kind === "identified" && id.baked.contractVersion).toBe("5.0");
    expect(session.convergence()).toBeNull();
  });

  it("D3: contract-skew TREADMILL — a DIFFERENT skewed instance after a drain → CROSS-SUPERVISOR fail-honest (anti-livelock), never drains forever (M1)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderVersion: "9.0",
      binderBuildId: "b",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ surfaceVersion: "1.1", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/newer contract/i);
    expect(handles[0]!.drainCount).toBe(1);

    enqueue(serve(helloVals({ surfaceVersion: "1.1", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /anti-livelock|treadmill|respawning/i,
    );
    expect(handles[1]!.drainCount).toBe(0);
    expect(session.convergence()?.kind).toBe("cross-supervisor");
    expect(session.entryFailedDetail()).toEqual({ cause: "cross-supervisor" });
  });

  it("an INTENDED drain resets the give-up budget — its disconnect is classified 'network', never the bounded 'remote'", async () => {
    const { session, enqueue } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(serve(helloVals({ buildId: "build-OLD" })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(down(session.currentState()).cause).toBe("network");
    expect(session.currentState().phase).not.toBe("failed");
  });

  it("contract skew, binder NEWER, drain does NOT take → degrades LOUDLY (unconverged), never adopts an incompatible contract", async () => {
    const { session, enqueue, handles } = makeArm({
      binderVersion: "9.0",
      binderBuildId: "b",
      drainTeardownCeilingMs: CEIL,
    });
    enqueue(
      serve(helloVals({ surfaceVersion: "1.1" }), {
        postDrain: { kind: "keeps-serving" },
      }),
    );
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/did not take|kept answering|skew/i);
    expect(handles[0]!.drainCount).toBe(1);
    await flush();
    const s = session.currentState();
    expect(s.phase).toBe("disconnected");
    expect(down(s).cause).toBe("remote");
    expect(session.identity().kind).toBe("disconnected");
    expect(session.convergence()?.kind).toBe("unconverged");
    expect(session.entryFailedDetail()).toEqual({ cause: "unconverged" });
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /did not take|kept answering|newer/i,
    );
  });

  it("PROJECTION INVARIANT: a plain TRANSIENT link drop (healthy bind that dropped) yields NO domain detail → null → warming", async () => {
    const { session, enqueue, handles } = makeArm({ binderBuildId: "build-X" });
    enqueue(serve(helloVals({ buildId: "build-X" })));
    await pinAdopt(session);
    expect(session.entryFailedDetail()).toBeNull();

    handles[0]!.kill();
    await flush();
    expect(session.currentState().phase).toBe("disconnected");
    expect(session.entryFailedDetail()).toBeNull();
  });

  it("stays BOUNDED when the post-drain liveness probe HANGS (a wedged link never blocks past the ceiling)", async () => {
    const { session, enqueue } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: 40,
    });
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), {
        postDrain: { kind: "wedges" },
      }),
    );
    const p = session.pin();
    p.catch(() => {});
    await flush(80);
    await flush();
    const client = await p;
    expect(client).toBeTruthy();
    expect(session.convergence()?.kind).toBe("adopted-stale");
    expect(session.convergence()?.detail).toMatch(
      /did not take|kept answering/i,
    );
  });

  it("build-mismatch drain converges when the link takes SEVERAL polls to die (multi-poll success loop)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: 500,
    });
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), {
        postDrain: exitsAfterHellos(4),
      }),
    );
    const p = session.pin();
    p.catch(() => {});
    await flush(500);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    expect(handles[0]!.drainCount).toBe(1);
  });
});

describe("composePadiExtraArgs (F2: the remote front never re-adds --stdio)", () => {
  it("passes --spawn-version through, and NEVER includes --stdio (host.ts already runs `padi --stdio`)", () => {
    const args = composePadiExtraArgs("1.2.3");
    expect(args).toEqual(["--spawn-version", "1.2.3"]);
    expect(args).not.toContain("--stdio");
  });

  it("is EMPTY when no spawn version is set — and still carries no --stdio", () => {
    expect(composePadiExtraArgs(null)).toEqual([]);
    expect(composePadiExtraArgs(undefined)).toEqual([]);
  });

  it("D3: forwards KOLU_REMOTE_PADI_STATE_DIR as --state-root so two kolus isolate their remote padis", () => {
    expect(composePadiExtraArgs("1.2.3", "/srv/kolu-a/padi")).toEqual([
      "--state-root",
      "/srv/kolu-a/padi",
      "--spawn-version",
      "1.2.3",
    ]);
    expect(composePadiExtraArgs("1.2.3", undefined)).toEqual([
      "--spawn-version",
      "1.2.3",
    ]);
    expect(composePadiExtraArgs(null, "")).toEqual([]);
  });
});

describe("KOLU_PADI_HOST seed parse (W4 the switch)", () => {
  const priorSeed = process.env[KOLU_PADI_HOST_ENV];
  afterEach(() => {
    if (priorSeed === undefined) delete process.env[KOLU_PADI_HOST_ENV];
    else process.env[KOLU_PADI_HOST_ENV] = priorSeed;
  });

  it("env unset → the lone LOCAL_HOST default (pixel-identical single-host)", () => {
    delete process.env[KOLU_PADI_HOST_ENV];
    expect(parseKoluPadiHostSeed()).toEqual([LOCAL_HOST]);
  });

  it("keeps valid remotes, order-preserved after the local head", () => {
    process.env[KOLU_PADI_HOST_ENV] = "srid@zest, srid@pu";
    expect(parseKoluPadiHostSeed()).toEqual([
      LOCAL_HOST,
      { kind: "remote", target: "srid@zest" },
      { kind: "remote", target: "srid@pu" },
    ]);
  });

  it("a seed entry that would have been a reserved channel name is now just an honest remote (the reject retired)", () => {
    process.env[KOLU_PADI_HOST_ENV] = "srid@zest,keys,srid@pu";
    const seed = parseKoluPadiHostSeed();
    expect(seed).toEqual([
      LOCAL_HOST,
      { kind: "remote", target: "srid@zest" },
      { kind: "remote", target: "keys" },
      { kind: "remote", target: "srid@pu" },
    ]);
  });
});
