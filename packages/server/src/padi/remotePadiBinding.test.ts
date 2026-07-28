/**
 * The ssh arm's adapter logic — the control-core `hello` handshake, skew/build
 * convergence (`decide` + the instance-keyed drain fence + adopt-loudly), scoping to
 * `.surface.padi`, identity, and the drain — WITHOUT a real ssh hop.
 *
 * Post-S9 there is no `RemotePadiSession` class: the arm is
 * `makeSession({ connectOnce: sshConnector({ binary: "padi" }), admit: padiAdmit })`
 * plus the daemon-supervision spread. So the transport is mocked at the ssh seam —
 * `sshConnector` is replaced (via `vi.mock` of `@kolu/surface-remote`) with a fake
 * connector that hands the loop a fake PADI DAEMON client per (re)dial, exactly the way
 * `recheck.test.ts` / `liveness.test.ts` mock the child. Everything ELSE — the real
 * `makeSession` reconnect loop, the real `admit` hook, the real `decide()` table — runs
 * unmocked, and the tests drive it through the public {@link PadiSession} API:
 *   - `pin()` / `currentClient()` — a fresh spawn's scoped client, or a WITHHELD
 *     (rejected) client on a refuse/drain (the pump cursor waits on it);
 *   - `convergence()` — the standing anomaly (skew-refused / adopted-stale / unconverged
 *     / link-failed), or null when healthy;
 *   - `identity()` — the null-free identity sum read off padi's `system.identity`
 *     (replacing the deleted `padiStartedAt`/`padiSurfaceVersion`/`padiBuildCommit`);
 *   - `renew()` — the drain (replacing `drainBoundPadi`);
 *   - `onState()` — the connection cell.
 *
 * The fake daemon client answers the frozen control core (`hello`/`drain`) and carries a
 * `.surface.padi` sibling (with a `system.identity`) so `scopePadiSurface` + the base
 * session's identity poll work. Skew/build-mismatch is driven by VARYING the hello's
 * `surfaceVersion`/`buildId`/`startedAt`; a drain's link-death is modelled by `hello()`
 * rejecting AFTER `drain()`. Injected {@link RemotePadiSessionDeps} (small
 * `maxBuildDrainsPerInstance`, short ceilings, explicit `binderVersion`/`binderBuildId`)
 * reach the drain/adopt-stale/unconverged paths with no real build.
 *
 * NOTE (mechanism vs outcome): a few OLD assertions read internals the class exposed
 * (`markConnectedCount`, a nulled `currentClient()` on a standing skew). The refactor
 * preserves the OUTCOME through makeSession: a refused/unconverged bind WITHHOLDS the
 * client as a REJECTED promise (the cursor still waits — the pump never folds it), and an
 * intended drain resets the give-up budget by classifying its disconnect `"network"`
 * (never `"remote"`). Those assertions are re-expressed against the new observation, not
 * weakened.
 */

import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import {
  type ClosedInfo,
  type ConnectContext,
  ConnectError,
  type Connection,
  type SessionState,
  type SshProv,
} from "@kolu/surface-remote";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PadiSession } from "./padiSession.ts";
import {
  composePadiExtraArgs,
  ensureRemotePadiBinding,
  KOLU_PADI_HOST_ENV,
  parseKoluPadiHostSeed,
  type RemotePadiSessionDeps,
} from "./remotePadiBinding.ts";

// ── Mock the ssh transport ONLY ──────────────────────────────────────────────
// Replace `sshConnector` with a fake connector the per-test harness drives; keep the
// rest of `@kolu/surface-remote` (the REAL `makeSession` loop, `ConnectError`, …)
// intact via `importOriginal`. This is the ssh seam the arm layers padi's admit over —
// mocking it is the exact analog of `recheck`/`liveness` mocking `node:child_process`.
const hoisted = vi.hoisted(() => ({
  nextConnector: null as
    | null
    | ((ctx: ConnectContext) => Promise<Connection<unknown>>),
}));
vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
  return {
    ...actual,
    // Ignore the ssh opts; delegate to the harness's queue-driven connector.
    sshConnector: () => (ctx: ConnectContext) => hoisted.nextConnector?.(ctx),
  };
});

