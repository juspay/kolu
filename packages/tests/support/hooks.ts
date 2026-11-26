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
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  BeforeStep,
  Status,
} from "@cucumber/cucumber";
import type { AgentDistroSetting } from "@kolu/agent-distro/schema";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { padiClientOver } from "@kolu/padi-client/dial";
import { padiGatePath, padiSocketPath } from "@kolu/padi-client/rendezvous";
import {
  type NewTerminalPolicy,
  type PadiIdentity,
  type PadiUrgency,
  padiDaemonGroup,
} from "@kolu/padi-client/surface";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect, Option, Stream } from "effect";
import getPort from "get-port";
import { composeSpawnEnv, NIX_ENV_WHITELIST, pickEnv } from "kolu-pty";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import * as engine from "../screencast/engine.ts";
import { getRecording } from "../screencast/recordings/index.ts";
import { agentDistroFixtureEnv } from "./agentDistroFixture.ts";
import { AGENT_DIR_VARS, FAKE_BIN_NAMES } from "./agentHarnessLists.ts";
import { stageFakeGh } from "./fake-gh.ts";
import { waitForPadiCell } from "./padiCellWait.ts";
import { watchContextPages } from "./pageWatch.ts";
import { pollFor } from "./poll.ts";
import { stageRenamedBash } from "./renamed-bash.ts";
import {
  disposeRpcWire,
  isPadiWarmingUp,
  padiCall,
  padiFirstFrame,
  RpcCallFailed,
  setRpcBaseUrl,
  surfaceCall,
} from "./rpcWire.ts";
import {
  retryPadiScenarioReset,
  retryTransient,
} from "./scenarioSetupRetry.ts";
import { retireWorldScrollFifo } from "./scrollFifo.ts";
import { padiBuildEnv, type ServerBuild } from "./serverBuild.ts";
import {
  type PageDiagnostic,
  SOLID_DIAGNOSTIC_BINDING,
  type SolidDevCheck,
  solidDevCheckFor,
  solidDiagnosticVerdict,
  solidObserveInitScript,
  stampDiagnostic,
} from "./solidDevBuild.ts";
import { type KoluWorld, STEP_GUARD, STEP_TIMEOUT } from "./world.ts";

const workerId = parseInt(process.env.CUCUMBER_WORKER_ID || "0", 10);

/** Fixtures scaffold real git repos and run `git commit` against them. On a
 *  pristine NixOS host with no `~/.gitconfig`, git aborts with "Author identity
 *  unknown" and scenarios fail (see #887). Pin a test identity so every fixture
 *  — current and future — inherits one. `??=` lets a host with `git config
 *  --global` set still take precedence when developers run locally.
 *
 *  This env identity reaches the git that runs in the HARNESS process directly
 *  (`execFileSync("git", …)` in worktree/git-context steps). Git that runs in a
 *  spawned PTY can NOT read it: the #1872 spawn allowlist (`composeSpawnEnv`)
 *  deliberately drops identity vars, so `GIT_AUTHOR_*` never rides ambient env
 *  into a hosted terminal. Those fixtures get their identity from the fake
 *  `$HOME/.gitconfig` seeded below — the forwarded-HOME config channel, the same
 *  one that sources `.bashrc` (see `cleanEnv`). */
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
 *  also `cd`s into so `findSessionsByDirectory` returns the mock row. */
const codexDir = mkSubDir("codex");
const opencodeDbDir = mkSubDir("opencode");
const opencodeDbPath = path.join(opencodeDbDir, "opencode.db");

/** Per-worker `XDG_STATE_HOME` for the server — and so for the padi it spawns,
 *  `XDG_STATE_HOME` being an operational spawn-env var a harness's own value
 *  would otherwise ride through on. It is where padi finds agent-distro's host
 *  state (`hostStateHome`), the fixture's update log among it
 *  (`agentDistroFixture.ts`). Everyday e2e only, with the throwaway HOME (see
 *  `serverModeEnv`); EXPORTED so a step that seeds that log writes HERE, never
 *  under the developer's real state home. */
export const stateHomeDir = mkSubDir("state-home");

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

/** Git identity travels into a spawned PTY via `$HOME/.gitconfig`, NOT ambient
 *  `GIT_AUTHOR_*` env — the #1872 spawn allowlist strips those. Seed the fake
 *  home's config with the resolved test identity (respecting a dev's `??=`
 *  override above, so the PTY and the harness-process git agree) so a fixture's
 *  `git commit` inside the terminal under test succeeds on pristine hosts.
 *  RECORDING mode uses the real HOME, whose real `~/.gitconfig` already applies. */
