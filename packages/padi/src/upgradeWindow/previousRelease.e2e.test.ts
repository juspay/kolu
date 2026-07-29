/**
 * The real thing, once — boot the PREVIOUS RELEASE's kaval, then bring up the
 * CURRENT build's padi against it and drive Restart kaval (`lifecycle.recycleKaval`).
 *
 * Slow by design: resolves the previous kaval binary (env override from the CI
 * recipe, or `nix build` of the latest version tag after `git fetch --tags`),
 * spawns it at the digest-keyed socket for a private state-root, starts current
 * padi, creates a terminal, recycles, asserts the daemon was replaced and the
 * session survived (parked for restore). Also grounds the shared-artifact
 * inventory against the live runtime dir + state-root (unknown non-log files
 * fail the suite).
 *
 * Own CI recipe (`ci::upgrade-window`) so the ordinary daemon lane stays
 * fast. Generous timeouts; deterministic waits (poll readiness, never
 * sleep-and-hope).
 *
 * Under `KOLU_UPGRADE_WINDOW_REQUIRE=1` (CI): the previous ref MUST be a version
 * tag and the previous kaval store path MUST differ from current #kaval — a
 * same-version collapse is a hard fail, not a green same-checkout recycle.
 */

import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { DAEMON_BIND_PID_ENV, gatePid } from "@kolu/surface-daemon";
import {
  assertPreviousReleaseWindow,
  createProcessReaper,
  runPreviousReleaseWindow,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
  waitForSocket,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { KAVAL_GATE_FILE } from "kaval";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
  writeStateRootManifest,
} from "../stateRoot.ts";
import type { PadiDaemonContract } from "../surface.ts";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

