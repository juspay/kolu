import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import {
  connectPadi,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiHelloIdentity,
} from "@kolu/padi-client/dial";
import {
  padiGatePath,
  padiRuntimeHome,
  padiSocketPath,
} from "@kolu/padi-client/rendezvous";
import {
  LOCAL_LOCATION,
  PADI_SURFACE_VERSION,
  type SavedSession,
  SavedSessionSchema,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import {
  DAEMON_BIND_PID_ENV,
  daemonBuild,
  gatePid,
  isHolderLive,
} from "@kolu/surface-daemon";
import {
  assertPreviousReleaseWindow,
  createProcessReaper,
  isPreviousReleaseTag,
  runPreviousReleaseWindow,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
  waitForSocket,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import {
  converge,
  createEndpoint,
  outcomeAnomaly,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import { processStateReader } from "@kolu/surface-daemon-supervisor";
import { Effect, Schema } from "effect";
import { KAVAL_GATE_FILE, PTY_HOST_CONTRACT_VERSION } from "kaval";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { currentPadiBuildIdentity } from "../daemonBoot/buildId.ts";
import { connectKaval, probeKavalForConvergence } from "../ptyHost/connect.ts";
import { padiKavalSocketPath, writeStateRootManifest } from "../stateRoot.ts";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";
import { harnessLogRoot } from "./yesterdayDaemon.fixture.testlib.ts";

const encodeSavedSession = Schema.encodeSync(SavedSessionSchema);

const PADI_TAKEOVER_DRAIN_CEILING_MS = 2000;

const execFileAsync = promisify(execFile);

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../../..");
const PADI_BIN = join(REPO_ROOT, "packages/padi/src/daemonBoot/bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "upgrade-window-rt-"));
const HARNESS_LOG_ROOT = harnessLogRoot();
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const reaper = createProcessReaper();
const required = (): boolean => process.env.KOLU_UPGRADE_WINDOW_REQUIRE === "1";

beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
  vi.stubEnv("XDG_RUNTIME_DIR", RUNTIME_ROOT);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
  rmSync(HARNESS_LOG_ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  await reaper.dispose();
});

function socketAccepts(socketPath: string): Promise<void> {
  return new Promise<void>((resolveConnect, rejectConnect) => {
    const socket = connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolveConnect();
    });
    socket.once("error", (err) => {
      socket.destroy();
      rejectConnect(err);
    });
  });
}

function requireLiveGateHolder(gatePath: string, label: string): number {
  const pid = gatePid(gatePath);
  if (pid === undefined) throw new Error(`${label} gate has no pid`);
  if (!isHolderLive(pid)) throw new Error(`${label} gate pid ${pid} is dead`);
  return pid;
}

async function waitForNeutralReadiness(
  socketPath: string,
  gatePath: string,
  label: string,
  ms?: number,
): Promise<number> {
  await waitForSocket(
    socketPath,
    async (path) => {
      await socketAccepts(path);
      requireLiveGateHolder(gatePath, label);
    },
    ms,
  );
  return requireLiveGateHolder(gatePath, label);
}

function storePathOfBin(bin: string): string {
  const real = realpathSync(bin);
  return dirname(dirname(real));
}

function logWindow(opts: {
  ref: string;
  previousStore: string;
  currentStore: string;
}): void {
  assertPreviousReleaseWindow(opts);
  console.log(`previousRelease.e2e: previous ref=${opts.ref}`);
  console.log(
    `previousRelease.e2e: previous kaval store=${opts.previousStore}`,
  );
  console.log(`previousRelease.e2e: current  kaval store=${opts.currentStore}`);
  console.log("previousRelease.e2e: store paths differ — window is real");
}

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
    if (!envPadiBin || !existsSync(envPadiBin)) {
      if (required()) {
        throw new Error(
          "KOLU_UPGRADE_WINDOW_REQUIRE=1 but KOLU_PREVIOUS_PADI_BIN is missing",
        );
      }
      return null;
    }
    const previousStore = envPrevStore ?? storePathOfBin(envBin);
    let currentStore = envCurrStore;
    if (!currentStore) {
      try {
        const { stdout } = await execFileAsync(
          "nix",
          ["build", "--no-link", "--print-out-paths", ".#kaval"],
          { cwd: REPO_ROOT, env: process.env, maxBuffer: 10 * 1024 * 1024 },
        );
        currentStore = stdout.trim().split("\n").at(-1) ?? "";
      } catch (error) {
        throw new Error("failed to build the current kaval store", {
          cause: error,
        });
      }
    }
    const ref = envRef ?? "unknown";
    if (required()) {
      if (!isPreviousReleaseTag(ref)) {
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
    } else if (isPreviousReleaseTag(ref) && currentStore) {
      logWindow({ ref, previousStore, currentStore });
    }
    return {
      bin: envBin,
      padiBin: envPadiBin,
      ref,
      previousStore,
      currentStore,
    };
  }

  await execFileAsync("git", ["fetch", "--tags", "--force"], {
    cwd: REPO_ROOT,
  }).catch(async (localError) => {
    try {
      await execFileAsync("git", ["fetch", "--tags", "--force", "origin"], {
        cwd: REPO_ROOT,
      });
    } catch (originError) {
      throw new AggregateError(
        [localError, originError],
        "failed to fetch version tags for the upgrade window",
      );
    }
  });

  let ref: string | undefined;
  const { stdout: tags } = await execFileAsync(
    "git",
    ["tag", "--sort=-v:refname"],
    { cwd: REPO_ROOT },
  );
  ref = tags
    .split("\n")
    .map((t) => t.trim())
    .find(isPreviousReleaseTag);

  if (!ref || !isPreviousReleaseTag(ref)) {
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
    if (!existsSync(bin) || !existsSync(padiBin)) {
      throw new Error(
        `built previous-release binaries are missing: kaval=${bin}, padi=${padiBin}`,
      );
    }
    logWindow({ ref, previousStore, currentStore });
    return { bin, padiBin, ref, previousStore, currentStore };
  } catch (err) {
    throw new Error("failed to build the mixed-version daemon window", {
      cause: err,
    });
  }
}

