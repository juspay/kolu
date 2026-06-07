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
import { NIX_ENV_WHITELIST } from "kolu-pty";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as engine from "../screencast/engine.ts";
import { getRecording } from "../screencast/recordings/index.ts";
import type { KoluWorld } from "./world.ts";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0", 10);

/** Fixtures scaffold real git repos in /tmp and run `git commit` against
 *  them. On a pristine NixOS host with no `~/.gitconfig`, git aborts with
 *  "Author identity unknown" and 31 scenarios fail (see #887). Pin a test
 *  identity here so every fixture — current and future — inherits one.
 *  `??=` lets a host with `git config --global` set still take precedence
 *  when developers run locally. */
process.env.GIT_AUTHOR_NAME ??= "kolu-test";
process.env.GIT_AUTHOR_EMAIL ??= "test@kolu.dev";
process.env.GIT_COMMITTER_NAME ??= "kolu-test";
process.env.GIT_COMMITTER_EMAIL ??= "test@kolu.dev";

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

/** Per-worker temp roots for the Codex and OpenCode mock harnesses —
 *  see `codex_steps.ts` and `opencode_steps.ts`. Both providers key off
 *  `state.cwd`, so the fixture DB rows carry a cwd that the scenario
 *  also `cd`s into so `findSessionByDirectory` returns the mock row. */
const codexDir = mkSubDir("codex");
const opencodeDbDir = mkSubDir("opencode");
const opencodeDbPath = path.join(opencodeDbDir, "opencode.db");

/** The agent-dir overrides that point kolu at the mock harnesses' temp dirs.
 *  KOLU_X11CAP recordings launch the REAL claude/codex (whose sessions land in
 *  the real ~/.claude/projects + ~/.codex), so every one of these must be ABSENT
 *  — both deleted from `process.env` (so an inherited developer export can't
 *  shadow the real dir) AND mapped to `undefined` in the server child env (so the
 *  `...process.env` spread can't re-introduce one). The invariant — "this exact
 *  set of vars is the temp-dir mapping normally, all-undefined under X11CAP" —
 *  lives here once; the loop below mutates `process.env` from it and BeforeAll
 *  spreads it into the child env. Add a new agent dir → add it here only. */
const AGENT_DIR_VARS = [
  "KOLU_CLAUDE_SESSIONS_DIR",
  "KOLU_CLAUDE_PROJECTS_DIR",
  "KOLU_CODEX_DIR",
] as const;
const agentDirEnv: Record<(typeof AGENT_DIR_VARS)[number], string | undefined> =
  process.env.KOLU_X11CAP
    ? {
        KOLU_CLAUDE_SESSIONS_DIR: undefined,
        KOLU_CLAUDE_PROJECTS_DIR: undefined,
        KOLU_CODEX_DIR: undefined,
      }
    : {
        KOLU_CLAUDE_SESSIONS_DIR: claudeSessionsDir,
        KOLU_CLAUDE_PROJECTS_DIR: claudeProjectsDir,
        KOLU_CODEX_DIR: codexDir,
      };
