/**
 * The standalone-daemon e2e: a REAL spawned `kaval` process, dialed over its
 * unix socket. Two layers:
 *   - the full contract corpus (`contractCorpus.testlib.ts`) over the socket
 *     link, so the daemon is pinned to identity-link behaviour; and
 *   - daemon-only scenarios no in-process test can reach: the single-instance
 *     gate race with real processes, SIGTERM teardown, initFiles materialising
 *     across the process boundary, restart-serves-fresh (no survival in B1),
 *     SIGKILL-mid-attach honesty, and `kaval-tui` driving the real daemon.
 *
 * Every daemon runs on a per-test `mkdtemp` socket (full isolation, no shared
 * $XDG_RUNTIME_DIR), and every test reaps the daemons it spawns.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSurfaceFace } from "@kolu/surface/client";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { DAEMON_BIND_PID_ENV, gatePid } from "@kolu/surface-daemon";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { runContractCorpus, spawnInput } from "./contractCorpus.testlib.ts";
import { KAVAL_GATE_FILE } from "./socketPath.ts";
import { ptyHostSurface } from "./ptyHostSurface.ts";
import { type PtyHostClient, ptyHostClientOver } from "./ptyHostClient.ts";
import { kavalControlSurface } from "./daemonSurface.ts";
import { closeStream, openStream } from "./streamFrame.testlib.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../..");
const KAVAL_BIN = join(SRC, "bin.ts");
const KAVAL_TUI = join(REPO_ROOT, "packages/kaval-tui/src/main.ts");

// Run the daemon IN-PROCESS under tsx's ESM loader — `node --import <loader>
// <file.ts>` — which is the EXACT launcher shape the shipped flake wrapper uses
// (`default.nix`'s `kaval` makeWrapper). With the loader there is exactly one
// process, so a SIGTERM and the exit code reach the daemon directly (its
// `waitForShutdown` runs, the socket + gate are released). The loader (`tsx`'s
// "." export, dist/loader.mjs) is resolved via the package so the spawn doesn't
// depend on a hoisted `.bin/tsx` symlink (pnpm doesn't hoist it to the repo root).
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

// tsx's *CLI* (`tsx bin.ts`) — the launcher shape we DELIBERATELY do NOT ship:
// the CLI forks a child that does NOT relay SIGTERM to the daemon, so it's
// killed (143) with a leaked socket + gate. The launcher guard below spawns this
// to pin that failure mode and justify the loader form in default.nix.
// `dist/cli.mjs` is tsx's `bin`.
const TSX_CLI = createRequire(import.meta.url)
  .resolve("tsx/package.json")
  .replace(/package\.json$/, "dist/cli.mjs");

/** Spawn a TypeScript entry under tsx's in-process loader, as a real child. */
function spawnTs(
  file: string,
  args: string[],
  stdout: "ignore" | "pipe",
): ChildProcess {
  assertDaemonSpawnAllowed("a real kaval daemon (node --import loader bin.ts)");
  return spawn(process.execPath, ["--import", TSX_LOADER, file, ...args], {
    stdio: ["ignore", stdout, "ignore"],
    env: process.env,
  });
}

/** Spawn a TypeScript entry through tsx's CLI — the forking shape the flake
 *  does NOT ship — so the launcher guard can demonstrate its broken SIGTERM
 *  teardown against the working loader form. */
function spawnTsCli(file: string, args: string[]): ChildProcess {
  assertDaemonSpawnAllowed("a real kaval daemon (tsx CLI fork)");
  return spawn(process.execPath, [TSX_CLI, file, ...args], {
    stdio: ["ignore", "ignore", "ignore"],
    env: process.env,
  });
}

/** A dialed daemon: the pty-host face, and the release of the link's scope.
 *  `unixSocketLink` now hands back a transport-neutral `{ dispatch, dispose }`
 *  (S4), so a consumer assembles the face itself — `dispose` is the ONLY thing
 *  that releases the link's protocol fibers, and it is async. */
