/**
 * Cucumber hooks — browser lifecycle + server health check.
 *
 * When running in parallel (--parallel N), each worker spawns its own
 * server on a random available port (via get-port), so multiple test
 * runs (including across worktrees) never collide.
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
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Server did not become healthy at ${url} within ${timeoutMs}ms`,
  );
}

BeforeAll(async function () {
  // Start server if not reusing
  if (process.env.BASE_URL) {
    baseUrl = process.env.BASE_URL;
  } else {
    const port = await getPort();
    baseUrl = `http://localhost:${port}`;
    console.log(`[worker:${workerId}] Starting server on port ${port}...`);
    serverProcess = spawn(
      "nix",
      ["run", "..#default", "--", "--port", String(port)],
      {
        stdio: "pipe",
        cwd: path.resolve(import.meta.dirname, ".."),
      },
    );
    serverProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[server:${workerId}] ${data}`);
    });
    await waitForHealth(`${baseUrl}/api/health`, 600_000);
    console.log(`[worker:${workerId}] Server is healthy.`);
  }

  // Launch browser
  const isCI = !!process.env.CI;
  browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
    args: isCI ? ciArgs : [],
  });
});

AfterAll(async function () {
  if (browser) await browser.close();
  killServer();
});

Before(async function (this: KoluWorld) {
  // Kill leftover terminals from previous scenarios so each starts with a clean slate
  await fetch(`${baseUrl}/rpc/terminal/killAll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  this.browser = browser;
  this.context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
  });
  this.page = await this.context.newPage();
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