if (fixtureHome) {
  fs.writeFileSync(
    path.join(fixtureHome, ".gitconfig"),
    `[user]\n\tname = ${process.env.GIT_AUTHOR_NAME}\n\temail = ${process.env.GIT_AUTHOR_EMAIL}\n`,
  );
  const inheritedPath = process.env.PATH;
  if (!inheritedPath) {
    throw new Error("E2E harness requires PATH for spawned terminal fixtures");
  }
  // macOS's /etc/zprofile replaces the inherited Nix PATH with system paths.
  // The isolated HOME is replayed after /etc/zprofile by prepareShellInit, so
  // restore the harness PATH here. This keeps the real Nix git on pristine
  // Darwin runners instead of falling into Apple's uninstalled Xcode stub.
  fs.writeFileSync(
    path.join(fixtureHome, ".zprofile"),
    `export PATH='${inheritedPath.replaceAll("'", `'\\''`)}'\n`,
  );
}

const grokDir = RECORDING ? undefined : mkSubDir("grok");
const piDir = RECORDING ? undefined : mkSubDir("pi");
const ompDir = RECORDING ? undefined : mkSubDir("omp");
const xyneDir = RECORDING ? undefined : mkSubDir("xyne");
const serverModeEnv: Record<
  (typeof AGENT_DIR_VARS)[number],
  string | undefined
> & { HOME?: string; XDG_STATE_HOME?: string } = RECORDING
  ? {
      KOLU_CLAUDE_SESSIONS_DIR: undefined,
      KOLU_CLAUDE_PROJECTS_DIR: undefined,
      KOLU_CODEX_DIR: undefined,
      KOLU_GROK_DIR: undefined,
      KOLU_PI_DIR: undefined,
      KOLU_OMP_DIR: undefined,
      KOLU_XYNE_DIR: undefined,
    }
  : {
      KOLU_CLAUDE_SESSIONS_DIR: claudeSessionsDir,
      KOLU_CLAUDE_PROJECTS_DIR: claudeProjectsDir,
      KOLU_CODEX_DIR: codexDir,
      KOLU_GROK_DIR: grokDir,
      KOLU_PI_DIR: piDir,
      KOLU_OMP_DIR: ompDir,
      KOLU_XYNE_DIR: xyneDir,
      HOME: fixtureHome,
      XDG_STATE_HOME: stateHomeDir,
    };
for (const name of AGENT_DIR_VARS) {
  const value = serverModeEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
// Same recording-mode split as AGENT_DIR_VARS above: the fake per-worker
// opencode DB is for the mocked e2e scenarios; under X11CAP the REAL
// ~/.local/share/opencode/opencode.db must resolve (locally and on a
// provisioned remote host, which inherits the var) or a live opencode is
// detected as a bare shell and never surfaces agent attention.
if (RECORDING) delete process.env.KOLU_OPENCODE_DB;
else process.env.KOLU_OPENCODE_DB = opencodeDbPath;

/** Fake agent binaries the codex/opencode mock scenarios invoke by
 *  absolute path to bypass PATH resolution — the user's shell rc (e.g.
 *  ~/.bashrc) may prepend `~/.npm-global/bin` on startup and shadow any
 *  PATH override we set via the whitelist, so a real codex/opencode
 *  install on the host silently wins against the fake.
 *
 *  Each stub is a renamed copy of `bash` (see `stageRenamedBash` for why a
 *  copy, and why not `/bin/sleep`), so `readForegroundBasename()` reads
 *  "codex" without the real CLI being installed.
 *
 *  Paths are surfaced to step definitions via KOLU_FAKE_CODEX_BIN,
 *  KOLU_FAKE_OPENCODE_BIN, KOLU_FAKE_GROK_BIN, KOLU_FAKE_PI_BIN,
 *  KOLU_FAKE_OMP_BIN, and KOLU_FAKE_XYNE_BIN env vars (on this worker's
 *  process env, not
 *  forwarded to the spawned server — the step defs read them directly
 *  and type the absolute path into the pty). */
const fakeBinDir = mkSubDir("bin");
const fakeBins = stageRenamedBash(fakeBinDir, FAKE_BIN_NAMES);
process.env.KOLU_FAKE_CODEX_BIN = fakeBins.codex;
process.env.KOLU_FAKE_OPENCODE_BIN = fakeBins.opencode;
process.env.KOLU_FAKE_GROK_BIN = fakeBins.grok;
process.env.KOLU_FAKE_PI_BIN = fakeBins.pi;
process.env.KOLU_FAKE_OMP_BIN = fakeBins.omp;
process.env.KOLU_FAKE_XYNE_BIN = fakeBins.xyne;
// The `claude` and `node` stubs are ROOT processes for the command-rooted spawn
// repro (`spawn_detection_steps.ts`), run as the PTY's argv[0] with no shell,
// exactly as `kaval-tui create -- <agent> …` does. `claude` (comm="claude")
// backs the pid-path regression guard; `node` is the npm-shim's real comm — an
// `opencode`-named binary execs it so comm="node" ≠ the agent name, forcing
// detection through the seeded command hint (the two-lock path).
process.env.KOLU_FAKE_CLAUDE_BIN = fakeBins.claude;
process.env.KOLU_FAKE_NODE_BIN = fakeBins.node;

/** The `gh` the PR sensor runs (see `support/fake-gh.ts`). Staged per worker
 *  beside the other fake binaries and handed to the server child explicitly —
 *  `KOLU_GH_BIN` is a which-binary var outside the shared spawn allowlist, the
 *  same class as `KOLU_KAVAL_BIN`, so it can only reach the server by being
 *  named there; the server forwards it to the padi it spawns (`daemonEnv`),
 *  and both nix wrappers bake it with `--set-default`, so the nix-built lane
 *  (`just test`, CI) gets the fake too. Without it the REAL `gh` would answer
 *  the suite's repositories — a network call, a token, and an answer no
 *  scenario stated. */
const fakeGhBin = stageFakeGh(fakeBinDir, process.execPath);

/** Per-worker ephemeral state dir for the kolu server under test. Routing
 *  to $TMPDIR keeps test state out of `~/.config`; nesting under
 *  `testBaseDir` means the whole run's scratch space cleans up together. */
const koluStateDir = mkSubDir("state");

/** Per-worker padi state-root — the CRITICAL isolation seam of the W2.2 cutover.
 *  kolu-server no longer serves padi in-process; it SPAWNS a separate padi PROCESS
 *  (server/src/padi/padiBinding.ts), and padi in turn spawns its OWN kaval. padi's whole
 *  identity — its socket + single-instance gate AND its kaval's socket + gate — is
 *  DERIVED from a digest of this state-root path (padi/src/stateRoot.ts). Without a
 *  private state-root per worker, every worker's server would resolve the SAME
 *  default (`$XDG_STATE_HOME/padi`) → the SAME digest → all workers collide on ONE
 *  shared padi. Passed to the server as `KOLU_PADI_STATE_DIR` (which padiBinding
 *  forwards verbatim to padi via `--state-root`), so the digest — and thus the
 *  socket/gate paths the reapers below compute — is this worker's alone. Nested
 *  under `testBaseDir` so it's wiped with the rest of the run.
 *
 *  EXPORTED because it is also where padi PERSISTS the saved session
 *  (`<stateRoot>/config.json`, `padi/src/session/stateStore.ts`) — the blob a
 *  restore-card scenario is actually asserting against. A step that must not
 *  race the 500 ms-debounced autosave reads it here (see
 *  `session_restore_steps.ts` → "the saved session should list N resumable
 *  agents"); it is the ONLY ground truth for "is the session on disk restorable
 *  yet", since nothing renders it while live terminals exist. */
export const padiStateDir = mkSubDir("padi-state");

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

/** THIS worker's kaval unix-socket path — the SAME daemon the server's pty-host
 *  client dials and adopts terminals from. Mirrors `kavalGate()` (which only
 *  swaps the socket's basename to `kaval.pid`), so an out-of-band `kaval-tui
 *  create` from a step lands a PTY the server discovers via its inventory feed.
 *  Pinned through `withWorkerRuntimeDir` because the harness process never sets
 *  `XDG_RUNTIME_DIR` itself (only the server child gets it). */
export function kavalSocketPath(): string {
  return withWorkerRuntimeDir(() => padiKavalSocketPath(padiStateDir));
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

/** padi's `urgency` and `identity`, read off THIS worker's padi socket — the
 *  padi itself, not the server's mirror of it. The mirror holds a cell's last
 *  value across a padi restart and serves it until the new padi's first frame
 *  for that cell, so a read through the server just after padi is replaced can
 *  be the OLD padi's word. Throws when no padi answers on the socket. */
export async function readPadiDirect(): Promise<{
  urgency: PadiUrgency;
  identity: PadiIdentity;
}> {
  const link = await unixSocketLink({
    group: padiDaemonGroup,
    socketPath: withWorkerRuntimeDir(() => padiSocketPath(padiStateDir)),
  });
  try {
    const { surface } = padiClientOver(link.dispatch).padi;
    const head = <A, E>(stream: Stream.Stream<A, E>): Promise<A> =>
      Effect.runPromise(
        Effect.map(Stream.runHead(stream), (frame) =>
          Option.getOrThrowWith(
            frame,
            () => new Error("padi closed a cell before its first frame"),
          ),
        ),
      );
    return {
      urgency: await head(surface.urgency.get(undefined)),
      identity: await head(surface.identity.get(undefined)),
    };
  } finally {
    await link.dispose();
  }
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
/** Set once per worker in BeforeAll: the Solid dev-diagnostics console check,
 *  present exactly when the server under test serves the dev-runtime client
 *  (`support/solidDevBuild.ts`), absent for a production one. */
let solidDevCheck: SolidDevCheck | undefined;

// Reuse TCP connections across scenarios to avoid TIME_WAIT socket
// accumulation on macOS (see #334).
const keepAliveAgent = new http.Agent({ keepAlive: true });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 *  we just reaped (kill padi before its kaval, and the server before padi).
 *
 *  `kaval: "keep"` stops one level short, and is THE REDEPLOY (see
 *  {@link restartKoluServer}): a new build replaces kolu-server and the padi
 *  under it, while the kaval holding the PTYs keeps running — so the fresh padi
 *  converges on a survivor and ADOPTS its terminals under the ids they already
 *  had, which is what a person's terminals do when kolu is redeployed under
 *  them. The runtime dir is left alone too: kaval's socket and gate live there,
 *  so removing it would strand the daemon we deliberately kept. */
function killServer(kaval: "reap" | "keep" = "reap") {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = undefined;
  }
  killPadiDaemon();
  if (kaval === "keep") return;
  killKavalDaemon();
  // The per-worker runtime dir lives outside `testBaseDir` (short path, see its
  // comment), so the run's recursive remove won't catch it — reap it here.
  try {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  } catch {
    // Best-effort: already gone / never created.
  }
}
// `exit` hands its listener the exit CODE; take none, so the reap is never
// read as a mode.
process.on("exit", () => killServer());

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

/** `@retina` — the device pixel ratio such a scenario asks for. 2.25 is not a
 *  round number on purpose: it is a ratio real machines report (and the one
 *  kolu's renderer-dependent resize was measured at), and a FRACTIONAL ratio
 *  is what makes xterm's two renderers derive different cell widths from one
 *  character measurement. At the default 1 — with a font this harness measures
 *  as a whole pixel — the two agree by accident, which silently turns a sizing
 *  scenario into an unconditional pass. Untagged scenarios keep Playwright's
 *  own default of 1. */
const RETINA_DEVICE_SCALE_FACTOR = 2.25;

async function newScenarioPage(
  isMobile: boolean,
  chrome: "app" | "browser",
  vp: { width: number; height: number } = X11_VIEWPORT,
  touchViewport: { width: number; height: number } = PHONE_VIEWPORT,
  deviceScaleFactor?: number,
  /** Everything that must be on the CONTEXT before a document exists —
   *  bindings, init scripts, the `page` listener. Run before `newPage()`, so
   *  nothing can navigate unwatched. The app-mode branch has no such moment:
   *  Chrome opens its window at launch, so there it runs as early as it can. */
  prepare: (context: BrowserContext) => Promise<void> = async () => {},
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
    await prepare(context);
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
      // `@retina`: a fractional device pixel ratio, so a scenario about SIZE
      // runs where the two xterm renderers can actually disagree.
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
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
    await prepare(context);
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

/** The genuinely-harness-specific env keys the e2e kolu-server child needs BEYOND the
 *  shared spawn-env allowlist base — nix-develop build env and test knobs that have no
 *  home in the production allowlist. NOT a widening of the shared policy: the base
 *  (`composeSpawnEnv`) already carries the allowlisted `LC_*`/`XDG_*`/`TMPDIR`, and this
 *  harness must NOT re-admit the extension keys prod deliberately strips (`LC_PAPER`,
 *  `XDG_DATA_DIRS`, …), or the e2e env would silently diverge from production — a scenario
 *  could then pass relying on a var prod drops. If the server truly needs one, that is a
 *  statement about the shared PRESENTATION/OPERATIONAL classes (add it there), not here.
 *  Only the `NIX_` devshell family (an open prefix) has no fixed-key form. */
const E2E_SERVER_ENV_PREFIXES = ["NIX_"] as const;
const E2E_SERVER_ENV_KEYS = [
  "IN_NIX_SHELL",
  "NODE_OPTIONS",
  "PWD",
  "CI",
  "HEADLESS",
  "CUCUMBER_WORKER_ID",
  "KOLU_TEST_VERBOSE",
  // Which kaval the server spawns (nix-built vs from-source) — the spawn-deciding var.
  "KOLU_KAVAL_BIN",
  // The baked osfacts binary padi and kaval read process facts through
  // (`bakedOsFactsBin`). Required and fail-fast with NO PATH fallback, so a
  // from-source server that does not inherit it dies at boot — which is what
  // `just test-quick` did for every scenario after #2067 adopted osfacts:
  // BeforeAll failed with "could not start a kolu server that owns its port",
  // 0 scenarios run. `just test` was unaffected (and so was CI) because
  // `.#koluBin`'s nix wrapper bakes the path in rather than inheriting it —
  // which is exactly why nothing caught this. Same class as KOLU_KAVAL_BIN
  // above: a which-binary var the from-source path can only get by inheritance.
  "KOLU_OSFACTS_BIN",
  // The baked agent source ref remote-host provisioning resolves the padi drv
  // from. Same class as KOLU_KAVAL_BIN/KOLU_OSFACTS_BIN: the nix wrapper bakes
  // it via `--set`, so a from-source server (`just record`'s wrapper, which
  // seeds kolu-bot for the hero-demo) can only get it by inheritance from the
  // recipe's `agent_bake`.
  "SURFACE_AGENT_FLAKE_REF",
  // Isolates the recording's remote padi state-root from any OTHER kolu bound
  // to the same host (the user's production kolu also converges kolu-bot's
  // DEFAULT state-root, so the two servers drain-and-replace each other's
  // daemon mid-recording — "daemon connection closed mid-session" on camera).
  "KOLU_REMOTE_PADI_STATE_DIR",
  "KOLU_COMMIT_HASH",
  "TZ",
  "TERMINFO",
] as const;

/** Compose the e2e server child's env from the shared spawn allowlist base plus the
 *  harness-specific keys above — instead of a wholesale `...process.env`, so no ambient
 *  identity var rides in. The caller layers the explicit per-worker test config (state
 *  dirs, mock agent bins, bind pid) on top. */
function composeE2eServerEnv(): Record<string, string> {
  const env = composeSpawnEnv(process.env);
  // The fixed harness keys via the SAME shared primitive the base uses (no drift); the
  // open `NIX_` devshell family via a prefix scan (no fixed-key helper fits a prefix).
  Object.assign(env, pickEnv(E2E_SERVER_ENV_KEYS, process.env));
  for (const [k, v] of Object.entries(process.env)) {
    if (v != null && E2E_SERVER_ENV_PREFIXES.some((p) => k.startsWith(p))) {
      env[k] = v;
    }
  }
  return env;
}

/** The fixture bake, built once per worker (its paths are stable across the
 *  server respawns a worker makes). */
const agentDistroFixture = agentDistroFixtureEnv();

/** The scripted ACP agent the conductor's scenarios run against. An
 *  absolute path, never a bare name: a production kolu BAKES this variable
 *  with a store path, and the one thing a from-source e2e must not do is
 *  depend on whatever the PTY's PATH happens to resolve
 *  (`skill://e2e-testing`'s third rule). */
const acpFixtureAgent = path.resolve(
  import.meta.dirname,
  "acp-fixture-agent.ts",
);

/** ... and the store it remembers prompted sessions in, per worker. */
const acpFixtureSessions = mkSubDir("acp-sessions");

/** The commit the source wrapper runs from — the other half of the padi build
 *  identity a start gives it ({@link padiBuildEnv}). */
const sourceCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

/** The build the running server is — the one a deploy replaces. */
let runningBuild: ServerBuild = "base";

function serverBinary(koluServer: string, build: ServerBuild): string {
  if (build === "base") return koluServer;
  const next = process.env.KOLU_SERVER_NEXT_BUILD;
  if (!next) {
    throw new Error(
      "a scenario deploys a second server build, but KOLU_SERVER_NEXT_BUILD is not set (the `just test` / `just test-quick` recipes set it)",
    );
  }
  return next;
}

async function startServerChild(
  koluServer: string,
  /** How this start proves padi is live — see {@link waitForPadiLive}. A
   *  start that precedes a FRESH scenario wipes as it probes; a restart in the
   *  MIDDLE of one must not, because what the new padi parked from the saved
   *  session is what that scenario is about. */
  probe: "killAll" | "read" = "killAll",
  /** Start on THIS port rather than a random one — a deploy keeps the address,
   *  and so the origin, the open page has. One child only, with no fresh port
   *  to move to: a child that exits fails the start at once, and a live child
   *  gets the whole budget every other start gets across its tries. */
  fixedPort?: number,
  build: ServerBuild = "base",
): Promise<void> {
  // Refuse a destructive ssh-leg bind BEFORE spawning the child — the spawn itself is
  // destructive, so the ack cannot wait until after (P2/F1).
  assertRemoteDestructiveAck();
  // The server runs inside the nix devshell, so it needs the devshell env
  // whitelist. Git identity is NOT threaded here: fixtures' in-terminal
  // `git commit` reads it from the fake `$HOME/.gitconfig` (seeded at startup),
  // not ambient `GIT_AUTHOR_*` env the spawn allowlist strips (#1872).
  const envWhitelist = NIX_ENV_WHITELIST;
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
  // All tries share ONE budget, which ends a step guard short of the limit of
  // the hooks that start a server and set none of their own (BeforeAll, the
  // @kaval-restart After): a try still waiting when that limit fires is cut
  // off by cucumber's bare timeout instead of failing with this start's own
  // diagnosis. A child that finds its port taken EXITS, so a live child that
  // has not yet announced is still starting: on a fixed port, with nowhere to
  // retry, it gets the whole budget in one wait, and only an exit fails it early.
  const SPAWN_BUDGET_MS = STEP_TIMEOUT - STEP_GUARD;
  const OWN_PORT_WAIT_MS = 15_000;
  const MAX_SPAWN_ATTEMPTS =
    fixedPort === undefined
      ? Math.floor(SPAWN_BUDGET_MS / OWN_PORT_WAIT_MS)
      : 1;
  const attemptWaitMs =
    fixedPort === undefined ? OWN_PORT_WAIT_MS : SPAWN_BUDGET_MS;
  let lastFailure = "";
  let started = false;
  for (let attempt = 1; attempt <= MAX_SPAWN_ATTEMPTS && !started; attempt++) {
    const port = fixedPort ?? (await getPort());
    const url = `http://localhost:${port}`;
    console.log(
      `[worker:${workerId}] Starting server on port ${port} (attempt ${attempt}/${MAX_SPAWN_ATTEMPTS})...`,
    );
    const child = spawn(
      serverBinary(koluServer, build),
      [
        // `web` is spelled explicitly: bare `kolu` lists its subcommands and
        // exits non-zero now — it stopped being an alias for the server when
        // the terminal verbs landed on the binary.
        "web",
        "--allow-nix-shell-with-env-whitelist",
        envWhitelist,
        "--port",
        String(port),
      ],
      {
        stdio: "pipe",
        env: {
          // Composed from a NAMED base (shared spawn allowlist + devshell/runtime
          // keys), NOT a wholesale `...process.env` — so a conductor's ambient
          // identity vars (CLAUDE_CODE_*, #1872) that leaked into the harness can't
          // ride into the server → padi → and muddy agent-detection scenarios.
          ...composeE2eServerEnv(),
          // Route server state to an ephemeral $TMPDIR path so test runs
          // never touch ~/.config and the dir can be wiped in AfterAll.
          KOLU_STATE_DIR: koluStateDir,
          // A stand-in agent-distro bake (see `agentDistroFixture.ts`): Settings
          // names its harnesses, and a terminal spawned with Agents on (and no
          // profiles) gets its stub `claude`. The server forwards it to the padi
          // it spawns, as the `default` wrapper's real bake is.
          ...agentDistroFixture,
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
          // Bind every daemon this run spawns (padi, and the kaval padi spawns) to
          // THIS cucumber worker's pid — the harness/run pid, NOT the server's. The
          // server forwards it to padi, padi to kaval, so BOTH daemons die the moment
          // this worker is gone (a signal-killed or crashed run whose After hooks
          // never ran, and whose digest-scoped reapers can't reach a foreign-digest
          // daemon). This binds padi + kaval only; the kolu-server is a child of the
          // worker reaped by the harness itself, not via this mechanism. padi/kaval
          // surviving the SERVER's death stays intact — the bind is to the worker,
          // which outlives the server across kaval-restart/session-restore scenarios.
          // Absence would leave the production `forever`.
          KOLU_DAEMON_BIND_PID: String(process.pid),
          // The everyday-e2e vs recording env divergence, decided once above:
          // mock agent dirs + a throwaway HOME normally; agent dirs absent and
          // HOME inherited (real) under X11CAP so the real claude/codex resolve
          // their sessions + login from the real home. See `serverModeEnv`.
          ...serverModeEnv,
          // Recording-mode split, same reason as serverModeEnv: real DB under
          // X11CAP, fake per-worker DB for the mocked scenarios.
          ...(RECORDING ? {} : { KOLU_OPENCODE_DB: opencodeDbPath }),
          // W3.1 — the ssh leg: when KOLU_E2E_PADI_HOST is set, the server binds a
          // REMOTE padi over ssh (the whole canvas becomes that host) instead of
          // spawning a local one, so the SAME suite runs unchanged against a remote
          // padi — the parity proof. Unset (the default) → today's local binding,
          // byte-identical, and none of the per-worker padi-state isolation above
          // changes. Run single-worker over ssh: the remote padi uses ITS OWN default
          // state-root (the binder passes nothing), so parallel workers would collide
          // on one remote daemon. The remote host needs the agent source baked
          // (a nix-built koluBin — `just test`, not `just test-quick`).
          ...(process.env.KOLU_E2E_PADI_HOST
            ? { KOLU_PADI_HOST: process.env.KOLU_E2E_PADI_HOST }
            : {}),
          // The POOL seed twin (the `record` recipe's hero-demo multi-host
          // fleet): forwarded to the server exactly like the W3.1 var above,
          // but deliberately NOT read by rpcWire's PADI_HOST_KEY — that
          // constant retargets EVERY harness padi verb (killAll, setTheme) at
          // the first non-local token, which is correct for the whole-canvas
          // ssh leg and wrong for a guest-pool seed: the recording's resets
          // and pins must keep hitting the LOCAL padi.
          ...(process.env.KOLU_E2E_PADI_HOST_SEED
            ? { KOLU_PADI_HOST: process.env.KOLU_E2E_PADI_HOST_SEED }
            : {}),
          // THE CONDUCTOR'S ADAPTER. kolu-server hosts the one conversation
          // now, so the nix wrapper that bakes `KOLU_ACP_AGENT` is `koluBin` —
          // the very binary this harness spawns — and a from-source e2e run has
          // no wrapper at all, so the value has to arrive here. It is the
          // scripted ACP agent in `support/`, run through this node: the
          // conductor the browser talks to is a real subprocess speaking the
          // real protocol, not a stubbed store. The bake is `--set-default`
          // precisely so this line wins.
          //
          // `KOLU_MCP_BIN` is GONE with the hosting move: the session's one MCP
          // server is kolu-server's own loopback HTTP face, so there is no
          // `kolu mcp` child to name and no path to forward.
          //
          // Its one argument is the directory it keeps PROMPTED sessions in —
          // a per-worker dir that outlives a server respawn, the way a real
          // adapter's store outlives kolu-server.
          KOLU_ACP_AGENT: `${process.execPath} ${acpFixtureAgent} ${acpFixtureSessions}`,
          // THE PR SENSOR'S `gh`. It runs inside padi; the server forwards it
          // there (`daemonEnv`), and the suite's answer must be the one a
          // scenario wrote into its own repo rather than whatever the real
          // `gh` can reach.
          KOLU_GH_BIN: fakeGhBin,
          // The padi build this start runs as, and the commit it is built
          // from — see `padiBuildEnv`.
          ...padiBuildEnv(build, sourceCommit),
        },
      },
    );
    // The worker owns this child from the moment it exists, not from the
    // moment it answers: a hook whose limit fires mid-try ends the worker, and
    // the exit handler's `killServer` reaches only the child named here.
    serverProcess = child;

    // Detect when OUR child announces it bound the port. The address in the
    // `kolu listening {...,"address":"http://127.0.0.1:<port>"}` log proves
    // ownership; buffer across chunks so a split line still matches.
    let outBuf = "";
    let ownsPort = false;
    let exited = false;
    let exitedAs = "";
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
      exitedAs = `code=${code} signal=${signal}`;
      const line = `[server:${workerId}] process exited code=${code} signal=${signal}\n`;
      serverLog.write(line);
      process.stderr.write(line);
    });

    const owned = await waitForOwnedServer(
      url,
      () => ownsPort,
      () => exited,
      attemptWaitMs,
    );
    if (owned) {
      runningBuild = build;
      baseUrl = url;
      // Re-point the shared RPC wire at THIS server: a restart lands on a fresh
      // random port, and a socket left dialling the old one would retry against a
      // corpse forever. Every RPC below (the liveness probe included) rides it.
      await setRpcBaseUrl(url);
      started = true;
      console.log(`[worker:${workerId}] Server is healthy on ${port}.`);
    } else {
      lastFailure = ownsPort
        ? exited
          ? `the server announced port ${port} and then exited (${exitedAs}) before it answered /api/health`
          : `the server was alive and announced port ${port} but did not answer /api/health within ${attemptWaitMs}ms`
        : exited
          ? `the server exited (${exitedAs}) before it owned port ${port} — the port may be held by another process`
          : `the server was alive but had not announced owning port ${port} after ${attemptWaitMs}ms`;
      const action =
        [
          exited ? null : "killing it",
          attempt < MAX_SPAWN_ATTEMPTS ? "retrying on a fresh port" : null,
        ]
          .filter((step) => step !== null)
          .join(" and ") || "giving up";
      console.log(`[worker:${workerId}] ${lastFailure}; ${action}.`);
      if (!exited) child.kill("SIGKILL");
      serverProcess = undefined;
    }
  }
  if (!started) {
    throw new Error(
      `[worker:${workerId}] could not start a kolu server that owns its port after ${MAX_SPAWN_ATTEMPTS} attempt(s): ${lastFailure}`,
    );
  }
  // BOTH arms now warm padi ASYNC (fail-open by design: the local arm's boot no
  // longer awaits its first connect before the server listens either — W4's
  // extend-fail-open-to-local fix — so the server is up before EITHER a local or a
  // remote padi is live). Wait for it here, on EVERY server start (boot AND the
  // mid-run restarts reconnect/session-restore/@kaval-restart trigger), so scenarios
  // never race the warm-up (a probe against a not-yet-connected binding is the
  // re-serve's "no live upstream link").
  await waitForPadiLive({ probe });
}

