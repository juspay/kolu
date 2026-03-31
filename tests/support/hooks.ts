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
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0");

let baseUrl: string;
let browser: Browser;
let serverProcess: ChildProcess | undefined;

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
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
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
        env: { ...process.env, KOLU_STATE_SUFFIX: `test-${workerId}` },
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
  killServer();
});

Before(async function (this: KoluWorld) {
  // Kill leftover terminals and clear saved session so each scenario starts clean
  await Promise.all([
    fetch(`${baseUrl}/rpc/terminal/killAll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/rpc/session/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  ]);

  this.browser = browser;
  this.context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    // clipboard-write: lets tests place images in the clipboard for paste testing.
    // clipboard-read is intentionally NOT granted — production code must work
    // without it (the paste event provides clipboard data for free).
    permissions: ["clipboard-write"],
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
  `);
  // Disable random theme so tests get deterministic default theme
  await this.page.addInitScript(() =>
    localStorage.setItem("kolu-random-theme", "false"),
  );
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