// ── The fake PADI daemon client + its per-spawn handle ───────────────────────

type HelloOver = Partial<{
  surfaceVersion: string;
  startedAt: number;
  commit: string;
  buildId: string;
}>;

/** A control-core `hello` payload — the wire the admit reads (surfaceVersion / startedAt
 *  / buildId drive skew + build convergence; commit rides identity). */
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

/** The reserved `system.identity` the fake padi surface serves — derived from the SAME
 *  hello so identity() and the convergence hello stay consistent (padi always DECLARES
 *  its build → `identified`). */
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

/** A spawn the connector hands out: a served daemon (its hello + drain behaviour) or a
 *  connector-level rejection (a provision/ssh failure). */
type ServeOpts = {
  /** Drain kills the link (default true). `false` = a wedged daemon that keeps answering
   *  after the drain (the drain did not take). */
  diesOnDrain?: boolean;
  /** Answer this many MORE hellos after the drain before dying (a link that takes several
   *  polls to tear down). */
  graceHellos?: number;
  /** After the drain, `hello()` HANGS forever (a wedged post-drain link the per-probe
   *  ceiling race must bound). */
  wedgeAfterDrain?: boolean;
  /**
   * ClosedInfo kind resolved when the drain "kills" the link (default `"exit"`).
   * F3: `transport-failed` models ssh link loss — must NOT count as process exit,
   * so the process oracle stays unsettled and the ceiling yields drain-not-taken.
   */
  closeKind?: ClosedInfo["kind"];
};
type SpawnSpec =
  | ({ kind: "serve"; hello: Hello } & ServeOpts)
  | { kind: "reject"; cause: "remote" | "network"; reason: string };

interface SpawnHandle {
  /** How many times THIS spawn's `drain()` was invoked. */
  drainCount: number;
  /** Model a link death (a respawn/re-adopt trigger) by resolving this spawn's `closed`. */
  kill: () => void;
}

const serve = (hello: Hello, opts: ServeOpts = {}): SpawnSpec => ({
  kind: "serve",
  hello,
  ...opts,
});

// ── The harness ──────────────────────────────────────────────────────────────

const sessions: PadiSession[] = [];

interface Arm {
  session: PadiSession;
  /** Queue a spawn the connector hands out on the next (re)dial. */
  enqueue: (spec: SpawnSpec) => void;
  /** The per-spawn handles, in dial order. */
  handles: SpawnHandle[];
}

