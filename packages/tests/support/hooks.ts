import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { After, AfterAll, Before, BeforeAll, Status } from "@cucumber/cucumber";
import type { AgentDistroSetting } from "@kolu/agent-distro/schema";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiGatePath, padiSocketPath } from "@kolu/padi-client/rendezvous";
import type { NewTerminalPolicy } from "@kolu/padi-client/surface";
import getPort from "get-port";
import { composeSpawnEnv, NIX_ENV_WHITELIST, pickEnv } from "kolu-pty";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as engine from "../screencast/engine.ts";
import { getRecording } from "../screencast/recordings/index.ts";
import { agentDistroFixtureEnv } from "./agentDistroFixture.ts";
import { AGENT_DIR_VARS, FAKE_BIN_NAMES } from "./agentHarnessLists.ts";
import { stageFakeGh } from "./fake-gh.ts";
import { waitForPadiCell } from "./padiCellWait.ts";
import { stageRenamedBash } from "./renamed-bash.ts";
import {
  disposeRpcWire,
  isPadiWarmingUp,
  padiCall,
  padiFirstFrameThenClose,
  RpcCallFailed,
  setRpcBaseUrl,
  surfaceCall,
} from "./rpcWire.ts";
import {
  isTransientSetupError,
  retryPadiScenarioReset,
  retryTransient,
} from "./scenarioSetupRetry.ts";
import { retireWorldScrollFifo } from "./scrollFifo.ts";
import type { KoluWorld } from "./world.ts";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0", 10);

/** Fixtures scaffold real git repos and run `git commit` against them. On a
 *  pristine NixOS host with no `~/.gitconfig`, git aborts with "Author identity
 *  unknown" and scenarios fail (see #887). Pin a test identity so every fixture
 *  — current and future — inherits one. `??=` lets a host with `git config
 *  --global` set still take precedence when developers run locally.
 *
 *  This env identity reaches the git that runs in the HARNESS process directly
 *  (`execFileSync("git", …)` in worktree/git-context steps). Git that runs in a
 *  spawned PTY can NOT read it: the #1872 spawn allowlist (`composeSpawnEnv`)
 *  deliberately drops identity vars, so `GIT_AUTHOR_*` never rides ambient env
 *  into a hosted terminal. Those fixtures get their identity from the fake
 *  `$HOME/.gitconfig` seeded below — the forwarded-HOME config channel, the same
 *  one that sources `.bashrc` (see `cleanEnv`). */
process.env.GIT_AUTHOR_NAME ??= "kolu-test";
process.env.GIT_AUTHOR_EMAIL ??= "test@kolu.dev";
process.env.GIT_COMMITTER_NAME ??= "kolu-test";
process.env.GIT_COMMITTER_EMAIL ??= "test@kolu.dev";

const testBaseDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `kolu-test-${process.pid}-w${workerId}-`),
);

const mkSubDir = (name: string) => {
  const dir = path.join(testBaseDir, name);
  fs.mkdirSync(dir);
  return dir;
};

const claudeSessionsDir = mkSubDir("claude-sessions");
const claudeProjectsDir = mkSubDir("claude-projects");

const codexDir = mkSubDir("codex");
const opencodeDbDir = mkSubDir("opencode");
const opencodeDbPath = path.join(opencodeDbDir, "opencode.db");

export const stateHomeDir = mkSubDir("state-home");

const RECORDING = !!process.env.KOLU_X11CAP;

const homeRootOutsideTmp =
  process.platform === "linux" ? "/dev/shm" : os.homedir();
const fixtureHome = RECORDING
  ? undefined
  : fs.mkdtempSync(path.join(homeRootOutsideTmp, ".kolu-e2e-home-"));