type ResolvedWindow = NonNullable<
  Awaited<ReturnType<typeof resolvePreviousWindow>>
>;

function padiEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: RUNTIME_ROOT,
    KOLU_KAVAL_SPAWN: "detached",
    [DAEMON_BIND_PID_ENV]: String(process.pid),
  };
  delete env.INVOCATION_ID;
  delete env.KOLU_KAVAL_SOCKET;
  delete env.KOLU_STATE_DIR;
  return env;
}

function daemonLogPath(name: string): string {
  return join(HARNESS_LOG_ROOT, `${name}.stderr.log`);
}

function stderrToFile(name: string): ["ignore", "ignore", number] {
  return ["ignore", "ignore", openSync(daemonLogPath(name), "a")];
}

function daemonLogTail(name: string, lines = 60): string {
  const path = daemonLogPath(name);
  if (!existsSync(path)) return `${name}: no log at ${path}`;
  try {
    const all = readFileSync(path, "utf8").trimEnd().split("\n");
    return `${name} (last ${Math.min(lines, all.length)} of ${all.length} lines):\n${all
      .slice(-lines)
      .join("\n")}`;
  } catch (err) {
    return `${name}: log unreadable (${String(err)})`;
  }
}

function reapGateHolders(gatePaths: readonly string[]): void {
  for (const gate of gatePaths) {
    const pid = gatePid(gate);
    if (pid !== undefined && isHolderLive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
    }
  }
}

async function bootPreviousKaval(
  window: ResolvedWindow,
  kavalSocket: string,
  kavalGate: string,
): Promise<number> {
  reaper.track(
    spawn(window.bin, ["--socket", kavalSocket], {
      stdio: stderrToFile("previous-kaval"),
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      },
    }),
  );
  const oldPid = await waitForNeutralReadiness(
    kavalSocket,
    kavalGate,
    "previous kaval",
  );
  const previousGateBody = readFileSync(kavalGate, "utf8").trim();
  expect(previousGateBody.split("\t")[0]).toBe(String(oldPid));
  return oldPid;
}

async function requireUnspeakable(kavalSocket: string): Promise<void> {
  const probed = await Effect.runPromise(
    probeKavalForConvergence(kavalSocket),
  ).then(
    (probe) => ({ kind: "resolved" as const, probe }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  );
  if (probed.kind === "resolved") {
    probed.probe?.dispose();
  }
  expect(
    probed.kind,
    "the current probe obtained an identity from a previous-release kaval — the wire epoch did not break, or the window collapsed to same-version",
  ).toBe("rejected");
  console.log(
    `previousRelease.e2e: previous kaval is unspeakable to this build — ${
      probed.kind === "rejected" && probed.error instanceof Error
        ? probed.error.message
        : String(probed)
    }`,
  );
}

async function bootCurrentPadi(
  stateRoot: string,
  padiSock: string,
): Promise<void> {
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
      { stdio: stderrToFile("current-padi"), env: padiEnv() },
    ),
  );
  await waitForSocket(
    padiSock,
    async (path) => {
      const conn = await Effect.runPromise(connectPadi(path));
      conn.dispose();
    },
    90_000,
  );
}