function makeArm(deps: RemotePadiSessionDeps = {}): Arm {
  const queue: SpawnSpec[] = [];
  const handles: SpawnHandle[] = [];

  hoisted.nextConnector = async (
    ctx: ConnectContext,
  ): Promise<Connection<unknown>> => {
    const spec = queue.shift();
    if (spec === undefined)
      throw new ConnectError("no more spawns queued (test)", "network");
    if (spec.kind === "reject") throw new ConnectError(spec.reason, spec.cause);

    const hello = spec.hello;
    const dies = spec.diesOnDrain ?? true;
    let grace = spec.graceHellos ?? 0;
    let drained = false;
    const handle: SpawnHandle = { drainCount: 0, kill: () => {} };
    handles.push(handle);

    // The COMBINED daemon client `sshConnector` yields — the frozen control core plus a
    // `.surface.padi` sibling (scoped by `scopePadiSurface`; its `system.identity` feeds
    // the base session's identity poll).
    const combined = {
      surface: {
        control: {
          core: {
            hello: async (): Promise<Hello> => {
              if (drained && spec.wedgeAfterDrain)
                return new Promise<Hello>(() => {}); // wedged: never settles
              if (drained && dies) {
                if (grace <= 0) throw new Error("link dead (padi exited)");
                grace -= 1;
              }
              return hello;
            },
            drain: async (): Promise<void> => {
              handle.drainCount += 1;
              drained = true;
              // F3 process oracle: resolve `closed` after grace window when the
              // drain "kills" the link (diesOnDrain) OR when a test injects an
              // explicit closeKind (e.g. transport-failed while hello still
              // answers — link loss ≠ process exit).
              const closeKind = spec.closeKind;
              if ((!dies && closeKind === undefined) || spec.wedgeAfterDrain) {
                return;
              }
              const graceMs = (spec.graceHellos ?? 0) * 20 + 5;
              const kind = closeKind ?? "exit";
              setTimeout(() => {
                if (kind === "exit") {
                  resolveClosed({ kind: "exit", code: 0, signal: null });
                } else if (kind === "spawn-error") {
                  resolveClosed({
                    kind: "spawn-error",
                    message: "spawn failed",
                  });
                } else {
                  resolveClosed({ kind });
                }
              }, graceMs);
            },
          },
        },
        padi: {
          marker: "padi-scoped",
          // The framework-reserved `system.*` members the padi-scoped session client
          // probes: `identity` (the identity poll) and `clockNow` (the clock-offset
          // poll `makeSession` fires at admit) — real padi auto-answers both via
          // `implementSurface`; mirrored here so both probes succeed like production.
          system: {
            identity: async () => servedIdentity(hello),
            clockNow: async () => ({ epochMs: Date.now() }),
          },
        },
      },
    };

    let resolveClosed!: (info: ClosedInfo) => void;
    const closed = new Promise<ClosedInfo>((r) => {
      resolveClosed = r;
    });
    handle.kill = () =>
      resolveClosed({ kind: "exit", code: null, signal: null });

    ctx.connecting();
    return {
      client: combined,
      closed,
      isAlive: () =>
        combined.surface.control.core.hello().then(() => undefined),
      teardown: () => resolveClosed({ kind: "exit", code: null, signal: null }),
    };
  };

  const session = ensureRemotePadiBinding({ host: "rmt" }, deps);
  sessions.push(session);
  return { session, enqueue: (s) => queue.push(s), handles };
}

/** Narrow a `SessionState` snapshot to its DOWN arm (`disconnected`/`failed`) —
 *  the UP arm carries no `error`/`cause` fields at all, so a test that expects a
 *  down state asserts it here rather than reading a field that doesn't exist on a
 *  live/warming snapshot. */
function down(
  s: SessionState<SshProv>,
): Extract<SessionState, { phase: "disconnected" | "failed" }> {
  if (s.phase !== "disconnected" && s.phase !== "failed") {
    throw new Error(`expected a DOWN session state, got phase=${s.phase}`);
  }
  return s;
}

/** Advance fake timers by `ms` and drain microtasks — runs the admit handshake, the
 *  drain poll loop, the identity poll, and (with a large enough `ms`) a reconnect. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

// Ceilings small enough that a single `flush(CEIL)` covers a drain but not the 2s
// makeSession reconnect backoff. `RECONNECT` steps past that backoff → the next (re)dial.
const CEIL = 60;
const RECONNECT = 2600;

/** Pin a session that is expected to ADOPT (possibly after a drain that did not take),
 *  advance past the drain ceiling + the identity poll, and return the scoped client. */
async function pinAdopt(session: PadiSession): Promise<{
  surface: { marker?: string };
}> {
  const p = session.pin();
  p.catch(() => {});
  await flush(CEIL);
  await flush();
  return (await p) as { surface: { marker?: string } };
}