/** Poll a padi procedure until the (async-warming) bound arm — local or, under
 *  `KOLU_E2E_PADI_HOST`, remote — is live, or throw at the caller-supplied deadline.
 *  Local warm-up is normally sub-second (a from-source spawn + connect); the remote
 *  leg's ssh provisioning is what needs the longer startup default. Runs
 *  UNCONDITIONALLY: since neither arm's boot blocks the server's listen anymore, a
 *  scenario racing padi's warm-up is possible on EITHER leg, not just the ssh one.
 *
 *  THE PROBE IS A CHOICE, because "is it up?" and "wipe it" are two questions
 *  and one helper used to mean both. `killAll` is right where the next thing
 *  that happens is a fresh scenario (the suite's own boot): it answers the
 *  liveness question AND clears whatever a previous run left. It is WRONG on a
 *  mid-scenario restart, where what padi has just parked from its saved session
 *  is the very thing the scenario is about — the probe killed the restored
 *  terminal a second after the daemon parked it, and the work's member really
 *  did go (kolu#2376's redeploy scenario read `gone` honestly about a terminal
 *  the harness had destroyed). `read` asks the same question of the terminals
 *  collection and changes nothing. */
async function waitForPadiLive({
  announce = true,
  timeoutMs = 120_000,
  probe = "killAll",
}: {
  announce?: boolean;
  timeoutMs?: number;
  probe?: "killAll" | "read";
} = {}): Promise<void> {
  const remotePadiHost = process.env.KOLU_E2E_PADI_HOST;
  // Belt-and-suspenders: the ack was already enforced before the spawn (assertRemoteDestructiveAck
  // in startServerChild); re-assert here so this destructive killAll poll can't run without it
  // even if a future caller reaches it another way. A no-op on the local leg, and
  // nothing to ask about a read-only probe.
  if (probe === "killAll") assertRemoteDestructiveAck();
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostic = "no attempt completed";
  while (true) {
    const remainingBeforeAttempt = deadline - Date.now();
    if (remainingBeforeAttempt <= 0) break;
    try {
      // Bound each attempt so a wedged call (socket up, handler hung mid-boot)
      // can't outlive the caller's deadline. The final attempt gets only the time
      // still available rather than a fresh five-second budget.
      const attempt = { timeoutMs: Math.min(5_000, remainingBeforeAttempt) };
      if (probe === "killAll") {
        await padiCall("lifecycle/killAll", undefined, attempt);
      } else {
        // The collection's `keys` is a subscription whose opening frame is the
        // roster padi is serving right now — the same "has the re-serve a live
        // upstream?" answer the killAll gave, with nothing destroyed.
        await padiFirstFrame("terminals/keys", undefined, attempt);
      }
      if (announce)
        console.log(
          remotePadiHost
            ? `[worker:${workerId}] remote padi is live — running against the ssh host`
            : `[worker:${workerId}] local padi is live`,
        );
      return;
    } catch (err) {
      // The retry/permanent split, on the wire's own vocabulary: a transport
      // failure, a per-attempt timeout, an unseeded map key, or the re-serve's
      // "no live upstream link" all mean "not yet" and keep polling
      // (`isPadiWarmingUp`). Anything else — a declared procedure error, a schema
      // rejection, a terminally-failed entry — is permanent and surfaces now,
      // carrying what the server actually said.
      if (!isPadiWarmingUp(err)) {
        throw new Error(
          `[worker:${workerId}] padi liveness probe failed permanently (${
            err instanceof Error ? err.message : String(err)
          })`,
          { cause: err },
        );
      }
      lastDiagnostic = err instanceof RpcCallFailed ? err.message : String(err);
    }
    const remainingBeforeSleep = deadline - Date.now();
    if (remainingBeforeSleep <= 0) break;
    await sleep(Math.min(1_000, remainingBeforeSleep));
  }
  throw new Error(
    remotePadiHost
      ? `[worker:${workerId}] remote padi (KOLU_E2E_PADI_HOST=${remotePadiHost}) never became live within ${timeoutMs}ms (last probe: ${lastDiagnostic})`
      : `[worker:${workerId}] local padi never became live within ${timeoutMs}ms (last probe: ${lastDiagnostic})`,
  );
}