interface Conn {
  client: PtyHostClient;
  dispose: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface Daemon {
  child: ChildProcess;
  exited: Promise<number | null>;
  socketPath: string;
  gatePath: string;
}

// A per-test reap backstop ONLY for the daemon-only `describe` below — its
// `track()`ed children are SIGKILL'd after each of ITS tests. The corpus's
// shared daemon (spawned in the corpus `beforeAll`) is deliberately NOT tracked
// here: it must outlive every corpus test and is reaped only by the corpus's
// own `dispose`. (An earlier version reaped a single global list after every
// test in the file, which killed the corpus daemon after its first test.)
const trackedChildren: ChildProcess[] = [];
// The rendezvous dirs of the daemon-only block's spawns — reaped BY GATE PID
// after each of ITS tests (below). A child handle alone is not enough: the
// tsx-CLI launcher guard forks a GRANDCHILD daemon, and SIGKILL-ing the tracked
// wrapper never reaches the fork — only its gate pid does. (Same scoping as
// `trackedChildren`: the corpus daemon is not tracked here.)
const trackedRendezvous: string[] = [];
// EVERY rendezvous any spawn (corpus + daemon-only) ever claimed — never spliced,
// so the file-level `afterAll` can assert the whole suite left NO live kaval
// behind and sweep every dir regardless of pass/fail.
const allRendezvous: string[] = [];

// Bind EVERY real kaval this suite spawns to the vitest process (its spawns inherit
// `process.env`), so a signal-killed run that skips the reap hooks still can't
// strand a detached kaval — it polls this pid and dies once vitest is gone. The
// gate-pid reaps below stay the fast path; this is the crash-only backstop, the
// same bind the padi/e2e harnesses set. (The vitest pid outlives every test, so the
// watcher never fires mid-suite — SIGTERM/gate-race/restart assertions are untouched.)
beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** The rendezvous dir a socket lives in, and its gate file within it. */
function rendezvousDir(socketPath: string): string {
  return dirname(socketPath);
}

/** SIGKILL a single pid, tolerating "already gone" (ESRCH). */
function sigkillQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone — nothing to kill.
  }
}

/** How long the graceful-first reap below waits for a SIGTERM'd daemon to run
 *  its shutdown (which disposes every PTY it owns) before escalating. Leaders
 *  die by SIGKILL inside that shutdown, so a healthy daemon is gone in well
 *  under a second; the bound only matters for a wedged one. */
const GRACEFUL_REAP_MS = 4_000;

/** Reap whatever pid holds this rendezvous' gate (the daemon, INCLUDING a
 *  forked grandchild), then remove the dir. GRACEFUL-FIRST: SIGTERM, wait for
 *  the daemon to die running its shutdown — `daemonMain`'s `.finally` awaits
 *  `ptyHost.close()`, which SIGKILLs every PTY leader it owns — and only then
 *  SIGKILL a daemon that would not go. A SIGKILL-first reap strands those
 *  leaders: node-pty `setsid`s each into its OWN session, so no kill aimed at
 *  the daemon (or its group) ever reaches them, and the OS backstop — the
 *  master closing hangs up the leader — misses on darwin whenever the
 *  `spawn-helper` launcher has not yet exec'd (it acquires the controlling tty
 *  only inside its own slave `open()`, so pre-exec there is nobody to hang
 *  up). The aged ppid-1 `spawn-helper <kaval-e2e-cwd-*> /bin/sh` orphans found
 *  on rasam are exactly that residue. ESRCH-safe — a cleanly-exited daemon
 *  left a dead/absent gate, so there's simply nothing to kill. */
