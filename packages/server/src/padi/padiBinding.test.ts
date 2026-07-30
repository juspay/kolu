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

import { createEndpointForTest as createEndpoint } from "@kolu/surface-daemon-supervisor/createEndpoint.testlib";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// `connectPadi` moved into the shared dial kit in W2.3; the supervision it feeds
// (bind/drain convergence, drivers, the reconnect session) stays in the binder.
import { connectPadi } from "@kolu/padi/dial";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "@kolu/padi/stateRoot";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import {
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  padiSurface,
} from "@kolu/padi/surface";
import { DAEMON_BIND_PID_ENV } from "@kolu/surface-daemon";
import { SPAWN_ENV_ALLOWLIST } from "kolu-pty";
import {
  type ConvergenceOutcome,
  converge,
  daemonBuild,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";

import {
  isSurfaceRelayTransportLost,
  isSurfaceStdioTransportClosed,
} from "@kolu/surface/client";
import { ConnectError, reServeSurface } from "@kolu/surface-remote";
import { createRouterClient } from "@orpc/server";
import { describeDaemon } from "@kolu/daemon-test-gate";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AGENT_DIR_ENV_KEYS,
  daemonEnv,
  ensurePadiBinding,
  ensurePadiBindingWith,
  handlePadiBootFailure,
  localPadiDriver,
  PADI_HOST_ID,
  PadiAdoptionRefusedError,
  PadiStateRootGoneError,
  padiConnectFailure,
  reportFatalBindingError,
  resolvePadiLaunch,
} from "./padiBinding.ts";
import {
  PADI_DRAIN_TEARDOWN_CEILING_MS,
  padiConvergencePolicy,
} from "./padiConvergence.ts";
// Post-S9 the binder returns a `PadiSession` (a base `Session` + the daemon-supervision
// spread) — there is no `PadiBindingSession` class.
import type { PadiSession } from "./padiSession.ts";
import { buildAppRouter } from "../router.ts";
import { padiRuntimeHome, residentPadiSocket } from "@kolu/padi/assembly";

/** A silent structural logger for the in-test endpoint + the newer-binder bind
 *  (the drain path logs at info/warn/error; the test keeps stdout clean). */
const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// ── The #1719 residual: an un-retried retryable relay-lost on reconnect ──
//
// The reconnect test below kills a bound padi WHILE the re-served `terminalAttach`
// stream is live. Post-SR5 (#1822) the re-serve relay CATCHES that mid-stream
// transport loss and re-throws it as the RETRYABLE `RelayTransportLostError`
// (`SURFACE_RELAY_TRANSPORT_LOST`) — an AWAITED throw, not a floating rejection.
// Production's re-serve consumer re-subscribes on it via `STREAM_RETRY`; this test
// dials the re-served router with a RAW `createRouterClient` (no retry plugin), so the
// attach threw un-retried and flaked. The whole fix is the `STREAM_RETRY` mimic in
// `roundTripTerminal` (below): retry the attach across the reconnect gap on a
// survivable transport float.
//
// (The earlier premise — an un-ownable oRPC-internal float the DAEMON must survive —
// was overturned by reproduction: the pre-SR5 abandoned-pull float class died with
// #1822's relay rework. Two 400-iter isolation runs on the real reconnect, WITH and
// WITHOUT an ownership wrapper, both showed 0 fails and 0 process floats. So there is
// no float to own or survive here — only the un-retried awaited throw above.)

/** Set (or, given `undefined`, unset) `$XDG_RUNTIME_DIR` — the single-source pin
 *  below flips this between a simulated wait-time and serve-time read. */