/** Reset every padi-owned scenario domain as one retryable transaction.
 *
 * The re-serve reports a link-down edge as its own `UpstreamUnavailableError`. If
 * that edge lands after `killAll` but before either cell write, restart the whole
 * idempotent sequence: a successful return therefore proves all three operations
 * reached one live padi episode. Any other failure is a real handler/contract
 * failure and surfaces immediately, carrying what the server said. */
async function resetPadiScenarioState(timeoutMs: number): Promise<void> {
  await retryPadiScenarioReset(timeoutMs, async (remaining) => {
    await waitForPadiLive({ announce: false, timeoutMs: remaining });
    await padiCall("activityFeed/test__set", {
      recentRepos: [],
      recentAgents: [],
    });
    await padiCall("session/test__set", null);
  });
}

/** How long a scenario waits for the resolved new-terminal policy to land on padi,
 *  how long one read of the cell may take, and how tightly the reads repeat. Both
 *  legs are already live by the time this runs (`resetPadiScenarioState` waited for
 *  padi), so what remains is one server→padi hop. */
const POLICY_PUSH_TIMEOUT = 5_000;

/** Block until padi's `newTerminalPolicy` cell reads the `inherit` policy the
 *  preferences reset above implies.
 *
 * Theme resolution for a new terminal lives in padi now (#2045): kolu-server
 * derives the policy from its preferences cell and PUSHES it across, so the
 * preferences write and the value `lifecycle.create` reads are separated by a
 * hop. A create that lands before that hop resolves against padi's baked default
 * ({shuffle, dark}) and the theme scenarios flake onto a shuffled theme — so the
 * scenario blocks here until the policy is observable on padi ITSELF, not merely
 * accepted by the server. A read that never converges is a broken push, not a slow
 * one: fail loudly with the last thing padi said. */
