/**
 * The padi-process e2e — the W2.2 stage-1 acceptance gate.
 *
 * A REAL spawned `padi` process (under tsx's loader, the shipped launcher shape),
 * anchored to a private state-root, dialed over its digest-keyed unix socket:
 *   - the frozen CONTROL CORE handshakes for real (`control.hello` echoes the
 *     state-root + versions; `control.clockNow` answers);
 *   - a terminal ROUND-TRIPS through `padiSurface` over the socket — padi
 *     spawns-or-adopts its OWN kaval under `kaval-<digest>/`, so `lifecycle.create`
 *     → `terminalAttach` (a snapshot frame) → `sendInput` → `screen.state` shows
 *     the echoed output; and
 *   - two padis at DISTINCT state-roots NEVER touch each other's kaval (the #1313
 *     property, by construction): distinct digests → distinct kaval sockets, and a
 *     terminal live on one is NOT_FOUND on the other.
 *
 * Every padi runs on a shared per-file temp `$XDG_RUNTIME_DIR` (so the digest —
 * not the runtime root — is what isolates them), with its own private state-root,
 * and every test reaps the padi AND the detached kaval it spawned.
 */

import { Effect } from "effect";
import { type ChildProcess, spawn } from "node:child_process";
import type { TerminalAttachFrame } from "./endpoint.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { awaitStdioReadiness } from "@kolu/surface/links/readiness";
import { stdioLink } from "@kolu/surface/links/stdio";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Stream } from "effect";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { probeKavalStatus } from "./hostInventory.ts";
import {
  assertPadiSurfaceCompatible,
  type PadiDaemonClient,
  padiClientOver,
} from "./dial.ts";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "./stateRoot.ts";
import {
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  TOPLEVEL_PLACEMENT,
} from "./surface.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
// Kept in step with the `padi` bin `package.json` declares — #2000 moved the
// entrypoint under `daemonBoot/` and this spawn path was the one reference left
// behind, which only the gated daemon suite exercises (the child died with
// ERR_MODULE_NOT_FOUND, surfacing here as "padi socket never came up").
const PADI_BIN = join(SRC, "daemonBoot", "bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

// Isolate every padi in this file under ONE temp runtime root, so a distinct
// state-root (→ distinct digest) is the ONLY thing separating two padis — the
// exact #1313 property under test. Saved + restored so the change is file-local.
const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "padi-dial-rt-"));
const priorXdg = process.env.XDG_RUNTIME_DIR;
beforeAll(() => {
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
});
afterAll(() => {
  process.env.XDG_RUNTIME_DIR = priorXdg;
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Poll `pred` until it holds or `ms` elapses (then throw `msg`). */
async function waitUntil(
  pred: () => boolean,
  ms: number,
  msg: string,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(100);
  }
  throw new Error(msg);
}

/** A dialed padi: the two typed faces over one link, plus that link's release.
 *  `dispose` is ASYNC now and is the ONLY thing that frees the link's protocol
 *  fibers — destroying the socket alone leaks one per dial. */
interface Conn {
  client: PadiDaemonClient;
  dispose: () => Promise<void>;
}

interface Padi {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
  kavalSocket: string;
}

const spawned: Padi[] = [];

/** Spawn `padi --state-root <sr>` as a real process under tsx's loader (the
 *  shipped launcher shape). padi spawns its OWN kaval from source, detached, so
 *  the child env forces the detached branch (no `KOLU_PADI_BIN`/systemd here) and
 *  scrubs any inherited `INVOCATION_ID` that would divert it to `systemd-run`. */
function spawnPadi(stateRoot: string, bindPid: number = process.pid): Padi {
  assertDaemonSpawnAllowed("a real padi daemon (node --import loader bin.ts)");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    // Bind the real spawned padi (and the kaval it spawns) to `bindPid` — THIS test
    // process by default, so a signal-killed run that skips `afterEach` still can't
    // leak them (they poll the pid and die when it is gone; `afterEach` remains the
    // fast path). The cross-process reap test overrides it with a sentinel it can kill
    // WITHOUT taking vitest down.
    KOLU_DAEMON_BIND_PID: String(bindPid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  // Never let the dial test's padi run the one-shot legacy import (which would
  // touch a real kolu config + write a backup) — its state-root is private.
  delete env.KOLU_STATE_DIR;
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--state-root",
      stateRoot,
      // The test runs inside the nix devshell; padi refuses to spawn PTYs then
      // unless given the env whitelist (else the devshell env leaks into shells).
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    { stdio: ["ignore", "ignore", "ignore"], env },
  );
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const padi: Padi = {
    child,
    exited,
    stateRoot,
    socketPath: padiSocketPath(stateRoot),
    kavalSocket: padiKavalSocketPath(stateRoot),
  };
  spawned.push(padi);
  return padi;
}

async function connect(socketPath: string): Promise<Conn> {
  const link = await unixSocketLink({ group: padiDaemonGroup, socketPath });
  return {
    client: padiClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

/** Poll-connect until padi answers a control-core `hello`, or fail loudly. */
async function waitForPadi(socketPath: string, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await Effect.runPromise(conn.client.control.surface.core.hello());
      await conn.dispose();
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`padi socket never came up: ${socketPath}`);
}

async function startPadi(stateRoot: string): Promise<Padi> {
  const p = spawnPadi(stateRoot);
  await waitForPadi(p.socketPath);
  return p;
}

/** The pid a gate file records (decimal text), or undefined if unreadable. */
function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Reap a padi AND the detached kaval it spawned (which outlives padi by design
 *  — the PTYs survive a padi restart). */
async function reap(p: Padi): Promise<void> {
  p.child.kill("SIGTERM");
  await p.exited;
  const kavalPid = gatePid(join(dirname(p.kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) {
    try {
      process.kill(kavalPid, "SIGKILL");
    } catch {
      // Already gone — nothing to reap.
    }
  }
}

afterEach(async () => {
  for (const p of spawned.splice(0)) {
    if (p.child.exitCode === null) await reap(p);
  }
});

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "padi-dial-sr-"));

/** A `padi --stdio` FRONT child: its piped stdio IS the wire (the ssh transport,
 *  minus ssh), fronting a durable padi daemon it spawned at `stateRoot`. Distinct
 *  from a {@link Padi} whose `child` is the daemon itself. */
interface PadiStdioFront {
  child: ChildProcess;
  exited: Promise<number | null>;
  stateRoot: string;
  socketPath: string;
  kavalSocket: string;
}

const stdioFronts: PadiStdioFront[] = [];

/** Spawn `padi --stdio --state-root <sr>`: the FRONT process, whose stdin/stdout
 *  are piped so a `stdioLink` speaks the combined contract straight through the
 *  byte relay to the durable padi the front adopt-or-spawns. Mirrors `spawnPadi`'s
 *  env scrubbing; stderr is inherited so a fatal `padi --stdio:` line is visible. */
function spawnPadiStdioFront(stateRoot: string): PadiStdioFront {
  assertDaemonSpawnAllowed(
    "a real padi --stdio front (node --import loader bin.ts)",
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    // Bind the durable padi this front spawns (and its kaval) to THIS test process,
    // so a signal-killed run that skips `afterEach` still can't leak them.
    KOLU_DAEMON_BIND_PID: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  const child = spawn(
    process.execPath,
    [
      "--import",
      TSX_LOADER,
      PADI_BIN,
      "--stdio",
      "--state-root",
      stateRoot,
      "--allow-nix-shell-with-env-whitelist",
      "default",
    ],
    { stdio: ["pipe", "pipe", "inherit"], env },
  );
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const front: PadiStdioFront = {
    child,
    exited,
    stateRoot,
    socketPath: padiSocketPath(stateRoot),
    kavalSocket: padiKavalSocketPath(stateRoot),
  };
  stdioFronts.push(front);
  return front;
}

/** The combined daemon client speaking straight through a front's byte relay.
 *  Opened over the WHOLE daemon group, so both siblings' tags are reachable —
 *  the same one-link-two-faces shape `dialPadiHello` builds. */
async function stdioClient(front: PadiStdioFront): Promise<Conn> {
  if (!front.child.stdout || !front.child.stdin)
    throw new Error("stdio front child has no piped stdio");
  // The REAL gate over the REAL front (juspay/kolu#2101): `runPadiStdioBridge`
  // converges the durable padi FIRST and only then greets, so a proof here is
  // evidence that convergence succeeded on the far side — not merely that a
  // process started.
  const readiness = await awaitStdioReadiness({
    read: front.child.stdout,
    deadlineMs: 60_000,
    describe: `padi --stdio front (${front.stateRoot})`,
  });
  const link = await stdioLink({
    group: padiDaemonGroup,
    read: front.child.stdout,
    write: front.child.stdin,
    readiness,
  });
  return {
    client: padiClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

/** Reap a stdio front AND the durable padi it fronted AND that padi's kaval — the
 *  front is a mere proxy, so killing it leaves the detached daemon standing. */
async function reapStdioFront(front: PadiStdioFront): Promise<void> {
  front.child.kill("SIGTERM");
  await front.exited;
  const padiPid = gatePid(padiGatePath(front.socketPath));
  if (padiPid !== undefined) {
    try {
      process.kill(padiPid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  const kavalPid = gatePid(join(dirname(front.kavalSocket), "kaval.pid"));
  if (kavalPid !== undefined) {
    try {
      process.kill(kavalPid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

afterEach(async () => {
  for (const f of stdioFronts.splice(0)) {
    if (f.child.exitCode === null) await reapStdioFront(f);
  }
});

describeDaemon("padi the process — dial acceptance", () => {
  it("handshakes the frozen control core over its socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const hello = await Effect.runPromise(
      conn.client.control.surface.core.hello(),
    );
    // padi echoes its own identity — the resolved state-root it anchored to.
    expect(hello.stateRoot).toBe(resolve(stateRoot));
    expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
    expect(hello.controlCoreVersion).toBe("1.0");
    // …and its boot time, stamped once at daemon init (honest uptime source).
    expect(hello.startedAt).toBeGreaterThan(0);

    const clock = await Effect.runPromise(
      conn.client.control.surface.core.clockNow(),
    );
    expect(clock.epochMs).toBeGreaterThan(0);

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("round-trips a terminal through padiSurface over the socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const { id } = await Effect.runPromise(
      conn.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: makeStateRoot(),
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // terminalAttach is the per-subscriber byte stream — its first frame is the
    // snapshot, straight through the socket (proving the delta/fail-through hop).
    const attach = Stream.toAsyncIterable(
      conn.client.padi.surface.terminalAttach.get({ id }),
    )[Symbol.asyncIterator]();
    const first = await attach.next();
    // The first frame is a `snapshot` (contract 3.0 union): the snapshot bytes
    // plus the absolute backfill seed `topLine` the snapshot frame carries.
    // The stream iterator's value type erases to `{}`, so name the REAL frame
    // union (not a hand-rolled shape) and narrow on its discriminant: the
    // `snapshot` arm carries `data` + the absolute `topLine` seed.
    const firstFrame = first.value as TerminalAttachFrame;
    if (firstFrame.kind !== "snapshot")
      throw new Error(`expected a snapshot frame, got ${firstFrame.kind}`);
    expect(typeof firstFrame.data).toBe("string");
    expect(typeof firstFrame.topLine).toBe("number");

    // Drive the PTY through the lifecycle procedure and read it back off the
    // screen procedure — a full round-trip through padi's OWN kaval.
    await Effect.runPromise(
      conn.client.padi.surface.lifecycle.sendInput({
        id,
        data: "echo DIALMARK\r",
      }),
    );
    let screen = "";
    for (let i = 0; i < 120 && !screen.includes("DIALMARK"); i++) {
      screen = await Effect.runPromise(
        conn.client.padi.surface.screen.state({ id }),
      );
      if (!screen.includes("DIALMARK")) await sleep(50);
    }
    expect(screen).toContain("DIALMARK");

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("two padis at distinct state-roots never touch each other's kaval", async () => {
    const srA = makeStateRoot();
    const srB = makeStateRoot();
    // Distinct state-roots → distinct digests → distinct kaval sockets, under the
    // SAME runtime root. This is the #1313 isolation, by construction.
    expect(padiKavalSocketPath(srA)).not.toBe(padiKavalSocketPath(srB));

    const a = await startPadi(srA);
    const b = await startPadi(srB);
    const connA = await connect(a.socketPath);
    const connB = await connect(b.socketPath);

    const { id } = await Effect.runPromise(
      connA.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: makeStateRoot(),
      }),
    );
    // A's terminal is live on A…
    expect(
      typeof (await Effect.runPromise(
        connA.client.padi.surface.screen.state({ id }),
      )),
    ).toBe("string");
    // …and INVISIBLE to B — its own kaval never saw it (a typed NOT_FOUND).
    await expect(
      Effect.runPromise(connB.client.padi.surface.screen.state({ id })),
    ).rejects.toThrow();

    await connA.dispose();
    await connB.dispose();
    await reap(a);
    await reap(b);
  }, 60000);

  it("the frozen control core stays reachable UNDER a padiSurface version skew", async () => {
    // THE reason the control core exists: when a binder and padi disagree on the
    // `padiSurface` version, the ONE moment you need "restart the other side" is
    // the moment the versioned surface can't be trusted. So the frozen core must
    // be reachable on the SAME socket regardless of the surface-version verdict —
    // if a versioned handshake gated the whole connection, the upgrade path would
    // dead-end and the core would be frozen in name only.
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    // A binder NEWER than this padi — it requires a hypothetical padiSurface 6.0
    // while this padi serves 5.0 — reads the running version from the FROZEN
    // control-core `hello` (the call that must work at a mismatch) and finds it
    // INCOMPATIBLE, so it REFUSES to bind the versioned surface. The required
    // version is spelled one MAJOR above `PADI_SURFACE_VERSION` deliberately: a
    // literal that happened to equal the current constant would silently turn
    // this into an assertion that compatibility HOLDS the day the constant
    // caught up to it, which is exactly how the old "5.0" spelling rotted.
    const hello = await Effect.runPromise(
      conn.client.control.surface.core.hello(),
    );
    expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
    expect(isContractVersionCompatible(hello.surfaceVersion, "6.0")).toBe(
      false,
    );

    // …yet the newer binder can DRAIN this padi on that same socket to converge on
    // the newer closure (persist + exit; the PTYs survive in kaval). This is the
    // upgrade path the frozen core guarantees. The contract is "the caller observes
    // the socket CLOSE", so the drain call may resolve OR reject as the socket tears
    // down mid-response — either way the load-bearing proof is that padi exits
    // cleanly (0), i.e. drain reached the frozen core and did its job.
    await Effect.runPromise(conn.client.control.surface.core.drain()).catch(
      () => {},
    );
    expect(await p.exited).toBe(0);

    try {
      await conn.dispose();
    } catch {
      // padi has already drained + closed the socket — nothing to dispose.
    }
    // padi exited via drain (not our SIGTERM), so afterEach skips it; reap here to
    // SIGKILL the detached kaval it left behind.
    await reap(p);
  }, 40000);

  it("reaps padi AND its kaval when the bound run pid dies (boundToPid, cross-process)", async () => {
    // The class-wide leak fix, proven across the process boundary: a sentinel process
    // stands in for the run/harness, so we can kill IT and watch padi + kaval self-reap
    // without taking vitest down. This is the end-to-end proof the manual verification
    // showed — env → `daemonLifetimeFromEnv` → `boundToPid` reaches a REAL spawned padi,
    // AND padi forwards the bind into the kaval it spawns, so ONE kill of the run pid
    // fells BOTH daemons even when no teardown hook runs.
    const sentinel = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 600000)"],
      { stdio: "ignore" },
    );
    if (sentinel.pid === undefined) throw new Error("sentinel failed to start");
    try {
      const stateRoot = makeStateRoot();
      const p = spawnPadi(stateRoot, sentinel.pid);
      await waitForPadi(p.socketPath);
      const padiGate = padiGatePath(p.socketPath);
      const kavalGate = join(dirname(p.kavalSocket), "kaval.pid");
      // Both daemons are up, gated by their OWN pids (not the sentinel's).
      await waitUntil(
        () => gatePid(kavalGate) !== undefined,
        15000,
        "kaval never came up under the bound padi",
      );
      expect(gatePid(padiGate)).toBeGreaterThan(0);

      // Kill the bound run: both poll it gone (production ~2s cadence) and exit
      // cleanly, RELEASING their gate + socket — nothing left behind a skipped hook.
      sentinel.kill("SIGKILL");
      expect(await p.exited).toBe(0);
      await waitUntil(
        () => gatePid(kavalGate) === undefined,
        15000,
        "kaval did not self-reap after the bound run pid died",
      );
      expect(gatePid(padiGate)).toBeUndefined();
    } finally {
      // If an assertion above threw before the kill, don't leak the sentinel.
      try {
        sentinel.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }, 60000);

  /**
   * The juspay/kolu#2101 N1 field reproduction, with a REAL padi and a REAL
   * kaval: **a comatose kaval must not be survivable.**
   *
   * `SIGSTOP` is the honest reproduction of the incident's presentation, and the
   * reason no existing guard caught it. The process stays ALIVE (`Ss`, 0% CPU),
   * its listening socket stays bound and keeps ACCEPTING connections, and it
   * answers nothing — no rejection, no close, no in-process error, no exit. G2's
   * fault arm sees no fault; the client-silence deadlines (H3/K1/J1) are about a
   * peer that stopped talking to a client, not a daemon that stopped talking at
   * all. In the field this survived a full night: padi diagnosed it in ten
   * seconds and handed the user a card and a button.
   *
   * Post-N1 the streak exhausts the ledger and padi recycles the daemon itself —
   * observed here as the gate file coming to hold a DIFFERENT pid, i.e. a
   * genuinely new kaval process at the same rendezvous.
   */
  it("REPAIRS a comatose kaval by itself — SIGSTOP, no human (#2101 N1)", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const kavalGate = join(dirname(p.kavalSocket), "kaval.pid");
    await waitUntil(
      () => gatePid(kavalGate) !== undefined,
      15000,
      "kaval never came up under the padi",
    );
    const comatose = gatePid(kavalGate);
    if (comatose === undefined) throw new Error("no kaval pid to freeze");

    process.kill(comatose, "SIGSTOP");
    try {
      // The DERIVED bound, summed rather than picked:
      //   ≈45 s  three consecutive probes at the 10 s inventory cadence, each
      //          spending its full 5 s deadline against a peer that never answers;
      //   ≤10 s  the bounded drain (`restartLocal`'s killAll deadline);
      //   ≤125 s `reapHolder`'s ladder — REAP_TERM_CEILING_MS (120 s) is spent in
      //          full here BY DESIGN, because a SIGSTOP'd process cannot handle
      //          SIGTERM and the graceful window is deliberately generous for a
      //          daemon that might be draining gigabytes of scrollback (#1034),
      //          plus REAP_KILL_CEILING_MS (5 s) for the kernel;
      //   ≈10 s  respawn + the fresh daemon's handshake.
      // ≈190 s, so 240 s is that sum with headroom on a loaded box. The claim
      // under test is that repair happens AT ALL with no human — the thing that
      // was false before N1, at any window.
      await waitUntil(
        () => {
          const now = gatePid(kavalGate);
          return now !== undefined && now !== comatose;
        },
        240_000,
        "padi never repaired the comatose kaval — the #2101 field incident, reproduced",
      );
    } finally {
      // A stopped process ignores SIGTERM until continued, so CONTINUE first and
      // only then kill: otherwise the reaper's graceful leg is wasted on a
      // process that cannot receive it. Both are best-effort — padi's own reap
      // ladder has usually already taken it by here.
      try {
        process.kill(comatose, "SIGCONT");
      } catch {
        // Already reaped by padi — which is the happy path.
      }
      try {
        process.kill(comatose, "SIGKILL");
      } catch {
        // Already gone.
      }
    }

    // ...and the daemon that replaced it actually SERVES — the repair is not
    // merely "a new pid exists". A recycled-but-wedged kaval would satisfy the
    // pid check and fail here, which is exactly the distinction the supervisor's
    // own `unrepaired` budget is built on.
    // The SAME probe the supervisor watches through — three read-only verbs over
    // a fresh link — so "repaired" means the identical thing here and in
    // production, rather than a second, weaker definition written for the test.
    const probe = await Effect.runPromise(probeKavalStatus(p.kavalSocket));
    expect(probe.contractVersion).not.toBeNull();
  }, 300_000);
});

describeDaemon(
  "padi the process — dialed over a stdio front (the ssh transport, minus ssh)",
  () => {
    // These prove the SAME control-core handshake + terminal round-trip the socket
    // tests above prove, but through `padi --stdio` + `frontDaemonOverStdio` +
    // `stdioLink` — the exact byte path kolu-server's remote binding rides over ssh
    // (`getHostSession({ binary: "padi", extraArgs: ["--stdio"] })`). No ssh here:
    // the front's own piped stdio is the wire, so the relay is exercised on its own.

    it("handshakes the frozen control core through the byte relay", async () => {
      const stateRoot = makeStateRoot();
      const front = spawnPadiStdioFront(stateRoot);
      // The durable padi comes up behind the front (which adopt-or-spawns it); wait
      // on its digest socket directly, then drive the front's relayed client.
      await waitForPadi(front.socketPath);
      const { client } = await stdioClient(front);

      const hello = await Effect.runPromise(
        client.control.surface.core.hello(),
      );
      expect(hello.stateRoot).toBe(resolve(stateRoot));
      expect(hello.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(hello.controlCoreVersion).toBe("1.0");
      expect(hello.startedAt).toBeGreaterThan(0);

      const clock = await Effect.runPromise(
        client.control.surface.core.clockNow(),
      );
      expect(clock.epochMs).toBeGreaterThan(0);

      await reapStdioFront(front);
    }, 40000);

    it("round-trips a terminal through padiSurface over the byte relay", async () => {
      const stateRoot = makeStateRoot();
      const front = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front.socketPath);
      const { client } = await stdioClient(front);

      const { id } = await Effect.runPromise(
        client.padi.surface.lifecycle.create({
          placement: TOPLEVEL_PLACEMENT,
          cwd: makeStateRoot(),
        }),
      );
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      // terminalAttach is the per-subscriber byte stream (delta/fail-through) — its
      // first frame is the snapshot, relayed straight through the front.
      const attach = Stream.toAsyncIterable(
        client.padi.surface.terminalAttach.get({ id }),
      )[Symbol.asyncIterator]();
      const first = await attach.next();
      // `snapshot` union frame (contract 3.0) relayed straight through the front.
      // The stream iterator's value type erases to `{}`, so name the REAL frame
      // union (not a hand-rolled shape) and narrow on its discriminant: the
      // `snapshot` arm carries `data` + the absolute `topLine` seed.
      const firstFrame = first.value as TerminalAttachFrame;
      if (firstFrame.kind !== "snapshot")
        throw new Error(`expected a snapshot frame, got ${firstFrame.kind}`);
      expect(typeof firstFrame.data).toBe("string");
      expect(typeof firstFrame.topLine).toBe("number");

      await Effect.runPromise(
        client.padi.surface.lifecycle.sendInput({
          id,
          data: "echo FRONTMARK\r",
        }),
      );
      let screen = "";
      for (let i = 0; i < 120 && !screen.includes("FRONTMARK"); i++) {
        screen = await Effect.runPromise(
          client.padi.surface.screen.state({ id }),
        );
        if (!screen.includes("FRONTMARK")) await sleep(50);
      }
      expect(screen).toContain("FRONTMARK");

      await reapStdioFront(front);
    }, 40000);

    it("the durable daemon SURVIVES the front dropping (detach → reattach)", async () => {
      // The mosh/dtach property the remote binding leans on: a front is a proxy, so
      // killing it must leave the padi + its kaval + a live PTY standing, and a
      // FRESH front must adopt the same daemon and find the terminal still there.
      const stateRoot = makeStateRoot();
      const front1 = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front1.socketPath);
      const { client: client1 } = await stdioClient(front1);
      const { id } = await Effect.runPromise(
        client1.padi.surface.lifecycle.create({
          placement: TOPLEVEL_PLACEMENT,
          cwd: makeStateRoot(),
        }),
      );
      await Effect.runPromise(
        client1.padi.surface.lifecycle.sendInput({
          id,
          data: "echo SURVIVOR\r",
        }),
      );

      // Drop the first front (SIGTERM the proxy only) — the detached daemon lives.
      front1.child.kill("SIGTERM");
      await front1.exited;

      // A second front adopts the SAME durable daemon (its socket is still bound),
      // and the terminal created through the first front is still there.
      const front2 = spawnPadiStdioFront(stateRoot);
      await waitForPadi(front2.socketPath);
      const { client: client2 } = await stdioClient(front2);
      let screen = "";
      for (let i = 0; i < 120 && !screen.includes("SURVIVOR"); i++) {
        screen = await Effect.runPromise(
          client2.padi.surface.screen.state({ id }),
        );
        if (!screen.includes("SURVIVOR")) await sleep(50);
      }
      expect(screen).toContain("SURVIVOR");

      await reapStdioFront(front2);
    }, 60000);
  },
);

/**
 * The dial kit's ONE compatibility judgement — pure, no process. Both transports
 * run it: `connectPadi` after the local-socket handshake, and `padi-tui --host`'s
 * ssh probe after the remote control-core `hello`. Testing it here pins the shared
 * gate so the two transports can't drift.
 */
describe("assertPadiSurfaceCompatible", () => {
  const parts = PADI_SURFACE_VERSION.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;

  it("passes an exactly-matching padiSurface version", () => {
    expect(() =>
      assertPadiSurfaceCompatible(PADI_SURFACE_VERSION),
    ).not.toThrow();
  });

  it("passes a newer MINOR (a padi ahead this client can still speak)", () => {
    expect(() =>
      assertPadiSurfaceCompatible(`${major}.${minor + 1}`),
    ).not.toThrow();
  });

  it("REFUSES a newer MAJOR with a loud DaemonContractSkewError", () => {
    expect(() => assertPadiSurfaceCompatible(`${major + 1}.0`)).toThrow(
      DaemonContractSkewError,
    );
    expect(() => assertPadiSurfaceCompatible(`${major + 1}.0`)).toThrow(
      /contract skew/,
    );
  });

  it("REFUSES an older version (a padi too old for this client)", () => {
    // "Too old" is an earlier minor within the same major, or an earlier major
    // entirely. At a `.0` build (this major's floor) only the earlier-major form
    // is expressible, so pick whichever is genuinely older than this build — this
    // keeps the older-skew covered even at a fresh major (4.0), where an in-major
    // older minor doesn't exist.
    const older = minor > 0 ? `${major}.${minor - 1}` : `${major - 1}.0`;
    expect(() => assertPadiSurfaceCompatible(older)).toThrow(
      DaemonContractSkewError,
    );
  });

  it("REFUSES an unparseable version string", () => {
    expect(() => assertPadiSurfaceCompatible("not-a-version")).toThrow(
      DaemonContractSkewError,
    );
  });
});
