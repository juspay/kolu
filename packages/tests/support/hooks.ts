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
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { After, AfterAll, Before, BeforeAll, Status } from "@cucumber/cucumber";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "@kolu/padi/stateRoot";
import getPort from "get-port";
import { NIX_ENV_WHITELIST } from "kolu-pty";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as engine from "../screencast/engine.ts";
import { getRecording } from "../screencast/recordings/index.ts";
import { padiFold } from "./padiEnvelope.ts";
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

/** The everyday-e2e vs recording (KOLU_X11CAP) divergence for the server's
 *  environment, decided ONCE here so no `if (KOLU_X11CAP)` has to be re-derived
 *  downstream (before this, the agent dirs branched here and HOME branched at
 *  the spawn site — two costumes of one decision, drifting apart).
 *
 *  Everyday e2e must touch NOTHING real: point the agent-session dirs at the
 *  mock harnesses' temp dirs AND give the server a throwaway $HOME, so a
 *  scenario typing into a terminal can't append to the real `~/.bash_history`
 *  or make the suite depend on the developer's personal dotfiles. (kolu
 *  forwards HOME into every PTY it spawns: `cleanEnv` whitelists it → `ptyHost`
 *  reads `env.HOME` → `prepareShellInit`'s `replay` sources `$HOME/.bashrc`
 *  etc. — so a real HOME is the leak.) The fake agent dirs sit under
 *  `testBaseDir` (AfterAll wipes it); the fake home is `fixtureHome`, wiped
 *  separately in AfterAll (it lives outside `testBaseDir` — see below).
 *
 *  Recording is the exact opposite: it launches the REAL claude/codex to
 *  capture footage, so the agent dirs must be ABSENT (the server then resolves
 *  them off the real `~/.claude` / `~/.codex` via `os.homedir()`) and HOME must
 *  stay inherited (real) so those agents find their login. Absent agent-dir
 *  keys are BOTH deleted from `process.env` (so a developer export can't shadow
 *  the real dir) and left out of the child env below.
 *
 *  `AGENT_DIR_VARS` names the exact agent-dir set the loop mutates onto
 *  `process.env` for step defs that read it directly — add a new agent dir
 *  there. HOME is child-env ONLY: never mutated onto the harness's own
 *  `process.env`, whose real value the recording path still needs. */
const RECORDING = !!process.env.KOLU_X11CAP;

/** e2e's throwaway $HOME must NOT sit under any `/tmp` path. A new PTY opens in
 *  `$HOME`, so a home under `/tmp` makes every default-cwd terminal report a cwd
 *  containing the substring `/tmp` — which pollutes the workspace-switcher's cwd
 *  search: a scenario that `cd /tmp` then searches `"/tmp"` also matches the
 *  home-cwd terminals, so "show 1 card" sees 2. Production homes aren't under
 *  `/tmp`, so the fake one mustn't be either, else the e2e env diverges from
 *  production and quietly breaks substring-cwd assertions.
 *
 *  Root it on a per-platform path guaranteed NOT under `/tmp`:
 *   - Linux → the tmpfs `/dev/shm` (ephemeral, off `/tmp`, and — crucially —
 *     off the developer's own `~`, since `just test` runs on their Linux box).
 *   - macOS (CI only, on `rasam`) → `os.homedir()`. We can't use `os.tmpdir()`
 *     here: over the CI ssh session `$TMPDIR` is unset, so Node's `os.tmpdir()`
 *     falls back to `/tmp` — the exact collision. The `.`-prefixed name keeps it
 *     a hidden, self-cleaning dir under that box's home.
 *  Wiped in AfterAll. Real dotfiles stay untouched — HISTFILE resolves to
 *  `<fixtureHome>/.bash_history`. */
const fixtureHomeRoot =
  process.platform === "linux" ? "/dev/shm" : os.homedir();
const fixtureHome = RECORDING
  ? undefined
  : fs.mkdtempSync(path.join(fixtureHomeRoot, ".kolu-e2e-home-"));

const AGENT_DIR_VARS = [
  "KOLU_CLAUDE_SESSIONS_DIR",
  "KOLU_CLAUDE_PROJECTS_DIR",
  "KOLU_CODEX_DIR",
  "KOLU_OPENCODE_DB",
] as const;