for (const name of AGENT_DIR_VARS) {
  const value = agentDirEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
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

/** PR-evidence capture (set `KOLU_EVIDENCE=1`): record a Playwright video per
 *  scenario and save it, scenario-named, under `reports/videos/` for the /do
 *  evidence flow to transcode + upload (the same GIF/Pages-player delivery the
 *  bespoke `capture.mjs` used). Off by default so normal runs pay nothing — the
 *  whole point of reusing the harness is that capture rides the existing step
 *  library. See `docs/atlas/src/content/atlas/video-evidence.mdx`. `rawVideoDir` holds
 *  Playwright's auto-named files (under `testBaseDir`, wiped in AfterAll);
 *  `evidenceVideoDir` holds the saved, named `.webm`s and survives the run. */
const EVIDENCE = !!process.env.KOLU_EVIDENCE;
const rawVideoDir = EVIDENCE ? mkSubDir("video-raw") : undefined;
const evidenceVideoDir = path.resolve(
  import.meta.dirname,
  "..",
  "reports",
  "videos",
);
/** Per-worker kolu-server stdout/stderr capture, written in BeforeAll. Under
 *  `reports/` (gitignored) so a post-mortem survives the run. */
const serverLogDir = path.resolve(import.meta.dirname, "..", "reports");
/** Evidence records at a denser desktop viewport than the normal 1920×1080:
 *  at full width the single terminal tile + side panel float small in a sea of
 *  canvas, so the clip reads tiny. 1280×720 fills the frame and matches
 *  recordVideo.size exactly, so the capture is 1:1 with no downscaling. */
const EVIDENCE_VIEWPORT = { width: 1280, height: 720 };

/** Marketing-grade screencast capture (set `KOLU_X11CAP=1`, via `just record`):
 *  runs Chrome HEADFUL at 2× inside an Xvfb virtual display and records the
 *  framebuffer with `ffmpeg -f x11grab` — smooth (fixed clock, off the
 *  compositor) AND crisp (true 2×). The gnarly bits live in the agnostic engine
 *  (`../screencast/engine.ts`); this just orchestrates them around the Cucumber
 *  lifecycle. Per-scenario the recording module (looked up by scenario name)
 *  decides app-mode vs browser chrome. Run single-worker (CUCUMBER_PARALLEL=1).
 *  See `welcome-live-screencast.mdx`. */
const X11CAP = !!process.env.KOLU_X11CAP;
const X11_SCALE = 2;
const X11_VIEWPORT = { width: 1280, height: 720 }; // logical; physical = ×scale
/** Driver-pacing for recorded clips (ms between Playwright actions). Both
 *  X11CAP launch paths — the app-mode persistent context and the global headful
 *  browser — reference this so app-mode and browser-chrome clips share one
 *  capture cadence. */
const X11_SLOWMO = 250;
const X11_SCREEN = engine.physicalSize({
  viewport: X11_VIEWPORT,
  scale: X11_SCALE,
});
/** Scenario name → file stem. The grab path (Before) and transcode path (After)
 * MUST agree on this, so it lives in exactly one place. */
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
/** The current scenario's file stem (slug of its name), set once in Before so
 * every After site (failure screenshot, evidence webm, x11 grab/transcode)
 * reads the same value instead of re-deriving it. */
let x11Stem: string | undefined;

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
  "ETIMEDOUT",
  "EADDRNOTAVAIL",
];

/** Collect errno `code`s from an error tree. Node raises a dual-stack
 *  `AggregateError` for a refused connection (IPv4 + IPv6) whose own
 *  `.message` is empty and whose real errno lives on `.code` and on each
 *  `.errors[].code`. */
function errorCodes(err: unknown, out: string[] = []): string[] {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") out.push(code);
    const inner = (err as { errors?: unknown }).errors;
    if (Array.isArray(inner)) for (const e of inner) errorCodes(e, out);
  }
  return out;
}

/** A setup POST/GET error worth retrying. Checks both the message AND the
 *  errno `code` tree: a server that briefly refuses connections (mid-restart,
 *  GC pause, the instant before it dies) surfaces as an `AggregateError` with
 *  an EMPTY message but `code: "ECONNREFUSED"`. The prior message-only check
 *  missed that, so `retryTransient` bailed on the FIRST attempt with no retry
 *  and rethrew an empty-tailed "failed after retries:" — and under parallel
 *  load a single such miss let one worker fail (and queue-drain) hundreds of
 *  scenarios. Matching on `code` restores the intended 3× retry. */
