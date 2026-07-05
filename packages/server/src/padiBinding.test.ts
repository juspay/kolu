/**
 * The W2.2 CUTOVER acceptance gate — kolu-server's padi BINDER end-to-end.
 *
 * `ensurePadiBinding` spawns a REAL padi process from source (under a private
 * state-root + a shared temp `$XDG_RUNTIME_DIR`, `KOLU_KAVAL_SPAWN=detached`, the
 * nix-shell whitelist, and scrubbed `INVOCATION_ID`/`KOLU_STATE_DIR`/
 * `KOLU_PADI_BIN`), handshakes its frozen control core, and produces the
 * reconnect-mirror session `reServeSurface` consumes. This test proves:
 *
 *   1. **boot + re-serve + router splice** — the re-served `padiSurface`, spliced
 *      under the `padi` key of the host router (via `buildAppRouter`, the real
 *      assembly path), round-trips a terminal end-to-end: dial `/surface/padi/*`
 *      → `lifecycle.create` → `terminalAttach` (a snapshot frame) → `sendInput`
 *      → `screen.state` shows the echoed output. This is the empirical proof that
 *      the splice routes at `/surface/padi/<member>` with NO `surface/surface`
 *      double-prefix (gotcha 3).
 *   2. **reconnect** — kill the bound padi; the `PadiBindingSession` drives
 *      `adoptOrSpawnOrRefuse` again (re-adopts the surviving kaval, or spawns
 *      fresh), the pump rebinds a FRESH client, and the SAME re-served surface
 *      round-trips a terminal again.
 *
 * Every padi + its detached kaval is reaped (SIGKILL via the gate files).
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "@kolu/padi/stateRoot";
import {
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  padiSurface,
} from "@kolu/padi/surface";
import {
  converge,
  createBuildDrainFence,
  createEndpoint,
} from "@kolu/surface-daemon-supervisor";
import { reServeSurface } from "@kolu/surface-nix-host";
import { createRouterClient } from "@orpc/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// `connectPadi` moved into the shared dial kit in W2.3; the supervision it feeds
// (bind/drain convergence, drivers, the reconnect session) stays in the binder.
import { connectPadi } from "@kolu/padi/dial";
import {
  ensurePadiBinding,
  localPadiDriver,
  PADI_HOST_ID,
  PadiBindingSession,
  type PadiBindingSessionDeps,
  resolvePadiLaunch,
} from "./padiBinding.ts";
// padi's convergence declaration + probe moved to `./padiConvergence.ts` in L6.
import {
  PADI_CONVERGENCE_POLICY,
  probePadiForConvergence,
} from "./padiConvergence.ts";
import { buildAppRouter } from "./router.ts";

/** A silent structural logger for the in-test endpoint + the newer-binder bind
 *  (the drain path logs at info/warn/error; the test keeps stdout clean). */
const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// tsx must resolve so the spawned padi (and its kaval) launch from source.
createRequire(import.meta.url).resolve("tsx");

// Isolate every padi under ONE temp runtime root: a distinct state-root (→ distinct
// digest) is the only thing separating two bindings. Saved + restored file-local.
const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "padi-bind-rt-"));
const prior: Record<string, string | undefined> = {};
const CLEARED = [
  "INVOCATION_ID", // force the driver's DETACHED path (no systemd-run)
  "KOLU_PADI_BIN", // force from-source launch
  "KOLU_STATE_DIR", // never run padi's one-shot legacy import against a real config
  "KOLU_PADI_SPAWN",
] as const;

beforeAll(() => {
  for (const k of ["XDG_RUNTIME_DIR", "KOLU_KAVAL_SPAWN", ...CLEARED] as const)
    prior[k] = process.env[k];
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
  process.env.KOLU_KAVAL_SPAWN = "detached"; // padi's kaval detaches (survives padi restarts)
  for (const k of CLEARED) delete process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "padi-bind-sr-"));

/** The pid a gate file records (decimal text), or undefined if unreadable. */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

const activeSessions: PadiBindingSession[] = [];
const activeStateRoots = new Set<string>();