async function waitForInheritPolicy(): Promise<void> {
  await waitForPadiCell({
    memberVerb: "newTerminalPolicy/get",
    accept: (p) => (p as NewTerminalPolicy).kind === "inherit",
    what: `the inherit new-terminal policy [worker:${workerId}]`,
    timeoutMs: POLICY_PUSH_TIMEOUT,
  });
}

/** Block until padi's `agentDistro` cell reads OFF — what the suite's "never
 *  chosen" preference folds to, so a terminal a scenario opens never gets the
 *  fixture agents (or their `claude`, which would shadow the mock agent bins)
 *  unless the scenario turns them on itself. Same hop, same reason as the policy
 *  wait above. */
async function waitForAgentsOff(): Promise<void> {
  await waitForPadiCell({
    memberVerb: "agentDistro/get",
    accept: (s) => (s as AgentDistroSetting).enabled === false,
    what: `the Agents setting off [worker:${workerId}]`,
    timeoutMs: POLICY_PUSH_TIMEOUT,
  });
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
    await setRpcBaseUrl(baseUrl);
    await waitForPadiLive();
  } else {
    await startServerChild(koluServer); // waits for a live bound padi internally
  }
  // Does this server serve the dev-runtime client? Asking it is what turns the
  // console check on — and on the Solid-diagnostics lane, a server that does
  // not fails here rather than passing for having nothing to report.
  solidDevCheck = await solidDevCheckFor(baseUrl);

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