/** W3.4: the mock-agent (packages/mock-agent) writes agent artifacts at the
 *  terminal box's REAL `$HOME` defaults — it runs INSIDE the terminal, so wherever
 *  the terminal lives (this box, or a leased ssh bind target) the files land in
 *  that box's `$HOME`. So point the server's providers (and the padi they read
 *  through) at the SAME `$HOME`-relative default paths under the sandboxed fixture
 *  home — NOT arbitrary `testBaseDir` subdirs the mock-agent could never know.
 *  Locally that keeps the read side on the same path the write side chose;
 *  remotely the padi has no override at all and defaults to its own `$HOME`, which
 *  the mock-agent also writes — the geography-free contract. Setting the claude
 *  dirs (rather than unsetting) additionally keeps `SUMMARY_FETCH_ENABLED` OFF
 *  (core.ts), so the e2e suite never invokes the Claude Agent SDK summary fetch. */
const agentHomeDefaults = (home: string) => ({
  KOLU_CLAUDE_SESSIONS_DIR: path.join(home, ".claude", "sessions"),
  KOLU_CLAUDE_PROJECTS_DIR: path.join(home, ".claude", "projects"),
  KOLU_CODEX_DIR: path.join(home, ".codex"),
  KOLU_OPENCODE_DB: path.join(
    home,
    ".local",
    "share",
    "opencode",
    "opencode.db",
  ),
});
const serverModeEnv: Record<
  (typeof AGENT_DIR_VARS)[number],
  string | undefined
> & { HOME?: string } =
  // Recording launches the REAL claude/codex off the developer's real `~`, so
  // the overrides stay ABSENT and HOME inherited there.
  RECORDING || fixtureHome === undefined
    ? {
        KOLU_CLAUDE_SESSIONS_DIR: undefined,
        KOLU_CLAUDE_PROJECTS_DIR: undefined,
        KOLU_CODEX_DIR: undefined,
        KOLU_OPENCODE_DB: undefined,
      }
    : { ...agentHomeDefaults(fixtureHome), HOME: fixtureHome };
