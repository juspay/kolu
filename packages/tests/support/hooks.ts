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

import { Before, After, BeforeAll, AfterAll, Status } from "@cucumber/cucumber";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import getPort from "get-port";
import { KoluWorld } from "./world.ts";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0");

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

/** POST JSON to a local URL, reusing TCP connections via keepAlive. */
function postJSON(url: string, body: object): Promise<void> {
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
        res.on("end", () =>
          resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300 }),
        );
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

BeforeAll(async function () {
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
        },
      },
    );
    serverProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[server:${workerId}] ${data}`);
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

AfterAll(async function () {
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
  this.context = await browser.newContext({
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
  this.page = await this.context.newPage();
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
  if (scenario.result?.status === Status.FAILED) {
    const dir = path.resolve(
      import.meta.dirname,
      "..",
      "reports",
      "screenshots",
    );
    fs.mkdirSync(dir, { recursive: true });
    const name = scenario.pickle.name.replace(/\s+/g, "-").toLowerCase();
    await this.page.screenshot({
      path: path.join(dir, `${name}.png`),
      fullPage: true,
    });
  }
  if (this.context) await this.context.close();
});