function setXdgRuntimeDir(v: string | undefined): void {
  if (v === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = v;
}

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
  for (const k of [
    "XDG_RUNTIME_DIR",
    "KOLU_KAVAL_SPAWN",
    DAEMON_BIND_PID_ENV,
    ...CLEARED,
  ] as const)
    prior[k] = process.env[k];
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
  process.env.KOLU_KAVAL_SPAWN = "detached"; // padi's kaval detaches (survives padi restarts)
  // Bind every real padi this binder spawns (and the kaval padi spawns — the binder's
  // env builder forwards this var) to THIS vitest process, so a signal-killed run that
  // skips the reap hooks still can't strand them: they poll this pid and die once
  // vitest is gone. `afterEach`'s gate-pid SIGKILL stays the fast path.
  process.env[DAEMON_BIND_PID_ENV] = String(process.pid);
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

const activeSessions: PadiSession[] = [];
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
  session: PadiSession;
  // biome-ignore lint/suspicious/noExplicitAny: the dialed client is walked structurally in the round-trip helper.
  padi: any;
}> {
  activeStateRoots.add(stateRoot);
  // `ensurePadiBinding` is side-effect-free (builds the session, doesn't dial); warm it
  // with an explicit boot-await BEFORE dialing the re-served surface — the exact stance
  // `index.ts` takes for the local arm, so the first round-trip meets a live upstream.
  const session = ensurePadiBinding({
    stateRoot,
    nixShellWhitelist: "default", // the test runs inside the nix devshell
    reconnectDelayMs: 400, // snappy reconnect for the kill test
  });
  activeSessions.push(session);
  await session.pin().catch(() => {
    /* fail-open — a boot failure surfaces on the connection cell + the loop retries */
  });

  const reServed = reServeSurface<typeof padiSurface.spec>({
    source: padiSurface,
    policy: PADI_FORWARDING_POLICY,
    // The `PadiSession` plugs into `reServeSurface`'s loose `Session` receptacle — S3
    // dropped the dead contract `<C>` at the role boundary, so only the SURFACE spec is
    // named here (as in index.ts).
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
    // The re-targeted "restart" is now the session's `renew()` (the drain verb), not the
    // deleted `drainBoundPadi()`.
    drainBoundPadi: () => session.renew(),
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: async () => {},
    viewerHost: async () => null,
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
  // 1:1 through the re-serve's fail-through relay. Frames are a { kind, data, … }
  // discriminated union (contract 5.2); the first is a `snapshot`.
  //
  // The attach can race the reconnect window: when the bound padi dies mid-attach the
  // re-serve relay (`failThroughStreamCore`) ends the downstream with the RETRYABLE
  // `RelayTransportLostError` (`SURFACE_RELAY_TRANSPORT_LOST`) — or the raw
  // `SURFACE_STDIO_TRANSPORT_CLOSED` — so a LIVE consumer re-subscribes end-to-end. In
  // PRODUCTION the reServe consumer carries `STREAM_RETRY` and re-subscribes
  // transparently (the terminal re-attaches with no user-visible break). This test dials
  // the re-served router with a RAW `createRouterClient` (no retry plugin), so mirror
  // `STREAM_RETRY` explicitly here: retry the attach across the reconnect gap on a
  // survivable transport float, exactly as `create` above retries. (This is the
  // consumer half of the reconnect guarantee; the DAEMON half — surviving the abandoned
  // oRPC-internal float without crashing — is pinned deterministically in
  // `reserveFloatBoundary.test.ts`.)
  let firstFrame: TerminalAttachFrame | undefined;
  for (let i = 0; i < 200 && firstFrame === undefined; i++) {
    try {
      const attach = (await padi.terminalAttach.get({ id }))[
        Symbol.asyncIterator
      ]();
      const first = await attach.next();
      firstFrame = first.value as TerminalAttachFrame;
      await attach.return?.();
    } catch (err) {
      if (
        isSurfaceStdioTransportClosed(err) ||
        isSurfaceRelayTransportLost(err)
      ) {
        await sleep(50); // the retryable relay/transport end — re-subscribe like STREAM_RETRY
        continue;
      }
      throw err;
    }
  }
  if (firstFrame === undefined)
    throw new Error(
      "terminalAttach never landed a snapshot across the reconnect",
    );
  expect(firstFrame.kind).toBe("snapshot");
  expect(typeof firstFrame.data).toBe("string");

  await padi.lifecycle.sendInput({ id, data: `echo ${mark}\r` });
  let screen = "";
  for (let i = 0; i < 160 && !screen.includes(mark); i++) {
    screen = await padi.screen.state({ id });
    if (!screen.includes(mark)) await sleep(50);
  }
  expect(screen).toContain(mark);
}

describeDaemon("kolu-server padi binder — cutover acceptance", () => {
  it("binds a spawned padi and the re-served surface round-trips a terminal", async () => {
    const { session, padi } = await bootReServedPadi(makeStateRoot());
    await roundTripTerminal(padi, "BINDMARK");

    // The LOCAL arm's new-API readouts, end-to-end against a REAL padi: a healthy local
    // bind surfaces NO convergence anomaly (parity with the pre-S9 `padiConvergence()`
    // returning null), and `identity()` reads padi's declared `system.identity` — a
    // null-free sum that is `identified` (padi always DECLARES its build) with the REAL
    // padiSurface contract version and an honest boot time, once bound.
    expect(session.convergence()).toBeNull();
    let id = session.identity();
    for (let i = 0; i < 100 && id.kind === "disconnected"; i++) {
      await sleep(50);
      id = session.identity();
    }
    expect(id.kind).toBe("identified");
    if (id.kind !== "identified")
      throw new Error("bound padi never surfaced an identity");
    expect(id.baked.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(id.startedAt).toBeGreaterThan(0);
  }, 60000);

  it("reconnects when padi dies, and the re-served surface round-trips again", async () => {
    const stateRoot = makeStateRoot();
    const { session, padi } = await bootReServedPadi(stateRoot);
    await roundTripTerminal(padi, "FIRST");

    // Capture progress lines across the kill+reconnect — the producer pin below
    // reads this to prove the ENDPOINT link death (no child process: the
    // `Endpoint`'s `onStatus` degraded/dead callback, not a real `exit` event)
    // renders honestly, never as a fabricated process exit.
    const seenLines: string[] = [];
    const unsub = session.onState((s) => {
      seenLines.push(...s.log.map((e) => e.line));
    });

    // Kill the bound padi (its detached kaval survives). The socket close flips the
    // endpoint to degraded → the session schedules `adoptOrSpawnOrRefuse` → a fresh
    // padi comes up (adopting the surviving kaval) → the pump rebinds.
    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    // The re-served surface round-trips a fresh terminal again once the binder has
    // re-established the link (roundTripTerminal retries create across the gap).
    await roundTripTerminal(padi, "SECOND");
    unsub();

    // THE PIN (task d): `ensurePadiBinding`'s `onStatus` degraded/dead handler used
    // to resolve `{kind: "exit", code: null, signal: null}` — a fabricated process
    // exit for a link death that was never a process exit — which `handleClosed`
    // rendered as "agent exited (code=null, signal=null)". It now emits the honest
    // `{kind: "endpoint-down"}` variant, rendered "endpoint link down (no process
    // exit)". Assert the honest line appeared and the fabricated one never did.
    expect(seenLines.some((l) => l.includes("endpoint link down"))).toBe(true);
    expect(seenLines.some((l) => l.includes("agent exited"))).toBe(false);

    // Reaching here — a SECOND terminal round-tripped through the re-served surface
    // after the bound padi died — IS the reconnect guarantee: the consumer re-subscribed
    // across the transport-loss window (`roundTripTerminal`'s attach retry, the
    // `STREAM_RETRY` mimic). The DAEMON's survival of the abandoned oRPC-internal float
    // is the separate guarantee pinned in `reserveFloatBoundary.test.ts` (see the
    // header note) — not re-asserted here, because under vitest that float surfaces as
    // this retryable throw, not the process `unhandledRejection` the daemon survives.
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
    // read through the FRESH binding — the metadata survived warm in padi. Post-S9
    // `ensurePadiBinding` is SYNC (no first-connect await), so the fresh binding's pump
    // may not have bound the live upstream on the first read — tolerate the warm-up gap
    // ("no live upstream link") the SAME way `roundTripTerminal` does for `create`.
    let warm = "";
    for (let i = 0; i < 200 && !warm.includes("WARMMARK"); i++) {
      try {
        warm = await second.padi.screen.state({ id });
      } catch {
        // pump not yet bound to the re-adopted padi — retry across the bind gap.
      }
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
    const firstFrame = first.value as TerminalAttachFrame;
    expect(firstFrame.kind).toBe("snapshot");
    expect(typeof firstFrame.data).toBe("string");

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
    // `renew()` is the post-S9 "restart" verb (was `drainBoundPadi()`).
    await session.renew();

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
    // (2.0); a fake newer binder ("2.1") is how we exercise the drain arm without a
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
    const probe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: PADI_DRAIN_TEARDOWN_CEILING_MS,
    });
    const preProbe = await probe(socketPath);
    expect(preProbe).not.toBeNull();
    expect(preProbe?.identity.contractVersion).toBe(PADI_SURFACE_VERSION);
    preProbe?.dispose();

    // A binder one MINOR ahead of what the running padi actually serves — derived
    // from the real constant so the skew holds regardless of the build's version.
    const [maj, min] = PADI_SURFACE_VERSION.split(".");
    const newerBinderVersion = `${maj}.${Number(min) + 1}`;

    // Build the SAME endpoint `ensurePadiBinding` builds, and run the REAL
    // `converge(ep)` as that newer binder. Policy carries the strictly-NEWER
    // contract; baked build is off-nix so only the CONTRACT axis fires.
    const newerPolicy = {
      ...padiConvergencePolicy(""),
      baked: {
        contractVersion: newerBinderVersion,
        build: daemonBuild(""),
      },
    };
    const ep = createEndpoint({
      hostId: PADI_HOST_ID,
      home: {
        dir: dirname(socketPath),
        gatePath: padiGatePath(socketPath),
        socketPath,
      },
      policy: newerPolicy,
      probe,
      driver: localPadiDriver(
        stateRoot,
        socketPath,
        "default",
        undefined,
        false,
        undefined,
      ),
      connect: (path) => connectPadi(path),
      log: silentLog,
      onStatus: () => {},
    });
    await converge(ep);

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

describe("localPadiDriver — the A8 runtime spawn leash at the real funnel (F5)", () => {
  const savedGate = process.env.KOLU_DAEMON_TESTS;
  afterEach(() => {
    if (savedGate === undefined) delete process.env.KOLU_DAEMON_TESTS;
    else process.env.KOLU_DAEMON_TESTS = savedGate;
  });

  it("REFUSES to spawn a real padi in a gate-off vitest worker (helper indirection can't smuggle a fork)", () => {
    // Force the gate OFF regardless of lane — "a bare vitest never forks a real padi".
    delete process.env.KOLU_DAEMON_TESTS;
    const driver = localPadiDriver(
      "/tmp/kolu-f5-state",
      "/run/user/1000/padi-x/padi.sock",
      undefined,
      undefined,
      false,
      undefined,
    );
    expect(() => driver.spawn()).toThrow(/KOLU_DAEMON_TESTS/);
  });
});

/**
 * F9 / UW1 done-when: budget-exhausted LOCAL adopt surfaces `adopted-stale`
 * through the REAL ensurePadiBindingWith → convergePadi path:
 *   standingConvergence = outcomeAnomaly(outcome)   // padiBinding.ts convergePadi
 *
 * MUTATION CHECK (re-verified wave 4): standingConvergence = null turns this RED.
 * Injection is via the NON-EXPORTED ensurePadiBindingWith (W4.1) — public options
 * stay domain-only; no endpointSeams on EnsurePadiBindingOptions.
 */
describe("local arm adopted-stale via convergence() (UW1 done-when / F9)", () => {
  it("ensurePadiBindingWith pin → drain not-taken → session.convergence() adopted-stale", async () => {
    const stateRoot = makeStateRoot();
    activeStateRoots.add(stateRoot);
    // Live gate holder + accepting socket so post-give-up bind ADOPTS
    // (liveServingHolder requires both; adopted-stale needs a resident).
    const home = padiRuntimeHome(stateRoot, residentPadiSocket(stateRoot));
    mkdirSync(home.dir, { recursive: true, mode: 0o700 });
    // This vitest process is the live gate holder (isHolderLive). Clear the gate
    // in finally so afterEach reap does not SIGKILL this process. Exclusive
    // create + owner-only mode on the tmp-derived path (CodeQL CWE-377).
    const gateFd = openSync(
      home.gatePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(gateFd, `${process.pid}\n`);
    } finally {
      closeSync(gateFd);
    }
    const sockServer = createServer((c) => c.on("error", () => {}));
    await new Promise<void>((resolve, reject) => {
      sockServer.once("error", reject);
      sockServer.listen(home.socketPath, () => resolve());
    });

    try {
      // Known (non-empty) binder build — off-nix ("") would decide adopt and skip drain.
      const binderBuildId = "binder-build-hex-f9";
      const staleBuild = "stale-running-build-f9";
      const policy = {
        ...padiConvergencePolicy(binderBuildId),
        drainBudget: { maxAttempts: 1, onGiveUp: "adopt-stale" as const },
      };

      // Minimal daemon client for makeSession identity/liveness after adopt.
      const fakeClient = {
        surface: {
          control: {
            core: {
              hello: async () => ({
                stateRoot,
                surfaceVersion: PADI_SURFACE_VERSION,
                controlCoreVersion: "1.0",
                startedAt: 99,
                commit: "deadbee",
                buildId: staleBuild,
              }),
              drain: async () => {},
            },
          },
          padi: {
            system: {
              identity: async () => ({
                kind: "identified" as const,
                baked: {
                  contractVersion: PADI_SURFACE_VERSION,
                  commit: { kind: "commit" as const, sha: "deadbee" },
                },
                startedAt: 99,
              }),
              clockNow: async () => ({ epochMs: Date.now() }),
            },
          },
        },
      };

      let drainCalls = 0;
      let probeCalls = 0;
      // W4.1: inject via non-exported ensurePadiBindingWith — never a public knob.
      const session = ensurePadiBindingWith(
        { stateRoot, reconnectDelayMs: 10_000 },
        {
          policy,
          probe: async () => {
            probeCalls += 1;
            return {
              capability: "drainable" as const,
              identity: {
                contractVersion: PADI_SURFACE_VERSION,
                build: daemonBuild(staleBuild),
              },
              instanceKey: { kind: "instance" as const, key: 99 },
              fireDrain: async () => {
                drainCalls += 1;
              },
              awaitExit: async (signal: AbortSignal) => {
                await new Promise<void>((resolve) => {
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
                });
              },
              drainCeilingMs: 30,
              dispose: () => {},
            };
          },
          driver: { spawn: async () => {} },
          connect: async () =>
            ({
              // biome-ignore lint/suspicious/noExplicitAny: fake PadiDaemonClient for seam
              client: fakeClient as any,
              identity: {
                surfaceVersion: PADI_SURFACE_VERSION,
                buildId: staleBuild,
                startedAt: 99,
              },
              startedAt: 99,
              metadata: {
                contractVersion: PADI_SURFACE_VERSION,
                buildId: staleBuild,
              },
              dispose: () => {},
              onClose: () => {},
              // biome-ignore lint/suspicious/noExplicitAny: fake DaemonConnection for seam
            }) as any,
        },
      );
      activeSessions.push(session);

      // Drive the REAL connector → convergePadi → standingConvergence = outcomeAnomaly(...)
      await session.pin();

      // Seams must be live (probe called) and build-mismatch must drain.
      expect(probeCalls).toBeGreaterThanOrEqual(1);
      expect(drainCalls).toBeGreaterThanOrEqual(1);

      // MUTATION CHECK (performed before claim): temporarily set
      // packages/server/src/padi/padiBinding.ts convergePadi assignment
      //   standingConvergence = outcomeAnomaly(outcome);
      // to `standingConvergence = null` → this assertion fails
      // (expected null not to be null). Restored the production assignment.
      expect(session.convergence()).not.toBeNull();
      expect(session.convergence()).toMatchObject({
        kind: "adopted-stale",
        running: {
          contractVersion: PADI_SURFACE_VERSION,
          build: { kind: "known", id: staleBuild },
        },
        expected: {
          build: { kind: "known", id: binderBuildId },
        },
      });
    } finally {
      sockServer.close();
      // Drop the gate so afterEach reap does not SIGKILL this vitest process.
      try {
        rmSync(home.gatePath, { force: true });
      } catch {
        // already gone
      }
    }
  });
});

describe("ensurePadiBinding — the LOCAL arm's members before any connect (pure, no real padi)", () => {
  // Post-S9 the boot-time lifecycle is no longer a bespoke `padiStartedAt()` on a wrapper
  // class; it rides the base `session.identity()` (padi's `system.identity`), which is
  // proven generically by surface-remote's session tests. What is padi-LOCAL-arm
  // specific — and unit-testable with NO real padi (the session is side-effect-free until
  // the first pin) — is: standing anomaly is null before any dial, `identity()` is the
  // honest `disconnected` arm while unbound (never a fabricated 0), and `renew()`
  // fails LOUDLY when there is no bound padi to drain (never a phantom success). A tmp
  // state-root keeps the endpoint's digest isolated; `destroy()` tears the session down.
  const build = (): PadiSession =>
    ensurePadiBinding({ stateRoot: makeStateRoot(), reconnectDelayMs: 10_000 });

  it("surfaces no convergence anomaly before any dial (standing anomaly is set by converge)", () => {
    const s = build();
    expect(s.convergence()).toBeNull();
    s.destroy();
  });

  it("identity() is the honest `disconnected` arm before any connect (never a fake 0)", () => {
    const s = build();
    expect(s.identity()).toEqual({ kind: "disconnected" });
    s.destroy();
    // …and still `disconnected` once destroyed.
    expect(s.identity()).toEqual({ kind: "disconnected" });
  });

  it("renew() (the restart/drain verb) throws LOUDLY when no padi is bound — never a phantom success", async () => {
    const s = build();
    // Never pinned → the endpoint holds no connection → the drain has nothing to reach.
    await expect(s.renew()).rejects.toThrow(/not bound|down|cannot drain/i);
    s.destroy();
  });

  it("declares its preservation (padi's PTYs SURVIVE a renew — they live in kaval)", () => {
    const s = build();
    expect(s.preservation).toEqual({ children: "survive" });
    s.destroy();
  });
});

describe("resolvePadiLaunch — the legacy-kaval-socket adopt-hint (binder hints its OWN port)", () => {
  const stateRoot = "/state/root";
  const socketPath = "/run/user/1000/padi-deadbeef/padi.sock";

  it("forwards `--legacy-kaval-socket <path>` VERBATIM when the binder hints one (its own listen port's legacy socket)", () => {
    const hint = "/run/user/1000/kaval-7681/pty-host.sock";
    const { args } = resolvePadiLaunch(
      stateRoot,
      socketPath,
      undefined,
      undefined,
      hint,
    );
    const i = args.indexOf("--legacy-kaval-socket");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(hint); // exactly what the binder passed — padi never guesses
  });

  it("OMITS the flag entirely for a standalone bring-up (no hint) — so a padi with no binder never adopts a stray port kaval", () => {
    const { args } = resolvePadiLaunch(
      stateRoot,
      socketPath,
      undefined,
      undefined,
      undefined,
    );
    expect(args).not.toContain("--legacy-kaval-socket");
  });
});

describe("daemonEnv — the server → padi forwarding hop for the run-bind pid", () => {
  // Guards the ACTUAL server→padi hop (`daemonEnv` builds the env the padi driver
  // spawns with). The cross-process sentinel test in `dial.test.ts` proves padi→kaval
  // by spawning padi directly, so it never exercises THIS function; without this
  // assertion, deleting the `DAEMON_BIND_PID_ENV` forward in `daemonEnv` would leave
  // both suites green while silently stranding harness/smoke-spawned padis.
  // `vi.stubEnv` snapshots the var at stub time and `unstubAllEnvs` restores THAT
  // value — here the vitest pid the file-level `beforeAll` set — so later real-padi
  // tests still spawn bound, without a hand-rolled runtime snapshot.
  afterEach(() => vi.unstubAllEnvs());

  it("forwards the run-bind pid VERBATIM into padi's env when the server carries one", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, "4321");
    expect(daemonEnv("/state/root", false)[DAEMON_BIND_PID_ENV]).toBe("4321");
  });

  it("OMITS the var when the server's is truly unset (production padi stays `forever`)", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, undefined);
    expect(daemonEnv("/state/root", false)).not.toHaveProperty(
      DAEMON_BIND_PID_ENV,
    );
  });

  it("forwards even an empty value (broken expansion) so padi fail-fasts, never drops it back to `forever`", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, "");
    expect(daemonEnv("/state/root", false)[DAEMON_BIND_PID_ENV]).toBe("");
  });

  it.each([
    ["KAVAL_BUILD_ID", "build-only"],
    ["KAVAL_COMMIT_HASH", "commit-only"],
  ])("rejects a half-baked kaval identity at the binder (%s only)", (name, value) => {
    vi.stubEnv("KAVAL_BUILD_ID", undefined);
    vi.stubEnv("KAVAL_COMMIT_HASH", undefined);
    vi.stubEnv(name, value);

    expect(() => daemonEnv("/state/root", false)).toThrow(
      "incomplete baked identity: KAVAL_BUILD_ID and KAVAL_COMMIT_HASH must be set together",
    );
  });

  it("is EXACTLY every allowlist key + every padi-operational input — no dropped base key, no leaked ambient key (#1872 2a parity)", () => {
    // The supervisor's detached spawn branch passes `cfg.env` ALONE (macOS launchd,
    // bare non-systemd) — so daemonEnv MUST carry the login-session base, or padi
    // launches HOME-less and kaval's own daemonEnv (which mines HOME from padi's env)
    // cascades the loss into every PTY. Twin of localDriver.daemonEnv. Seed EVERY
    // allowlist key + every optional operational input, assert the WHOLE object.
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) delete process.env[k];
      const expected: Record<string, string> = {};
      for (const k of SPAWN_ENV_ALLOWLIST) {
        process.env[k] = `val-${k}`;
        expected[k] = `val-${k}`;
      }
      // padi-operational inputs (NODE_OPTIONS scrubbed — a value with no dev flags):
      process.env.KOLU_STATE_DIR = "/state";
      process.env.KOLU_KAVAL_SPAWN = "detached";
      process.env.LOG_LEVEL = "warn";
      process.env.NODE_OPTIONS = "--max-old-space-size=4096";
      process.env.KOLU_DIAG_DIR = "/diag";
      process.env.KAVAL_BUILD_ID = "bid";
      process.env.KAVAL_COMMIT_HASH = "hash";
      process.env[DAEMON_BIND_PID_ENV] = "4321";
      // Agent-detection dir overrides padi's sensors read — MUST be forwarded, or
      // detection silently breaks on a built forced-detached deployment (the exact
      // e2e regression). Seed + expect each.
      for (const k of AGENT_DIR_ENV_KEYS) {
        process.env[k] = `dir-${k}`;
        expected[k] = `dir-${k}`;
      }
      // ambient identity/secret in the server's own env — must NOT reach padi:
      process.env.CLAUDE_CODE_CHILD_SESSION = "1";
      Object.assign(expected, {
        KOLU_STATE_DIR: "/state",
        KOLU_PADI_STATE_DIR: "/state/root", // always stamped from the arg
        KOLU_KAVAL_SPAWN: "detached",
        LOG_LEVEL: "warn",
        NODE_OPTIONS: "--max-old-space-size=4096",
        KOLU_DIAG_DIR: "/diag",
        KAVAL_BUILD_ID: "bid",
        KAVAL_COMMIT_HASH: "hash",
        [DAEMON_BIND_PID_ENV]: "4321",
      });

      expect(daemonEnv("/state/root", false)).toEqual(expected);
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("resolvePadiLaunch — the from-source entrypoint (KOLU_PADI_BIN unset) resolves to a REAL file", () => {
  const stateRoot = "/state/root";

  it("points at packages/padi/src/daemonBoot/bin.ts, an existing file — not a phantom under packages/server/ (L27 move must not skew the ../.. hop)", () => {
    const prev = process.env.KOLU_PADI_BIN;
    delete process.env.KOLU_PADI_BIN;
    try {
      const { binPath, args } = resolvePadiLaunch(
        stateRoot,
        padiSocketPath(stateRoot),
        undefined,
        undefined,
        undefined,
      );
      // from-source arm: process.execPath --import <tsx> <bin.ts> ...baseArgs
      expect(binPath).toBe(process.execPath);
      const importIdx = args.indexOf("--import");
      expect(importIdx).toBeGreaterThanOrEqual(0);
      const binTs = args[importIdx + 2];
      if (binTs === undefined)
        throw new Error("expected --import to be followed by a bin.ts path");
      expect(binTs.endsWith("packages/padi/src/daemonBoot/bin.ts")).toBe(true);
      expect(existsSync(binTs)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.KOLU_PADI_BIN;
      else process.env.KOLU_PADI_BIN = prev;
    }
  });
});

describe("resolvePadiLaunch — single-source the padi socket path (#1713 pattern)", () => {
  const stateRoot = "/state/root";

  it("ALWAYS forwards `--socket <path>` VERBATIM — the exact path the binder already computed with padiSocketPath, so padi's own process never re-derives it from its own env", () => {
    const socketPath = padiSocketPath(stateRoot);
    const { args } = resolvePadiLaunch(
      stateRoot,
      socketPath,
      undefined,
      undefined,
      undefined,
    );
    const i = args.indexOf("--socket");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(socketPath);
  });

  it("wait-path === serve-path EVEN WHEN the two sides read $XDG_RUNTIME_DIR at genuinely different moments (SET at wait-time, UNSET at serve-time, and vice versa) — the real shape of the bug, where a transient systemd-run unit's own default env can differ from the binder's. Without the fix, padi's own `padiSocketPath(stateRoot, opts.socketOverride)` (daemonMain.ts) would re-read its OWN env and diverge from what the binder dials; with the fix the override makes the serve side ignore its env entirely", () => {
    const prevXdg = process.env.XDG_RUNTIME_DIR;
    try {
      for (const [waitXdg, serveXdg] of [
        ["/run/user/1000", undefined],
        [undefined, "/run/user/1000"],
        [undefined, undefined],
        ["/run/user/1000", "/run/user/1000"],
      ] as const) {
        // Wait-time: the binder resolves its own endpoint/dial path under ITS env.
        setXdgRuntimeDir(waitXdg);
        const waitPath = padiSocketPath(stateRoot);
        const { args } = resolvePadiLaunch(
          stateRoot,
          waitPath,
          undefined,
          undefined,
          undefined,
        );
        const socketOverride = args[args.indexOf("--socket") + 1];

        // Serve-time: padi's OWN process (daemonMain.ts) calls
        // `padiSocketPath(stateRoot, opts.socketOverride)` under WHATEVER env IT
        // sees — simulated here as possibly different from wait-time.
        setXdgRuntimeDir(serveXdg);
        const servePath = padiSocketPath(stateRoot, socketOverride);

        expect(servePath).toBe(waitPath);
      }
    } finally {
      setXdgRuntimeDir(prevXdg);
    }
  });
});

describe("padiConnectFailure — the ONE fatal classification (#1313 adoption-refused vs. everything-else-retries)", () => {
  const stateRoot = "/state/root";
  const socketPath = "/run/user/1000/padi-deadbeef/padi.sock";

  it("a genuine skew-refused outcome (never adopted) is FATAL — a PadiAdoptionRefusedError naming the state dir + socket + remedy", () => {
    const outcome: ConvergenceOutcome = {
      kind: "refused",
      adopted: false,
      anomaly: {
        kind: "skew-refused",
        running: {
          contractVersion: "9.0",
          build: daemonBuild("x"),
        },
        expected: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild("mine"),
        },
        detail: "skew",
      },
    };
    const err = padiConnectFailure(outcome, stateRoot, socketPath);
    expect(err).toBeInstanceOf(PadiAdoptionRefusedError);
    expect(err.message).toContain(stateRoot);
    expect(err.message).toContain(socketPath);
    expect(err.message).toContain("KOLU_STATE_DIR"); // the remedy
  });

  it("cross-supervisor refuse is a ConnectError naming the fight — not a contract-skew refusal", () => {
    const err = padiConnectFailure(
      {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "cross-supervisor",
          drained: { kind: "instance", key: 1 },
          observed: { kind: "instance", key: 2 },
          running: {
            contractVersion: PADI_SURFACE_VERSION,
            build: daemonBuild("x"),
          },
          detail: "foreign instance of drained build",
        },
      },
      stateRoot,
      socketPath,
    );
    expect(err).toBeInstanceOf(ConnectError);
    expect(err).not.toBeInstanceOf(PadiAdoptionRefusedError);
    expect(err.message).toMatch(/cross-supervisor/i);
  });

  it("every other reason `conn` is undefined stays the pre-existing retryable ConnectError — never fatal", () => {
    const outcomes: ConvergenceOutcome[] = [
      { kind: "not-adopted" },
      { kind: "recycled", bind: { kind: "refused-or-failed" } },
      {
        kind: "drained-replacing",
        axis: "build",
        running: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild(""),
        },
        bind: { kind: "refused-or-failed" },
      },
    ];
    for (const outcome of outcomes) {
      const err = padiConnectFailure(outcome, stateRoot, socketPath);
      expect(err).toBeInstanceOf(ConnectError);
      expect(err).not.toBeInstanceOf(PadiAdoptionRefusedError);
    }
  });
});

describe("reportFatalBindingError — a refusal reported on EVERY dial, not just the first (delta-re-review finding 2)", () => {
  it("invokes the hook for a genuine PadiAdoptionRefusedError", () => {
    const err = new PadiAdoptionRefusedError(
      "a padi is already serving this workspace",
    );
    const seen: PadiAdoptionRefusedError[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([err]);
  });

  it("does NOT invoke the hook for a non-fatal (retryable) classification", () => {
    const err = new ConnectError("padi did not come up", "network");
    const seen: unknown[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([]);
  });

  it("is a no-op when no hook is supplied (the option is optional)", () => {
    expect(() =>
      reportFatalBindingError(new PadiAdoptionRefusedError("x"), undefined),
    ).not.toThrow();
  });

  it("invokes the hook for a PadiStateRootGoneError too — the #2010 gone-root verdict is the same fatal class", () => {
    const err = new PadiStateRootGoneError("/gone/worktree/.kolu-dev/padi");
    const seen: unknown[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([err]);
  });

  // THE PIN: session.ts's own reconnect loop (`@kolu/surface-remote`'s
  // `launchAttempt`) only lets the composition root's boot `pin()` observe the
  // FIRST dial's rejection — every dial after that is fire-and-forget, silently
  // swallowing whatever `connectOnce` throws. Before this fix, a refusal reached on
  // a LATER (reconnect) dial was retried as "network" forever — the exact silent
  // spinner the boot-time fail-fast was meant to kill. `reportFatalBindingError` is
  // called directly at the connector's throw site (not left to whichever dial's
  // promise happens to be awaited), so calling it a SECOND time — simulating a
  // reconnect dial that now hits a refusal a first dial didn't — must report just
  // as loudly as the first ever would.
  it("PIN: a refuse reached on a SIMULATED RECONNECT dial (a second, later call) still reports — never silently swallowed", () => {
    const seen: PadiAdoptionRefusedError[] = [];
    const onFatalBindingError = (e: PadiAdoptionRefusedError): void => {
      seen.push(e);
    };

    // Dial 1: a transient, retryable hiccup — no report (matches today's fail-open
    // reconnect stance for everything except a genuine refusal).
    reportFatalBindingError(
      padiConnectFailure({ kind: "not-adopted" }, "/sr", "/sock"),
      onFatalBindingError,
    );
    expect(seen).toHaveLength(0);

    // Dial 2 — a RECONNECT: the survivor now at this socket is a genuine contract
    // skew this binder must never touch (#1313). This is the exact case the
    // session's fire-and-forget reconnect loop would otherwise swallow silently.
    const err = padiConnectFailure(
      {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "skew-refused",
          running: {
            contractVersion: "9.0",
            build: daemonBuild(""),
          },
          expected: {
            contractVersion: PADI_SURFACE_VERSION,
            build: daemonBuild("mine"),
          },
          detail: "skew",
        },
      },
      "/sr",
      "/sock",
    );
    reportFatalBindingError(err, onFatalBindingError);
    expect(seen).toEqual([err]);
  });
});

describe("handlePadiBootFailure — the composition root's boot-pin catch (exits ONLY on the fatal classification)", () => {
  it("a PadiAdoptionRefusedError logs FATAL and exits non-zero, naming the conflict + remedy", () => {
    const err = new PadiAdoptionRefusedError(
      "a padi is already serving this workspace — state dir /x, socket /y. " +
        "run with KOLU_STATE_DIR=<dir> for a second instance.",
    );
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(err, {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]?.[1]).toContain("KOLU_STATE_DIR");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("a PadiStateRootGoneError (#2010) logs FATAL and exits non-zero — a deleted workspace is terminal, never a retry", () => {
    const err = new PadiStateRootGoneError("/gone/worktree/.kolu-dev/padi");
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(err, {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]?.[1]).toContain("/gone/worktree/.kolu-dev/padi");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("every other error (transient boot hiccup) logs error and does NOT exit — the fail-open stance", () => {
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(new ConnectError("padi did not come up", "network"), {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("ensurePadiBinding — the #2010 gone-root gate (fork-free: the gate throws before any converge/spawn)", () => {
  it("creates a missing state root at boot; a dial after its deletion reports PadiStateRootGoneError — never a respawn", async () => {
    const parent = mkdtempSync(join(tmpdir(), "padi-goneroot-"));
    // Deliberately NESTED and missing at construct time — pins that the binder
    // OWNS creation (mkdir recursive), the premise that makes "missing later"
    // always proof of deletion rather than a fresh-machine first boot.
    const stateRoot = join(parent, "nested", "padi-state");
    const seen: unknown[] = [];
    let firstVerdict!: (e: unknown) => void;
    const verdictP = new Promise<unknown>((r) => {
      firstVerdict = r;
    });
    let session: PadiSession | undefined;
    try {
      session = ensurePadiBinding({
        stateRoot,
        nixShellWhitelist: "default",
        reconnectDelayMs: 50,
        onFatalBindingError: (e) => {
          seen.push(e);
          firstVerdict(e);
        },
      });
      expect(existsSync(stateRoot)).toBe(true); // the binder created it
      // Delete it BEFORE the first dial (the session dials lazily, on `pin()`),
      // so that dial must hit the gone-root gate at the top of the connector.
      // If the gate ever regressed, the dial would instead reach converge →
      // spawn and surface as the vitest daemon-spawn leash's refusal — a
      // different error class than the one asserted here — so "never a
      // respawn" is observable, not assumed.
      rmSync(parent, { recursive: true, force: true });
      const pinP = session.pin();
      pinP.catch(() => {}); // observed via `verdictP` + the rejects assertion below
      // The hook is the load-bearing reporting path (a RECONNECT dial's verdict
      // is otherwise swallowed by the session's fire-and-forget loop) — assert
      // it fired with the typed error, exactly as the composition root wires it.
      const err = await verdictP;
      expect(err).toBeInstanceOf(PadiStateRootGoneError);
      expect((err as Error).message).toContain(stateRoot);
      // And the boot pin's own await observes the same verdict.
      await expect(pinP).rejects.toBeInstanceOf(PadiStateRootGoneError);
    } finally {
      session?.destroy();
      rmSync(parent, { recursive: true, force: true });
    }
  }, 15000);
});

describeDaemon(
  "ensurePadiBinding — ADOPTS a resident registered under a MISMATCHED drawer (#1713 adopt-path sibling, the live repro)",
  () => {
    // The live repro: a resident padi is registered under ONE runtime drawer; a fresh
    // `ensurePadiBinding` for the SAME state-root, whose OWN env computes a DIFFERENT
    // drawer, must DISCOVER + ADOPT it (fast, no redundant second spawn) rather than
    // wait/hang at its own-env-computed (empty) drawer. Uses the /tmp-vs-XDG direction
    // deterministically reproducible in ANY CI (no dependency on a real login
    // session's `/run/user/$UID`): the resident's OWN env has `$XDG_RUNTIME_DIR`
    // UNSET at spawn time (so it binds at the real `/tmp/padi-<digest>-$UID/`
    // fallback), and the waiter's OWN env is SET to an entirely different temp dir —
    // the exact mirror of the reported bug (an XDG-unset kolu against an XDG-SET
    // resident), proving the SAME cross-regime manifest read-back mechanism.
    it("a waiter whose own env computes a different drawer than a real resident still ADOPTS it — fast, no redundant spawn", async () => {
      const stateRoot = makeStateRoot();
      const waiterDrawer = mkdtempSync(
        join(tmpdir(), "padi-bind-waiter-drawer-"),
      );
      const savedXdg = process.env.XDG_RUNTIME_DIR;
      let residentSession: PadiSession | undefined;
      let waiterSession: PadiSession | undefined;
      try {
        // The RESIDENT: XDG UNSET at spawn time → binds at the real `/tmp` fallback
        // drawer, a drawer the waiter's own env (set below) will NOT compute.
        delete process.env.XDG_RUNTIME_DIR;
        residentSession = ensurePadiBinding({
          stateRoot,
          nixShellWhitelist: "default", // the test runs inside the nix devshell
          reconnectDelayMs: 400,
        });
        // `pin()` resolves with the padi surface client ONLY once the endpoint has
        // actually connected + handshaken — no re-serve/pump needed (this dials padi
        // directly), so its resolution alone proves the resident is genuinely live.
        // biome-ignore lint/suspicious/noExplicitAny: the raw session client is walked structurally, like `roundTripTerminal`'s `padi`.
        const residentClient: any = await residentSession.pin();
        const residentPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
        expect(residentPid).toBeDefined();

        // Create a terminal through the RESIDENT — the fact the WAITER can read it
        // back below is the proof the waiter reached the SAME live registry, not a
        // fresh empty one.
        const { id } = await residentClient.surface.lifecycle.create({
          cwd: makeStateRoot(),
        });
        expect(id).toMatch(/^[0-9a-f-]{36}$/);

        // The WAITER: a FRESH binding for the SAME state root, but its OWN env
        // computes a DIFFERENT (empty) drawer.
        process.env.XDG_RUNTIME_DIR = waiterDrawer;
        waiterSession = ensurePadiBinding({
          stateRoot,
          nixShellWhitelist: "default",
          reconnectDelayMs: 400,
        });
        const startedAt = Date.now();
        // biome-ignore lint/suspicious/noExplicitAny: see `residentClient` above.
        const waiterClient: any = await waiterSession.pin();
        const elapsedMs = Date.now() - startedAt;

        // FAST — never the 30s "daemon socket never came up" hang the bug produced.
        expect(elapsedMs).toBeLessThan(10_000);

        // ADOPTED the resident: the waiter reads the SAME terminal the resident
        // created — a fresh (unadopted) spawn would have an EMPTY registry and this
        // would throw ("terminal not found"), not resolve.
        const screen = await waiterClient.surface.screen.state({ id });
        expect(typeof screen).toBe("string");

        // NEVER spawned a redundant second padi at the waiter's own (empty) drawer.
        expect(
          gatePid(padiGatePath(padiSocketPath(stateRoot))),
        ).toBeUndefined();

        // The ORIGINAL resident is still the SAME pid — never killed/replaced.
        delete process.env.XDG_RUNTIME_DIR;
        expect(gatePid(padiGatePath(padiSocketPath(stateRoot)))).toBe(
          residentPid,
        );
      } finally {
        waiterSession?.destroy();
        residentSession?.destroy();
        // Reap the resident (real `/tmp` drawer) + its detached kaval by gate pid.
        delete process.env.XDG_RUNTIME_DIR;
        reap(stateRoot);
        await sleep(50);
        // Unlike the shared `RUNTIME_ROOT` (a mkdtemp'd wrapper other tests leave
        // behind too), the resident's drawer here is the real top-level `/tmp` — a
        // SIGKILL doesn't unlink it, so remove it explicitly rather than littering
        // `/tmp`'s root with digest-named dirs across test runs.
        rmSync(dirname(padiSocketPath(stateRoot)), {
          recursive: true,
          force: true,
        });
        rmSync(dirname(padiKavalSocketPath(stateRoot)), {
          recursive: true,
          force: true,
        });
        rmSync(waiterDrawer, { recursive: true, force: true });
        if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = savedXdg;
      }
    }, 60000);
  },
);