function isTransientSetupError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (TRANSIENT_SETUP_ERRORS.some((needle) => msg.includes(needle)))
    return true;
  return errorCodes(err).some((code) => TRANSIENT_SETUP_ERRORS.includes(code));
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
  // Append the errno code(s) so an empty-message AggregateError (the
  // dual-stack ECONNREFUSED a dead server produces) still names its cause.
  const codes = errorCodes(last);
  const suffix = codes.length ? ` [${[...new Set(codes)].join(",")}]` : "";
  throw last instanceof Error
    ? new Error(`${label} failed after retries: ${last.message}${suffix}`, {
        cause: last,
      })
    : new Error(`${label} failed after retries: ${String(last)}${suffix}`);
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
        res.on("end", () => {
          // Reject non-2xx so a reset the server actually rejected (it was
          // briefly unready, or an endpoint drifted) surfaces instead of
          // resolving as success and letting the scenario start against stale
          // state. Mirrors httpGet's status check; 2xx resolves exactly as
          // before, so green runs are unchanged.
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) resolve();
          else reject(new Error(`POST ${url} -> HTTP ${code}`));
        });
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
  chrome: "app" | "browser",
): Promise<{ context: BrowserContext; page: Page }> {
  // KOLU_X11CAP app-mode: a frameless `--app=` window (the installed-PWA look)
  // needs its own persistent context — Playwright drives the page Chrome opens
  // at launch. Browser-chrome recordings fall through to the headful newContext
  // path below (the global `browser` is launched headful under X11CAP).
  if (X11CAP && chrome === "app" && !isMobile) {
    const userDataDir = fs.mkdtempSync(path.join(testBaseDir, "chrome-app-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: engine.appModeArgs({
        url: baseUrl,
        scale: X11_SCALE,
        viewport: X11_VIEWPORT,
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
      // 1920×1080 matches a typical desktop monitor — the previous 1280×720
      // default hid viewport-size-dependent bugs (e.g. the canvas
      // centering math behaves differently when the tile is small relative
      // to the viewport vs nearly filling it).
      // KOLU_X11CAP browser-chrome: viewport null → the page fills the headful
      // window (sized by the launch args, i.e. 2560×1440 physical).
      viewport: isMobile
        ? { width: 390, height: 844 }
        : X11CAP
          ? null
          : EVIDENCE
            ? EVIDENCE_VIEWPORT
            : { width: 1920, height: 1080 },
      ...(isMobile && { hasTouch: true, isMobile: true }),
      baseURL: baseUrl,
      ignoreHTTPSErrors: true,
      // clipboard-write: lets tests place images in the clipboard for paste testing.
      // clipboard-read: lets tests verify clipboard contents after copy operations.
      // Production code never calls clipboard.read — these are test-only permissions.
      permissions: ["clipboard-write", "clipboard-read"],
      // KOLU_EVIDENCE: record a video of the context. recordVideo is a
      // context option (not a launch option); the file is finalized on
      // context.close() and retrieved per-page via page.video() in After.
      // size matches the evidence viewport so the capture is 1:1.
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
  // KOLU_X11CAP: bring up the Xvfb virtual display BEFORE launching the (headful)
  // browser, and point DISPLAY at it so Chrome and ffmpeg share the framebuffer.
  if (X11CAP) {
    x11Display = `:${99 + Number(workerId ?? 0)}`;
    xvfbProc = engine.startXvfb(
      x11Display,
      X11_SCREEN.width,
      X11_SCREEN.height,
    );
    process.env.DISPLAY = x11Display;
    // Give Xvfb a moment to create the display before Chrome connects.
    await new Promise((r) => setTimeout(r, 600));
    console.log(`[worker:${workerId}] KOLU_X11CAP: Xvfb up on ${x11Display}`);
  }

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
    // Extend NIX_ENV_WHITELIST with GIT_AUTHOR_*/GIT_COMMITTER_* so PTY
    // shells in fixtures like `code-tab.feature` (which run `git init &&
    // git commit` inside the terminal under test) inherit the same
    // identity set on process.env above. Without this, the whitelist
    // filter strips them and those scenarios fail on pristine hosts.
    const envWhitelist = [
      NIX_ENV_WHITELIST,
      "GIT_AUTHOR_NAME,GIT_AUTHOR_EMAIL,GIT_COMMITTER_NAME,GIT_COMMITTER_EMAIL",
    ].join(",");
    serverProcess = spawn(
      koluServer,
      [
        "--allow-nix-shell-with-env-whitelist",
        envWhitelist,
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
          // The agent-dir overrides, derived once above: temp dirs normally,
          // all-undefined under X11CAP so the `...process.env` spread can't
          // re-introduce an inherited value and the server watches the real
          // ~/.claude/projects + ~/.codex (the dock then tracks the live agent).
          ...agentDirEnv,
          KOLU_OPENCODE_DB: opencodeDbPath,
        },
      },
    );
    // Tee the spawned server's stdout+stderr to a per-worker file. A server
    // that dies mid-run otherwise leaves NO trace in the suite log (its only
    // visible symptom is downstream `ECONNREFUSED` resets on its port); the
    // file preserves the crash stack / clean-exit / silence-then-gone that
    // distinguishes a crash from a wedge. Append-mode so a re-spawn doesn't
    // clobber the prior life. Cheap, always on (replaces the KOLU_TEST_VERBOSE
    // stdout gate — stdout is still drained so the pipe can't block pino).
    fs.mkdirSync(serverLogDir, { recursive: true });
    const serverLog = fs.createWriteStream(
      path.join(serverLogDir, `server-w${workerId}.log`),
      { flags: "a" },
    );
    serverProcess.stderr?.on("data", (data: Buffer) => {
      serverLog.write(data);
      process.stderr.write(`[server:${workerId}] ${data}`);
    });
    serverProcess.stdout?.on("data", (data: Buffer) => {
      serverLog.write(data);
      if (process.env.KOLU_TEST_VERBOSE) {
        process.stderr.write(`[server:${workerId}:out] ${data}`);
      }
    });
    // Record the death itself: code/signal disambiguates crash (code≠0 or a
    // signal) from a clean exit from a never-fired handler (wedge).
    serverProcess.on("exit", (code, signal) => {
      const line = `[server:${workerId}] process exited code=${code} signal=${signal}\n`;
      serverLog.write(line);
      process.stderr.write(line);
    });
    await waitForHealth(`${baseUrl}/api/health`, 10_000);
    console.log(`[worker:${workerId}] Server is healthy.`);
  }

  // Launch browser — always use CI args for consistency and performance.
  // KOLU_X11CAP: go HEADFUL at 2× inside Xvfb so x11grab captures real physical
  // pixels. This global browser backs *browser-chrome* recordings (newContext);
  // app-mode recordings launch their own persistent context in newScenarioPage.
  // Same capture-window base as app mode, minus `--app` (chrome stays visible).
  const x11Args = engine.captureWindowArgs({
    scale: X11_SCALE,
    viewport: X11_VIEWPORT,
  });
  browser = await chromium.launch({
    headless: X11CAP ? false : process.env.HEADLESS !== "false",
    args: X11CAP ? x11Args : ciArgs,
    // Pace driver actions so the recorded video is legible (the lead-up; the
    // app's own async — e.g. an iframe reload — still runs at real speed, so
    // the payoff is shown via the scenario's own waits).
    ...(EVIDENCE || X11CAP ? { slowMo: X11_SLOWMO } : {}),
  });
});