AfterAll(tearDownWorker);

async function tearDownWorker(): Promise<void> {
  if (browser) await browser.close();
  // KOLU_X11CAP: tear down the virtual display once the browser is gone.
  if (xvfbProc) {
    xvfbProc.kill("SIGTERM");
    xvfbProc = undefined;
  }
  keepAliveAgent.destroy();
  // Close the worker's RPC websocket before the server goes away — the link owns
  // fibers (dial, ping, response pump) that only `dispose` releases, and a socket
  // left open would keep the process alive past the run.
  await disposeRpcWire();
  killServer();
  // PADI'S OWN LOGS, kept beside the server's. The daemon writes them inside
  // its state root, which lives under `testBaseDir` and is about to be
  // removed — and they are the only account of what the daemon did on BOOT
  // (what it found in the saved session and parked), which is exactly what a
  // scenario about a restart has to be read against. Every `.log` in that
  // root is taken rather than one name: the daemon keeps its own log and its
  // raw stderr apart, and which of the two holds the line a post-mortem wants
  // is not this harness's business. `reports/` is gitignored run output, like
  // `server-w<N>.log`.
  try {
    for (const entry of fs.readdirSync(padiStateDir)) {
      if (!entry.endsWith(".log")) continue;
      fs.copyFileSync(
        path.join(padiStateDir, entry),
        path.join(serverLogDir, `padi-w${workerId}-${entry}`),
      );
    }
  } catch {
    // Best-effort: a run that never started a padi has no log to keep.
  }
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
}

const SCENARIO_PADI_LIVE_TIMEOUT = 60_000;
const SCENARIO_SETUP_GUARD = 30_000;
const SCENARIO_SETUP_TIMEOUT =
  SCENARIO_PADI_LIVE_TIMEOUT + SCENARIO_SETUP_GUARD;

