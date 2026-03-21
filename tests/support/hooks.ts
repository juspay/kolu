/**
 * Cucumber hooks — browser lifecycle + server health check.
 */

import { Before, After, BeforeAll, AfterAll, Status } from "@cucumber/cucumber";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { KoluWorld } from "./world.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const BASE_URL = "http://localhost:7681";
const HEALTH_URL = `${BASE_URL}/api/health`;

let browser: Browser;
let serverProcess: ChildProcess | undefined;

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
  if (!process.env.REUSE_SERVER) {
    console.log("Starting server via nix run ..#default ...");
    serverProcess = spawn("nix", ["run", "..#default"], {
      stdio: "pipe",
      cwd: path.resolve(import.meta.dirname, ".."),
    });
    serverProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[server] ${data}`);
    });
    await waitForHealth(HEALTH_URL, 600_000);
    console.log("Server is healthy.");
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
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
});

Before(async function (this: KoluWorld) {
  this.browser = browser;
  this.context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    baseURL: BASE_URL,
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