/** SIGKILL the CURRENT padi (its gate may point at a respawned one) AND its
 *  detached kaval, given a binding's state-root. */
function reap(stateRoot: string): void {
  const padiGate = padiGatePath(padiSocketPath(stateRoot));
  const kavalGate = join(dirname(padiKavalSocketPath(stateRoot)), "kaval.pid");
  for (const g of [padiGate, kavalGate]) {
    const pid = gatePid(g);
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

afterEach(async () => {
  // Stop every reconnect loop BEFORE reaping, else the loop respawns padi after
  // we kill it. Then SIGKILL the current padi + its kaval.
  for (const s of activeSessions.splice(0)) s.destroy();
  await sleep(50);
  for (const sr of [...activeStateRoots]) reap(sr);
  activeStateRoots.clear();
});

/** Boot a binding + re-serve, and dial it through the REAL host-router splice
 *  (`buildAppRouter` → `directLink`), so calls land at `/surface/padi/<member>`. */
async function bootReServedPadi(stateRoot: string): Promise<{
  session: PadiBindingSession;
  // biome-ignore lint/suspicious/noExplicitAny: the dialed client is walked structurally in the round-trip helper.
  padi: any;
}> {
  activeStateRoots.add(stateRoot);
  const session = await ensurePadiBinding({
    stateRoot,
    nixShellWhitelist: "default", // the test runs inside the nix devshell
    reconnectDelayMs: 400, // snappy reconnect for the kill test
  });
  activeSessions.push(session);

  const reServed = reServeSurface<
    typeof padiSurface.spec,
    typeof padiSurface.contract
  >({
    source: padiSurface,
    policy: PADI_FORWARDING_POLICY,
    // `PadiBindingSession implements RemoteMirrorSession<…>`, so it plugs in with
    // no cast — the contract param is pinned explicitly (as in index.ts) because
    // it isn't reverse-inferable from the concrete class value.
    session,
    log: () => {},
  });
  // Never let `done` float; a clean session.destroy() resolves it.
  void reServed.done.catch(() => {});

  // Splice the re-serve's inner surface under `padi`, then assemble the host router
  // exactly as `index.ts` does — proving the splice routes at `/surface/padi/*`.
  const surfaceRouter = {
    surface: {
      padi: (reServed.router as { surface: Record<string, unknown> }).surface,
    },
  };
  const appRouter = buildAppRouter({
    surfaceRouter,
    drainBoundPadi: () => session.drainBoundPadi(),
  });
  // `directLink` internally; drive the assembled router in-process and walk it
  // structurally (`surface.padi.<member>`).
  const client = createRouterClient(
    appRouter as Parameters<typeof createRouterClient>[0],
    // biome-ignore lint/suspicious/noExplicitAny: test dials the assembled router structurally (surface.padi.*).
  ) as any;
  return { session, padi: client.surface.padi };
}

/** Round-trip a fresh terminal THROUGH the re-served surface: create (retry until
 *  the pump has bound the live upstream), attach (a snapshot frame), drive it, and
 *  read the echo back off `screen.state`. */
// biome-ignore lint/suspicious/noExplicitAny: `padi` is the structurally-dialed re-served client.
async function roundTripTerminal(padi: any, mark: string): Promise<void> {
  // The pump binds `liveProcedures` a tick after the session reports connected;
  // a create in that gap throws "no live upstream link" — retry until it binds.
  let id: string | undefined;
  for (let i = 0; i < 200 && id === undefined; i++) {
    try {
      ({ id } = await padi.lifecycle.create({ cwd: makeStateRoot() }));
    } catch {
      await sleep(100);
    }
  }
  if (id === undefined)
    throw new Error("re-served lifecycle.create never bound");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  // terminalAttach is a DELTA member — its first frame is the snapshot, forwarded
  // 1:1 through the re-serve's fail-through relay.
  const attach = (await padi.terminalAttach.get({ id }))[
    Symbol.asyncIterator
  ]();
  const first = await attach.next();
  expect(typeof first.value).toBe("string");
  await attach.return?.();

  await padi.lifecycle.sendInput({ id, data: `echo ${mark}\r` });
  let screen = "";
  for (let i = 0; i < 160 && !screen.includes(mark); i++) {
    screen = await padi.screen.state({ id });
    if (!screen.includes(mark)) await sleep(50);
  }
  expect(screen).toContain(mark);
}

describe("kolu-server padi binder — cutover acceptance", () => {
  it("binds a spawned padi and the re-served surface round-trips a terminal", async () => {
    const { padi } = await bootReServedPadi(makeStateRoot());
    await roundTripTerminal(padi, "BINDMARK");
  }, 60000);

  it("reconnects when padi dies, and the re-served surface round-trips again", async () => {
    const stateRoot = makeStateRoot();
    const { padi } = await bootReServedPadi(stateRoot);
    await roundTripTerminal(padi, "FIRST");

    // Kill the bound padi (its detached kaval survives). The socket close flips the
    // endpoint to degraded → the session schedules `adoptOrSpawnOrRefuse` → a fresh
    // padi comes up (adopting the surviving kaval) → the pump rebinds.
    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    // The re-served surface round-trips a fresh terminal again once the binder has
    // re-established the link (roundTripTerminal retries create across the gap).
    await roundTripTerminal(padi, "SECOND");
  }, 90000);

  it("a kolu-server (binder) restart keeps padi's registry WARM — adopts, never respawns (done-criterion b)", async () => {
    const stateRoot = makeStateRoot();
    const first = await bootReServedPadi(stateRoot);

    // Create a terminal through the FIRST binding and drive it to a known mark.
    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = await first.padi.lifecycle.create({ cwd: makeStateRoot() }));
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");
    await first.padi.lifecycle.sendInput({ id, data: "echo WARMMARK\r" });
    let screen = "";
    for (let i = 0; i < 160 && !screen.includes("WARMMARK"); i++) {
      screen = await first.padi.screen.state({ id });
      if (!screen.includes("WARMMARK")) await sleep(50);
    }
    expect(screen).toContain("WARMMARK");

    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();

    // Simulate a kolu-server RESTART: destroy the binder session (drop the link)
    // WITHOUT touching padi — padi is a detached process that outlives its binder,
    // holding the registry + live PTYs. This is the whole point of the split.
    first.session.destroy();
    await sleep(400);
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(padiPid as number)).toBe(true); // padi survived the binder restart.

    // Re-bind at the SAME state-root — adopt-or-spawn-or-refuse ADOPTS the surviving
    // padi (same digest → same socket), never recycling it.
    const second = await bootReServedPadi(stateRoot);
    const padiPid2 = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid2).toBe(padiPid); // SAME process — adopted, not respawned.

    // The terminal created BEFORE the restart is still live with its screen intact,
    // read through the FRESH binding — the metadata survived warm in padi.
    let warm = "";
    for (let i = 0; i < 160 && !warm.includes("WARMMARK"); i++) {
      warm = await second.padi.screen.state({ id });
      if (!warm.includes("WARMMARK")) await sleep(50);
    }
    expect(warm).toContain("WARMMARK");
  }, 90000);

  it("a padi death MID-ATTACH ends the held downstream iterator — never splices (done-criterion c)", async () => {
    const stateRoot = makeStateRoot();
    const { padi } = await bootReServedPadi(stateRoot);

    // Create a terminal (retry across the pump's bind gap, like roundTripTerminal).
    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = await padi.lifecycle.create({ cwd: makeStateRoot() }));
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");

    // Open the attach iterator and pull its FIRST (snapshot) frame, then HOLD the
    // iterator open — a pending pull is exactly the mid-attach state under test.
    const attach = (await padi.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    const first = await attach.next();
    expect(typeof first.value).toBe("string");

    // Kill the bound padi WHILE the iterator is held.
    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    // The held downstream iterator must END (throw or `done:true`), not hang and
    // not silently splice another terminal's bytes. kolu-server's fail-through
    // relay ENDS the browser stream with a non-retriable ORPCError on the
    // mid-chain death; here we assert that END happens. (In the browser,
    // `consumeReattachingStream` is what re-subscribes on this end.) Frames the
    // relay emitted just before the death are fine to drain — the invariant is
    // that the stream TERMINATES, so we pull until it ends or times out.
    async function drainUntilEnd(): Promise<"threw" | "done"> {
      for (;;) {
        let res: IteratorResult<unknown>;
        try {
          res = await attach.next();
        } catch {
          return "threw"; // relay ended the stream with an error — correct.
        }
        if (res.done) return "done"; // relay closed the stream — also correct.
        // A pre-death frame for THIS terminal — keep pulling until the end lands.
      }
    }
    const outcome = await Promise.race([
      drainUntilEnd(),
      sleep(30000).then(() => "timeout" as const),
    ]);
    expect(outcome).not.toBe("timeout"); // a hang would strand the tile forever.
    expect(["threw", "done"]).toContain(outcome);
  }, 90000);

  it("a drain ACROSS THE WIRE persists the session — the state-root blob never nulls/shrinks (done-criterion f)", async () => {
    const stateRoot = makeStateRoot();
    const { session, padi } = await bootReServedPadi(stateRoot);

    // Build a NON-EMPTY session: create two terminals through the re-served surface.
    for (let n = 0; n < 2; n++) {
      let id: string | undefined;
      for (let i = 0; i < 200 && id === undefined; i++) {
        try {
          ({ id } = await padi.lifecycle.create({ cwd: makeStateRoot() }));
        } catch {
          await sleep(100);
        }
      }
      if (id === undefined)
        throw new Error("re-served lifecycle.create never bound");
    }

    // padi persists its session into `<stateRoot>/config.json` (its own Conf). Read
    // the live blob's terminal count straight off disk — the property under test is
    // that THIS number never nulls or shrinks across the wire-crossing drain.
    const confPath = join(stateRoot, "config.json");
    // The persisted terminal count, or `null` on a transient read/parse miss (Conf
    // writes atomically via temp+rename, so a genuine EMPTY session reads as `0` —
    // distinct from `null` — and a real null/shrink still fails the assertion below).
    const savedLen = (): number | null => {
      try {
        return (
          (
            JSON.parse(readFileSync(confPath, "utf8")) as {
              session?: { terminals?: unknown[] };
            }
          ).session?.terminals?.length ?? 0
        );
      } catch {
        return null;
      }
    };
    let before = 0;
    for (let i = 0; i < 200 && before < 2; i++) {
      before = savedLen() ?? 0;
      if (before < 2) await sleep(100);
    }
    expect(before).toBeGreaterThanOrEqual(2);

    // Drain the bound padi ACROSS THE kolu↔padi WIRE: kolu-server → `control.drain`
    // → padi's `onDrain` (persist via the empty-preserve receptacle, then exit). The
    // binder's reconnect loop re-binds a fresh padi that adopts the surviving kaval.
    await session.drainBoundPadi();

    // The persisted blob must NEVER have nulled or shrunk — the drain used the
    // empty-preserve receptacle (a parked-only/empty snapshot leaves it intact) and
    // no autosave nulled it in the hand-off gap. Poll across the re-bind; skip
    // transient read misses (null) but count a real `0` — the MINIMUM must hold
    // ≥ before.
    let minAfter = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 30; i++) {
      const s = savedLen();
      if (s !== null) minAfter = Math.min(minAfter, s);
      await sleep(50);
    }
    expect(minAfter).toBeGreaterThanOrEqual(before);
  }, 90000);

  it("a NEWER binder DRAINS a running older padi + respawns: padi gate pid CHANGES, the surviving kaval is re-adopted (pid UNCHANGED), the session is intact (newest-wins convergence)", async () => {
    const stateRoot = makeStateRoot();
    const first = await bootReServedPadi(stateRoot);

    // Build a NON-EMPTY session: create a terminal through the re-served surface.
    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = await first.padi.lifecycle.create({ cwd: makeStateRoot() }));
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");

    // Record the padi gate pid + the surviving kaval gate pid BEFORE the drain.
    const kavalGate = join(
      dirname(padiKavalSocketPath(stateRoot)),
      "kaval.pid",
    );
    const padiPidBefore = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    const kavalPidBefore = gatePid(kavalGate);
    expect(padiPidBefore).toBeDefined();
    expect(kavalPidBefore).toBeDefined();

    // The persisted session terminal count BEFORE (padi autosaves to config.json).
    const confPath = join(stateRoot, "config.json");
    const savedLen = (): number | null => {
      try {
        return (
          (
            JSON.parse(readFileSync(confPath, "utf8")) as {
              session?: { terminals?: unknown[] };
            }
          ).session?.terminals?.length ?? 0
        );
      } catch {
        return null;
      }
    };
    let before = 0;
    for (let i = 0; i < 200 && before < 1; i++) {
      before = savedLen() ?? 0;
      if (before < 1) await sleep(100);
    }
    expect(before).toBeGreaterThanOrEqual(1);

    // Simulate a kolu-server restart as a NEWER binder: drop the OLD binder's link
    // (padi + its detached kaval survive) WITHOUT touching padi, then re-bind with
    // a NEWER binderVersion. The running padi serves the real `PADI_SURFACE_VERSION`
    // (1.0); a fake newer binder ("1.1") is how we exercise the drain arm without a
    // second padiSurface build — the kit's probe reads the real identity, sees the skew,
    // and (drain-newer-else-refuse) drains it; the fresh spawn then connects genuinely
    // compatibly (real vs real), adopts the surviving kaval, and restores the session.
    first.session.destroy();
    await sleep(400);
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(padiPidBefore as number)).toBe(true); // padi survived the drop.

    // Sanity: the pre-flight probe reaches the running padi's frozen control core
    // and reads its REAL surface version (whatever this build serves).
    const socketPath = padiSocketPath(stateRoot);
    const preProbe = await probePadiForConvergence(socketPath);
    expect(preProbe).not.toBeNull();
    expect(preProbe?.identity.contractVersion).toBe(PADI_SURFACE_VERSION);
    preProbe?.dispose();

    // A binder one MINOR ahead of what the running padi actually serves — derived
    // from the real constant so the skew holds regardless of the build's version.
    const [maj, min] = PADI_SURFACE_VERSION.split(".");
    const newerBinderVersion = `${maj}.${Number(min) + 1}`;

    // Build the SAME endpoint `ensurePadiBinding` builds, and run the REAL
    // `converge` (`probePadiForConvergence` → drain) as that newer binder.
    const ep = createEndpoint({
      hostId: PADI_HOST_ID,
      gatePath: padiGatePath(socketPath),
      socketPath,
      driver: localPadiDriver(
        stateRoot,
        "default",
        undefined,
        false,
        undefined,
      ),
      connect: () => connectPadi(socketPath),
      log: silentLog,
      onStatus: () => {},
    });
    await converge({
      endpoint: ep,
      // strictly NEWER contract than the running padi. From-source padi has no baked
      // PADI_BUILD_ID, and this exercises the CONTRACT drain — so baked.buildId is ""
      // too, keeping the BUILD axis dormant.
      baked: { contractVersion: newerBinderVersion, buildId: "" },
      probe: () => probePadiForConvergence(socketPath),
      policy: PADI_CONVERGENCE_POLICY,
      buildFence: createBuildDrainFence(),
      log: silentLog,
    });

    // padi gate pid CHANGED — the old padi drained (persist + exit), a fresh (this
    // binder's own) padi spawned in its place.
    const padiPidAfter = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPidAfter).toBeDefined();
    expect(padiPidAfter).not.toBe(padiPidBefore);
    expect(isAlive(padiPidBefore as number)).toBe(false); // the old padi exited.

    // The surviving kaval is UNCHANGED — the fresh padi RE-ADOPTED it (never killed;
    // its PTYs + the session they carry rode through the drain).
    const kavalPidAfter = gatePid(kavalGate);
    expect(kavalPidAfter).toBe(kavalPidBefore);

    // Session intact — the persisted blob never nulled/shrank across the drain →
    // respawn (poll across the re-bind; skip transient read misses).
    let minAfter = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 40; i++) {
      const s = savedLen();
      if (s !== null) minAfter = Math.min(minAfter, s);
      await sleep(50);
    }
    expect(minAfter).toBeGreaterThanOrEqual(before);

    // Drop the in-test endpoint's live link so the afterEach reap is the only thing
    // that stops the fresh padi (no dangling reconnect loop — this raw endpoint has none).
    ep.current()?.dispose();
  }, 90000);
});

