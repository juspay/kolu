/**
 * Dev-mode smoke: boot `just dev`, load Kolu in a real browser, fail on any
 * console error.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CUCUMBER SUITE
 *
 * Every other e2e check runs against a PRODUCTION bundle — `just test` against
 * the nix-built binary, `just test-quick` against `vite build` output. A
 * production bundle is tree-shaken, and tree-shaking is precisely what hides
 * this class of defect.
 *
 * kolu#2042 is the worked example. A barrel import (`@kolu/surface-daemon`,
 * whose index re-exports `daemonHome.ts` → `@kolu/surface/unix-socket` →
 * `node:fs`) reached `App.tsx`. In a production build Rollup dropped the unused
 * re-export and the bundle came out byte-identical — `nix build` green, the
 * whole cucumber suite green. In DEV, where Vite serves unbundled modules with
 * no tree-shaking, the browser fetched `daemonHome.ts`, ran its top-level
 * `import "node:fs"`, hit Vite's browser stub, and the app died at module load:
 *
 *     Uncaught Error: Module "node:fs" has been externalized for browser
 *     compatibility. Cannot access "node:fs.lstatSync" in client code.
 *
 * Nothing that inspects the production build can see that, so the check has to
 * be what a developer does: run the dev server, open the page, look at the
 * console. The defect is dev-only, so the check is dev-only.
 *
 * This deliberately does NOT enumerate forbidden imports. It asserts the
 * property that actually matters — Kolu loads clean — so it catches the next
 * module-load crash too, whatever its cause.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import getPort from "get-port";
import { chromium, type ConsoleMessage } from "playwright";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

/** How long the dev server gets to compile and start serving. Vite's cold
 *  dep-optimize on this workspace is the slow part; CI boxes are slower than a
 *  laptop, so this is generous. */
const DEV_READY_TIMEOUT_MS = 180_000;
/** How long the app gets to mount after navigation. */
const APP_MOUNT_TIMEOUT_MS = 60_000;
/** Quiet period after mount, to catch errors that arrive just after first paint. */
const SETTLE_MS = 3_000;

/** Two free ports, held open until both are chosen so they cannot collide with
 *  each other. Random ports are mandatory, not tidiness: the canonical 7681/5173
 *  belong to the developer's own `kolu.service`, and binding them would either
 *  fail or, worse, proxy this check's browser at their production instance. */
async function pickPorts(): Promise<{ server: number; client: number }> {
  const server = await getPort();
  const client = await getPort({ exclude: [server] });
  return { server, client };
}

/** Resolve once the port accepts a TCP connection AND serves a 200 — Vite binds
 *  before it can serve, so a bare connect check races the first request. */
async function waitForHttp(url: string, timeoutMs: number, proc: ChildProcess) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `dev server exited with code ${proc.exitCode} before serving ${url}`,
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // Not up yet — the deadline above is the real bound.
    }
    await sleep(500);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${url}`);
}

/** `just dev` forks a server and a client in parallel, so the child is a process
 *  GROUP. `detached: true` + `kill(-pid)` is what reaches both halves; killing
 *  the `just` pid alone orphans a Vite that keeps holding the port. */
function startDevServer(ports: { server: number; client: number }) {
  return spawn("just", ["dev", String(ports.server), String(ports.client)], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    // `just dev` deliberately detaches padi (and padi detaches kaval) so a
    // normal developer server can restart without killing terminal sessions.
    // A one-shot smoke run has the opposite lifetime: bind both daemons to this
    // process so its exit reaps the detached tree as well as the foreground
    // process group stopped below.
    env: {
      ...process.env,
      KOLU_DAEMON_BIND_PID: String(process.pid),
    },
  });
}

function stopDevServer(proc: ChildProcess) {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    // Group already gone — nothing to reap.
  }
}

/** A console message worth failing on. `error` is the module-load crash class
 *  this exists for. `warning` is deliberately NOT included: Vite dev emits
 *  routine warnings (pre-bundle reloads, HMR notices) that are not defects. */
function isFailure(msg: ConsoleMessage): boolean {
  return msg.type() === "error";
}

async function main() {
  const ports = await pickPorts();
  console.log(
    `dev-smoke: server=${ports.server} client=${ports.client} (random, never the 7681/5173 production slot)`,
  );

  const dev = startDevServer(ports);
  const devLog: string[] = [];
  dev.stdout?.on("data", (d) => devLog.push(String(d)));
  dev.stderr?.on("data", (d) => devLog.push(String(d)));

  const failures: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    const url = `http://localhost:${ports.client}/`;
    await waitForHttp(url, DEV_READY_TIMEOUT_MS, dev);
    console.log(`dev-smoke: dev server serving ${url}`);

    browser = await chromium.launch();
    const page = await browser.newPage();

    page.on("console", (msg) => {
      if (isFailure(msg)) failures.push(`console.error: ${msg.text()}`);
    });
    // A module-load crash arrives as an uncaught exception, not a console call.
    page.on("pageerror", (err) => failures.push(`uncaught: ${err.message}`));

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // The app must MOUNT, not merely serve HTML: the #2042 crash left a served
    // page with an empty body, which a status-code check would have called
    // healthy. `[data-ws-status]` is the app shell's connection indicator — the
    // same element the cucumber suite reads — so waiting on it proves Solid
    // rendered, not just that Vite answered.
    //
    // A mount failure is recorded, NOT thrown. When the app dies at module load
    // both things are true — the console has the crash and the mount never
    // happens — and the console message is the one that names the cause. Letting
    // the timeout propagate would report `TimeoutError` and discard the
    // diagnosis the listeners above already captured.
    try {
      await page
        .locator("[data-ws-status]")
        .first()
        .waitFor({ state: "attached", timeout: APP_MOUNT_TIMEOUT_MS });
      // Only settle once mounted: a module-load crash in a lazily-imported chunk
      // surfaces slightly after first paint, and this is what catches it.
      await sleep(SETTLE_MS);
    } catch {
      failures.push(
        `app never mounted: no [data-ws-status] within ${APP_MOUNT_TIMEOUT_MS}ms`,
      );
    }
  } finally {
    await browser?.close();
    stopDevServer(dev);
  }

  if (failures.length > 0) {
    console.error(`\ndev-smoke: FAIL — ${failures.length} browser error(s):\n`);
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      "\nKolu did not load cleanly under `just dev`. Note that a production" +
        "\nbuild can hide this: Rollup tree-shakes unused re-exports, so a" +
        "\nserver-only module reached through a package barrel disappears from" +
        "\n`nix build` output while dev still serves and executes it (kolu#2042)." +
        "\n\nDev server output:\n",
    );
    console.error(devLog.join(""));
    process.exitCode = 1;
    return;
  }

  console.log("dev-smoke: PASS — Kolu loaded with a clean browser console");
}

await main();