if (fixtureHome) {
  fs.writeFileSync(
    path.join(fixtureHome, ".gitconfig"),
    `[user]\n\tname = ${process.env.GIT_AUTHOR_NAME}\n\temail = ${process.env.GIT_AUTHOR_EMAIL}\n`,
  );
  const inheritedPath = process.env.PATH;
  if (!inheritedPath) {
    throw new Error("E2E harness requires PATH for spawned terminal fixtures");
  }
  // macOS's /etc/zprofile replaces the inherited Nix PATH with system paths.
  // The isolated HOME is replayed after /etc/zprofile by prepareShellInit, so
  // restore the harness PATH here. This keeps the real Nix git on pristine
  // Darwin runners instead of falling into Apple's uninstalled Xcode stub.
  fs.writeFileSync(
    path.join(fixtureHome, ".zprofile"),
    `export PATH='${inheritedPath.replaceAll("'", `'\\''`)}'\n`,
  );
}

const grokDir = RECORDING ? undefined : mkSubDir("grok");
const piDir = RECORDING ? undefined : mkSubDir("pi");
const ompDir = RECORDING ? undefined : mkSubDir("omp");
const xyneDir = RECORDING ? undefined : mkSubDir("xyne");
type ServerModeEnv = Record<
  (typeof AGENT_DIR_VARS)[number],
  string | undefined
> & { HOME?: string; XDG_STATE_HOME?: string };

const realAgentEnv = (): ServerModeEnv => ({
  KOLU_CLAUDE_SESSIONS_DIR: undefined,
  KOLU_CLAUDE_PROJECTS_DIR: undefined,
  KOLU_CODEX_DIR: undefined,
  KOLU_GROK_DIR: undefined,
  KOLU_PI_DIR: undefined,
  KOLU_OMP_DIR: undefined,
  KOLU_XYNE_DIR: undefined,
});

const mockedAgentEnv = (): ServerModeEnv => ({
  KOLU_CLAUDE_SESSIONS_DIR: claudeSessionsDir,
  KOLU_CLAUDE_PROJECTS_DIR: claudeProjectsDir,
  KOLU_CODEX_DIR: codexDir,
  KOLU_GROK_DIR: grokDir,
  KOLU_PI_DIR: piDir,
  KOLU_OMP_DIR: ompDir,
  KOLU_XYNE_DIR: xyneDir,
  HOME: fixtureHome,
  XDG_STATE_HOME: stateHomeDir,
});

const serverModeEnv: ServerModeEnv = RECORDING
  ? realAgentEnv()
  : mockedAgentEnv();
for (const name of AGENT_DIR_VARS) {
  const value = serverModeEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
if (RECORDING) delete process.env.KOLU_OPENCODE_DB;
else process.env.KOLU_OPENCODE_DB = opencodeDbPath;

const fakeBinDir = mkSubDir("bin");
const fakeBins = stageRenamedBash(fakeBinDir, FAKE_BIN_NAMES);
process.env.KOLU_FAKE_CODEX_BIN = fakeBins.codex;
process.env.KOLU_FAKE_OPENCODE_BIN = fakeBins.opencode;
process.env.KOLU_FAKE_GROK_BIN = fakeBins.grok;
process.env.KOLU_FAKE_PI_BIN = fakeBins.pi;
process.env.KOLU_FAKE_OMP_BIN = fakeBins.omp;
process.env.KOLU_FAKE_XYNE_BIN = fakeBins.xyne;
process.env.KOLU_FAKE_CLAUDE_BIN = fakeBins.claude;
process.env.KOLU_FAKE_NODE_BIN = fakeBins.node;

const fakeGhBin = stageFakeGh(fakeBinDir, process.execPath);

const koluStateDir = mkSubDir("state");

export const padiStateDir = mkSubDir("padi-state");

function shortRuntimeDirForSockets(): string {
  const dir = fs.mkdtempSync(path.join("/tmp", `kr${workerId}-`));
  fs.chmodSync(dir, 0o700);
  return dir;
}

const runtimeDir = shortRuntimeDirForSockets();

function withWorkerRuntimeDir<T>(fn: () => T): T {
  const prev = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prev;
  }
}

const errnoCode = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

function readPidAtGate(gate: string): number | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(gate, "utf8");
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
    return undefined;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function killPidAtGate(gate: string): number | undefined {
  const pid = readPidAtGate(gate);
  if (pid === undefined) return undefined;
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    if (errnoCode(err) !== "ESRCH") throw err;
    return undefined;
  }
  return pid;
}

export function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function padiGate(): string {
  return withWorkerRuntimeDir(() => padiGatePath(padiSocketPath(padiStateDir)));
}

function kavalGate(): string {
  return withWorkerRuntimeDir(() =>
    path.join(path.dirname(padiKavalSocketPath(padiStateDir)), "kaval.pid"),
  );
}

export function kavalSocketPath(): string {
  return withWorkerRuntimeDir(() => padiKavalSocketPath(padiStateDir));
}

export function readPadiGatePid(): number | undefined {
  return readPidAtGate(padiGate());
}

export function readKavalGatePid(): number | undefined {
  return readPidAtGate(kavalGate());
}

export function killPadiDaemon(): number | undefined {
  return killPidAtGate(padiGate());
}

export function killKavalDaemon(): number | undefined {
  return killPidAtGate(kavalGate());
}

const EVIDENCE = !!process.env.KOLU_EVIDENCE;
const rawVideoDir = EVIDENCE ? mkSubDir("video-raw") : undefined;
const evidenceVideoDir = path.resolve(
  import.meta.dirname,
  "..",
  "reports",
  "videos",
);
const serverLogDir = path.resolve(import.meta.dirname, "..", "reports");
const EVIDENCE_VIEWPORT = { width: 1280, height: 720 };

const X11CAP = !!process.env.KOLU_X11CAP;
const X11_SCALE = 2;
const X11_VIEWPORT = { width: 1280, height: 720 };
const X11_MAX_VIEWPORT = { width: 1728, height: 972 };
const X11_SLOWMO = 250;
const X11_SCREEN = engine.physicalSize({
  viewport: X11_MAX_VIEWPORT,
  scale: X11_SCALE,
});
const slug = (s: string) => s.replace(/\s+/g, "-").toLowerCase();
const demoOutDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "website",
  "public",
  "demo",
);
let xvfbProc: ReturnType<typeof spawn> | undefined;
let ffmpegProc: ReturnType<typeof spawn> | undefined;
let x11Display: string | undefined;
let x11RawPath: string | undefined;
let x11Stem: string | undefined;

let baseUrl: string;
let browser: Browser;
let serverProcess: ChildProcess | undefined;

// Reuse TCP connections across scenarios to avoid TIME_WAIT socket
// accumulation on macOS (see #334).
const keepAliveAgent = new http.Agent({ keepAlive: true });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        agent: keepAliveAgent,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          resolve({ ok: code >= 200 && code < 300 });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function killServerKeepingKaval() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
  killPadiDaemon();
}

function killServerAndDaemons() {
  killServerKeepingKaval();
  killKavalDaemon();
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
process.on("exit", () => killServerAndDaemons());

const ciArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--headless=new",
];

const PHONE_VIEWPORT = { width: 390, height: 844 };
const COMPACT_VIEWPORT = { width: 900, height: 1000 };

const RETINA_DEVICE_SCALE_FACTOR = 2.25;

async function newScenarioPage(
  isMobile: boolean,
  chrome: "app" | "browser",
  vp: { width: number; height: number } = X11_VIEWPORT,
  touchViewport: { width: number; height: number } = PHONE_VIEWPORT,
  deviceScaleFactor?: number,
): Promise<{ context: BrowserContext; page: Page }> {
  if (X11CAP && chrome === "app" && !isMobile) {
    const userDataDir = fs.mkdtempSync(path.join(testBaseDir, "chrome-app-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: engine.appModeArgs({
        url: baseUrl,
        scale: X11_SCALE,
        viewport: vp,
      }),
      viewport: null,
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-write", "clipboard-read"],
      slowMo: X11_SLOWMO,
    });
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    return { context, page };
  }

  let previousContext: BrowserContext | undefined;
  return retryTransient("create Playwright page", async () => {
    if (previousContext) {
      await previousContext.close().catch(() => undefined);
      previousContext = undefined;
    }
    const context = await browser.newContext({
      viewport: isMobile
        ? touchViewport
        : X11CAP
          ? null
          : EVIDENCE
            ? EVIDENCE_VIEWPORT
            : { width: 1920, height: 1080 },
      ...(isMobile && { hasTouch: true, isMobile: true }),
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-write", "clipboard-read"],
      ...(rawVideoDir
        ? { recordVideo: { dir: rawVideoDir, size: EVIDENCE_VIEWPORT } }
        : {}),
    });
    previousContext = context;
    const page = await context.newPage();
    previousContext = undefined;
    return { context, page };
  });
}

async function waitForOwnedServer(
  url: string,
  ownsPort: () => boolean,
  hasExited: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (hasExited()) return false;
    if (ownsPort()) {
      try {
        const resp = await httpGet(`${url}/api/health`);
        if (resp.ok) return true;
      } catch (err) {
        if (!isTransientSetupError(err)) throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function assertRemoteDestructiveAck(): void {
  const remotePadiHost = process.env.KOLU_E2E_PADI_HOST;
  if (!remotePadiHost) return;
  if (process.env.KOLU_E2E_SSH_DESTRUCTIVE_ACK !== "1") {
    throw new Error(
      `REFUSING: the cucumber ssh leg (KOLU_E2E_PADI_HOST=${remotePadiHost}) is DESTRUCTIVE — ` +
        `binding kolu-server to it drains + killAll's that host's padi (its live terminals) on ` +
        `every server start. Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '${remotePadiHost}' is a ` +
        `disposable test host, never a workstation.`,
    );
  }
}

const E2E_SERVER_ENV_PREFIXES = ["NIX_"] as const;
const DEVSHELL_VARS = ["IN_NIX_SHELL", "NODE_OPTIONS", "PWD"] as const;
const HARNESS_KNOB_VARS = [
  "CI",
  "HEADLESS",
  "CUCUMBER_WORKER_ID",
  "KOLU_TEST_VERBOSE",
  "KOLU_COMMIT_HASH",
  "TZ",
  "TERMINFO",
] as const;
const WHICH_BINARY_VARS = [
  "KOLU_KAVAL_BIN",
  "KOLU_OSFACTS_BIN",
  "SURFACE_AGENT_FLAKE_REF",
] as const;
const RECORDING_VARS = ["KOLU_REMOTE_PADI_STATE_DIR"] as const;
const E2E_SERVER_ENV_KEYS = [
  ...DEVSHELL_VARS,
  ...HARNESS_KNOB_VARS,
  ...WHICH_BINARY_VARS,
  ...RECORDING_VARS,
] as const;

function composeE2eServerEnv(): Record<string, string> {
  const env = composeSpawnEnv(process.env);
  Object.assign(env, pickEnv(E2E_SERVER_ENV_KEYS, process.env));
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && E2E_SERVER_ENV_PREFIXES.some((p) => k.startsWith(p))) {
      env[k] = v;
    }
  }
  return env;
}

const agentDistroFixture = agentDistroFixtureEnv();

const acpFixtureAgent = path.resolve(
  import.meta.dirname,
  "acp-fixture-agent.ts",
);

const acpFixtureSessions = mkSubDir("acp-sessions");

type PadiProbe = "wipe" | "readOnly";

function perWorkerIsolationEnv(): Record<string, string> {
  return {
    KOLU_STATE_DIR: koluStateDir,
    KOLU_PADI_STATE_DIR: padiStateDir,
    XDG_RUNTIME_DIR: runtimeDir,
    KOLU_DAEMON_BIND_PID: String(process.pid),
  };
}

function agentFixtureEnv(): Record<string, string | undefined> {
  return {
    ...agentDistroFixture,
    ...serverModeEnv,
    ...(RECORDING ? {} : { KOLU_OPENCODE_DB: opencodeDbPath }),
  };
}

function padiHostOverrideEnv(): Record<string, string> {
  const host =
    process.env.KOLU_E2E_PADI_HOST_SEED || process.env.KOLU_E2E_PADI_HOST;
  return host ? { KOLU_PADI_HOST: host } : {};
}

function conductorEnv(): Record<string, string> {
  return {
    KOLU_ACP_AGENT: `${process.execPath} ${acpFixtureAgent} ${acpFixtureSessions}`,
  };
}

async function startServerChild(
  koluServer: string,
  wipeOnProbe: PadiProbe = "wipe",
): Promise<void> {
  assertRemoteDestructiveAck();
  const envWhitelist = NIX_ENV_WHITELIST;
  fs.mkdirSync(serverLogDir, { recursive: true });
  const serverLog = fs.createWriteStream(
    path.join(serverLogDir, `server-w${workerId}.log`),
    { flags: "a" },
  );

  const MAX_SPAWN_ATTEMPTS = 5;
  let started = false;
  for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS && !started; attempt++) {
    const port = await getPort();
    const url = `http://localhost:${port}`;
    console.log(
      `[worker:${workerId}] Starting server on port ${port} (attempt ${attempt}/${MAX_SPAWN_ATTEMPTS})...`,
    );
    const child = spawn(
      koluServer,
      [
        "web",
        "--allow-nix-shell-with-env-whitelist",
        envWhitelist,
        "--port",
        String(port),
      ],
      {
        stdio: "pipe",
        env: {
          ...composeE2eServerEnv(),
          ...perWorkerIsolationEnv(),
          KOLU_KAVAL_SPAWN: "detached",
          ...agentFixtureEnv(),
          ...padiHostOverrideEnv(),
          ...conductorEnv(),
          KOLU_GH_BIN: fakeGhBin,
        },
      },
    );

    let outBuf = "";
    let ownsPort = false;
    let exited = false;
    const scan = (data: Buffer) => {
      serverLog.write(data);
      if (!ownsPort) {
        outBuf += data.toString();
        if (outBuf.includes("kolu listening") && outBuf.includes(`:${port}`))
          ownsPort = true;
        if (outBuf.length > 16_384) outBuf = outBuf.slice(-4_096);
      }
    };
    child.stderr?.on("data", (data: Buffer) => {
      scan(data);
      process.stderr.write(`[server:${workerId}] ${data}`);
    });
    child.stdout?.on("data", (data: Buffer) => {
      scan(data);
      if (process.env.KOLU_TEST_VERBOSE) {
        process.stderr.write(`[server:${workerId}:out] ${data}`);
      }
    });
    child.on("exit", (code, signal) => {
      exited = true;
      const line = `[server:${workerId}] process exited code=${code} signal=${signal}\n`;
      serverLog.write(line);
      process.stderr.write(line);
    });

    const owned = await waitForOwnedServer(
      url,
      () => ownsPort,
      () => exited,
      15_000,
    );
    if (owned) {
      serverProcess = child;
      baseUrl = url;
      await setRpcBaseUrl(url);
      started = true;
      console.log(`[worker:${workerId}] Server is healthy on ${port}.`);
    } else {
      console.log(
        `[worker:${workerId}] Server did not take ownership of port ${port} ` +
          `(ownsPort=${ownsPort} exited=${exited}) — likely a squatter; retrying on a fresh port.`,
      );
      child.kill("SIGKILL");
    }
  }
  if (!started) {
    throw new Error(
      `[worker:${workerId}] could not start a kolu server that owns its port after ${MAX_SPAWN_ATTEMPTS} attempts`,
    );
  }
  await waitForPadiLive({ wipeOnProbe });
}