AfterAll(async () => {
  if (browser) await browser.close();
  // KOLU_X11CAP: tear down the virtual display once the browser is gone.
  if (xvfbProc) {
    xvfbProc.kill("SIGTERM");
    xvfbProc = undefined;
  }
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
  // Derive the scenario's file stem once, up front — the failure screenshot,
  // the evidence webm, the x11 grab, and the transcoded assets all key off the
  // same value, so it's computed here and read at every site below.
  x11Stem = slug(scenario.pickle.name);
  // Kill leftover terminals and reset state so each scenario starts clean.
  // After #577 each domain (preferences / activity / savedSession) owns its
  // own reset endpoint — fired in parallel so the per-scenario setup cost
  // stays the same.
  await Promise.all([
    postJSON(`${baseUrl}/rpc/terminal/killAll`, {}),
    postJSON(`${baseUrl}/rpc/surface/kolu/preferences/test__set`, {
      json: {
        // Reset all preferences to defaults (shuffleTheme off for deterministic tests)
        seenTips: [],
        // Marketing recordings (KOLU_X11CAP) want a quiet canvas — no ambient
        // tip banners popping in mid-shot. Normal e2e runs keep them on.
        startupTips: !X11CAP,
        shuffleTheme: false,
        scrollLock: true,
        activityAlerts: true,
        colorScheme: "dark",
        terminalRenderer: "auto",
        rightPanel: {
          collapsed: true,
          size: 0.25,
          activeTab: "inspector",
          codeMode: "local",
          codeTabTreeSize: 0.35,
        },
      },
    }),
    postJSON(`${baseUrl}/rpc/surface/kolu/activityFeed/test__set`, {
      json: { recentRepos: [], recentAgents: [] },
    }),
    postJSON(`${baseUrl}/rpc/surface/kolu/session/test__set`, { json: null }),
  ]);

  // @mobile tag → emulate a touch phone (flips `(pointer: coarse)` to true,
  // mounts the mobile drag handle). Without the tag, scenarios run in the
  // desktop context unchanged.
  const isMobile = scenario.pickle.tags.some((t) => t.name === "@mobile");

  // KOLU_X11CAP: the recording (keyed by scenario name) decides app-mode vs
  // browser chrome — read it so the launch matches.
  const chrome = X11CAP ? getRecording(scenario.pickle.name).chrome : "browser";

  this.browser = browser;
  const created = await newScenarioPage(isMobile, chrome);
  this.context = created.context;
  this.page = created.page;
  // Disable CSS transitions/animations so Corvu dialogs open/close instantly.
  // prefers-reduced-motion tells well-behaved libraries to skip animations;
  // the style override catches anything that ignores the media query. SKIPPED
  // under KOLU_EVIDENCE — when we're recording a video, motion is the point.
  if (!EVIDENCE && !X11CAP) {
    await this.page.emulateMedia({ reducedMotion: "reduce" });
    await this.page.addInitScript(`
      document.addEventListener("DOMContentLoaded", function() {
        var style = document.createElement("style");
        style.textContent = "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }";
        document.head.appendChild(style);
      });
    `);
  }
  // KOLU_X11CAP: recordings want a quiet canvas — suppress the ambient tip
  // banner unconditionally (it's desktop-always-on, not the startupTips pref).
  if (X11CAP) {
    await this.page.addInitScript(`
      document.addEventListener("DOMContentLoaded", function() {
        var style = document.createElement("style");
        style.textContent = '[data-testid="tip-banner"] { display: none !important; }';
        document.head.appendChild(style);
      });
    `);
  }
  // Shared xterm buffer reader for e2e tests — used by waitForBufferContains,
  // readBufferText, and getTerminalPid via page.evaluate / page.waitForFunction.
  // Single definition avoids the buffer-read loop being duplicated across files.
  // Always injected (independent of the motion gate above).
  await this.page.addInitScript(`
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

  // KOLU_X11CAP: start grabbing the Xvfb framebuffer now. x11grab runs off its
  // own 30 fps clock independent of Chrome's paint speed, so the recording is
  // smooth regardless of how heavy the scenario is. Leading blank frames (before
  // the first navigation) are trimmed in the transcode step.
  if (X11CAP && x11Display) {
    x11RawPath = path.join(evidenceVideoDir, `${x11Stem}.x11.mp4`);
    ffmpegProc = engine.startX11Grab({
      display: x11Display,
      width: X11_SCREEN.width,
      height: X11_SCREEN.height,
      out: x11RawPath,
      logFile: path.join(evidenceVideoDir, `${x11Stem}.x11.log`),
    });
    ffmpegProc.on("error", (e) =>
      console.error(`[worker:${workerId}] KOLU_X11CAP: ffmpeg spawn error:`, e),
    );
  }
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
  // PR-evidence video (KOLU_EVIDENCE): grab the page's video handle BEFORE
  // closing the context — the .webm is only finalized on close — then save it
  // scenario-named under reports/videos/ once closed. saveAs waits for the
  // file to be fully written, so the order (handle → close → save) is safe.
  const video = EVIDENCE ? this.page?.video() : undefined;
  // KOLU_X11CAP: stop the grab cleanly (SIGINT flushes the moov atom) BEFORE
  // closing the context — or the window vanishes and the final frames go black.
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
  // KOLU_X11CAP: now the raw clip is finalized, transcode it into the crisp web
  // assets the welcome page embeds (mp4 + webm + poster), trimming the leading
  // blank from before the first navigation. FAIL-CLOSED: only publish when the
  // scenario PASSED, and let a bad grab or transcode throw so `just record`
  // exits non-zero rather than silently committing stale/blank assets.
  if (X11CAP && x11RawPath) {
    const raw = x11RawPath;
    x11RawPath = undefined;
    // Reuse the exact stem Before stashed — never re-derive, or the transcode
    // could target a file the grab never created.
    const name = x11Stem ?? slug(scenario.pickle.name);
    x11Stem = undefined;
    // A failed scenario means the flow didn't reach its climax — the clip is
    // junk. Don't overwrite the committed demo assets with it; keep the raw
    // around for debugging and surface the failure (After can't re-fail the
    // scenario, but a thrown error here still aborts the run non-zero).
    if (scenario.result?.status !== Status.PASSED) {
      throw new Error(
        `KOLU_X11CAP: scenario "${scenario.pickle.name}" did not pass ` +
          `(${scenario.result?.status}); refusing to publish demo assets from ` +
          `${raw}`,
      );
    }
    // Guard against a truncated/empty grab (ffmpeg spawn failure, Xvfb gone):
    // transcoding a 0-byte clip would emit broken assets that still "succeed".
    let rawSize = 0;
    try {
      rawSize = fs.statSync(raw).size;
    } catch {
      // file missing — rawSize stays 0, falls through to the size check below
    }
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
      // Skip the app-mode load-in + Background reload + the killAll that
      // clears the auto-restored terminal, so the clip opens on the clean
      // empty-canvas welcome (then the terminal is created on camera).
      // Trim the load-in (app-mode reload + the killAll that clears the
      // auto-restored terminal) so the clip opens on the clean empty canvas. A
      // recording can override when its opening timing differs.
      trimStart: getRecording(scenario.pickle.name).trimStart ?? 5.3,
      // Poster is sampled from the trimmed timeline. Default (6s) lands on the
      // clean empty-canvas demo state (past the welcome card + the nudge), not
      // the restore-session card. A recording can override `posterAt` when its
      // payoff is later (e.g. dock-alert-demo samples its end-of-clip alert).
      posterAt: getRecording(scenario.pickle.name).posterAt ?? 6,
    });
    console.log(`[worker:${workerId}] KOLU_X11CAP: web assets → ${out.mp4}`);
  }
});