// ── Setup ────────────────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("remote padi arm — the ssh arm's handshake + scope + drain", () => {
  it("handshakes a fresh spawn, scopes to .surface.padi, and reads identity", async () => {
    // Off-nix binder ("") never drains on build grounds → a compatible contract ADOPTS
    // deterministically regardless of the survivor's buildId.
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ commit: "deadbee", startedAt: 4242 })));

    const scoped = await pinAdopt(session);
    // scopePadiSurface = { surface: combined.surface.padi } — the scoped client's
    // `.surface` IS padi's sibling (the re-serve mirrors `.surface.padi.<member>`).
    expect(scoped.surface.marker).toBe("padi-scoped");

    // Identity graduates to the base `identity()` off padi's `system.identity` (the old
    // padiSurfaceVersion / padiBuildCommit / padiStartedAt readouts, now one sum).
    const id = session.identity();
    expect(id.kind).toBe("identified");
    if (id.kind !== "identified") throw new Error("expected identified");
    expect(id.baked.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(id.baked.commit).toEqual({ kind: "commit", sha: "deadbee" });
    expect(id.startedAt).toBe(4242);
    // Healthy bind → no standing anomaly.
    expect(session.convergence()).toBeNull();
  });

  it("refuses an incompatible padiSurface LOUDLY (skew) — WITHHOLDS the client, degrades the cell, never a kill", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ surfaceVersion: "99.0" })));

    const p = session.pin();
    p.catch(() => {});
    await flush();
    // The mirrored client REJECTS so the pump's cursor keeps waiting (no crash).
    await expect(p).rejects.toThrow(/skew/i);
    await flush();

    // The connection cell reads a loud, honest degraded/remote frame.
    const s = session.currentState();
    expect(s.phase).toBe("disconnected");
    expect(down(s).cause).toBe("remote");
    // Identity is the honest `disconnected` arm (nothing adopted) — the old
    // padiSurfaceVersion()===null.
    expect(session.identity().kind).toBe("disconnected");

    // M2: a STANDING skew WITHHOLDS the live client — the base session keeps the client
    // promise REJECTED (the cursor waits; the pump never folds a rejected client), which
    // is how makeSession expresses the old class's nulled `currentClient()`.
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /skew/i,
    );

    // …and the reason is a STANDING, surfaced convergence state so the Padi dialog shows WHY.
    expect(session.convergence()?.kind).toBe("skew-refused");
    expect(session.convergence()?.detail).toMatch(/contract skew|refusing/i);

    // THE PROJECTION INVARIANT (`@kolu/surface-map`'s `projectStatus` discriminates the
    // `disconnected` arm on cause-specificity): a REFUSE verdict sets a SPECIFIC domain
    // cause on the DOWN state — so the standing refuse projects to `failed` + card, never
    // masked as a transient `warming`. D2's typed running/expected pair rides along.
    expect(session.entryFailedDetail()).toMatchObject({
      cause: "contract-skew-refused",
      running: "99.0",
    });
  });

  it("a TERMINAL link failure (host unreachable / provisioning failed) surfaces as a standing link-failed state, canvas dead", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    // The connector rejects every dial (remote-store `nix build` provisioning failed) → after the bounded
    // give-up budget the session goes terminal `failed`.
    for (let i = 0; i < 5; i++)
      enqueue({
        kind: "reject",
        cause: "remote",
        reason: "testhost: remote-store 'nix build' exited with code 1",
      });

    const p = session.pin();
    p.catch(() => {});
    await expect(p).rejects.toThrow(/nix build|exited with code/i);
    // Walk the exponential backoff (2s+4s+8s+16s) to the give-up.
    await flush(60_000);

    expect(session.currentState().phase).toBe("failed");
    // No live client (canvas dead) — currentClient is null (honest absent).
    expect(session.currentClient()).toBeNull();
    // …but the REASON is a standing, surfaced convergence state.
    const conv = session.convergence();
    expect(conv?.kind).toBe("link-failed");
    expect(conv?.detail).toMatch(/nix build|exited with code/i);
  });

  it("P1: a fresh spawn under a STANDING link-failed does not float an unhandled handshake rejection (no fatal process.exit)", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    for (let i = 0; i < 5; i++)
      enqueue({
        kind: "reject",
        cause: "remote",
        reason: "provisioning failed",
      });
    // The post-failed re-arm brings up a REFUSED skew — its handshake rejects.
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
      // Re-arm the failed session with a NEW spawn that will be REFUSED. makeSession's
      // reconnect path attaches its own `.catch` to the launched attempt, so the refused
      // handshake's rejection must NOT float (else index.ts's unhandledRejection handler
      // process.exit(1)s the whole server).
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
      binderBuildId: "", // off-nix → adopt on bind, no build drain
      drainTeardownCeilingMs: 200,
    });
    enqueue(serve(helloVals())); // dies on drain (graceHellos 0)
    await pinAdopt(session); // adopt → bound

    const r = session.renew();
    r.catch(() => {});
    await flush(200);
    await r; // resolves only after the modelled link death
    expect(handles[0]!.drainCount).toBe(1);
  });

  it("renew() THROWS when the padi does not exit in the window (never a phantom success)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "",
      drainTeardownCeilingMs: 40,
    });
    // The daemon keeps answering after drain (the drain did not take) — the fail-fast
    // window elapses and the restart verb THROWS. Never a kill.
    enqueue(serve(helloVals(), { diesOnDrain: false }));
    await pinAdopt(session);

    const r = session.renew();
    r.catch(() => {});
    await flush(80);
    await expect(r).rejects.toThrow(/did not (complete|exit)/i);
    expect(handles[0]!.drainCount).toBe(1); // attempted once, no kill
  });

  it("throws on drain when unbound (no crash, an honest error)", async () => {
    const { session } = makeArm({ binderBuildId: "" });
    // Never pinned → no combined client → renew throws honestly (the arm's message is
    // "not bound — cannot drain", the new spelling of the old "no adopted daemon").
    await expect(session.renew()).rejects.toThrow(/not bound|cannot drain/i);
  });

  it("refuses to drain a padi it only REFUSED for a skew — honors the bind verdict, never downgrades it", async () => {
    const { session, enqueue } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ surfaceVersion: "99.0" })));
    const p = session.pin();
    p.catch(() => {});
    await flush();
    await expect(p).rejects.toThrow(/skew/i);
    await flush(); // let the disconnect frame null `combined`
    // The restart verb must NOT reach the raw host client for a padi we never adopted —
    // an older binder draining a refused newer padi would DOWNGRADE it (anti-monotonic).
    await expect(session.renew()).rejects.toThrow(/not bound|cannot drain/i);
  });

  it("re-handshakes a NEW spawn on reconnect, refreshing identity", async () => {
    const { session, enqueue, handles } = makeArm({ binderBuildId: "" });
    enqueue(serve(helloVals({ commit: "aaa1111" })));
    await pinAdopt(session);
    const first = session.identity();
    if (first.kind !== "identified") throw new Error("expected identified");
    expect(first.baked.commit).toEqual({ kind: "commit", sha: "aaa1111" });

    // Link drops: identity clears to the honest `disconnected`, no live client.
    handles[0]!.kill();
    await flush();
    expect(session.identity().kind).toBe("disconnected");
    expect(session.currentClient()).toBeNull();

    // A fresh spawn (a respawned / re-adopted padi) re-handshakes with fresh identity.
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
    // Stable within a spawn — the memoized promise, so a cursor keeps waiting instead of
    // busy-spinning on a fresh object each poll.
    expect(a).toBe(b);

    // A genuinely new spawn (drop → reconnect → re-adopt) → a new promise identity.
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
    expect(handles.length).toBe(0); // nothing dialed until pinned

    await pinAdopt(session);
    expect(handles.length).toBe(1); // pin kicked exactly one spawn
    expect(session.currentState().phase).toBe("connected");

    session.markConnected(); // idempotent — a second mark is a no-op
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
    expect(scoped.surface.marker).toBe("padi-scoped");
    expect(handles[0]!.drainCount).toBe(0);
  });

  it("build MISMATCH → drains the survivor, then adopts the respawned build (fresh instance, matched build)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    // Spawn 1 — an OLD build (instance 1000). The mismatch DRAINS + rejects (the cursor
    // waits) to reconnect. The flagship #1670 redeploy, over ssh.
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(handles[0]!.drainCount).toBe(1);

    // Spawn 2 — the drain TOOK: the reconnect respawned a FRESH instance (2000) running
    // THIS binder's build. It matches → ADOPT, no second drain.
    enqueue(serve(helloVals({ buildId: "build-NEW", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    const scoped = (await session.currentClient()) as {
      surface: { marker?: string };
    };
    expect(scoped.surface.marker).toBe("padi-scoped");
    expect(handles[1]!.drainCount).toBe(0);
  });

  it("budget SURVIVES adopts: a drained build reappearing under a foreign instance is cross-supervisor (not a fresh drain)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    // 1. build-MISMATCH survivor (1000, build-OLD) → drain took → reject. Budget remembers
    //    the drained (build-OLD, 1000) lineage.
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch/i);
    expect(handles[0]!.drainCount).toBe(1);

    // 2. reconnect brings up a MATCHED build (2000) → ADOPT. Budget is NOT reset
    //    (survives adopts — the old reset-on-adopt wiped the memory needed to notice
    //    a cross-supervisor fight).
    enqueue(serve(helloVals({ buildId: "build-NEW", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    const scoped = (await session.currentClient()) as {
      surface: { marker?: string };
    };
    expect(scoped.surface.marker).toBe("padi-scoped");
    expect(handles[1]!.drainCount).toBe(0);

    // 3. LATER a NEW instance of the ALREADY-DRAINED build-OLD appears (3000). That is
    //    another supervisor respawning the old build → cross-supervisor, NOT a fresh
    //    drain (drainCount stays 0).
    handles[1]!.kill(); // the matched build's link drops → reconnect
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
    // Blip 1: build-OLD, instance 5000. drain → reconnect. Drained once, NOT adopted.
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 5000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    expect(handles[0]!.drainCount).toBe(1);

    // The daemon SURVIVED the blip: reconnect re-adopts the SAME instance (5000), still
    // build-OLD → RE-DRAIN (never adopt the stale build).
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 5000 })));
    await flush(RECONNECT);
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /build mismatch|link death/i,
    );
    expect(handles[1]!.drainCount).toBe(1);

    // Budget (2) exhausted for instance 5000: the SAME instance again → ADOPT-LOUDLY the
    // resident build (canvas WORKS), never a pointless re-drain.
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
    expect(session.currentState().phase).toBe("connected"); // canvas alive
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

    // reconnect brings up a DIFFERENT instance (2000) STILL build-OLD — another supervisor
    // is respawning its OWN build (the remote twin of the local supervisor.pid war). D3:
    // STOP + fail-honest with the TYPED `cross-supervisor` cause, never ADOPT the contested
    // build (the build we'd ride is the loser of a race). No fresh drain; the host goes down
    // and the Skew-UX card offers [Switch to local] / isolate via KOLU_REMOTE_PADI_STATE_DIR.
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /anti-livelock|respawning/i,
    );
    expect(handles[1]!.drainCount).toBe(0);
    // Parked under the `unconverged` convergence banner, but the TYPED map cause is
    // `cross-supervisor` (the dedicated flag wins over `unconverged` in the detail hook).
    expect(session.convergence()?.kind).toBe("cross-supervisor");
    expect(session.entryFailedDetail()).toEqual({ cause: "cross-supervisor" });
  });

  it("renew() restarts an ADOPTED-STALE resident (a live adopted daemon), not a false 'not bound' error", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      maxBuildDrainsPerInstance: 1,
      drainTeardownCeilingMs: CEIL,
    });
    // Reach adopted-stale via BUDGET exhaustion (a flapping SAME instance — a link blip, NOT
    // a cross-supervisor fight): drain 7000 once, the blip reconnects the SAME 7000 still
    // mismatched → budget (1) spent → adopt-stale the resident (a LIVE daemon).
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 7000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/build mismatch|link death/i);
    enqueue(serve(helloVals({ buildId: "build-OLD", startedAt: 7000 })));
    await flush(RECONNECT);
    await flush();
    await session.currentClient(); // adopts-stale the resident (a LIVE daemon)
    expect(session.convergence()?.kind).toBe("adopted-stale");

    // Restart the resident: renew must DRAIN it (it exits), not reject "not bound" —
    // adopted-stale is a live adopted daemon.
    const r = session.renew();
    r.catch(() => {});
    await flush(CEIL);
    await r;
    expect(handles[1]!.drainCount).toBe(1);
  });

  it("ABSENT buildId (a pre-field survivor) → drains as an older build", async () => {
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
    });
    // A hello with NO buildId field (`undefined`) — `?? ""` folds it to off-nix, which
    // never matches the binder's known id, so it drains (a pre-field padi is an older
    // build). Omit it via override rather than `delete` (noDelete).
    const h = { ...helloVals({ startedAt: 1000 }), buildId: undefined };
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
    // `diesOnDrain: false` — the daemon keeps answering after drain (a wedged link). The
    // fail-fast window elapses → could not drain-replace, so ADOPT LOUDLY, never a kill.
    enqueue(serve(helloVals({ buildId: "build-OLD" }), { diesOnDrain: false }));
    const client = await pinAdopt(session);
    expect(client).toBeTruthy();
    expect(handles[0]!.drainCount).toBe(1); // attempted once, no kill
    const conv = session.convergence();
    expect(conv?.kind).toBe("adopted-stale");
    expect(conv?.detail).toMatch(/did not take|kept answering/i);
    expect(session.currentState().phase).toBe("connected"); // canvas stays live
  });

  it("F3: transport-failed ClosedInfo during drain is NOT process exit → drain-not-taken (real adapter)", async () => {
    // Drives the REAL remotePadiBinding awaitExitViaProcessOracle over conn.closed
    // (not a synthetic awaitExit). On drain, closed resolves as transport-failed
    // while hello still answers — link loss must NOT count as process exit; the
    // process oracle stays unsettled until the ceiling → drain-not-taken → adopt-stale.
    const { session, enqueue, handles } = makeArm({
      binderBuildId: "build-NEW",
      drainTeardownCeilingMs: CEIL,
      maxBuildDrainsPerInstance: 1,
    });
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), {
        // Keep answering hello (not process death); inject transport-failed close.
        diesOnDrain: false,
        closeKind: "transport-failed",
      }),
    );
    const client = await pinAdopt(session);
    expect(client).toBeTruthy();
    expect(handles[0]!.drainCount).toBe(1);
    const conv = session.convergence();
    // Must NOT have been treated as successful process exit → replaced.
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
      binderBuildId: "", // isolate the CONTRACT axis (off-nix never build-drains)
      drainTeardownCeilingMs: CEIL,
    });
    // An OLD-contract survivor → binder newer → DRAIN (took) → reconnect.
    enqueue(serve(helloVals({ surfaceVersion: "1.1", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/newer contract/i);

    // reconnect brings up this binder's OWN (compatible) contract → ADOPT, converged.
    enqueue(serve(helloVals({ surfaceVersion: "5.0", startedAt: 2000 })));
    await flush(RECONNECT);
    await flush();
    const client = await session.currentClient();
    expect(client).toBeTruthy();
    const id = session.identity();
    expect(id.kind === "identified" && id.baked.contractVersion).toBe("5.0");
    expect(session.convergence()).toBeNull(); // healthy — no degraded banner
  });

  it("D3: contract-skew TREADMILL — a DIFFERENT skewed instance after a drain → CROSS-SUPERVISOR fail-honest (anti-livelock), never drains forever (M1)", async () => {
    const { session, enqueue, handles } = makeArm({
      binderVersion: "9.0",
      binderBuildId: "b",
      drainTeardownCeilingMs: CEIL,
    });
    // Drain instance 1000 (old contract 1.1) → took → reconnect.
    enqueue(serve(helloVals({ surfaceVersion: "1.1", startedAt: 1000 })));
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/newer contract/i);
    expect(handles[0]!.drainCount).toBe(1);

    // reconnect brings up a DIFFERENT instance (2000), STILL old contract — another
    // supervisor is respawning it. Do NOT re-drain: STOP + fail-honest with the TYPED
    // `cross-supervisor` cause (framework anomaly arm). The isolation
    // lever is KOLU_REMOTE_PADI_STATE_DIR; the client card offers [Switch to local].
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
    // The OLD arm marked the HostSession connected BEFORE a drain to reset the give-up
    // budget so a deliberate drain-exit isn't counted a connect failure. makeSession
    // preserves the OUTCOME differently: a `replaced` (drain) disconnect carries
    // failureCause "network" — and network failures are NEVER terminal — so an intended
    // drain treadmill can never trip the bounded give-up gate to `failed`.
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
      serve(helloVals({ surfaceVersion: "1.1" }), { diesOnDrain: false }),
    );
    const p = session.pin();
    p.catch(() => {});
    await flush(CEIL);
    await expect(p).rejects.toThrow(/did not take|kept answering|skew/i);
    expect(handles[0]!.drainCount).toBe(1); // attempted once, no kill
    await flush();
    const s = session.currentState();
    expect(s.phase).toBe("disconnected");
    expect(down(s).cause).toBe("remote");
    expect(session.identity().kind).toBe("disconnected");
    // Surfaced as a standing `unconverged` state (NOT adopted — an incompatible contract
    // can't be ridden, unlike a build mismatch).
    expect(session.convergence()?.kind).toBe("unconverged");
    // THE PROJECTION INVARIANT: `unconverged` is a REFUSE, so it sets a SPECIFIC cause on
    // the down state (→ `failed` + card, never masked as warming).
    expect(session.entryFailedDetail()).toEqual({ cause: "unconverged" });
    // The client is WITHHELD (rejected) on subsequent live-client reads (like skew).
    await expect(session.currentClient() as Promise<unknown>).rejects.toThrow(
      /did not take|kept answering|newer/i,
    );
  });

  it("PROJECTION INVARIANT: a plain TRANSIENT link drop (healthy bind that dropped) yields NO domain detail → null → warming", async () => {
    // The other half of the invariant the failure projection rides on: a link that
    // dropped WITHOUT a refuse verdict has no standing failure, so `entryFailedDetail()`
    // returns `null`. On a still-retrying `disconnected` state `padiFailureOf` projects
    // that `null` straight through (the single-meaning absent, PR4), and `serveHostMap`
    // reads the absent failure as RETRIABLE warming (coming back up), never a masked-
    // standing `failed`. (A terminal give-up is the OTHER case — `padiFailureOf` floors
    // it to `link-failed` off the transport reason; see `padiSession.test.ts`.)
    const { session, enqueue, handles } = makeArm({ binderBuildId: "build-X" });
    enqueue(serve(helloVals({ buildId: "build-X" }))); // same build → clean ADOPT
    await pinAdopt(session);
    expect(session.entryFailedDetail()).toBeNull(); // connected, nothing to classify

    // The link drops (a transient network blip — no skew, no cross-supervisor, no drv
    // fault). The healthy bind's convergence clears to null → no domain cause.
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
    // After the drain the daemon's `hello` NEVER settles — a wedged ssh link. The per-probe
    // ceiling race must give up within the window and ADOPT the old build (degraded).
    enqueue(
      serve(helloVals({ buildId: "build-OLD" }), { wedgeAfterDrain: true }),
    );
    const p = session.pin();
    p.catch(() => {});
    await flush(80);
    await flush();
    // `currentClient()` RESOLVING at all (to a live client) is the bound-ceiling proof.
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
    // The daemon answers 4 more hellos after the drain, then dies — drainAndAwaitClose must
    // still detect the exit ("took" → reconnect) rather than time out.
    enqueue(serve(helloVals({ buildId: "build-OLD" }), { graceHellos: 4 }));
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
    // The primary defense against a remote cross-supervisor war: a per-kolu remote
    // state-root → distinct digest → distinct socket → no shared padi to fight over.
    expect(composePadiExtraArgs("1.2.3", "/srv/kolu-a/padi")).toEqual([
      "--state-root",
      "/srv/kolu-a/padi",
      "--spawn-version",
      "1.2.3",
    ]);
    // Unset / empty → omitted (single-kolu common case: the remote padi picks its own default).
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
    // `HostKey` is a nominal sum now, not an in-band string a bad value could collide
    // with — every remote's encoded form is `remote:<target>`, which can never equal a
    // reserved collection channel suffix (`keys`/`deltas`) — so there is nothing left to
    // reject. `parseHostInput` is total: every token seeds cleanly.
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
