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

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { padiKavalSocketPath, padiSocketPath } from "./stateRoot.ts";
import type { PadiDaemonContract } from "./surface.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const PADI_BIN = join(SRC, "bin.ts");
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

type Conn = UnixSocketConnection<PadiDaemonContract>;

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
function spawnPadi(stateRoot: string): Padi {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
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

function connect(socketPath: string): Promise<Conn> {
  return unixSocketLink<PadiDaemonContract>({ socketPath });
}

/** Poll-connect until padi answers a control-core `hello`, or fail loudly. */
async function waitForPadi(socketPath: string, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const conn = await connect(socketPath);
      await conn.client.surface.control.core.hello();
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

describe("padi the process — dial acceptance", () => {
  it("handshakes the frozen control core over its socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const hello = await conn.client.surface.control.core.hello();
    // padi echoes its own identity — the resolved state-root it anchored to.
    expect(hello.stateRoot).toBe(resolve(stateRoot));
    expect(hello.surfaceVersion).toBe("1.0");
    expect(hello.controlCoreVersion).toBe("1.0");

    const clock = await conn.client.surface.control.core.clockNow();
    expect(clock.epochMs).toBeGreaterThan(0);

    await conn.dispose();
    await reap(p);
  }, 40000);

  it("round-trips a terminal through padiSurface over the socket", async () => {
    const stateRoot = makeStateRoot();
    const p = await startPadi(stateRoot);
    const conn = await connect(p.socketPath);

    const { id } = await conn.client.surface.padi.lifecycle.create({
      cwd: makeStateRoot(),
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // terminalAttach is the per-subscriber byte stream — its first frame is the
    // snapshot, straight through the socket (proving the delta/fail-through hop).
    const attach = (await conn.client.surface.padi.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    const first = await attach.next();
    expect(typeof first.value).toBe("string");

    // Drive the PTY through the lifecycle procedure and read it back off the
    // screen procedure — a full round-trip through padi's OWN kaval.
    await conn.client.surface.padi.lifecycle.sendInput({
      id,
      data: "echo DIALMARK\r",
    });
    let screen = "";
    for (let i = 0; i < 120 && !screen.includes("DIALMARK"); i++) {
      screen = await conn.client.surface.padi.screen.state({ id });
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

    const { id } = await connA.client.surface.padi.lifecycle.create({
      cwd: makeStateRoot(),
    });
    // A's terminal is live on A…
    expect(typeof (await connA.client.surface.padi.screen.state({ id }))).toBe(
      "string",
    );
    // …and INVISIBLE to B — its own kaval never saw it (a typed NOT_FOUND).
    await expect(
      connB.client.surface.padi.screen.state({ id }),
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

    // A binder NEWER than this padi (it requires padiSurface 2.0; padi serves 1.0)
    // reads the running version from the FROZEN control-core `hello` — the call
    // that must work at a mismatch — and finds it INCOMPATIBLE, so it REFUSES to
    // bind the versioned surface.
    const hello = await conn.client.surface.control.core.hello();
    expect(hello.surfaceVersion).toBe("1.0");
    expect(isContractVersionCompatible(hello.surfaceVersion, "2.0")).toBe(
      false,
    );

    // …yet the newer binder can DRAIN this padi on that same socket to converge on
    // the newer closure (persist + exit; the PTYs survive in kaval). This is the
    // upgrade path the frozen core guarantees. The contract is "the caller observes
    // the socket CLOSE", so the drain call may resolve OR reject as the socket tears
    // down mid-response — either way the load-bearing proof is that padi exits
    // cleanly (0), i.e. drain reached the frozen core and did its job.
    await conn.client.surface.control.core.drain().catch(() => {});
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
});