async function reapRendezvous(dir: string): Promise<void> {
  const pid = gatePid(join(dir, KAVAL_GATE_FILE));
  if (pid !== undefined && isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Raced its own exit — already gone.
    }
    const deadline = Date.now() + GRACEFUL_REAP_MS;
    while (isAlive(pid) && Date.now() < deadline) await sleep(50);
    // A daemon that sat out the whole window is wedged; SIGKILL is the honest
    // last resort (any leaders it still owned are then visibly leaked to the
    // file-level afterAll assertion, never silently accepted).
    if (isAlive(pid)) sigkillQuietly(pid);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** Is a pid still alive? `kill(pid, 0)` sends no signal — it only probes. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function track<T extends Daemon | ChildProcess>(x: T): T {
  if ("child" in x) {
    trackedChildren.push(x.child);
    trackedRendezvous.push(rendezvousDir(x.socketPath));
  } else {
    trackedChildren.push(x);
  }
  return x;
}

/** Spawn `kaval --socket <path>` as a real process (under tsx). Does NOT wait
 *  for readiness — callers that need it call `waitForSocket`. NOT auto-tracked;
 *  the caller decides its lifetime (corpus dispose vs the daemon-only backstop),
 *  but its rendezvous IS recorded for the file-level leak sweep. */
function launch(socketPath: string): Daemon {
  const child = spawnTs(KAVAL_BIN, ["--socket", socketPath], "ignore");
  const exited = new Promise<number | null>((res) => {
    child.on("exit", (code) => res(code));
  });
  allRendezvous.push(rendezvousDir(socketPath));
  return {
    child,
    exited,
    socketPath,
    gatePath: join(dirname(socketPath), KAVAL_GATE_FILE),
  };
}

// The whole-suite leak assertion (Part 3's pin): after every test has run and
// every block has reaped its own, NO kaval the suite spawned may still hold a
// gate. Compute the verdict first, then sweep every rendezvous unconditionally,
// so a green OR a red run leaves the box clean (a failing test can't strand a
// daemon), and finally assert.
afterAll(async () => {
  const leaked = allRendezvous.filter((dir) => {
    const pid = gatePid(join(dir, KAVAL_GATE_FILE));
    return pid !== undefined && isAlive(pid);
  });
  for (const dir of allRendezvous.splice(0)) await reapRendezvous(dir);
  expect(leaked).toEqual([]);
});

async function connect(socketPath: string): Promise<Conn> {
  const link = await unixSocketLink({
    group: ptyHostSurface.group,
    socketPath,
  });
  return {
    client: ptyHostClientOver(link.dispatch),
    dispose: () => link.dispose(),
  };
}

/** Poll-connect until the daemon answers a heartbeat, or fail loudly. */
async function waitForSocket(socketPath: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await Effect.runPromise(conn.client.surface.system.heartbeat({}));
      await conn.dispose();
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`kaval socket never came up: ${socketPath}`);
}

/** A fresh per-test socket path under its own private dir. */
function socketIn(): string {
  return join(mkdtempSync(join(tmpdir(), "kaval-e2e-")), "pty-host.sock");
}

const makeCwd = (): string => {
  // A cwd for a spawned shell — recorded in `allRendezvous` so the file-level
  // sweep removes it too (it has no gate, so `reapRendezvous` just `rmSync`s it).
  // Without this the harness leaked an empty `kaval-e2e-cwd-*` dir per spawn.
  const dir = mkdtempSync(join(tmpdir(), "kaval-e2e-cwd-"));
  allRendezvous.push(dir);
  return dir;
};

/** Start a daemon and wait until it serves. */
async function startDaemon(): Promise<Daemon> {
  const d = launch(socketIn());
  await waitForSocket(d.socketPath);
  return d;
}

async function reap(d: Daemon): Promise<void> {
  d.child.kill("SIGTERM");
  await d.exited;
}