const execFileAsync = promisify(execFile);

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../../..");
const PADI_BIN = join(REPO_ROOT, "packages/padi/src/daemonBoot/bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "upgrade-window-rt-"));
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type PadiConn = UnixSocketConnection<PadiDaemonContract>;

const reaper = createProcessReaper();
const required = (): boolean => process.env.KOLU_UPGRADE_WINDOW_REQUIRE === "1";

beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
  vi.stubEnv("XDG_RUNTIME_DIR", RUNTIME_ROOT);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  await reaper.dispose();
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

/** Store path of a kaval bin (…/nix/store/HASH-kaval/bin/kaval → …/HASH-kaval). */
function storePathOfBin(bin: string): string {
  // realpath so symlinked result → /nix/store/.../bin/kaval resolves.
  const real = realpathSync(bin);
  return dirname(dirname(real));
}

/**
 * Assert the mixed-version window is real: previous ref is a version tag and
 * previous kaval's nix store path differs from current. Called under REQUIRE
 * and when the CI recipe has already stamped the env.
 */
function logWindow(opts: {
  ref: string;
  previousStore: string;
  currentStore: string;
}): void {
  assertPreviousReleaseWindow(opts);
  // Loud, greppable proof lines for CI evidence.
  console.log(`previousRelease.e2e: previous ref=${opts.ref}`);
  console.log(
    `previousRelease.e2e: previous kaval store=${opts.previousStore}`,
  );
  console.log(`previousRelease.e2e: current  kaval store=${opts.currentStore}`);
  console.log("previousRelease.e2e: store paths differ — window is real");
}

/** Resolve previous-release kaval binary + window identity for the e2e.
 *
 *  Prefer the CI recipe's stamped env (tag + both store paths already proven
 *  unequal). Local fallback: fetch tags, build latest vX.Y.Z + current, refuse
 *  non-tag / identical stores under REQUIRE. */
async function resolvePreviousWindow(): Promise<{
  bin: string;
  padiBin: string;
  ref: string;
  previousStore: string;
  currentStore: string;
} | null> {
  const envBin = process.env.KOLU_PREVIOUS_KAVAL_BIN;
  const envPadiBin = process.env.KOLU_PREVIOUS_PADI_BIN;
  const envRef = process.env.KOLU_PREVIOUS_KAVAL_REF;
  const envPrevStore = process.env.KOLU_PREVIOUS_KAVAL_STORE;
  const envCurrStore = process.env.KOLU_CURRENT_KAVAL_STORE;

  if (envBin && existsSync(envBin)) {
    if (required() && (!envPadiBin || !existsSync(envPadiBin))) {
      throw new Error(
        "KOLU_UPGRADE_WINDOW_REQUIRE=1 but KOLU_PREVIOUS_PADI_BIN is missing",
      );
    }
    const previousStore = envPrevStore ?? storePathOfBin(envBin);
    let currentStore = envCurrStore;
    if (!currentStore) {
      // Local: build current for the inequality check.
      try {
        const { stdout } = await execFileAsync(
          "nix",
          ["build", "--no-link", "--print-out-paths", ".#kaval"],
          { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
        );
        currentStore = stdout.trim().split("\n").at(-1) ?? "";
      } catch {
        currentStore = "";
      }
    }
    const ref = envRef ?? "unknown";
    if (required()) {
      if (!VERSION_TAG.test(ref)) {
        throw new Error(
          `KOLU_UPGRADE_WINDOW_REQUIRE=1 but KOLU_PREVIOUS_KAVAL_REF='${ref}' is not a version tag — ` +
            `the recipe must git fetch --tags and refuse the last-kaval-commit fallback`,
        );
      }
      if (!currentStore) {
        throw new Error(
          "KOLU_UPGRADE_WINDOW_REQUIRE=1 but current kaval store path is unknown — " +
            "set KOLU_CURRENT_KAVAL_STORE (the recipe builds .#kaval)",
        );
      }
      logWindow({ ref, previousStore, currentStore });
    } else if (VERSION_TAG.test(ref) && currentStore) {
      logWindow({ ref, previousStore, currentStore });
    }
    return {
      bin: envBin,
      padiBin: envPadiBin ?? "",
      ref,
      previousStore,
      currentStore: currentStore || previousStore,
    };
  }

  // Local / unstamped path: fetch tags, require a version tag under REQUIRE.
  try {
    await execFileAsync("git", ["fetch", "--tags", "--force"], {
      cwd: REPO_ROOT,
    }).catch(() =>
      execFileAsync("git", ["fetch", "--tags", "--force", "origin"], {
        cwd: REPO_ROOT,
      }),
    );
  } catch {
    // offline — fall through
  }

  let ref: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["tag", "--sort=-v:refname"],
      { cwd: REPO_ROOT },
    );
    ref = stdout
      .split("\n")
      .map((t) => t.trim())
      .find((t) => VERSION_TAG.test(t));
  } catch {
    ref = undefined;
  }

  if (!ref || !VERSION_TAG.test(ref)) {
    if (required()) {
      throw new Error(
        "KOLU_UPGRADE_WINDOW_REQUIRE=1 but no version tag (vX.Y.Z) after git fetch --tags — " +
          "refusing the last-kaval-commit fallback that collapses the window",
      );
    }
    return null;
  }

  try {
    const [prev, prevPadi, curr] = await Promise.all([
      execFileAsync(
        "nix",
        [
          "build",
          "--no-link",
          "--print-out-paths",
          `git+file://${REPO_ROOT}?ref=${ref}#kaval`,
        ],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
      execFileAsync(
        "nix",
        [
          "build",
          "--no-link",
          "--print-out-paths",
          `git+file://${REPO_ROOT}?ref=${ref}#padi`,
        ],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
      execFileAsync(
        "nix",
        ["build", "--no-link", "--print-out-paths", ".#kaval"],
        { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
      ),
    ]);
    const previousStore = prev.stdout.trim().split("\n").at(-1) ?? "";
    const currentStore = curr.stdout.trim().split("\n").at(-1) ?? "";
    const bin = join(previousStore, "bin", "kaval");
    const padiBin = join(
      prevPadi.stdout.trim().split("\n").at(-1) ?? "",
      "bin",
      "padi",
    );
    if (!existsSync(bin) || !existsSync(padiBin)) return null;
    logWindow({ ref, previousStore, currentStore });
    return { bin, padiBin, ref, previousStore, currentStore };
  } catch (err) {
    if (required()) throw err;
    console.warn(
      "previousRelease.e2e: could not nix-build previous/current kaval:",
      (err as Error).message,
    );
    return null;
  }
}

type ResolvedWindow = NonNullable<
  Awaited<ReturnType<typeof resolvePreviousWindow>>
>;

async function newReadsOld(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release kaval + current padi");

  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);

  // Manifest so discovery can label the rendezvous (production does this
  // before kaval binds).
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  // 1) Boot PREVIOUS-release kaval at the digest-keyed path current padi will dial.
  reaper.track(
    spawn(window.bin, ["--socket", kavalSocket], {
      stdio: "ignore",
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      },
    }),
  );

  await waitForSocket(kavalSocket, async (path) => {
    const { unixSocketLink: link } = await import(
      "@kolu/surface/links/unix-socket"
    );
    const conn = await link({ socketPath: path });
    try {
      await (
        conn.client as {
          surface: {
            system: { heartbeat: (i: object) => Promise<unknown> };
          };
        }
      ).surface.system.heartbeat({});
    } finally {
      await conn.dispose();
    }
  });

  const oldPid = gatePid(kavalGate);
  expect(oldPid).toBeTypeOf("number");
  expect(isAlive(oldPid as number)).toBe(true);

  // 2) Boot CURRENT padi against the same state-root. Compatible contract →
  //    adopt (PTYs would survive); we then force-recycle via recycleKaval.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    [DAEMON_BIND_PID_ENV]: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_BIN;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;

  reaper.track(
    spawn(
      process.execPath,
      [
        "--import",
        TSX_LOADER,
        PADI_BIN,
        "--state-root",
        stateRoot,
        "--allow-nix-shell-with-env-whitelist",
        "default",
      ],
      { stdio: "ignore", env },
    ),
  );

  await waitForSocket(
    padiSock,
    async (path) => {
      const conn = await unixSocketLink<PadiDaemonContract>({
        socketPath: path,
      });
      try {
        await conn.client.surface.control.core.hello();
      } finally {
        await conn.dispose();
      }
    },
    90_000,
  );

  // After adopt, the gate still names the previous-release pid (compatible).
  // (If the previous release were wire-incompatible, converge would have
  // recycled already — still a valid mixed-version proof, just a different
  // arm. We accept either: old pid still live OR already recycled.)
  const pidAfterBoot = gatePid(kavalGate);
  expect(pidAfterBoot).toBeTypeOf("number");

  const conn: PadiConn = await unixSocketLink<PadiDaemonContract>({
    socketPath: padiSock,
  });
  try {
    // 3) Create a terminal so recycle has a session to capture.
    const { id } = await conn.client.surface.padi.lifecycle.create({
      cwd: stateRoot,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Wait for autosave to persist the session (deterministic poll).
    const confPath = join(stateRoot, "config.json");
    const sessionDeadline = Date.now() + 15_000;
    let sessionPresent = false;
    while (Date.now() < sessionDeadline) {
      if (existsSync(confPath)) {
        try {
          const raw = JSON.parse(readFileSync(confPath, "utf8")) as {
            session?: { terminals?: unknown[] };
          };
          if ((raw.session?.terminals?.length ?? 0) > 0) {
            sessionPresent = true;
            break;
          }
        } catch {
          // mid-write
        }
      }
      await sleep(100);
    }
    expect(sessionPresent).toBe(true);

    // Ground the shared-artifact inventory against the LIVE runtime +
    // state-root: every non-log file must match an inventory diskBasename.
    // An unregistered shared file (the miss a hand-list-only watchdog
    // cannot catch) fails here with instructions.
    const unknown = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      RUNTIME_ROOT,
      stateRoot,
    );
    expect(
      unknown,
      unknownSharedFileMessage(SHARED_ARTIFACTS, unknown),
    ).toEqual([]);

    const pidBeforeRecycle = gatePid(kavalGate) as number;

    // 4) Restart kaval — the production recycle path.
    await conn.client.surface.padi.lifecycle.recycleKaval(undefined);

    // 5) Daemon replaced: gate pid changed (or the old process is dead and
    //    a new live holder is present).
    const recycleDeadline = Date.now() + 60_000;
    let newPid: number | undefined;
    while (Date.now() < recycleDeadline) {
      const p = gatePid(kavalGate);
      if (p !== undefined && isAlive(p) && p !== pidBeforeRecycle) {
        newPid = p;
        break;
      }
      await sleep(200);
    }
    expect(
      newPid,
      `kaval was not replaced after recycleKaval (still ${pidBeforeRecycle})`,
    ).toBeTypeOf("number");
    expect(isAlive(pidBeforeRecycle)).toBe(false);

    // 6) Session survived for restore — still on disk with the terminal.
    const after = JSON.parse(readFileSync(confPath, "utf8")) as {
      session?: { terminals?: { id: string }[] };
    };
    expect(after.session?.terminals?.length).toBeGreaterThanOrEqual(1);
    // padi itself stayed up (its gate unchanged through a kaval-only recycle).
    const padiPid = gatePid(padiGatePath(padiSock));
    expect(padiPid).toBeTypeOf("number");
    expect(isAlive(padiPid as number)).toBe(true);

    // Re-ground after recycle — a new shared file introduced by the fresh
    // kaval must still match the inventory.
    const unknownAfter = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      RUNTIME_ROOT,
      stateRoot,
    );
    expect(
      unknownAfter,
      unknownSharedFileMessage(SHARED_ARTIFACTS, unknownAfter),
    ).toEqual([]);
  } finally {
    await conn.dispose();
    // Reap kaval (current + any leftover) + padi.
    for (const g of [kavalGate, padiGatePath(padiSock)]) {
      const p = gatePid(g);
      if (p !== undefined && isAlive(p)) {
        try {
          process.kill(p, "SIGKILL");
        } catch {
          // gone
        }
      }
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

async function oldReadsNew(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release padi + current kaval");
  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-reverse-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  const currentKavalBin = join(window.currentStore, "bin", "kaval");
  if (!existsSync(currentKavalBin)) {
    throw new Error(`current kaval binary is missing: ${currentKavalBin}`);
  }
  reaper.track(
    spawn(currentKavalBin, ["--socket", kavalSocket], {
      stdio: "ignore",
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      },
    }),
  );
  await waitForSocket(kavalSocket, async (path) => {
    const conn = await unixSocketLink({ socketPath: path });
    try {
      await (
        conn.client as {
          surface: { system: { heartbeat: (i: object) => Promise<unknown> } };
        }
      ).surface.system.heartbeat({});
    } finally {
      await conn.dispose();
    }
  });
  const currentKavalPid = gatePid(kavalGate);
  expect(currentKavalPid).toBeTypeOf("number");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    [DAEMON_BIND_PID_ENV]: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  reaper.track(
    spawn(
      window.padiBin,
      [
        "--state-root",
        stateRoot,
        "--allow-nix-shell-with-env-whitelist",
        "default",
      ],
      { stdio: "ignore", env },
    ),
  );

  try {
    await waitForSocket(
      padiSock,
      async (path) => {
        const conn = await unixSocketLink<PadiDaemonContract>({
          socketPath: path,
        });
        try {
          await conn.client.surface.control.core.hello();
        } finally {
          await conn.dispose();
        }
      },
      90_000,
    );
    // The previous padi reached and adopted the already-running current kaval:
    // the gate still names the same newer daemon instead of spawning its own.
    expect(gatePid(kavalGate)).toBe(currentKavalPid);
    expect(isAlive(currentKavalPid as number)).toBe(true);
  } finally {
    for (const gate of [kavalGate, padiGatePath(padiSock)]) {
      const pid = gatePid(gate);
      if (pid !== undefined && isAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

describeDaemon("bidirectional previous-release daemon window", () => {
  it("runs new-reads-old and old-reads-new against distinct stores", async () => {
    const window = await resolvePreviousWindow();
    if (!window) {
      if (required()) {
        throw new Error(
          "previous-release padi/kaval unavailable under KOLU_UPGRADE_WINDOW_REQUIRE=1",
        );
      }
      console.warn(
        "SKIP: no previous-release daemon binaries (set KOLU_PREVIOUS_KAVAL_BIN and KOLU_PREVIOUS_PADI_BIN)",
      );
      return;
    }
    await runPreviousReleaseWindow({
      window,
      newReadsOld: () => newReadsOld(window),
      oldReadsNew: () => oldReadsNew(window),
    });
  }, 300_000);
});