async function awaitRecycle(
  kavalSocket: string,
  kavalGate: string,
  oldPid: number,
): Promise<void> {
  const recycledDeadline = Date.now() + 90_000;
  let currentEpochPid: number | undefined;
  while (Date.now() < recycledDeadline) {
    const pid = gatePid(kavalGate);
    if (pid !== undefined && pid !== oldPid && isHolderLive(pid)) {
      currentEpochPid = pid;
      break;
    }
    await sleep(200);
  }
  expect(
    currentEpochPid,
    `the previous-release kaval (pid ${oldPid}) was still holding the gate — an unspeakable survivor must be RECYCLED, not adopted`,
  ).toBeTypeOf("number");
  expect(isHolderLive(oldPid)).toBe(false);

  const freshProbe = await Effect.runPromise(
    probeKavalForConvergence(kavalSocket),
  );
  expect(freshProbe).not.toBeNull();
  expect(freshProbe?.identity.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
  freshProbe?.dispose();
}

function sessionTerminalCount(confPath: string): number | null {
  if (!existsSync(confPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(confPath, "utf8")) as {
      session?: { terminals?: unknown[] };
    };
    return raw.session?.terminals?.length ?? 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!(err instanceof SyntaxError) && code !== "ENOENT") throw err;
    return null;
  }
}

async function requireSessionPersisted(
  client: PadiDaemonClient,
  confPath: string,
  id: string,
): Promise<void> {
  const sessionDeadline = Date.now() + 15_000;
  let sessionPresent = false;
  while (Date.now() < sessionDeadline) {
    if ((sessionTerminalCount(confPath) ?? 0) > 0) {
      sessionPresent = true;
      break;
    }
    await sleep(100);
  }
  const listing = await Effect.runPromise(
    Effect.catch(
      Effect.timeout(
        firstFrameOrThrow(
          client.padi.surface.terminals.keys(undefined),
          "padi's terminals keys stream yielded no frame",
        ),
        2_000,
      ),
      (err) => Effect.succeed(`unreadable (${String(err)})`),
    ),
  );
  expect(
    sessionPresent,
    [
      `the autosave never persisted a terminal within 15s of lifecycle.create (${id})`,
      `padi's live terminals: ${JSON.stringify(listing)}`,
      `config.json: ${existsSync(confPath) ? readFileSync(confPath, "utf8").slice(0, 2000) : "absent"}`,
      daemonLogTail("current-padi"),
    ].join("\n\n"),
  ).toBe(true);
}

function requireNoUnknownSharedFiles(stateRoot: string): void {
  const unknown = unknownProtocolFilesOnDisk(
    SHARED_ARTIFACTS,
    RUNTIME_ROOT,
    stateRoot,
  );
  expect(unknown, unknownSharedFileMessage(SHARED_ARTIFACTS, unknown)).toEqual(
    [],
  );
}

async function recycleAndAssertReplaced(
  client: PadiDaemonClient,
  kavalGate: string,
): Promise<void> {
  const pidBeforeRecycle = gatePid(kavalGate);
  if (pidBeforeRecycle === undefined) {
    throw new Error("kaval gate has no pid before recycle");
  }
  await Effect.runPromise(
    client.padi.surface.lifecycle.recycleKaval(undefined),
  );
  const recycleDeadline = Date.now() + 60_000;
  let newPid: number | undefined;
  while (Date.now() < recycleDeadline) {
    const p = gatePid(kavalGate);
    if (p !== undefined && isHolderLive(p) && p !== pidBeforeRecycle) {
      newPid = p;
      break;
    }
    await sleep(200);
  }
  expect(
    newPid,
    `kaval was not replaced after recycleKaval (still ${pidBeforeRecycle})`,
  ).toBeTypeOf("number");
  expect(isHolderLive(pidBeforeRecycle)).toBe(false);
}

