import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import getPort from "get-port";
import { chromium, errors as playwrightErrors, type Page } from "playwright";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

const DEV_SMOKE_BUDGET = {
  viteColdStartMs: 180_000,
  appMountMs: 60_000,
  postMountSettleMs: 3_000,
  httpProbeMs: 5_000,
  httpProbeIntervalMs: 500,
};

const PRODUCTION_PORT_SLOTS = {
  server: 7681,
  client: 5173,
};

const MOUNTED_APP_SHELL_SELECTOR = "[data-ws-status]";

async function pickPortsAwayFromProductionSlots(): Promise<{
  server: number;
  client: number;
}> {
  const productionSlots = [
    PRODUCTION_PORT_SLOTS.server,
    PRODUCTION_PORT_SLOTS.client,
  ];
  const server = await getPort({ exclude: productionSlots });
  const client = await getPort({ exclude: [...productionSlots, server] });
  return { server, client };
}

function isServerNotServingYet(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return error instanceof TypeError;
}

async function waitForHttpOk(
  url: string,
  timeoutMs: number,
  proc: ChildProcess,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(
        `dev server exited with code ${proc.exitCode} before serving ${url}`,
      );
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DEV_SMOKE_BUDGET.httpProbeMs),
      });
      if (res.ok) return;
    } catch (error) {
      if (!isServerNotServingYet(error)) throw error;
    }
    await sleep(DEV_SMOKE_BUDGET.httpProbeIntervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${url}`);
}

function bindDaemonsToThisProcessEnv(ports: {
  server: number;
  client: number;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KOLU_DEV_SERVER_PORT: String(ports.server),
    KOLU_DEV_CLIENT_PORT: String(ports.client),
    KOLU_DAEMON_BIND_PID: String(process.pid),
  };
}

function spawnDevParallelGroup(ports: { server: number; client: number }) {
  return spawn("just", ["_dev-parallel"], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: bindDaemonsToThisProcessEnv(ports),
  });
}

function isProcessGroupGone(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ESRCH";
}

function killProcessGroup(proc: ChildProcess) {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch (error) {
    if (!isProcessGroupGone(error)) throw error;
  }
}

async function appShellMounted(page: Page): Promise<boolean> {
  try {
    await page
      .locator(MOUNTED_APP_SHELL_SELECTOR)
      .first()
      .waitFor({ state: "attached", timeout: DEV_SMOKE_BUDGET.appMountMs });
    return true;
  } catch (error) {
    if (error instanceof playwrightErrors.TimeoutError) return false;
    throw error;
  }
}

async function collectBrowserLoadFailures(clientUrl: string) {
  const failures: string[] = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") failures.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) => failures.push(`uncaught: ${err.message}`));

    await page.goto(clientUrl, { waitUntil: "domcontentloaded" });

    if (await appShellMounted(page)) {
      await sleep(DEV_SMOKE_BUDGET.postMountSettleMs);
    } else {
      failures.push(
        `app never mounted: no ${MOUNTED_APP_SHELL_SELECTOR} within ${DEV_SMOKE_BUDGET.appMountMs}ms`,
      );
    }
  } finally {
    await browser.close();
  }
  return failures;
}

async function main() {
  const ports = await pickPortsAwayFromProductionSlots();
  console.log(
    `dev-smoke: server=${ports.server} client=${ports.client} (random, never the ${PRODUCTION_PORT_SLOTS.server}/${PRODUCTION_PORT_SLOTS.client} production slot)`,
  );

  const dev = spawnDevParallelGroup(ports);
  const devLog: string[] = [];
  dev.stdout?.on("data", (d) => devLog.push(String(d)));
  dev.stderr?.on("data", (d) => devLog.push(String(d)));

  let failures: string[] = [];

  try {
    const clientUrl = `http://localhost:${ports.client}/`;
    const serverHealthUrl = `http://localhost:${ports.server}/api/health`;
    await Promise.all([
      waitForHttpOk(clientUrl, DEV_SMOKE_BUDGET.viteColdStartMs, dev),
      waitForHttpOk(serverHealthUrl, DEV_SMOKE_BUDGET.viteColdStartMs, dev),
    ]);
    console.log(
      `dev-smoke: dev stack serving ${clientUrl} (health ${serverHealthUrl})`,
    );

    failures = await collectBrowserLoadFailures(clientUrl);
  } catch (error) {
    console.error(
      "dev-smoke: dev server output before failure:\n",
      devLog.join(""),
    );
    throw error;
  } finally {
    killProcessGroup(dev);
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
