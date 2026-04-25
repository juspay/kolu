/**
 * Cucumber hooks — browser lifecycle + server health check.
 *
 * KOLU_SERVER controls how the server is provided:
 *  - URL (http://...) → reuse an existing server
 *  - file path        → each worker spawns the binary on a random port
 *
 * Random ports (via get-port) let parallel runs across worktrees
 * coexist without port collisions.
 */

import type { ChildProcess } from "node:child_process";
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { After, AfterAll, Before, BeforeAll, Status } from "@cucumber/cucumber";
import getPort from "get-port";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import type { KoluWorld } from "./world.ts";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0", 10);

/** One base $TMPDIR per worker holds everything this test run creates:
 *  the kolu server's state dir and the Claude Code mock harness's
 *  sessions/projects dirs. Nesting keeps /tmp tidy (one entry per run
 *  instead of three) and makes cleanup a single recursive remove.
 *  Pid + workerId in the name let `ps`/`lsof` identify which concurrent
 *  run owns the tree; `mkdtempSync`'s random suffix prevents collisions. */
const testBaseDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `kolu-test-${process.pid}-w${workerId}-`),
);

const mkSubDir = (name: string) => {
  const dir = path.join(testBaseDir, name);
  fs.mkdirSync(dir);
  return dir;
};

/** Per-worker temp dirs for the Claude Code mock harness — see
 *  `claude_code_steps.ts`. Sharing one dir across all eight cucumber
 *  workers (the previous setup, exported once before `pnpm test`) puts
 *  enough inotify pressure on the server's `fs.watch(SESSIONS_DIR)` that
 *  events get dropped under load and detection silently misses the mock
 *  session. Each worker getting its own dir eliminates the contention. */
const claudeSessionsDir = mkSubDir("claude-sessions");
const claudeProjectsDir = mkSubDir("claude-projects");
process.env.KOLU_CLAUDE_SESSIONS_DIR = claudeSessionsDir;
process.env.KOLU_CLAUDE_PROJECTS_DIR = claudeProjectsDir;

/** Per-worker temp roots for the Codex and OpenCode mock harnesses —
 *  see `codex_steps.ts` and `opencode_steps.ts`. Both providers key off
 *  `state.cwd`, so the fixture DB rows carry a cwd that the scenario
 *  also `cd`s into so `findSessionByDirectory` returns the mock row. */
const codexDir = mkSubDir("codex");
const opencodeDbDir = mkSubDir("opencode");
const opencodeDbPath = path.join(opencodeDbDir, "opencode.db");
process.env.KOLU_CODEX_DIR = codexDir;
process.env.KOLU_OPENCODE_DB = opencodeDbPath;

/** Fake agent binaries the codex/opencode mock scenarios invoke by
 *  absolute path to bypass PATH resolution — the user's shell rc (e.g.
 *  ~/.bashrc) may prepend `~/.npm-global/bin` on startup and shadow any
 *  PATH override we set via the whitelist, so a real codex/opencode
 *  install on the host silently wins against the fake.
 *
 *  Each stub is a copy of `bash`, renamed to `codex` / `opencode`. The
 *  kernel's `/proc/<pid>/comm` (Linux) and sysctl KERN_PROC_PATHNAME
 *  (macOS) both reflect the execve basename, so a bash copy launched as
 *  `.../bin/codex -c "..."` shows up with comm="codex" — satisfying
 *  `readForegroundBasename() === "codex"` without requiring the real
 *  CLI to be installed.
 *
 *  `/bin/sleep` tempted as a simpler stub but fails on nixpkgs: coreutils
 *  ships as a multi-call binary that inspects argv[0] and errors with
 *  "unknown program 'codex'" when renamed. Bash is a single-purpose
 *  binary and copies cleanly.
 *
 *  Paths are surfaced to step definitions via KOLU_FAKE_CODEX_BIN and
 *  KOLU_FAKE_OPENCODE_BIN env vars (on this worker's process env, not
 *  forwarded to the spawned server — the step defs read them directly
 *  and type the absolute path into the pty). */
const fakeBinDir = mkSubDir("bin");
const bashPath = execSync("command -v bash", { encoding: "utf8" }).trim();
const fakeBins: Record<string, string> = {};
for (const name of ["codex", "opencode"]) {
  const target = path.join(fakeBinDir, name);
  fs.copyFileSync(bashPath, target);
  fs.chmodSync(target, 0o755);
  fakeBins[name] = target;
}
process.env.KOLU_FAKE_CODEX_BIN = fakeBins.codex;
process.env.KOLU_FAKE_OPENCODE_BIN = fakeBins.opencode;

