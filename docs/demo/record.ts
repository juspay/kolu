/**
 * Record a GIF demo of kolu's terminal via screenshots.
 *
 * Starts its own kolu server, captures screenshots at key moments using
 * Playwright, then outputs numbered PNGs to docs/demo/tmp/ for ffmpeg
 * conversion to GIF. Screenshot-based approach works reliably with
 * ghostty-web's WebGL canvas (unlike Playwright video recording).
 */

import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const PORT = 17681; // non-default port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;
const frameDir = path.resolve(import.meta.dirname, "tmp");
const repoRoot = path.resolve(import.meta.dirname, "../..");

fs.mkdirSync(frameDir, { recursive: true });

let frameNum = 0;
const FPS = 10; // target frame rate

// --- Start a fresh kolu server ---
console.log("Starting kolu server...");
const server: ChildProcess = spawn(
  "nix",
  ["run", `.#default`, "--", "--port", String(PORT)],
  {
    stdio: "pipe",
    cwd: repoRoot,
  },
);
server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[server] ${d}`));

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Server did not become healthy at ${url} within ${timeoutMs}ms`,
  );
}

await waitForHealth(`${BASE_URL}/api/health`, 120_000);
console.log("Server is healthy.");

// --- Record via screenshots ---
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-webgl"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  baseURL: BASE_URL,
});
const page = await context.newPage();

async function captureFrame() {
  const padded = String(frameNum++).padStart(5, "0");
  await page.screenshot({ path: path.join(frameDir, `frame-${padded}.png`) });
}

/** Capture frames for a duration at FPS rate */
async function captureForMs(ms: number) {
  const interval = 1000 / FPS;
  const count = Math.ceil(ms / interval);
  for (let i = 0; i < count; i++) {
    await captureFrame();
    await page.waitForTimeout(interval);
  }
}

/** Type text with per-character delay, capturing a frame after each keystroke */
async function typeWithCapture(text: string, delayMs = 80) {
  for (const char of text) {
    await page.keyboard.type(char);
    await captureFrame();
    await page.waitForTimeout(delayMs);
  }
}

// Navigate and wait for terminal canvas
await page.goto("/");
await page.locator("canvas").waitFor({ state: "visible", timeout: 15_000 });
await page.waitForTimeout(2000); // let fonts and terminal settle

// Focus the terminal canvas so keystrokes reach ghostty
await page.locator("canvas").click();
await page.waitForTimeout(500);

// Capture initial terminal state
await captureForMs(1000);

// Demo: type and run commands
await typeWithCapture("echo hello from kolu");
await captureFrame();
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
await captureForMs(2000);

await typeWithCapture("uname -a");
await captureFrame();
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
await captureForMs(3000);

// Final pause
await captureForMs(1500);

// Cleanup
await page.close();
await context.close();
await browser.close();
server.kill("SIGTERM");

console.log(`Captured ${frameNum} frames to ${frameDir}/`);