/** Run `kaval-tui <args>` to completion; capture stdout, stderr + exit code. */
function runKavalTui(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // The runtime leash at the fork site (per-call-site, like spawnTs/spawnTsCli above):
  // this re-execs a real kaval-tui, so a gate-off vitest must never reach it.
  assertDaemonSpawnAllowed("a real kaval-tui (node --import loader)");
  return new Promise((resolvePromise) => {
    const child = track(
      spawn(process.execPath, ["--import", TSX_LOADER, KAVAL_TUI, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      }),
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr?.on("data", (b) => {
      stderr += String(b);
    });
    child.on("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

// ── The contract corpus, over a real spawned daemon's socket ────────────────
runContractCorpus({
  label: "spawned daemon socket",
  makeHost: async () => {
    const d = await startDaemon();
    const conn = await connect(d.socketPath);
    return {
      client: conn.client,
      // A negative-path test that closes the multiplexed transport gets its own
      // throwaway connection to the SAME daemon, so it never poisons the shared
      // corpus connection.
      isolated: async () => {
        const probe = await connect(d.socketPath);
        return { client: probe.client, dispose: () => probe.dispose() };
      },
      dispose: async () => {
        await conn.dispose();
        await reap(d);
      },
    };
  },
  makeCwd,
});

// ── Daemon-only scenarios ───────────────────────────────────────────────────
describeDaemon("kaval daemon — process-boundary behaviour", () => {
  // Backstop: reap every daemon/tui this block spawned that a failing test left
  // alive — SIGKILL the tracked child handles AND reap each rendezvous by its
  // gate pid (which reaches a forked GRANDCHILD the child handle can't). Runs
  // after EVERY test, pass or fail, so a failing assertion can't strand a daemon.
  // Scoped to THIS describe, so it never touches the corpus's shared daemon.
  afterEach(async () => {
    // Rendezvous reap FIRST: the tracked child handles include these very
    // daemons, and SIGKILL-ing a handle before its rendezvous reap would
    // forfeit the graceful window in which the daemon disposes its PTY
    // leaders — recreating the exact strand the graceful-first reap exists to
    // prevent. The handle sweep after is the backstop for non-daemon children
    // (kaval-tui runs) and for a daemon the graceful reap already escalated on.
    for (const dir of trackedRendezvous.splice(0)) await reapRendezvous(dir);
    for (const c of trackedChildren.splice(0)) {
      if (c.exitCode === null) c.kill("SIGKILL");
    }
  });

  it("serves frozen identity beside the unchanged pty surface and refuses drain without exiting", async () => {
    const d = track(await startDaemon());
    // ONE link over the daemon's composed group, two faces on top of it — each
    // built from the STANDALONE surface it belongs to, so neither learns it is
    // talking to a composed daemon. That is the flat tag namespace's whole
    // payoff, and it is what the old `implement(widenedContract as any)` splice
    // existed to fake.
    const link = await unixSocketLink({
      group: ptyHostSurface.group.merge(kavalControlSurface.group),
      socketPath: d.socketPath,
    });
    try {
      const pty = ptyHostClientOver(link.dispatch);
      const control = buildSurfaceFace(kavalControlSurface, link.dispatch)
        .surface.core as {
        hello(): Effect.Effect<Record<string, unknown>, unknown>;
        drain(): Effect.Effect<void, unknown>;
      };

      const version = await Effect.runPromise(pty.surface.system.version({}));
      const hello = await Effect.runPromise(control.hello());
      expect(hello.surfaceVersion).toBe(version.contractVersion);
      expect(hello.startedAt).toBe(version.startedAt);

      // kaval cannot drain (ending the process destroys its live PTYs), and the
      // frozen `core.drain` declares no error schema — so the refusal crosses as
      // an undeclared DEFECT (PLAN D4). What a caller relies on is unchanged: it
      // REJECTS, and the daemon is demonstrably still there afterwards.
      await expect(Effect.runPromise(control.drain())).rejects.toThrow();
      await expect(Effect.runPromise(control.hello())).resolves.toEqual(hello);
      expect(isAlive(d.child.pid ?? -1)).toBe(true);
    } finally {
      await link.dispose();
    }
  }, 30000);

  it("single-instance gate: a second kaval yields (exit 0); a SIGKILL'd one leaves a stale gate the next reaps", async () => {
    const socketPath = socketIn();
    const a = track(launch(socketPath));
    await waitForSocket(socketPath);

    // A second daemon on the same socket sees the live gate and exits 0.
    const b = track(launch(socketPath));
    expect(await b.exited).toBe(0);

    // A is still serving.
    const c1 = await connect(socketPath);
    await Effect.runPromise(c1.client.surface.system.heartbeat({}));
    await c1.dispose();

    // SIGKILL A — no graceful gate release, so it leaves a stale gate.
    a.child.kill("SIGKILL");
    await a.exited;

    // C reaps the stale gate and serves.
    const c = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect(
      (await Effect.runPromise(c2.client.surface.terminal.list({}))).entries,
    ).toEqual([]);
    await c2.dispose();
    await reap(c);
  }, 30000);

  it("graceful shutdown reaps a non-tty-aware PTY leader — no orphaned spawn-helper", async () => {
    // A daemon asked to stop (SIGTERM here; in production the detached daemon
    // self-exits the same way when its bound run pid vanishes) must reap the
    // node-pty children it owns. node-pty `setsid`s each PTY into its own
    // session, so the daemon dying can NEVER let a process-group kill reach them
    // — only the host disposing each entry (SIGHUP to the leader) does. Before
    // shutdown was wired to dispose, a SIGTERM'd daemon left the `spawn-helper`
    // subtree reparented to init and alive, leaking across CI runs (aged orphans
    // found on rasam) and loading the box — the darwin-under-load flake substrate.
    //
    // The pin is a DIRECTLY-spawned, non-tty-aware leader (a bare `sleep`): it
    // neither reads the pty (so it can't self-exit on the master's EOF) nor
    // watches the tty — so, unlike a SHELL leader (which reliably self-reaps on
    // the master's hangup), it cannot RELIABLY be reaped by the OS. darwin's
    // master-close does hang it up, but only intermittently (observed leaking
    // once, then reaped on a later 5/5 batch — the aged rasam orphans are that
    // unreliable tail); the daemon's explicit dispose makes the reap
    // DETERMINISTIC, which is the fix. A leader that HAS foreground descendants is
    // reaped whole anyway — the leader's death hangs up its foreground group
    // (kernel), so the descendants go with it — and a real shell leader self-reaps
    // on the hangup regardless. Both were verified on rasam: every shell-involved
    // topology passes even WITHOUT the fix, so the honest reproduction is this
    // non-self-reaping leader.
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: ["sleep", "100000"],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm" },
        initFiles: [],
      }),
    );
    await conn.dispose();
    expect(isAlive(pid)).toBe(true);

    try {
      // Graceful stop — daemonMain's shutdown `.finally` awaits the host close,
      // which must dispose (SIGKILL) the PTY leader before the process exits.
      await reap(d);

      // Reaping is async; poll briefly. RED before the fix: the leader stays
      // alive past the window (leaked). GREEN after: it is gone.
      for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100);
      expect(isAlive(pid)).toBe(false);
    } finally {
      // Never let THIS test strand the leader (e.g. on a RED assertion) — that
      // would leak exactly the process the test guards against.
      sigkillQuietly(pid);
    }
  }, 30000);

  it("the rendezvous backstop reaps a daemon's PTY leaders — even one the master-close hangup cannot kill", async () => {
    // The backstop (afterEach/afterAll → `reapRendezvous`) reaps daemons a
    // failing test left behind. Reaping the DAEMON alone is not enough: each
    // PTY leader lives in its own session, so only the daemon's own graceful
    // shutdown (dispose → SIGKILL per leader) reaches it. The leader here
    // ignores SIGHUP before exec'ing — modelling the class the OS cannot reap
    // for us. On darwin that class includes every spawn-helper still pre-exec
    // (no controlling tty yet, so the dying master hangs up nobody): the aged
    // ppid-1 orphans found on rasam. A SIGKILL-first backstop leaks this
    // leader on EVERY platform (verified red on linux); the graceful-first
    // backstop reaps it deterministically.
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: ["/bin/sh", "-c", "trap '' HUP; exec sleep 100000"],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", TERM: "xterm" },
        initFiles: [],
      }),
    );
    await conn.dispose();
    expect(isAlive(pid)).toBe(true);

    try {
      // The exact call the afterEach/afterAll backstops make on a rendezvous
      // whose daemon is still alive.
      await reapRendezvous(rendezvousDir(d.socketPath));

      // Graceful-first: the daemon died by running its shutdown (exit 0, not a
      // SIGKILL's null), and that shutdown took the HUP-immune leader with it.
      expect(await d.exited).toBe(0);
      for (let i = 0; i < 50 && isAlive(pid); i++) await sleep(100);
      expect(isAlive(pid)).toBe(false);
    } finally {
      // Never let THIS test strand the leader it built to be unreapable.
      sigkillQuietly(pid);
    }
  }, 30000);

  it("SIGTERM teardown removes the socket and releases the gate", async () => {
    const d = track(await startDaemon());
    expect(existsSync(d.socketPath)).toBe(true);
    expect(existsSync(d.gatePath)).toBe(true);

    await reap(d);
    expect(existsSync(d.socketPath)).toBe(false);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 30000);

  it("the launcher choice is load-bearing: tsx's CLI fork swallows SIGTERM teardown; the loader form (the shipped wrapper) does not", async () => {
    // The flake wrapper launches kaval as `node --import <tsx loader> bin.ts`,
    // NOT `tsx bin.ts`. This pins WHY: tsx's CLI forks a child that does NOT
    // relay SIGTERM to the daemon's `waitForShutdown`, so the daemon is killed
    // (143) and LEAKS its socket + gate; the one-process loader form delivers
    // the signal and the daemon tears itself down cleanly (exit 0, both gone).
    // If someone "simplifies" the wrapper back to `tsx bin.ts`, this guard fires.
    const startGet = (
      spawnFn: (file: string, args: string[]) => ChildProcess,
    ): Promise<{
      code: number | null;
      socketLeft: boolean;
      gateLeft: boolean;
    }> =>
      (async () => {
        const socketPath = socketIn();
        const gatePath = join(dirname(socketPath), KAVAL_GATE_FILE);
        // The tsx-CLI shape FORKS a grandchild daemon that outlives the tracked
        // wrapper (the leak this guard demonstrates). Register the rendezvous so
        // the afterEach reaps that fork BY GATE PID; the wrapper alone can't.
        trackedRendezvous.push(rendezvousDir(socketPath));
        allRendezvous.push(rendezvousDir(socketPath));
        const child = track(spawnFn(KAVAL_BIN, ["--socket", socketPath]));
        const exited = new Promise<number | null>((res) =>
          child.on("exit", (code) => res(code)),
        );
        await waitForSocket(socketPath);
        child.kill("SIGTERM");
        const code = await exited;
        return {
          code,
          socketLeft: existsSync(socketPath),
          gateLeft: existsSync(gatePath),
        };
      })();

    // The shipped shape: clean shutdown, exit 0, nothing left behind.
    const loader = await startGet((f, a) => spawnTs(f, a, "ignore"));
    expect(loader.code).toBe(0);
    expect(loader.socketLeft).toBe(false);
    expect(loader.gateLeft).toBe(false);

    // The forking CLI shape: killed by the signal (143) with a leaked socket +
    // gate — the failure mode that justifies the loader form in default.nix.
    const cli = await startGet(spawnTsCli);
    expect(cli.code).not.toBe(0);
    expect(cli.socketLeft || cli.gateLeft).toBe(true);
  }, 30000);

  it("initFiles materialise under the daemon's rcDir across the process boundary, then are removed on exit", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const info = await Effect.runPromise(conn.client.surface.system.info({}));
    const rcName = "corpus-initfile";
    const rcPath = join(info.rcDir, rcName);

    const { id } = await Effect.runPromise(
      conn.client.surface.terminal.spawn({
        argv: [info.shell],
        cwd: makeCwd(),
        env: { PATH: process.env.PATH ?? "", HOME: info.home },
        initFiles: [{ name: rcName, content: "# corpus init marker\n" }],
      }),
    );
    // The file the client named landed on the daemon's disk.
    expect(existsSync(rcPath)).toBe(true);

    await Effect.runPromise(conn.client.surface.terminal.kill({ id }));
    // onDispose removes it; poll briefly for the async cleanup.
    for (let i = 0; i < 60 && existsSync(rcPath); i++) await sleep(50);
    expect(existsSync(rcPath)).toBe(false);

    await conn.dispose();
    await reap(d);
  }, 30000);

  it("a restart on the same socket serves fresh — B1 makes no survival promise", async () => {
    const socketPath = socketIn();
    const first = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c1 = await connect(socketPath);
    await Effect.runPromise(
      c1.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );
    expect(
      (await Effect.runPromise(c1.client.surface.terminal.list({}))).entries,
    ).toHaveLength(1);
    await c1.dispose();
    await reap(first);

    const second = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect(
      (await Effect.runPromise(c2.client.surface.terminal.list({}))).entries,
    ).toEqual([]);
    await c2.dispose();
    await reap(second);
  }, 30000);

  it("SIGKILL mid-attach: the client's stream errors or ends — it does not hang", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { id, pid } = await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );
    try {
      const iterator = openStream(
        conn.client.surface.terminalAttach.get({ id }),
      );
      await iterator.next(); // the snapshot frame

      // Kill the daemon outright; the next pull must settle (reject or end), not hang.
      d.child.kill("SIGKILL");
      await d.exited;

      const outcome = await Promise.race([
        iterator
          .next()
          .then(() => "settled" as const)
          .catch(() => "errored" as const),
        sleep(6000).then(() => "hung" as const),
      ]);
      expect(outcome).not.toBe("hung");
      closeStream(iterator);
      // The socket is already gone (daemon SIGKILL'd), so releasing the link's
      // scope is a no-op on a dead transport — never a failure to surface here.
      await conn.dispose().catch(() => {});
    } finally {
      // This test SIGKILLs the daemon ON PURPOSE, so nothing ever disposes the
      // PTY it just spawned: the leader sits in its own session (setsid) where
      // no kill aimed at the daemon reaches it, and the OS backstop (the dying
      // master hanging up the leader) misses on darwin whenever the
      // spawn-helper launcher hasn't exec'd yet — the ppid-1
      // `spawn-helper <kaval-e2e-cwd-*> /bin/sh` orphans aged days on rasam
      // came from this very spawn. The strander reaps what it strands.
      sigkillQuietly(pid);
    }
  }, 30000);

  it("kaval-tui drives the real daemon: `list` exits 0 and reflects spawns", async () => {
    const d = track(await startDaemon());

    const empty = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("no live terminals");

    const conn = await connect(d.socketPath);
    await Effect.runPromise(
      conn.client.surface.terminal.spawn(spawnInput(makeCwd())),
    );

    const populated = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(populated.code).toBe(0);
    expect(populated.stdout).not.toContain("no live terminals");

    await conn.dispose();
    await reap(d);
  }, 30000);

  it("kaval-tui create: the CLI spawns through main.ts and the id is then listable", async () => {
    const d = track(await startDaemon());

    // Drive the REAL cleye boundary: `[command...]` after `--` (so the command
    // keeps its own flags), `--json` for a scriptable `{ id }`, the daemon
    // socket. This proves dispatch + positional + `--` + `--json` + stdout, not
    // just `buildCreateInput` in isolation.
    const created = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--json",
      "--",
      "sh",
      "-c",
      "echo CREATEMARK; sleep 100",
    ]);
    expect(created.code).toBe(0);
    // `--json` keeps stdout to the scriptable object — the next-step hint is
    // suppressed there (it rides stderr only on the human path, asserted below).
    const { id } = JSON.parse(created.stdout) as { id: string };
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // The human (non-`--json`) path prints the one-line `spawned …` to stdout
    // and the `attach with …` next-step hint to STDERR, so stdout stays the
    // scriptable spawn line.
    const human = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--",
      "sh",
      "-c",
      "sleep 100",
    ]);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/^spawned /);
    expect(human.stderr).toContain("attach with `kaval-tui attach");

    // The freshly-minted terminal is live on the daemon — `list` sees the FULL
    // id (the form `--json` carries), so create→list round-trips end to end.
    const listed = await runKavalTui([
      "list",
      "--socket",
      d.socketPath,
      "--json",
    ]);
    expect(listed.code).toBe(0);
    const entries = JSON.parse(listed.stdout) as Array<{ id: string }>;
    expect(entries.some((e) => e.id === id)).toBe(true);

    // …and its screen shows the command's output, proving the `[command...]`
    // positional reached the host's spawn (not a plain $SHELL).
    const conn = await connect(d.socketPath);
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("CREATEMARK"); i++) {
      screen = (
        await Effect.runPromise(
          conn.client.surface.terminal.getScreenText({ id }),
        )
      ).text;
      if (!screen.includes("CREATEMARK")) await sleep(50);
    }
    expect(screen).toContain("CREATEMARK");
    await conn.dispose();

    await reap(d);
  }, 30000);

  it("kaval-tui create: stamps KAVAL_SOCKET so a process inside can reach its daemon", async () => {
    const d = track(await startDaemon());

    // The whole point of the $TMUX-style stamp: a shell spawned in this daemon
    // has KAVAL_SOCKET pointing at the very socket that owns it, so an agent
    // running inside can drive its siblings without scanning /tmp. Echo it from
    // the spawned shell and read it back off the screen — proving the full chain
    // (CLI resolves the socket → buildCreateInput stamps it → host spawns → the
    // shell inherits it), which no unit test on buildCreateInput alone can.
    const created = await runKavalTui([
      "create",
      "--socket",
      d.socketPath,
      "--json",
      "--",
      "sh",
      "-c",
      'echo "KS=[$KAVAL_SOCKET]"; sleep 100',
    ]);
    expect(created.code).toBe(0);
    const { id } = JSON.parse(created.stdout) as { id: string };

    const conn = await connect(d.socketPath);
    let screen = "";
    for (let i = 0; i < 100 && !screen.includes("KS=["); i++) {
      screen = (
        await Effect.runPromise(
          conn.client.surface.terminal.getScreenText({ id }),
        )
      ).text;
      if (!screen.includes("KS=[")) await sleep(50);
    }
    expect(screen).toContain(`KS=[${d.socketPath}]`);
    await conn.dispose();

    await reap(d);
  }, 30000);

  it("a flag BEFORE the subcommand fails with a flag-order hint, not silent help", async () => {
    // cleye binds flags only after the subcommand, so `--socket X list` makes it
    // lose the command. Rather than print bare help (which read as a no-op), the
    // CLI must steer the user to the right order with a non-zero exit. No daemon
    // needed — this fails at arg parsing, before any connect.
    const wrong = await runKavalTui(["--socket", "/whatever", "list"]);
    expect(wrong.code).not.toBe(0);
    expect(wrong.stderr).toContain("AFTER the subcommand");
    // And the conventional order is accepted as far as arg parsing (it then
    // fails to connect to the bogus path — a *different*, honest error).
    const right = await runKavalTui([
      "list",
      "--socket",
      "/no/such/kaval.sock",
    ]);
    expect(right.code).not.toBe(0);
    expect(right.stderr).toContain("no socket at /no/such/kaval.sock");
  }, 30000);

  it("--host and --socket are mutually exclusive: passing both fails with a clear hint", async () => {
    // The remote (--host, an ssh target) and local (--socket, a path) transports
    // name two different daemons, so passing both is a usage error rejected at
    // arg validation — before any connect, so no daemon or ssh is involved.
    const both = await runKavalTui([
      "list",
      "--host",
      "nix@prod",
      "--socket",
      "/some/where.sock",
    ]);
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain("mutually exclusive");
  }, 30000);
});