/** Per-worker ephemeral state dir for the kolu server under test. Routing
 *  to $TMPDIR keeps test state out of `~/.config`; nesting under
 *  `testBaseDir` means the whole run's scratch space cleans up together. */
const koluStateDir = mkSubDir("state");

let baseUrl: string;
let browser: Browser;
let serverProcess: ChildProcess | undefined;

// Reuse TCP connections across scenarios to avoid TIME_WAIT socket
// accumulation on macOS (see #334).
const keepAliveAgent = new http.Agent({ keepAlive: true });

const TRANSIENT_SETUP_ERRORS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "socket hang up",
  "read ECONNRESET",
];

function isTransientSetupError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_SETUP_ERRORS.some((needle) => msg.includes(needle));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientSetupError(err) || attempt === 3) break;
      await sleep(100 * attempt);
    }
  }
  throw last instanceof Error
    ? new Error(`${label} failed after retries: ${last.message}`, {
        cause: last,
      })
    : new Error(`${label} failed after retries: ${String(last)}`);
}

/** POST JSON to a local URL, reusing TCP connections via keepAlive. */
function postJSONOnce(url: string, body: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        agent: keepAliveAgent,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function postJSON(url: string, body: object): Promise<void> {
  return retryTransient(`POST ${url}`, () => postJSONOnce(url, body));
}

/** GET a URL, reusing TCP connections via keepAlive. */
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
          // `res.statusCode` is typed `number | undefined` because the parser
          // can technically receive a malformed first line; in practice
          // node's `http` always supplies it once `end` fires, but treat
          // an absent code as a non-2xx response rather than asserting.
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

/** Kill the server child on any exit path (crash, SIGINT, SIGTERM). */
function killServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
}
process.on("exit", killServer);

const ciArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--headless=new",
];