Before(
  { timeout: SCENARIO_SETUP_TIMEOUT },
  async function (this: KoluWorld, scenario) {
    // Derive the scenario's file stem once, up front — the failure screenshot,
    // the evidence webm, the x11 grab, and the transcoded assets all key off the
    // same value, so it's computed here and read at every site below.
    x11Stem = slug(scenario.pickle.name);
    // Preferences FIRST, padi second — these two resets stopped being independent
    // when new-terminal theme resolution moved into padi (#2045). kolu-server
    // derives the theme policy from THESE preferences and pushes the resolved
    // value into padi's memory-only `newTerminalPolicy` cell, so racing the two
    // (the old `Promise.all`) left the push chasing a padi that a `killAll` was
    // still reconnecting through.
    await surfaceCall("surface/kolu/preferences/test__set", {
      // Reset all preferences to defaults (newTerminalTheme "inherit" so new
      // terminals get the default theme — deterministic for tests)
      seenTips: [],
      // Marketing recordings (KOLU_X11CAP) want a quiet canvas — no ambient
      // tip banners popping in mid-shot. Normal e2e runs keep them on.
      startupTips: !X11CAP,
      newTerminalTheme: "inherit",
      // The NEW-TERMINAL `collapsed` default — a top-level seed beside
      // `newTerminalTheme`. The LIVE collapsed state is per-terminal now (it
      // follows the terminal, #959) — but every new terminal SEEDS its
      // `collapsed` from this default, so pinning it `true` still gives the
      // whole suite a deterministic collapsed starting point (every terminal a
      // scenario spawns starts closed) for the many toggle-and-assert
      // scenarios. The shipped runtime default is open
      // (DEFAULT_PREFERENCES.newTerminalCollapsed = false). Recordings
      // (X11CAP) want the right panel visible by default (it's the new app
      // default, and the Code tab is part of what we show); normal tests keep
      // it collapsed (right-panel.feature asserts that). `activeTab`/`codeMode`
      // are per-terminal too (DEFAULT_RIGHT_PANEL_PER_TERMINAL) and flow from
      // there, asserted by right-panel.feature / code-tab.feature.
      newTerminalCollapsed: !X11CAP,
      shuffleBehavior: "auto",
      scrollLock: true,
      attentionAlerts: true,
      colorScheme: "dark",
      terminalRenderer: "auto",
      // `rightPanel` preferences hold the panel width and the Code-tab tree
      // split — live-written geometry only.
      rightPanel: {
        size: 0.25,
        codeTabTreeSize: 0.35,
      },
      // Agents NEVER CHOSEN for the suite, as a fresh install ships (`null`, which
      // behaves as off): the fixture bake gives every terminal a `claude` that
      // would shadow the mock agent bins the agent-detection scenarios run, and
      // the welcome card asks first. `agents.feature` chooses them itself.
      agentDistro: null,
      agentProfilesRecent: [],
      tipBarCollapsed: false,
      // No host arrangement: the strip is in pool order, local pinned first —
      // what every scenario that lists hosts expects.
      hostOrder: [],
      // The Conductor compacts at the shipped point, which
      // `conductor-compaction.feature` reads back as "about 200k".
      conductorCompactsAt: 200_000,
    });
    // Reset padi's terminals + cells as one retryable transaction. It waits for
    // padi to be live, which is what bounds the tight policy poll that follows.
    await resetPadiScenarioState(SCENARIO_PADI_LIVE_TIMEOUT);
    await waitForInheritPolicy();
    await waitForAgentsOff();

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
    // @retina → a fractional device pixel ratio (see RETINA_DEVICE_SCALE_FACTOR).
    const deviceScaleFactor = scenario.pickle.tags.some(
      (t) => t.name === "@retina",
    )
      ? RETINA_DEVICE_SCALE_FACTOR
      : undefined;

    // KOLU_X11CAP: the recording (keyed by scenario name) decides app-mode vs
    // browser chrome and its capture viewport — read it so the launch + grab match.
    const rec = X11CAP ? getRecording(scenario.pickle.name) : undefined;
    const chrome = rec?.chrome ?? "browser";
    const vp = rec?.viewport ?? X11_VIEWPORT;

    this.browser = browser;
    this.errors = [];
    this.solidDiagnostics = [];
    this.solidDiagnosticFooters = [];
    this.solidDiagnosticEvents = [];
    const check = solidDevCheck;
    // WHAT THE CONSOLE CANNOT SAY, FROM THE CHANNEL ITSELF, INSTALLED BEFORE
    // THE PAGE EXISTS. On a dev-runtime server the client hands its `OBSERVE`
    // to the page (`client/src/solidDiagnosticsExpose.ts`, development
    // runtimes only); this init script subscribes to the diagnostics channel
    // and reports each event's code, location and owner path through a binding
    // — the fields a diagnostic whose call site throws never reaches the
    // console with. On the CONTEXT, so a window the page opens is subscribed
    // too, and before `newPage()`, so no document can load unwatched. Each
    // event is stamped with the step the run was on when it arrived.
    const created = await newScenarioPage(
      isMobile,
      chrome,
      vp,
      touchViewport,
      deviceScaleFactor,
      async (context) => {
        // Everything any document of this scenario throws, and on a
        // dev-runtime server every console line that is a Solid dev
        // diagnostic or warning. ONE subscription for all of them — the
        // scenario's own page included, since Playwright emits `page` for
        // `newPage()` too — each line named by where it came from
        // (see `pageWatch.ts`).
        watchContextPages({
          context,
          scenarioPage: () => this.page,
          check,
          reports: {
            errors: this.errors,
            diagnostics: this.solidDiagnostics,
            footers: this.solidDiagnosticFooters,
          },
        });
        if (!check) return;
        await context.exposeBinding(
          SOLID_DIAGNOSTIC_BINDING,
          (_source, event: PageDiagnostic) =>
            void this.solidDiagnosticEvents.push(
              stampDiagnostic(event, {
                scenario: this.currentScenario,
                step: this.currentStep,
              }),
            ),
        );
        await context.addInitScript(solidObserveInitScript());
      },
    );
    this.context = created.context;
    this.page = created.page;
    // Disable CSS transitions/animations so Corvu dialogs open/close instantly.
    // prefers-reduced-motion tells well-behaved libraries to skip animations;
    // the style override catches anything that ignores the media query. SKIPPED
    // under KOLU_EVIDENCE — when we're recording a video, motion is the point.
    const reducedMotion = !EVIDENCE && !X11CAP;
    if (reducedMotion) {
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
    window.__readXtermBuffer = function(sel, idx, opts) {
      var containers = document.querySelectorAll(sel);
      var container = containers[idx];
      if (!container) return "";
      var term = container.__xterm;
      if (!term) return "";
      var buf = term.buffer.active;
      // Whole buffer (scrollback included) by default; opts.viewport narrows to
      // the rows on SCREEN. Reading the buffer answers "did the bytes arrive",
      // reading the viewport answers "does the user see them" — a terminal
      // showing the wrong window onto correct bytes fails only the latter.
      var start = 0, end = buf.length;
      if (opts && opts.viewport) {
        start = buf.viewportY;
        end = Math.min(buf.length, buf.viewportY + term.rows);
      }
      var lines = [];
      for (var i = start; i < end; i++) {
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
        var next = i + 1 < end ? buf.getLine(i + 1) : null;
        var continued = !!(next && next.isWrapped);
        var s = line.translateToString(!continued);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += s;
        else lines.push(s);
      }
      return lines.join("\\n");
    };
  `);
    // A phone that opens kolu FRESH lands on the Conductor
    // (`freshChromeTab`). The touch scenarios written before that were written
    // for a tab already on its host, so a touch page starts on its host —
    // unless it is tagged `@fresh-open`, the scenarios about that very open.
    // Only when nothing is stored: a scenario that picks the Conductor and
    // reloads must land back on it.
    const freshOpen = scenario.pickle.tags.some(
      (t) => t.name === "@fresh-open",
    );
    if (isMobile && !freshOpen) {
      await this.page.addInitScript(`
      try {
        if (sessionStorage.getItem("kolu-active-chrome-tab") === null)
          sessionStorage.setItem("kolu-active-chrome-tab", "hosts");
      } catch (e) {}
    `);
    }

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
        console.error(
          `[worker:${workerId}] KOLU_X11CAP: ffmpeg spawn error:`,
          e,
        ),
      );
    }
  },
);

// WHERE THE RUN IS, for anything that arrives between steps. A diagnostic
// reaches the binding with no notion of what provoked it; the scenario name
// alone cannot say, because four workers interleave and one scenario runs
// dozens of steps. So the step text is recorded as each step starts, and each
// event is stamped with it as it arrives.
BeforeStep(function (this: KoluWorld, { pickle, pickleStep }) {
  this.currentScenario = pickle.name;
  this.currentStep = pickleStep.text;
});

// THE SOLID-DIAGNOSTICS LANE'S VERDICT: a scenario whose pages raised a Solid
// dev diagnostic Solid itself grades `error` or `warn` fails, naming each —
// what the diagnostics channel handed over (code, grade, location, owner path,
// node name) and what reached the console, plus everything the pages threw,
// since a diagnostic that throws is also a page error. A finding Solid grades
// `info` is advisory: printed, failing nothing, because that is Solid's own
// word for "reported, not wrong" (a DOM measurement's relay tear is the
// standing example).
// Defined BEFORE the main After hook because Cucumber runs After hooks in
// reverse definition order, so this runs last — after the teardown and failure
// artifacts, which a throw here must not skip. On a production server it has
// nothing to look at: nothing collected it.
After(function (this: KoluWorld) {
  const verdict = solidDiagnosticVerdict({
    events: this.solidDiagnosticEvents,
    lines: this.solidDiagnostics,
    footers: this.solidDiagnosticFooters,
    pageErrors: this.errors,
  });
  if (verdict === undefined) return;
  if (!verdict.fails) {
    console.info(`[worker:${workerId}] ${verdict.words}`);
    return;
  }
  throw new Error(verdict.words);
});

// Generous timeout: under KOLU_X11CAP this hook transcodes the raw grab (mp4 +
// VP9 webm + poster). A long clip at 3200×1800 takes well over Cucumber's 70s
// default, so give it room. The raw hero-demo grab is now up to ~6 minutes, and
// transcoding it twice (mp4 + webm, preset slow) at that size outruns the old
// 300s cap — which would kill a *successful* recording at publish time.
After({ timeout: 600_000 }, async function (this: KoluWorld, scenario) {
  // Always retire a prepared scroll-lock FIFO, including when the fire step
  // never ran — `rm` of the dir alone leaves `cat` blocked on the unlinked
  // inode (juspay/kolu#2178).
  await retireWorldScrollFifo(this);
  // A FAILED SCENARIO SAYS WHAT THE PAGES THREW — the main page's and any
  // window it opened — so a throw that left the page half-drawn names itself
  // in the failure rather than only in a later "no page errors" step that a
  // failure never reaches.
  if (
    scenario.result?.status === Status.FAILED &&
    // Set with the page; a scenario that failed before it has none.
    this.errors !== undefined &&
    this.errors.length > 0
  ) {
    console.error(
      `[worker:${workerId}] page errors in "${scenario.pickle.name}":\n  ${this.errors.join("\n  ")}`,
    );
  }
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

/** Take this worker's server down and bring another up IN THE MIDDLE of the
 *  run. When that fails, the worker is left with no server, and every scenario
 *  cucumber hands it next would fail against nothing — fast enough to drain the
 *  queue that healthy workers could have run. So a failure ends the worker,
 *  the way cucumber ends one whose BeforeAll failed: the cause on stderr, the
 *  worker's own teardown, exit 1. Cucumber marks the run failed and gives the
 *  scenarios still queued to the other workers. */
async function replaceServer(downThenUp: () => Promise<void>): Promise<void> {
  try {
    await downThenUp();
  } catch (err) {
    console.error(
      new Error(
        `[worker:${workerId}] replacing the server mid-run failed, so this worker has none; worker exiting`,
        { cause: err },
      ),
    );
    await tearDownWorker();
    process.exit(1);
  }
}

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
  await replaceServer(async () => {
    killServer(); // also reaps any surviving kaval
    await startServerChild(koluServer);
  });
});

/** REDEPLOY THE WORKER'S SERVER MID-SCENARIO — what a person's machine lives
 *  through when a new kolu build lands under them: the server child is killed
 *  along with the padi it spawned, and a fresh one is started on a fresh port.
 *  The new port is answered so the caller can navigate the page at it — a page
 *  left on the old URL would be talking to a corpse.
 *
 *  THE KAVAL IS KEPT, because that is what actually happens (kolu#2376): a
 *  redeploy replaces kolu-server and drain-replaces its padi, while the daemon
 *  holding the PTYs keeps running — so the fresh padi converges on a survivor
 *  and adopts its terminals, under the SAME ids. A restart that reaped kaval
 *  too would ask the suite a question nobody has: it would destroy the
 *  terminals and then observe that they were destroyed. Reaping it belongs to
 *  the worker's teardown, not to a scenario (see {@link killServer}).
 *
 *  What survives is therefore of two kinds, and both are honest: what was
 *  WRITTEN (the state dir is the worker's and does not move, so a restart is
 *  the real test of "is this remembered?" rather than of a signal that happened
 *  to stay in a browser tab), and what was never killed (the terminals, adopted
 *  by the new padi).
 *
 *  Refuses when `KOLU_SERVER` is a URL: that mode reuses a server this run
 *  neither owns nor may restart.
 *
 *  `whileDown` runs between the kill and the start, with the state file's path
 *  — the one window in which a scenario can SEED that file, because the
 *  running server is its one writer and would overwrite anything written
 *  under it. That is what lets a scenario put a store this build cannot read
 *  in front of a boot. */
export async function restartKoluServer(
  whileDown?: (stateFile: string) => void,
): Promise<string> {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer || koluServer.startsWith("http")) {
    throw new Error(
      "a scenario asked for a server restart, but KOLU_SERVER is a reused URL this run does not own",
    );
  }
  console.log(`[worker:${workerId}] redeploying the server for a scenario.`);
  await replaceServer(async () => {
    killServer("keep");
    whileDown?.(path.join(koluStateDir, "config.json"));
    // READ-ONLY, because this restart happens INSIDE a scenario: the fresh padi
    // adopts the surviving kaval's terminals (and parks whatever its saved
    // session holds that is not live), and the destructive probe would kill
    // exactly those terminals a second later — which is what a work's member
    // leaving a redeploy really was.
    await startServerChild(koluServer, "read");
  });
  return baseUrl;
}

/** DEPLOY UNDER AN OPEN PAGE, the way a deploy does it: stop ONLY the server
 *  (SIGTERM, as a service manager would), leave padi and kaval running, and
 *  start the OTHER build of the server ({@link ServerBuild}: a different padi
 *  build id) on the SAME port. Nothing here touches padi: what replaces it is
 *  the new server's binder, draining a padi whose build is not its own.
 *
 *  Resolves once the deploy has taken that path, and throws unless it has:
 *  the old padi outlived the old server, the new server logged its binder's
 *  `padi build change on boot`, a NEW padi holds the gate, and kaval is the
 *  process it was. The server listens before its binder has replaced padi, so
 *  "the new server is up" is not yet any of that — it is waited for. */
export async function deployKoluServer(): Promise<void> {
  const koluServer = process.env.KOLU_SERVER;
  if (!koluServer || koluServer.startsWith("http")) {
    throw new Error(
      "a scenario asked for a deploy, but KOLU_SERVER is a reused URL this run does not own",
    );
  }
  const old = serverProcess;
  if (!old) throw new Error("no server child to deploy over");
  const port = Number(new URL(baseUrl).port);
  const logFile = path.join(serverLogDir, `server-w${workerId}.log`);
  const logOffset = fs.statSync(logFile).size;
  const padiBefore = readPadiGatePid();
  const kavalBefore = readKavalGatePid();
  if (padiBefore === undefined || kavalBefore === undefined) {
    throw new Error(
      `nothing to deploy over: padi pid ${padiBefore}, kaval pid ${kavalBefore}`,
    );
  }
  console.log(
    `[worker:${workerId}] deploying: stopping only the server (padi ${padiBefore} and kaval ${kavalBefore} keep running).`,
  );
  await replaceServer(async () => {
    const { promise: exited, resolve: onExit } = Promise.withResolvers<void>();
    old.once("exit", () => onExit());
    old.kill("SIGTERM");
    serverProcess = undefined;
    await exited;
    if (!isPidLive(padiBefore)) {
      throw new Error(
        `padi (pid ${padiBefore}) did not outlive the old server: that is a kill, not a deploy`,
      );
    }
    await startServerChild(
      koluServer,
      "read",
      port,
      runningBuild === "base" ? "next" : "base",
    );
  });
  await pollFor({
    observe: async () => ({
      logged: fs
        .readFileSync(logFile)
        .subarray(logOffset)
        .toString("utf8")
        .includes("padi build change on boot"),
      pid: readPadiGatePid(),
    }),
    isDone: ({ logged, pid }) =>
      logged && pid !== undefined && pid !== padiBefore && isPidLive(pid),
    timeoutMs: 60_000,
    intervalMs: 100,
    onTimeout: (last, ms) =>
      new Error(
        `after ${ms}ms the new server had not replaced padi: \`padi build change on boot\` logged: ${last?.logged}; padi pid ${padiBefore} -> ${last?.pid}`,
      ),
  });
  const kavalAfter = readKavalGatePid();
  if (kavalAfter !== kavalBefore) {
    throw new Error(
      `kaval was replaced by the deploy (pid ${kavalBefore} -> ${kavalAfter}): the terminals did not survive it`,
    );
  }
}