async function waitForPadiLive({
  announce = true,
  timeoutMs = 120_000,
  wipeOnProbe = "wipe",
}: {
  announce?: boolean;
  timeoutMs?: number;
  wipeOnProbe?: PadiProbe;
} = {}): Promise<void> {
  const remotePadiHost = process.env.KOLU_E2E_PADI_HOST;
  if (wipeOnProbe === "wipe") assertRemoteDestructiveAck();
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostic = "no attempt completed";
  while (true) {
    const remainingBeforeAttempt = deadline - Date.now();
    if (remainingBeforeAttempt <= 0) break;
    try {
      const attempt = { timeoutMs: Math.min(5_000, remainingBeforeAttempt) };
      if (wipeOnProbe === "wipe") {
        await padiCall("lifecycle/killAll", undefined, attempt);
      } else {
        await padiFirstFrameThenClose("terminals/keys", undefined, attempt);
      }
      if (announce)
        console.log(
          remotePadiHost
            ? `[worker:${workerId}] remote padi is live — running against the ssh host`
            : `[worker:${workerId}] local padi is live`,
        );
      return;
    } catch (err) {
      if (!isPadiWarmingUp(err)) {
        throw new Error(
          `[worker:${workerId}] padi liveness probe failed permanently (${
            err instanceof Error ? err.message : String(err)
          })`,
          { cause: err },
        );
      }
      lastDiagnostic = err instanceof RpcCallFailed ? err.message : String(err);
    }
    const remainingBeforeSleep = deadline - Date.now();
    if (remainingBeforeSleep <= 0) break;
    await sleep(Math.min(1_000, remainingBeforeSleep));
  }
  throw new Error(
    remotePadiHost
      ? `[worker:${workerId}] remote padi (KOLU_E2E_PADI_HOST=${remotePadiHost}) never became live within ${timeoutMs}ms (last probe: ${lastDiagnostic})`
      : `[worker:${workerId}] local padi never became live within ${timeoutMs}ms (last probe: ${lastDiagnostic})`,
  );
}