describe("PadiBindingSession.padiStartedAt — honest boot time for the rail's padi uptime", () => {
  // A pure unit test of the boot-time lifecycle — no real padi. Fake timers so the
  // degraded-branch `scheduleReconnect()` timer never lingers past the test (the
  // reconnect itself is irrelevant here — we only assert the boot-time accessor).
  // The inner afterEach restores real timers BEFORE the file-level afterEach's
  // `await sleep(50)` runs (innermost hooks run first).
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Minimal fake endpoint: `onEndpointStatus` reads `endpoint.current()` only to scope
  // the client on `connected`, and the boot-time lifecycle reads the STATUS's
  // `startedAt` (not `current()`), so a null current is fine — `clientPromise` stays
  // null and we assert only `padiStartedAt()`.
  const makeSession = (): PadiBindingSession =>
    new PadiBindingSession({
      endpoint: {
        current: () => null,
      } as unknown as PadiBindingSessionDeps["endpoint"],
      connectOnce: async () => true,
      reconnectDelayMs: 10_000, // never fires — cleared by the afterEach
    });

  type Status = Parameters<PadiBindingSession["onEndpointStatus"]>[0];
  const connected = (startedAt: number): Status => ({
    state: "connected",
    identity: { stateRoot: "/x", surfaceVersion: PADI_SURFACE_VERSION },
    startedAt,
    metadata: {
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: "1.0",
    },
  });

  it("is null before any connection (honest unknown, never a fake 0)", () => {
    const s = makeSession();
    expect(s.padiStartedAt()).toBeNull();
    s.destroy();
  });

  it("reports the connected status's startedAt, then clears to null on a drop", () => {
    const s = makeSession();
    s.onEndpointStatus(connected(1_700_000_000_000));
    expect(s.padiStartedAt()).toBe(1_700_000_000_000);
    // A degraded close clears it — the padi uptime reads "unknown", never a stale age.
    s.onEndpointStatus({ state: "degraded" } as Status);
    expect(s.padiStartedAt()).toBeNull();
    s.destroy();
  });

  it("re-reads a FRESH boot time on reconnect (a respawned padi is a new process)", () => {
    const s = makeSession();
    s.onEndpointStatus(connected(111));
    expect(s.padiStartedAt()).toBe(111);
    s.onEndpointStatus({ state: "degraded" } as Status);
    s.onEndpointStatus(connected(222)); // respawn → new boot time, not the old 111
    expect(s.padiStartedAt()).toBe(222);
    s.destroy();
  });

  it("is null once destroyed", () => {
    const s = makeSession();
    s.onEndpointStatus(connected(555));
    s.destroy();
    expect(s.padiStartedAt()).toBeNull();
  });
});

describe("resolvePadiLaunch — the legacy-kaval-socket adopt-hint (binder hints its OWN port)", () => {
  const stateRoot = "/state/root";

  it("forwards `--legacy-kaval-socket <path>` VERBATIM when the binder hints one (its own listen port's legacy socket)", () => {
    const hint = "/run/user/1000/kaval-7681/pty-host.sock";
    const { args } = resolvePadiLaunch(stateRoot, undefined, undefined, hint);
    const i = args.indexOf("--legacy-kaval-socket");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(hint); // exactly what the binder passed — padi never guesses
  });

  it("OMITS the flag entirely for a standalone bring-up (no hint) — so a padi with no binder never adopts a stray port kaval", () => {
    const { args } = resolvePadiLaunch(
      stateRoot,
      undefined,
      undefined,
      undefined,
    );
    expect(args).not.toContain("--legacy-kaval-socket");
  });
});