for (const name of AGENT_DIR_VARS) {
  const value = serverModeEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// Pre-create the (empty) agent home dirs BEFORE the server/padi starts. The
// codex WAL watcher (`createWalSubscription`) attaches an fs.watch to
// `~/.codex` at padi boot; if that dir doesn't exist yet — the mock-agent
// creates it lazily on its first write, which is AFTER padi boots — the watch
// silently never attaches and a second-turn token update is never re-read. The
// old ventriloquist mock got this for free (its dirs were `mkSubDir`'d before
// the server spawned). Remote runs pre-create the SAME dirs on the bind target
// as part of box B's provisioning. No-op under recording (no fixture home).
if (fixtureHome !== undefined) {
  const d = agentHomeDefaults(fixtureHome);
  fs.mkdirSync(d.KOLU_CLAUDE_SESSIONS_DIR, { recursive: true });
  fs.mkdirSync(d.KOLU_CLAUDE_PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(d.KOLU_CODEX_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(d.KOLU_OPENCODE_DB), { recursive: true });
}

// The agent mocks (claude/codex/opencode) are now `kolu-mock-agent` run INSIDE
// the terminal by absolute store path (support/mockAgent.ts) — the old
// renamed-`bash` fakes + KOLU_FAKE_*_BIN are gone. The recipe builds
// `.#mock-agent` (and `nix copy`s it to any bind target) and exports
// `KOLU_MOCK_AGENT_BIN`; assert it here (non-recording) so a misconfigured run
// fails loudly at boot rather than mid-scenario. Recording drives the REAL
// agents, so it needs no mock bin.
if (!RECORDING && !process.env.KOLU_MOCK_AGENT_BIN) {
  throw new Error(
    "KOLU_MOCK_AGENT_BIN is unset — the e2e recipe must build `.#mock-agent` and " +
      "export its bin dir (the terminal invokes <dir>/{claude,codex,opencode} by absolute path).",
  );
}

/** Per-worker ephemeral state dir for the kolu server under test. Routing
 *  to $TMPDIR keeps test state out of `~/.config`; nesting under
 *  `testBaseDir` means the whole run's scratch space cleans up together. */
const koluStateDir = mkSubDir("state");

/** Per-worker padi state-root — the CRITICAL isolation seam of the W2.2 cutover.
 *  kolu-server no longer serves padi in-process; it SPAWNS a separate padi PROCESS
 *  (server/src/padiBinding.ts), and padi in turn spawns its OWN kaval. padi's whole
 *  identity — its socket + single-instance gate AND its kaval's socket + gate — is
 *  DERIVED from a digest of this state-root path (padi/src/stateRoot.ts). Without a
 *  private state-root per worker, every worker's server would resolve the SAME
 *  default (`$XDG_STATE_HOME/padi`) → the SAME digest → all workers collide on ONE
 *  shared padi. Passed to the server as `KOLU_PADI_STATE_DIR` (which padiBinding
 *  forwards verbatim to padi via `--state-root`), so the digest — and thus the
 *  socket/gate paths the reapers below compute — is this worker's alone. Nested
 *  under `testBaseDir` so it's wiped with the rest of the run. */
const padiStateDir = mkSubDir("padi-state");

/** Per-worker `XDG_RUNTIME_DIR` so each worker's padi (and the kaval padi spawns)
 *  land at ISOLATED sockets + gates. Both are anchored under this dir but keyed by
 *  the state-root digest — `$XDG_RUNTIME_DIR/padi-<digest>/` and `kaval-<digest>/`
 *  (padi/src/stateRoot.ts) — so the per-worker `padiStateDir` above and this
 *  per-worker runtime dir TOGETHER guarantee no two workers share a padi or a
 *  kaval. Without an isolated runtime dir, parallel workers would collide on the
 *  shared runtime path and a single-instance gate would make worker 2's daemon
 *  yield to worker 1's — the same foreign-server hazard the HTTP-port ownership
 *  check guards against. 0700 because the daemon refuses a gate dir that isn't
 *  owner-only.
 *
 *  Deliberately a SHORT, top-level path — NOT nested under `testBaseDir` (which
 *  lives under the deep nix-shell `$TMPDIR`). kolu's per-terminal scratch dir
 *  hangs off `$XDG_RUNTIME_DIR`, so a deep runtime path bloats a pasted scratch
 *  file path (clipboard / file-drop) and keeps the padi/kaval unix-socket paths
 *  nearer the ~108-char limit — both reasons to stay short. It is NOT, however,
 *  what keeps the screen-state assertion correct: even with this short dir the
 *  W2.2 scratch layout (`$XDG_RUNTIME_DIR/kolu-<pid>/scratch/<uuid>/<name>`)
 *  runs ~81 chars and the filename straddles the 80-col grid before xterm's
 *  fit() widens it under load. The screen-state reader now rejoins hard-wrapped
 *  rows via `isWrapped` (see `__readXtermBuffer`), so a wrapped path no longer
 *  splits the filename — the cells are clean, not "garbled". Cleaned up by
 *  `killServer` (it sits outside `testBaseDir`, so the run's recursive remove
 *  doesn't catch it). */
const runtimeDir = fs.mkdtempSync(path.join("/tmp", `kr${workerId}-`));
fs.chmodSync(runtimeDir, 0o700);

/** Compute a padi/kaval rendezvous path the SAME way padi does — anchored under
 *  THIS worker's `runtimeDir`. padi's path builders (`padiSocketPath`,
 *  `padiKavalSocketPath`) read `process.env.XDG_RUNTIME_DIR` to anchor the
 *  digest-keyed dir, but the harness sets that var only on the server CHILD's env,
 *  never its own process. So pin it to `runtimeDir` for the duration of the call
 *  and restore it after — giving a reaper the exact socket/gate the worker's padi
 *  (and its kaval) actually wrote, WITHOUT perturbing the harness process's own
 *  env (which Chrome and other children inherit). */
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

/** Read a daemon's pid-gate file → the integer pid, or undefined if the gate is
 *  missing/stale/unreadable (never throws). The read-only primitive both the
 *  reapers below and the `@kaval-restart` pid-observability steps share (a
 *  `recycleKaval` must CHANGE the kaval gate pid while the padi gate pid stays
 *  put — the "recycles kaval, not padi" proof). */
function readPidAtGate(gate: string): number | undefined {
  try {
    const pid = Number.parseInt(fs.readFileSync(gate, "utf8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    // No gate / not readable — nothing to report.
  }
  return undefined;
}

/** Read a daemon's pid-gate file and SIGKILL the holder; returns the killed pid,
 *  or undefined if the gate is missing/stale/unreadable (never throws). Shared by
 *  the padi and kaval reapers below, which differ only in WHICH gate they read. */
function killPidAtGate(gate: string): number | undefined {
  const pid = readPidAtGate(gate);
  if (pid === undefined) return undefined;
  try {
    process.kill(pid, "SIGKILL");
    return pid;
  } catch {
    // Already gone / not ours — nothing to reap.
  }
  return undefined;
}

/** True iff `pid` names a live process (a signal-0 probe — checks existence
 *  without delivering a signal). Used by the restart steps to assert a FRESH
 *  kaval is actually running after a recycle, not just that a gate file exists. */
export function isPidLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The padi gate path for THIS worker — the digest-keyed `padi.pid` beside padi's
 *  socket. Read-only counterpart to `killPadiDaemon`'s gate resolution. */
function padiGate(): string {
  return withWorkerRuntimeDir(() => padiGatePath(padiSocketPath(padiStateDir)));
}

/** The kaval gate path for THIS worker — `kaval.pid` beside padi's kaval socket.
 *  Read-only counterpart to `killKavalDaemon`'s gate resolution. */
function kavalGate(): string {
  return withWorkerRuntimeDir(() =>
    path.join(path.dirname(padiKavalSocketPath(padiStateDir)), "kaval.pid"),
  );
}

/** The pid holding THIS worker's padi gate right now (or undefined). A recycle-
 *  kaval must leave this UNCHANGED — padi stays up; only its kaval is recycled. */
export function readPadiGatePid(): number | undefined {
  return readPidAtGate(padiGate());
}

/** The pid holding THIS worker's kaval gate right now (or undefined). A recycle-
 *  kaval must CHANGE this — a stuck-but-alive kaval is killed + respawned, a dead
 *  one is spawned fresh; either way a new pid holds the gate. */
export function readKavalGatePid(): number | undefined {
  return readPidAtGate(kavalGate());
}

/** SIGKILL the padi PROCESS this worker's server spawned. The cutover put padi
 *  BETWEEN the server and kaval: the server spawns padi (detached in e2e, so it
 *  outlives the server), padi spawns kaval. padi's single-instance gate
 *  (`padi.pid`) sits beside its socket at the digest-keyed `padi-<digest>/` dir —
 *  derived here from THIS worker's `padiStateDir` — so we reap the worker's own
 *  padi and never another worker's. Robust to an absent gate (nothing to reap). */
export function killPadiDaemon(): number | undefined {
  return killPidAtGate(padiGate());
}

/** SIGKILL the kaval daemon padi spawned for this worker (it is detached, so it
 *  outlives padi and the server — B2 makes no survival promise, but the harness
 *  must not leak it across runs). After the cutover kaval is padi's child, keyed
 *  by the SAME state-root digest as padi: its gate (`kaval.pid`) lives beside its
 *  socket at `kaval-<digest>/`, derived here from `padiStateDir`. Returns the
 *  killed pid, or undefined if there was nothing to reap. Also the
 *  `pkill kaval mid-session` step's mechanism for the degraded-state e2e. */
export function killKavalDaemon(): number | undefined {
  return killPidAtGate(kavalGate());
}

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
const X11_VIEWPORT = { width: 1280, height: 720 }; // logical default; physical = ×scale
// The Xvfb screen is sized ONCE (BeforeAll), before the scenario is known, so it
// must fit the LARGEST per-recording viewport. Each recording's window + x11grab
// are then sized to its own viewport within this screen (the window is pinned at
// 0,0 by captureWindowArgs, so the grab from 0,0 captures exactly that window).
const X11_MAX_VIEWPORT = { width: 1728, height: 972 };
/** Driver-pacing for recorded clips (ms between Playwright actions). Both
 *  X11CAP launch paths — the app-mode persistent context and the global headful
 *  browser — reference this so app-mode and browser-chrome clips share one
 *  capture cadence. */
const X11_SLOWMO = 250;
const X11_SCREEN = engine.physicalSize({
  viewport: X11_MAX_VIEWPORT,
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

/** Kill the server child on any exit path (crash, SIGINT, SIGTERM), then reap the
 *  detached daemons the cutover chains BELOW it — padi (the server's child) and
 *  padi's kaval (padi's child) — both of which outlive the server. Order matters:
 *  server → padi → kaval, so a still-live parent can't race a respawn of a child
 *  we just reaped (kill padi before its kaval, and the server before padi). */
function killServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
  killPadiDaemon();
  killKavalDaemon();
  // The per-worker runtime dir lives outside `testBaseDir` (short path, see its
  // comment), so the run's recursive remove won't catch it — reap it here.
  try {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  } catch {
    // Best-effort: already gone / never created.
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

/** The touch-context viewport. A phone (`@mobile`) is a tall 390×844; a roomy
 *  touch device (`@compact` — a Z Fold 6 unfolded, a tablet) is a near-square
 *  900×1000 that clears the `sm` breakpoint so `layoutMode` resolves to
 *  `compact` rather than `phone`. Both run with `hasTouch + isMobile`, which
 *  flips the primary pointer to `(pointer: coarse) and (hover: none)`. */
const PHONE_VIEWPORT = { width: 390, height: 844 };
const COMPACT_VIEWPORT = { width: 900, height: 1000 };

async function newScenarioPage(
  isMobile: boolean,
  chrome: "app" | "browser",
  vp: { width: number; height: number } = X11_VIEWPORT,
  touchViewport: { width: number; height: number } = PHONE_VIEWPORT,
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
      // 1920×1080 matches a typical desktop monitor — the previous 1280×720
      // default hid viewport-size-dependent bugs (e.g. the canvas
      // centering math behaves differently when the tile is small relative
      // to the viewport vs nearly filling it).
      // KOLU_X11CAP browser-chrome: viewport null → the page fills the headful
      // window (sized by the launch args, i.e. 2560×1440 physical).
      viewport: isMobile
        ? touchViewport
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

/** Wait until the server WE spawned owns the port and answers health.
 *
 *  A bare `/api/health` probe is not enough on a shared CI host: a stale
 *  orphan kolu from a previous run (or another consumer of the box) can be
 *  squatting the ephemeral port `get-port` just handed us. Our child then
 *  fails to bind, but the probe hits the *orphan* — which answers
 *  `/api/health` (200) yet 404s every test-only RPC. The suite would then run
 *  against a foreign server, one wedged worker drains the cucumber queue, and
 *  hundreds of scenarios fail with an opaque 404 (the same single-bad-worker
 *  catastrophe class as the ECONNREFUSED queue-drain in #?, different cause).
 *
 *  So gate on OUR child first announcing `kolu listening` on the expected
 *  port (`ownsPort`) — proof it actually bound it — and only then confirm
 *  HTTP health. Returns false (caller retries a fresh port) if the child
 *  exits early (EADDRINUSE) or never claims the port within the budget. */
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
      } catch {
        // bound but HTTP not answering yet — keep polling
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** Spawn the kolu server BINARY on a fresh random port and wait until OUR child
 *  owns it and answers health, setting `serverProcess` + `baseUrl`. Retries on a
 *  fresh port if a stale orphan squats the one `get-port` handed us (see
 *  `waitForOwnedServer`). Used at BeforeAll AND by the restart path that the
 *  kaval-daemon scenario's After hook drives — that scenario SIGKILLs the
 *  worker's kaval, leaving the server degraded, so the worker must be re-booted
 *  before any later scenario tries to create a terminal. */
/** DESTRUCTIVE-ACK guard for the ssh leg — checked BEFORE any server child spawns. Binding a
 *  kolu-server to KOLU_E2E_PADI_HOST is itself destructive (it drains/converges + killAll's
 *  that host's padi, killing its live terminals), so a mistyped host must be refused BEFORE the
 *  spawn — not after, where the child races ahead and murders a workstation's terminals first. */
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

async function startServerChild(koluServer: string): Promise<void> {
  // Refuse a destructive ssh-leg bind BEFORE spawning the child — the spawn itself is
  // destructive, so the ack cannot wait until after (P2/F1).
  assertRemoteDestructiveAck();
  // Extend NIX_ENV_WHITELIST with GIT_AUTHOR_*/GIT_COMMITTER_* so PTY
  // shells in fixtures like `code-tab.feature` (which run `git init &&
  // git commit` inside the terminal under test) inherit the same
  // identity set on process.env above. Without this, the whitelist
  // filter strips them and those scenarios fail on pristine hosts.
  const envWhitelist = [
    NIX_ENV_WHITELIST,
    "GIT_AUTHOR_NAME,GIT_AUTHOR_EMAIL,GIT_COMMITTER_NAME,GIT_COMMITTER_EMAIL",
  ].join(",");
  // Append-mode per-worker server log: a server that dies mid-run otherwise
  // leaves NO trace in the suite log; the file preserves the crash stack /
  // clean-exit / silence-then-gone that distinguishes a crash from a wedge.
  fs.mkdirSync(serverLogDir, { recursive: true });
  const serverLog = fs.createWriteStream(
    path.join(serverLogDir, `server-w${workerId}.log`),
    { flags: "a" },
  );

  // Spawn on a random port, retrying on a fresh port if our child can't take
  // ownership of it (a stale orphan may be squatting — see waitForOwnedServer).
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
          KOLU_STATE_DIR: koluStateDir,
          // Per-worker padi state-root: the server forwards this to the padi
          // PROCESS it spawns, and padi's socket + gate AND its kaval's socket +
          // gate are all keyed by this path's digest. Combined with the per-worker
          // XDG_RUNTIME_DIR below, this is what isolates each worker's padi + kaval
          // (the reapers recompute the same digest paths — see killPadiDaemon /
          // killKavalDaemon). Without it every worker's padi would resolve the same
          // default state-root and collide on one shared padi.
          KOLU_PADI_STATE_DIR: padiStateDir,
          // Per-worker runtime dir → isolated padi/kaval sockets + gates. Both
          // daemons anchor here (`padi-<digest>/`, `kaval-<digest>/`), keyed by the
          // state-root digest above, so parallel workers never collide on a shared
          // path. (No KOLU_KAVAL_SOCKET pin: after the cutover the server doesn't
          // spawn kaval — padi does, at its own digest-keyed path — so an explicit
          // kaval-socket override no longer applies.)
          XDG_RUNTIME_DIR: runtimeDir,
          // Force a detached kaval spawn: e2e reaps the daemon itself and may
          // run on a box with no systemd user session (where the production
          // `systemd-run --user` path would fail).
          KOLU_KAVAL_SPAWN: "detached",
          // The everyday-e2e vs recording env divergence, decided once above:
          // agent dirs pinned at the fixture home's `$HOME` defaults + a throwaway
          // HOME normally (so padi reads where the in-terminal mock-agent writes);
          // agent dirs absent and HOME inherited (real) under X11CAP so the real
          // claude/codex resolve their sessions + login from the real home. See
          // `serverModeEnv` (KOLU_OPENCODE_DB is one of its keys now).
          ...serverModeEnv,
          // W3.1 — the ssh leg: when KOLU_E2E_PADI_HOST is set, the server binds a
          // REMOTE padi over ssh (the whole canvas becomes that host) instead of
          // spawning a local one, so the SAME suite runs unchanged against a remote
          // padi — the parity proof. Unset (the default) → today's local binding,
          // byte-identical, and none of the per-worker padi-state isolation above
          // changes. Run single-worker over ssh: the remote padi uses ITS OWN default
          // state-root (the binder passes nothing), so parallel workers would collide
          // on one remote daemon. The remote host needs the padi drv map baked
          // (a nix-built koluBin — `just test`, not `just test-quick`).
          ...(process.env.KOLU_E2E_PADI_HOST
            ? { KOLU_PADI_HOST: process.env.KOLU_E2E_PADI_HOST }
            : {}),
        },
      },
    );

    // Detect when OUR child announces it bound the port. The address in the
    // `kolu listening {...,"address":"http://127.0.0.1:<port>"}` log proves
    // ownership; buffer across chunks so a split line still matches.
    let outBuf = "";
    let ownsPort = false;
    let exited = false;
    const scan = (data: Buffer) => {
      serverLog.write(data);
      if (!ownsPort) {
        outBuf += data.toString();
        if (outBuf.includes("kolu listening") && outBuf.includes(`:${port}`))
          ownsPort = true;
        // Cap the scan buffer — once it's clearly past the boot banner and
        // still no match, keep only the tail so memory can't grow unbounded.
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
    // Record the death itself: code/signal disambiguates crash (code≠0 or a
    // signal) from a clean exit from a never-fired handler (wedge). A bind
    // failure (port squatted) shows up here and flips `exited`.
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
  // BOTH arms now warm padi ASYNC (fail-open by design: the local arm's boot no
  // longer awaits its first connect before the server listens either — W4's
  // extend-fail-open-to-local fix — so the server is up before EITHER a local or a
  // remote padi is live). Wait for it here, on EVERY server start (boot AND the
  // mid-run restarts reconnect/session-restore/@kaval-restart trigger), so scenarios
  // never race the warm-up (a `killAll` against a not-yet-connected binding is the
  // "no live upstream link" 500).
  await waitForPadiLive();
}

/** Poll a padi procedure until the (async-warming) bound arm — local or, under
 *  `KOLU_E2E_PADI_HOST`, remote — is live, or throw after 120s. Local warm-up is
 *  normally sub-second (a from-source spawn + connect); the remote leg's ssh
 *  provisioning is what actually needs the long budget. Runs UNCONDITIONALLY: since
 *  neither arm's boot blocks the server's listen anymore, a scenario racing padi's
 *  warm-up is possible on EITHER leg, not just the ssh one. */
async function waitForPadiLive(): Promise<void> {
  const remotePadiHost = process.env.KOLU_E2E_PADI_HOST;
  // Belt-and-suspenders: the ack was already enforced before the spawn (assertRemoteDestructiveAck
  // in startServerChild); re-assert here so this destructive killAll poll can't run without it
  // even if a future caller reaches it another way. A no-op on the local leg.
  assertRemoteDestructiveAck();
  const deadline = Date.now() + 120_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/rpc/surface/padi/lifecycle/killAll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: padiFold() }),
        // Bound each attempt so a wedged request (TCP accepted, handler hung
        // mid-boot) can't outlive the 120s deadline this function promises — a bare
        // `await fetch` re-checks the deadline only BETWEEN attempts, so one hung
        // request would stall the whole e2e startup indefinitely.
        signal: AbortSignal.timeout(5_000),
      });
      lastStatus = res.status;
      if (res.ok) {
        console.log(
          remotePadiHost
            ? `[worker:${workerId}] remote padi is live — running against the ssh host`
            : `[worker:${workerId}] local padi is live`,
        );
        return;
      }
    } catch {
      // server not answering yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    remotePadiHost
      ? `[worker:${workerId}] remote padi (KOLU_E2E_PADI_HOST=${remotePadiHost}) never became live within 120s (last killAll status ${lastStatus})`
      : `[worker:${workerId}] local padi never became live within 120s (last killAll status ${lastStatus})`,
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
    await waitForPadiLive();
  } else {
    await startServerChild(koluServer); // waits for a live bound padi internally
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
    // The fake $HOME lives outside `testBaseDir` (on /dev/shm under Linux — see
    // `fixtureHome`), so the recursive remove above doesn't catch it. Reap it
    // here in the same best-effort block. Absent under X11CAP (real HOME).
    if (fixtureHome) fs.rmSync(fixtureHome, { recursive: true, force: true });
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
    postJSON(`${baseUrl}/rpc/surface/padi/lifecycle/killAll`, {
      json: padiFold(),
    }),
    postJSON(`${baseUrl}/rpc/surface/kolu/preferences/test__set`, {
      json: {
        // Reset all preferences to defaults (newTerminalTheme "inherit" so new
        // terminals get the default theme — deterministic for tests)
        seenTips: [],
        // Marketing recordings (KOLU_X11CAP) want a quiet canvas — no ambient
        // tip banners popping in mid-shot. Normal e2e runs keep them on.
        startupTips: !X11CAP,
        newTerminalTheme: "inherit",
        shuffleBehavior: "auto",
        scrollLock: true,
        activityAlerts: true,
        colorScheme: "dark",
        terminalRenderer: "auto",
        // `rightPanel` preferences hold only workspace-level chrome
        // (collapsed/size/codeTabTreeSize) — `activeTab`/`codeMode` are
        // per-terminal state (DEFAULT_RIGHT_PANEL_PER_TERMINAL), not
        // preferences, so they don't belong here. We deliberately pin
        // `collapsed: true` for the suite so the many toggle-and-assert
        // scenarios get a deterministic collapsed starting point; the
        // shipped runtime default is open (DEFAULT_PREFERENCES.rightPanel
        // .collapsed = false). The per-terminal Code/browse defaults are
        // NOT overridden here, so they flow from DEFAULT_RIGHT_PANEL_PER_-
        // TERMINAL and are asserted by right-panel.feature / code-tab.feature.
        rightPanel: {
          // Recordings (X11CAP) want the right panel visible by default (it's
          // the new app default, and the Code tab is part of what we show);
          // normal tests keep it collapsed (right-panel.feature asserts that).
          collapsed: !X11CAP,
          size: 0.25,
          codeTabTreeSize: 0.35,
        },
      },
    }),
    postJSON(`${baseUrl}/rpc/surface/padi/activityFeed/test__set`, {
      json: padiFold({ recentRepos: [], recentAgents: [] }),
    }),
    postJSON(`${baseUrl}/rpc/surface/padi/session/test__set`, {
      json: padiFold(null),
    }),
  ]);

  // @mobile tag → emulate a touch phone (flips `(pointer: coarse)` to true,
  // mounts the mobile drag handle). @compact → emulate a roomy touch device
  // (Z Fold 6 unfolded / tablet): same touch context, but a near-square 900×1000
  // viewport past the `sm` breakpoint, so `layoutMode` resolves to `compact`.
  // Both share the touch context; they differ only in viewport size. Without
  // either tag, scenarios run in the desktop context unchanged.
  const isCompact = scenario.pickle.tags.some((t) => t.name === "@compact");
  const isMobile =
    isCompact || scenario.pickle.tags.some((t) => t.name === "@mobile");
  const touchViewport = isCompact ? COMPACT_VIEWPORT : PHONE_VIEWPORT;

  // KOLU_X11CAP: the recording (keyed by scenario name) decides app-mode vs
  // browser chrome and its capture viewport — read it so the launch + grab match.
  const rec = X11CAP ? getRecording(scenario.pickle.name) : undefined;
  const chrome = rec?.chrome ?? "browser";
  const vp = rec?.viewport ?? X11_VIEWPORT;

  this.browser = browser;
  const created = await newScenarioPage(isMobile, chrome, vp, touchViewport);
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
        var next = i + 1 < buf.length ? buf.getLine(i + 1) : null;
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

  // KOLU_X11CAP: start grabbing the Xvfb framebuffer now. x11grab runs off its
  // own 30 fps clock independent of Chrome's paint speed, so the recording is
  // smooth regardless of how heavy the scenario is. Leading blank frames (before
  // the first navigation) are trimmed in the transcode step.
  if (X11CAP && x11Display) {
    x11RawPath = path.join(evidenceVideoDir, `${x11Stem}.x11.mp4`);
    // Grab exactly this recording's window (pinned at 0,0), sized to its own
    // viewport — which may be smaller than the (max-sized) Xvfb screen.
    const grab = engine.physicalSize({ viewport: vp, scale: X11_SCALE });
    ffmpegProc = engine.startX11Grab({
      display: x11Display,
      width: grab.width,
      height: grab.height,
      out: x11RawPath,
      logFile: path.join(evidenceVideoDir, `${x11Stem}.x11.log`),
    });
    ffmpegProc.on("error", (e) =>
      console.error(`[worker:${workerId}] KOLU_X11CAP: ffmpeg spawn error:`, e),
    );
  }
});