async function newReadsOld(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release kaval + current padi");

  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);
  const confPath = join(stateRoot, "config.json");

  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  const oldPid = await bootPreviousKaval(window, kavalSocket, kavalGate);
  await requireUnspeakable(kavalSocket);
  await bootCurrentPadi(stateRoot, padiSock);
  await awaitRecycle(kavalSocket, kavalGate, oldPid);

  const conn = await Effect.runPromise(connectPadi(padiSock));
  try {
    const { id } = await Effect.runPromise(
      conn.client.padi.surface.lifecycle.create({
        placement: TOPLEVEL_PLACEMENT,
        cwd: stateRoot,
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    await requireSessionPersisted(conn.client, confPath, id);
    requireNoUnknownSharedFiles(stateRoot);
    await recycleAndAssertReplaced(conn.client, kavalGate);

    expect(sessionTerminalCount(confPath)).toBeGreaterThanOrEqual(1);
    const padiPid = gatePid(padiGatePath(padiSock));
    expect(padiPid).toBeTypeOf("number");
    if (padiPid === undefined) throw new Error("padi gate has no pid");
    expect(isHolderLive(padiPid)).toBe(true);

    requireNoUnknownSharedFiles(stateRoot);
  } finally {
    conn.dispose();
    reapGateHolders([kavalGate, padiGatePath(padiSock)]);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

async function oldReadsNew(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release padi + current kaval");
  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-reverse-sr-"));
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  const padiSock = padiSocketPath(stateRoot);
  const padiGate = padiGatePath(padiSock);
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
  const currentKavalPid = await waitForNeutralReadiness(
    kavalSocket,
    kavalGate,
    "current kaval",
  );

  try {
    const kavalConn = await Effect.runPromise(connectKaval(kavalSocket));
    try {
      expect(kavalConn.metadata.contractVersion).toBe(
        PTY_HOST_CONTRACT_VERSION,
      );
      expect(kavalConn.metadata.pid).toBe(currentKavalPid);
    } finally {
      kavalConn.dispose();
    }

    reaper.track(
      spawn(
        window.padiBin,
        [
          "--state-root",
          stateRoot,
          "--allow-nix-shell-with-env-whitelist",
          "default",
        ],
        { stdio: "ignore", env: padiEnv() },
      ),
    );

    const previousPadiPid = await waitForNeutralReadiness(
      padiSock,
      padiGate,
      "previous padi",
      90_000,
    );

    const dialed = await Promise.race([
      Effect.runPromise(connectPadi(padiSock)).then(
        (conn) => {
          conn.dispose();
          return "connected" as const;
        },
        () => "refused" as const,
      ),
      sleep(30_000).then(() => "no-answer" as const),
    ]);
    expect(
      dialed,
      "this build completed a padi handshake against a previous-release padi — the wire epoch did not break",
    ).not.toBe("connected");
    console.log(`previousRelease.e2e: old padi is ${dialed} to this build`);

    expect(isHolderLive(previousPadiPid)).toBe(true);

    const holder = requireLiveGateHolder(kavalGate, "kaval after old padi");
    const body = readFileSync(kavalGate, "utf8").trim();
    expect(Number.parseInt(body, 10)).toBe(holder);
    expect(gatePid(kavalGate)).toBe(holder);
  } finally {
    reapGateHolders([kavalGate, padiGate]);
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

async function newTakesOverOldPadi(window: ResolvedWindow): Promise<void> {
  assertDaemonSpawnAllowed("previous-release padi + current padi takeover");

  const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-takeover-sr-"));
  const home = padiRuntimeHome(stateRoot);
  const kavalSocket = padiKavalSocketPath(stateRoot);
  const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

  const plantedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const plantedSession = {
    terminals: [
      {
        id: plantedId,
        state: "active",
        cwd: stateRoot,
        lastActivityAt: 1,
        promptedAt: null,
        git: { kind: "none" },
        pr: { kind: "absent" },
        location: LOCAL_LOCATION,
        restoreTarget: { kind: "none" },
      },
    ],
    activeTerminalId: plantedId,
    savedAt: 1_700_000_000_000,
  } satisfies SavedSession;
  const encoded = encodeSavedSession(plantedSession);
  const previousReleaseSession = {
    ...encoded,
    terminals: encoded.terminals.map(({ promptedAt: _, ...t }) => ({
      ...t,
      git: null,
    })),
  };
  writeFileSync(
    join(stateRoot, "config.json"),
    `${JSON.stringify({ session: previousReleaseSession }, null, 2)}\n`,
  );

  try {
    reaper.track(
      spawn(
        window.padiBin,
        [
          "--state-root",
          stateRoot,
          "--allow-nix-shell-with-env-whitelist",
          "default",
        ],
        { stdio: "ignore", env: padiEnv() },
      ),
    );
    const oldPadiPid = await waitForNeutralReadiness(
      home.socketPath,
      home.gatePath,
      "previous padi",
      90_000,
    );

    const padiProbe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: PADI_TAKEOVER_DRAIN_CEILING_MS,
    });
    const probed = await Effect.runPromise(padiProbe(home.socketPath)).then(
      (probe) => ({ kind: "resolved" as const, probe }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    if (probed.kind === "resolved") probed.probe?.dispose();
    expect(
      probed.kind,
      "this build's probe obtained an identity from a previous-release padi — the wire epoch did not break",
    ).toBe("rejected");
    console.log(
      `previousRelease.e2e: previous padi is unspeakable to this build — ${
        probed.kind === "rejected" && probed.error instanceof Error
          ? probed.error.message
          : String(probed)
      }`,
    );

    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    let spawns = 0;
    const ep = createEndpoint<
      PadiDaemonClient,
      PadiHelloIdentity,
      PadiConnectionMetadata
    >({
      hostId: "padi",
      home,
      readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
      readSocketHolders: osfactsSocketHolders(osfactsBin),
      readProcessState: processStateReader(osfactsBin),
      policy: {
        capability: "drainable",
        baked: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild(currentPadiBuildIdentity().staleKey),
        },
        onContractSkew: { kind: "drain-newer-else-refuse" },
        onBuildMismatch: { kind: "drain-and-replace" },
        drainBudget: { maxAttempts: 3, onGiveUp: "adopt-stale" },
      },
      probe: (socketPath) => padiProbe(socketPath),
      driver: {
        spawn: Effect.promise(async () => {
          spawns += 1;
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
              { stdio: "ignore", env: padiEnv() },
            ),
          );
        }),
      },
      connect: (path) => connectPadi(path),
      log: silentLogger,
      onStatus: () => {},
      socketReadyMs: 90_000,
    });

    const outcome = await Effect.runPromise(converge(ep));
    expect(
      outcome.kind,
      `an unspeakable padi must be TAKEN OVER, not left standing (got ${outcome.kind}: ${JSON.stringify(outcomeAnomaly(outcome))})`,
    ).toBe("recycled");
    expect(outcomeAnomaly(outcome)).toBeNull();
    expect(spawns).toBe(1);

    expect(
      isHolderLive(oldPadiPid),
      `the previous-release padi (pid ${oldPadiPid}) survived the takeover`,
    ).toBe(false);
    const newPadiPid = gatePid(home.gatePath);
    expect(newPadiPid).toBeTypeOf("number");
    if (newPadiPid === undefined) throw new Error("padi gate has no pid");
    expect(newPadiPid).not.toBe(oldPadiPid);
    expect(isHolderLive(newPadiPid)).toBe(true);
    console.log(
      `previousRelease.e2e: padi TAKEN OVER — ${oldPadiPid} (previous epoch) → ${newPadiPid} (this build)`,
    );

    const held = ep.current();
    expect(held, "the takeover held no connection").toBeDefined();
    const conn = await Effect.runPromise(connectPadi(home.socketPath));
    try {
      expect(conn.metadata.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(conn.identity.surfaceVersion).toBe(PADI_SURFACE_VERSION);
      expect(conn.identity.stateRoot).toBe(stateRoot);

      const onDisk = JSON.parse(
        readFileSync(join(stateRoot, "config.json"), "utf8"),
      ) as { session?: { terminals?: { id: string }[] } };
      expect(onDisk.session?.terminals?.map((t) => t.id)).toEqual([plantedId]);

      const served = await Effect.runPromise(
        firstFrameOrThrow(
          conn.client.padi.surface.session.get(undefined),
          "the new padi's session cell yielded no frame",
        ),
      );
      expect(
        served?.terminals.map((t) => t.id),
        "the new padi did not seed its session from disk",
      ).toEqual([plantedId]);
      expect(
        served?.terminals.map((t) => t.git),
        "the new padi did not migrate the previous release's `git: null`",
      ).toEqual([{ kind: "unresolved" }]);

      const unknown = unknownProtocolFilesOnDisk(
        SHARED_ARTIFACTS,
        RUNTIME_ROOT,
        stateRoot,
      );
      expect(
        unknown,
        unknownSharedFileMessage(SHARED_ARTIFACTS, unknown),
      ).toEqual([]);
    } finally {
      conn.dispose();
      held?.dispose();
    }
  } finally {
    reapGateHolders([home.gatePath, kavalGate]);
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
      newReadsOld,
      oldReadsNew,
    });
    await newTakesOverOldPadi(window);
  }, 600_000);
});