async function resetPadiScenarioState(timeoutMs: number): Promise<void> {
  await retryPadiScenarioReset(timeoutMs, async (remaining) => {
    await waitForPadiLive({ announce: false, timeoutMs: remaining });
    await padiCall("activityFeed/test__set", {
      recentRepos: [],
      recentAgents: [],
    });
    await padiCall("session/test__set", null);
  });
}

const POLICY_PUSH_TIMEOUT = 5_000;

async function waitForInheritPolicy(): Promise<void> {
  await waitForPadiCell({
    memberVerb: "newTerminalPolicy/get",
    accept: (p) => (p as NewTerminalPolicy).kind === "inherit",
    what: `the inherit new-terminal policy [worker:${workerId}]`,
    timeoutMs: POLICY_PUSH_TIMEOUT,
  });
}

async function waitForAgentsOff(): Promise<void> {
  await waitForPadiCell({
    memberVerb: "agentDistro/get",
    accept: (s) => (s as AgentDistroSetting).enabled === false,
    what: `the Agents setting off [worker:${workerId}]`,
    timeoutMs: POLICY_PUSH_TIMEOUT,
  });
}

const X11_SOCKET_TIMEOUT = 10_000;

async function waitForDisplaySocket(display: string): Promise<void> {
  const socket = path.join("/tmp", ".X11-unix", `X${display.slice(1)}`);
  const deadline = Date.now() + X11_SOCKET_TIMEOUT;
  while (!fs.existsSync(socket)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Xvfb never opened ${socket} within ${X11_SOCKET_TIMEOUT}ms`,
      );
    }
    await sleep(50);
  }
}

BeforeAll(async () => {
  if (X11CAP) {
    x11Display = `:${99 + Number(workerId ?? 0)}`;
    xvfbProc = engine.startXvfb(
      x11Display,
      X11_SCREEN.width,
      X11_SCREEN.height,
    );
    process.env.DISPLAY = x11Display;
    await waitForDisplaySocket(x11Display);
    console.log(`[worker:${workerId}] KOLU_X11CAP: Xvfb up on ${x11Display}`);
  }

  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer) throw new Error("KOLU_SERVER must be a URL or binary path");

  if (koluServer.startsWith("http")) {
    baseUrl = koluServer;
    await setRpcBaseUrl(baseUrl);
    await waitForPadiLive();
  } else {
    await startServerChild(koluServer);
  }

  const x11Args = engine.captureWindowArgs({
    scale: X11_SCALE,
    viewport: X11_VIEWPORT,
  });
  browser = await chromium.launch({
    headless: X11CAP ? false : process.env.HEADLESS !== "false",
    args: X11CAP ? x11Args : ciArgs,
    ...(EVIDENCE || X11CAP ? { slowMo: X11_SLOWMO } : {}),
  });
});

AfterAll(async () => {
  if (browser) await browser.close();
  if (xvfbProc) {
    xvfbProc.kill("SIGTERM");
    xvfbProc = undefined;
  }
  keepAliveAgent.destroy();
  await disposeRpcWire();
  killServerAndDaemons();
  try {
    for (const entry of fs.readdirSync(padiStateDir)) {
      if (!entry.endsWith(".log")) continue;
      fs.copyFileSync(
        path.join(padiStateDir, entry),
        path.join(serverLogDir, `padi-w${workerId}-${entry}`),
      );
    }
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }
  fs.rmSync(testBaseDir, { recursive: true, force: true });
  if (fixtureHome) fs.rmSync(fixtureHome, { recursive: true, force: true });
});

const SCENARIO_PADI_LIVE_TIMEOUT = 60_000;
const SCENARIO_SETUP_GUARD = 30_000;
const SCENARIO_SETUP_TIMEOUT =
  SCENARIO_PADI_LIVE_TIMEOUT + SCENARIO_SETUP_GUARD;

Before(
  { timeout: SCENARIO_SETUP_TIMEOUT },
  async function (this: KoluWorld, scenario) {
    x11Stem = slug(scenario.pickle.name);
    await surfaceCall("surface/kolu/preferences/test__set", {
      seenTips: [],
      startupTips: !X11CAP,
      newTerminalTheme: "inherit",
      newTerminalCollapsed: !X11CAP,
      shuffleBehavior: "auto",
      scrollLock: true,
      attentionAlerts: true,
      colorScheme: "dark",
      terminalRenderer: "auto",
      rightPanel: {
        size: 0.25,
        codeTabTreeSize: 0.35,
      },
      agentDistro: null,
      agentProfilesRecent: [],
      tipBarCollapsed: false,
      hostOrder: [],
    });
    await resetPadiScenarioState(SCENARIO_PADI_LIVE_TIMEOUT);
    await waitForInheritPolicy();
    await waitForAgentsOff();

    const isCompact = scenario.pickle.tags.some((t) => t.name === "@compact");
    const isMobile =
      isCompact || scenario.pickle.tags.some((t) => t.name === "@mobile");
    const touchViewport = isCompact ? COMPACT_VIEWPORT : PHONE_VIEWPORT;
    const deviceScaleFactor = scenario.pickle.tags.some(
      (t) => t.name === "@retina",
    )
      ? RETINA_DEVICE_SCALE_FACTOR
      : undefined;

    const rec = X11CAP ? getRecording(scenario.pickle.name) : undefined;
    const chrome = rec?.chrome ?? "browser";
    const vp = rec?.viewport ?? X11_VIEWPORT;

    this.browser = browser;
    const created = await newScenarioPage(
      isMobile,
      chrome,
      vp,
      touchViewport,
      deviceScaleFactor,
    );
    this.context = created.context;
    this.page = created.page;
    const reducedMotion = !EVIDENCE && !X11CAP;
    if (reducedMotion) {
      await this.page.emulateMedia({ reducedMotion: "reduce" });
      await this.page.addInitScript(`
      document.addEventListener("DOMContentLoaded", function() {
        var style = document.createElement("style");
        style.textContent = "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }";
        document.head.appendChild(style);
      });
    `);
    }
    if (X11CAP) {
      await this.page.addInitScript(`
      document.addEventListener("DOMContentLoaded", function() {
        var style = document.createElement("style");
        style.textContent = '[data-testid="tip-banner"] { display: none !important; }';
        document.head.appendChild(style);
      });
    `);
    }
    await this.page.addInitScript(`
    window.__readXtermBuffer = function(sel, idx, opts) {
      var containers = document.querySelectorAll(sel);
      var container = containers[idx];
      if (!container) return "";
      var term = container.__xterm;
      if (!term) return "";
      var buf = term.buffer.active;
      var start = 0, end = buf.length;
      if (opts && opts.viewport) {
        start = buf.viewportY;
        end = Math.min(buf.length, buf.viewportY + term.rows);
      }
      var lines = [];
      for (var i = start; i < end; i++) {
        var line = buf.getLine(i);
        if (!line) { lines.push(""); continue; }
        // A single logical line longer than the grid width hard-wraps across
        // several buffer rows; the continuation rows carry isWrapped=true.
        // Rejoin them into ONE logical line so a match string that straddles a
        // wrap column is still found — e.g. a dropped file's long scratch path
        // wraps "notes.md" as "...no" + "tes.md", which a naive per-row join
        // would split with a newline and never match (the file-drop/clipboard
        // screen-state flake). translateToString(trimRight) is applied only at
        // the logical-line END: a mid-line (continued) row fills the full width,
        // so trimming it would drop a real space sitting on the wrap boundary.
        var next = i + 1 < end ? buf.getLine(i + 1) : null;
        var continued = !!(next && next.isWrapped);
        var s = line.translateToString(!continued);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += s;
        else lines.push(s);
      }
      return lines.join("\\n");
    };
  `);
    this.errors = [];
    this.page.on("pageerror", (err) => this.errors.push(err.message));

    if (X11CAP && x11Display) {
      x11RawPath = path.join(evidenceVideoDir, `${x11Stem}.x11.mp4`);
      const grab = engine.physicalSize({ viewport: vp, scale: X11_SCALE });
      ffmpegProc = engine.startX11Grab({
        display: x11Display,
        width: grab.width,
        height: grab.height,
        out: x11RawPath,
        logFile: path.join(evidenceVideoDir, `${x11Stem}.x11.log`),
      });
      ffmpegProc.on("error", (e) =>
        console.error(
          `[worker:${workerId}] KOLU_X11CAP: ffmpeg spawn error:`,
          e,
        ),
      );
    }
  },
);

After({ timeout: 600_000 }, async function (this: KoluWorld, scenario) {
  await retireWorldScrollFifo(this);
  if (scenario.result?.status === Status.FAILED && this.page) {
    const dir = path.resolve(
      import.meta.dirname,
      "..",
      "reports",
      "screenshots",
    );
    fs.mkdirSync(dir, { recursive: true });
    const name = x11Stem ?? slug(scenario.pickle.name);
    await this.page
      .screenshot({
        path: path.join(dir, `${name}.png`),
        fullPage: true,
      })
      .catch((err) => {
        console.error(
          `[worker:${workerId}] Failed to capture failure screenshot:`,
          err,
        );
      });
  }
  const video = EVIDENCE ? this.page?.video() : undefined;
  if (X11CAP && ffmpegProc) {
    await engine.stopX11Grab(ffmpegProc);
    ffmpegProc = undefined;
    console.log(`[worker:${workerId}] KOLU_X11CAP: saved ${x11RawPath}`);
  }
  if (this.context) await this.context.close();
  if (video) {
    const name = x11Stem ?? slug(scenario.pickle.name);
    fs.mkdirSync(evidenceVideoDir, { recursive: true });
    await video
      .saveAs(path.join(evidenceVideoDir, `${name}.webm`))
      .catch((err) => {
        console.error(
          `[worker:${workerId}] Failed to save evidence video:`,
          err,
        );
      });
  }
  if (X11CAP && x11RawPath) {
    const raw = x11RawPath;
    x11RawPath = undefined;
    const name = x11Stem ?? slug(scenario.pickle.name);
    x11Stem = undefined;
    if (scenario.result?.status !== Status.PASSED) {
      throw new Error(
        `KOLU_X11CAP: scenario "${scenario.pickle.name}" did not pass ` +
          `(${scenario.result?.status}); refusing to publish demo assets from ` +
          `${raw}`,
      );
    }
    const rawSize = fs.statSync(raw, { throwIfNoEntry: false })?.size ?? 0;
    if (rawSize < 1024) {
      throw new Error(
        `KOLU_X11CAP: raw clip ${raw} is missing or too small (${rawSize}B) — ` +
          `ffmpeg likely failed to capture; not publishing demo assets`,
      );
    }
    const out = await engine.transcodeToWeb({
      raw,
      outDir: demoOutDir,
      name,
      trimStart: getRecording(scenario.pickle.name).trimStart ?? 5.3,
      posterAt: getRecording(scenario.pickle.name).posterAt ?? 6,
    });
    console.log(`[worker:${workerId}] KOLU_X11CAP: web assets → ${out.mp4}`);
  }
});

After({ tags: "@kaval-restart" }, async function (this: KoluWorld) {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer || koluServer.startsWith("http")) return;
  console.log(
    `[worker:${workerId}] @kaval-restart: rebooting server to respawn its kaval daemon.`,
  );
  killServerAndDaemons();
  await startServerChild(koluServer);
});

export async function restartKoluServer(
  whileDown?: (stateFile: string) => void,
): Promise<string> {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer || koluServer.startsWith("http")) {
    throw new Error(
      "a scenario asked for a server restart, but KOLU_SERVER is a reused URL this run does not own",
    );
  }
  console.log(`[worker:${workerId}] redeploying the server for a scenario.`);
  killServerKeepingKaval();
  whileDown?.(path.join(koluStateDir, "config.json"));
  await startServerChild(koluServer, "readOnly");
  return baseUrl;
}