async function newScenarioPage(
  isMobile: boolean,
): Promise<{ context: BrowserContext; page: Page }> {
  let previousContext: BrowserContext | undefined;
  return retryTransient("create Playwright page", async () => {
    if (previousContext) {
      await previousContext.close().catch(() => undefined);
      previousContext = undefined;
    }
    const context = await browser.newContext({
      viewport: isMobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 720 },
      ...(isMobile && { hasTouch: true, isMobile: true }),
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      // clipboard-write: lets tests place images in the clipboard for paste testing.
      // clipboard-read: lets tests verify clipboard contents after copy operations.
      // Production code never calls clipboard.read — these are test-only permissions.
      permissions: ["clipboard-write", "clipboard-read"],
    });
    previousContext = context;
    const page = await context.newPage();
    previousContext = undefined;
    return { context, page };
  });
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await httpGet(url);
      if (resp.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Server did not become healthy at ${url} within ${timeoutMs}ms`,
  );
}

BeforeAll(async () => {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer) throw new Error("KOLU_SERVER must be a URL or binary path");

  if (koluServer.startsWith("http")) {
    // Reuse an already-running server
    baseUrl = koluServer;
  } else {
    // Spawn the binary on a random port
    const port = await getPort();
    baseUrl = `http://localhost:${port}`;
    console.log(`[worker:${workerId}] Starting server on port ${port}...`);
    serverProcess = spawn(
      koluServer,
      [
        "--allow-nix-shell-with-env-whitelist",
        "default",
        "--port",
        String(port),
      ],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          // Route server state to an ephemeral $TMPDIR path so test runs
          // never touch ~/.config and the dir can be wiped in AfterAll.
          // `mkdtempSync`'s random suffix guarantees no collisions across
          // parallel workers or worktrees.
          KOLU_STATE_DIR: koluStateDir,
          KOLU_CLAUDE_SESSIONS_DIR: claudeSessionsDir,
          KOLU_CLAUDE_PROJECTS_DIR: claudeProjectsDir,
          KOLU_CODEX_DIR: codexDir,
          KOLU_OPENCODE_DB: opencodeDbPath,
        },
      },
    );
    serverProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[server:${workerId}] ${data}`);
    });
    // Drain stdout so the pipe buffer can't fill and block the server's
    // pino writes (pino targets stdout). Forward to stderr when
    // KOLU_TEST_VERBOSE is set for local debugging.
    serverProcess.stdout?.on("data", (data: Buffer) => {
      if (process.env.KOLU_TEST_VERBOSE) {
        process.stderr.write(`[server:${workerId}:out] ${data}`);
      }
    });
    await waitForHealth(`${baseUrl}/api/health`, 10_000);
    console.log(`[worker:${workerId}] Server is healthy.`);
  }

  // Launch browser — always use CI args for consistency and performance
  browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
    args: ciArgs,
  });
});

AfterAll(async () => {
  if (browser) await browser.close();
  keepAliveAgent.destroy();
  killServer();
  // Remove the per-worker base dir created with `mkdtempSync` above. Without
  // this, every `just test` invocation leaks ~100–200MB of JSONL transcripts
  // and session files into /tmp/kolu-test-*, and a long ralph loop or CI
  // server will eventually fill /tmp or /. Discovered during the #440
  // hardening loop — the halt at 0 bytes free was directly caused by this.
  try {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup — if something already removed the tree (or we
    // don't have permission for some reason) there's nothing productive
    // to do in a test teardown. The OS will clean /tmp eventually.
  }
});

Before(async function (this: KoluWorld, scenario) {
  // Kill leftover terminals and reset state so each scenario starts clean.
  // After #577 each domain (preferences / activity / savedSession) owns its
  // own reset endpoint — fired in parallel so the per-scenario setup cost
  // stays the same.
  await Promise.all([
    postJSON(`${baseUrl}/rpc/terminal/killAll`, {}),
    postJSON(`${baseUrl}/rpc/preferences/test__set`, {
      json: {
        // Reset all preferences to defaults (shuffleTheme off for deterministic tests)
        seenTips: [],
        startupTips: true,
        shuffleTheme: false,
        scrollLock: true,
        activityAlerts: true,
        colorScheme: "dark",
        terminalsFollowOSScheme: false,
        terminalRenderer: "auto",
        rightPanel: {
          collapsed: true,
          size: 0.25,
          tab: { kind: "inspector" },
        },
      },
    }),
    postJSON(`${baseUrl}/rpc/activity/test__set`, {
      json: { recentRepos: [], recentAgents: [] },
    }),
    postJSON(`${baseUrl}/rpc/session/test__set`, { json: null }),
  ]);

  // @mobile tag → emulate a touch phone (flips `(pointer: coarse)` to true,
  // mounts the mobile drag handle). Without the tag, scenarios run in the
  // desktop context unchanged.
  const isMobile = scenario.pickle.tags.some((t) => t.name === "@mobile");

  this.browser = browser;
  const created = await newScenarioPage(isMobile);
  this.context = created.context;
  this.page = created.page;
  // Disable CSS transitions/animations so Corvu dialogs open/close instantly.
  // prefers-reduced-motion tells well-behaved libraries to skip animations.
  // The style override catches anything that doesn't respect the media query.
  await this.page.emulateMedia({ reducedMotion: "reduce" });
  await this.page.addInitScript(`
    document.addEventListener("DOMContentLoaded", function() {
      var style = document.createElement("style");
      style.textContent = "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }";
      document.head.appendChild(style);
    });
    // Shared xterm buffer reader for e2e tests — used by waitForBufferContains,
    // readBufferText, and getTerminalPid via page.evaluate / page.waitForFunction.
    // Single definition avoids the buffer-read loop being duplicated across files.
    window.__readXtermBuffer = function(sel, idx) {
      var containers = document.querySelectorAll(sel);
      var container = containers[idx];
      if (!container) return "";
      var term = container.__xterm;
      if (!term) return "";
      var buf = term.buffer.active;
      var lines = [];
      for (var i = 0; i < buf.length; i++) {
        var line = buf.getLine(i);
        lines.push(line ? line.translateToString(true) : "");
      }
      return lines.join("\\n");
    };
  `);
  this.errors = [];
  this.page.on("pageerror", (err) => this.errors.push(err.message));
});

After(async function (this: KoluWorld, scenario) {
  // Screenshot on failure
  if (scenario.result?.status === Status.FAILED && this.page) {
    const dir = path.resolve(
      import.meta.dirname,
      "..",
      "reports",
      "screenshots",
    );
    fs.mkdirSync(dir, { recursive: true });
    const name = scenario.pickle.name.replace(/\s+/g, "-").toLowerCase();
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
  if (this.context) await this.context.close();
});
