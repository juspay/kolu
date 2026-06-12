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
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { afterEach, describe, expect, it } from "vitest";
import { runContractCorpus, spawnInput } from "./contractCorpus.testlib.ts";
import type { ptyHostSurface } from "./ptyHostSurface.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../..");
const KAVAL_BIN = join(SRC, "bin.ts");
const KAVAL_TUI = join(REPO_ROOT, "packages/kaval-tui/src/main.ts");

// Run the daemon IN-PROCESS under tsx's ESM loader — `node --import tsx
// <file.ts>` — rather than tsx's CLI, which forks a child: with the loader
// there is exactly one process, so a SIGTERM and the exit code reach the
// daemon directly (no wrapper swallowing them). The loader (`tsx`'s "." export,
// dist/loader.mjs) is resolved via the package so the spawn doesn't depend on a
// hoisted `.bin/tsx` symlink (pnpm doesn't hoist it to the repo root).
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

/** Spawn a TypeScript entry under tsx's in-process loader, as a real child. */
function spawnTs(
  file: string,
  args: string[],
  stdout: "ignore" | "pipe",
): ChildProcess {
  return spawn(process.execPath, ["--import", TSX_LOADER, file, ...args], {
    stdio: ["ignore", stdout, "ignore"],
    env: process.env,
  });
}

type Conn = UnixSocketConnection<typeof ptyHostSurface.contract>;

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
function track<T extends { child: ChildProcess } | ChildProcess>(x: T): T {
  trackedChildren.push("child" in x ? x.child : x);
  return x;
}

/** Spawn `kaval --socket <path>` as a real process (under tsx). Does NOT wait
 *  for readiness — callers that need it call `waitForSocket`. NOT auto-tracked;
 *  the caller decides its lifetime (corpus dispose vs the daemon-only backstop). */
function launch(socketPath: string): Daemon {
  const child = spawnTs(KAVAL_BIN, ["--socket", socketPath], "ignore");
  const exited = new Promise<number | null>((res) => {
    child.on("exit", (code) => res(code));
  });
  return {
    child,
    exited,
    socketPath,
    gatePath: join(dirname(socketPath), "kaval.pid"),
  };
}

function connect(socketPath: string): Promise<Conn> {
  return unixSocketLink<typeof ptyHostSurface.contract>({ socketPath });
}

/** Poll-connect until the daemon answers a heartbeat, or fail loudly. */
async function waitForSocket(socketPath: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await conn.client.surface.system.heartbeat({});
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

const makeCwd = (): string => mkdtempSync(join(tmpdir(), "kaval-e2e-cwd-"));

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

/** Run `kaval-tui <args>` to completion; capture stdout + exit code. */
function runKavalTui(
  args: string[],
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = track(spawnTs(KAVAL_TUI, args, "pipe"));
    let stdout = "";
    child.stdout?.on("data", (b) => {
      stdout += String(b);
    });
    child.on("exit", (code) => resolvePromise({ code, stdout }));
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
        conn.dispose();
        await reap(d);
      },
    };
  },
  makeCwd,
});

// ── Daemon-only scenarios ───────────────────────────────────────────────────
describe("kaval daemon — process-boundary behaviour", () => {
  // Backstop: SIGKILL any daemon/tui this block spawned that a failing test
  // left alive. Scoped to THIS describe, so it never touches the corpus's
  // shared daemon (which lives under a different describe's lifecycle).
  afterEach(() => {
    for (const c of trackedChildren.splice(0)) {
      if (c.exitCode === null) c.kill("SIGKILL");
    }
  });

  it("single-instance gate: a second kaval yields (exit 0); a SIGKILL'd one leaves a stale gate the next reaps", async () => {
    const socketPath = socketIn();
    const a = track(launch(socketPath));
    await waitForSocket(socketPath);

    // A second daemon on the same socket sees the live gate and exits 0.
    const b = track(launch(socketPath));
    expect(await b.exited).toBe(0);

    // A is still serving.
    const c1 = await connect(socketPath);
    await c1.client.surface.system.heartbeat({});
    await c1.dispose();

    // SIGKILL A — no graceful gate release, so it leaves a stale gate.
    a.child.kill("SIGKILL");
    await a.exited;

    // C reaps the stale gate and serves.
    const c = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect((await c2.client.surface.terminal.list({})).entries).toEqual([]);
    await c2.dispose();
    await reap(c);
  }, 30000);

  it("SIGTERM teardown removes the socket and releases the gate", async () => {
    const d = track(await startDaemon());
    expect(existsSync(d.socketPath)).toBe(true);
    expect(existsSync(d.gatePath)).toBe(true);

    await reap(d);
    expect(existsSync(d.socketPath)).toBe(false);
    expect(existsSync(d.gatePath)).toBe(false);
  }, 30000);

  it("initFiles materialise under the daemon's rcDir across the process boundary, then are removed on exit", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const info = await conn.client.surface.system.info({});
    const rcName = "corpus-initfile";
    const rcPath = join(info.rcDir, rcName);

    const { id } = await conn.client.surface.terminal.spawn({
      argv: [info.shell],
      cwd: makeCwd(),
      env: { PATH: process.env.PATH ?? "", HOME: info.home },
      initFiles: [{ name: rcName, content: "# corpus init marker\n" }],
    });
    // The file the client named landed on the daemon's disk.
    expect(existsSync(rcPath)).toBe(true);

    await conn.client.surface.terminal.kill({ id });
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
    await c1.client.surface.terminal.spawn(spawnInput(makeCwd()));
    expect((await c1.client.surface.terminal.list({})).entries).toHaveLength(1);
    await c1.dispose();
    await reap(first);

    const second = track(launch(socketPath));
    await waitForSocket(socketPath);
    const c2 = await connect(socketPath);
    expect((await c2.client.surface.terminal.list({})).entries).toEqual([]);
    await c2.dispose();
    await reap(second);
  }, 30000);

  it("SIGKILL mid-attach: the client's stream errors or ends — it does not hang", async () => {
    const d = track(await startDaemon());
    const conn = await connect(d.socketPath);
    const { id } = await conn.client.surface.terminal.spawn(
      spawnInput(makeCwd()),
    );
    const iterator = (await conn.client.surface.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
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
    try {
      conn.dispose();
    } catch {
      // The socket is already gone (daemon SIGKILL'd) — nothing to dispose.
    }
  }, 30000);

  it("kaval-tui drives the real daemon: `list` exits 0 and reflects spawns", async () => {
    const d = track(await startDaemon());

    const empty = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("no live terminals");

    const conn = await connect(d.socketPath);
    await conn.client.surface.terminal.spawn(spawnInput(makeCwd()));

    const populated = await runKavalTui(["list", "--socket", d.socketPath]);
    expect(populated.code).toBe(0);
    expect(populated.stdout).not.toContain("no live terminals");

    await conn.dispose();
    await reap(d);
  }, 30000);
});