// Generous timeout: under KOLU_X11CAP this hook transcodes the raw grab (mp4 +
// VP9 webm + poster). A long clip at 3200×1800 takes well over Cucumber's 70s
// default, so give it room.
After({ timeout: 300_000 }, async function (this: KoluWorld, scenario) {
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
      // payoff is later (e.g. hero-demo samples its end-of-clip alert).
      posterAt: getRecording(scenario.pickle.name).posterAt ?? 6,
    });
    console.log(`[worker:${workerId}] KOLU_X11CAP: web assets → ${out.mp4}`);
  }
});

/** Restore the worker after a `@kaval-restart` scenario (kaval-daemon.feature) —
 *  one that SIGKILLed its kaval daemon (the degraded-state e2e) OR recycled it via
 *  the Restart button (the live/dead recycle arms). A kill leaves the worker's
 *  server in `degraded` with NO daemon, and even a clean recycle leaves the worker
 *  in a restored/parked session state; `ensureLocalEndpoint` only spawns kaval at
 *  server boot, so the clean way back to a pristine worker is to reboot the server.
 *  Without this, a later scenario the cucumber queue assigns to THIS worker could
 *  fail the instant it tries to create a terminal.
 *  Skipped when KOLU_SERVER is a URL (a reused server we don't own/can't restart;
 *  that mode runs the suite single-server and isn't subject to the queue-poison). */
After({ tags: "@kaval-restart" }, async function (this: KoluWorld) {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer || koluServer.startsWith("http")) return;
  console.log(
    `[worker:${workerId}] @kaval-restart: rebooting server to respawn its kaval daemon.`,
  );
  killServer(); // also reaps any surviving kaval
  await startServerChild(koluServer);
});
