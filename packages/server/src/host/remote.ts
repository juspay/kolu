/**
 * `RemoteHost` — a `Host` that proxies PTY ops to a `kolu-helper` running
 * on another machine over SSH.
 *
 * Architecture:
 *   - One child `ssh <alias> <helperPath> --serve` per host. Lazy: not
 *     spawned until the first `spawnPty` call.
 *   - Newline-delimited JSON over the SSH stdio carries requests and
 *     events (`packages/common/src/helper-protocol.ts`).
 *   - Returned `PtyHandle`s satisfy the existing in-process interface,
 *     so the rest of the server is unchanged. The OSC 7 / OSC 2 / OSC 633
 *     parsing lives kolu-side: the helper streams raw PTY bytes, kolu
 *     pipes them into a local headless xterm to extract cwd/title/cmd.
 *
 * Helper deployment is automatic via Nix:
 *
 *   ssh <alias> bash -lc 'nix run github:juspay/kolu/<branch>#kolu-helper -- --serve'
 *
 *   The remote evaluates the flake for its own platform, substitutes
 *   from `cache.nixos.asia/oss` if available, or builds locally — first
 *   connect is slow, subsequent ones are cached. No rsync, no scp, no
 *   PATH twiddling. Override the default with `KOLU_HELPER_REMOTE_CMD`
 *   if the remote runs the helper a different way (custom build, Docker,
 *   non-Nix host, …).
 *
 *   `bash -lc` is load-bearing — a non-interactive SSH session doesn't
 *   source the user's profile by default, so `nix` typically isn't on
 *   PATH without it.
 *
 * v0 limitations (documented in the talk-mode plan; tracked for follow-up):
 *   - When the SSH child exits the helper exits and its PTYs die. v1
 *     will detach the helper (Unix socket + nohup) so PTYs survive
 *     SSH drops; the helper-protocol sequence numbers and `attach` RPC
 *     are already in place for the reconnect-replay path.
 *   - foregroundPid / process are exposed via a cached value updated by
 *     a background poll, so the synchronous getters on the PtyHandle
 *     interface keep working. The proper fix (decompose into an async
 *     ForegroundPidSource per Hickey/Lowy review notes) is a follow-up.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import {
  type HelperDataEvent,
  type HelperExitEvent,
  HelperEventSchema,
  HelperResponseSchema,
} from "kolu-common/helper-protocol";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import type { Logger } from "../log.ts";
import { attachOscParser } from "../osc-parser.ts";
import type { PtyHandle } from "../pty.ts";
import { getScreenText } from "../pty.ts";
import { buildRemoteBashRc } from "../shell.ts";
import { log as rootLog } from "../log.ts";
import type { ExecOpts, ExecResult, Host, SpawnPtyOpts } from "./types.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** Background poll cadence for foregroundPid / processName. The local
 *  case reads these via a kernel syscall on demand; the remote case
 *  can't make that synchronous, so we cache the last value from a
 *  periodic helper RPC. 250ms balances "feels live" against helper RPC
 *  cost — agent detection's title-event reconcile is the main consumer
 *  and it can tolerate a quarter-second staleness easily. */
const FOREGROUND_POLL_MS = 250;

/** Spawn a periodic poll loop that keeps `foregroundPid` and `process`
 *  fresh for the remote PTY. Returned `stop` clears the timer.
 *
 *  Lives outside `spawnPty` so the closure inside `spawnPty` doesn't
 *  braid three things into one factory call: the lifecycle of the PTY
 *  itself, the OSC parser, AND the background poller. Local separation
 *  per Hickey C1 — the broader fix (an async `ForegroundPidSource` that
 *  removes the synchronous-getter complect from `PtyHandle` itself)
 *  remains the deferred follow-up the file header calls out. */
interface ForegroundPoller {
  foregroundPid(): number | undefined;
  processName(): string;
  stop(): void;
}

function createForegroundPoller(
  ptyId: string,
  sendRequest: <T>(method: string, params: unknown, log: Logger) => Promise<T>,
  tlog: Logger,
): ForegroundPoller {
  let cachedForegroundPid: number | undefined;
  let cachedProcess = "";
  const timer = setInterval(() => {
    sendRequest<{ pid?: number }>("foregroundPid", { ptyId }, tlog)
      .then((r) => {
        cachedForegroundPid = r.pid;
      })
      .catch(() => {
        // Helper gone or PTY missing — leave the cached value alone.
      });
    sendRequest<{ name?: string }>("processName", { ptyId }, tlog)
      .then((r) => {
        cachedProcess = r.name ?? "";
      })
      .catch(() => {});
  }, FOREGROUND_POLL_MS);
  return {
    foregroundPid: () => cachedForegroundPid,
    processName: () => cachedProcess,
    stop: () => clearInterval(timer),
  };
}

interface PendingRequest {
  resolve(result: unknown): void;
  reject(err: Error): void;
}

/** Branch the auto-deploy command targets. Once the prototype merges,
 *  switch to `github:juspay/kolu#kolu-helper` so existing clones don't
 *  have to track a feature branch by name. */
const DEFAULT_HELPER_FLAKE_REF =
  "github:juspay/kolu/feat/remote-terminal-prototype#kolu-helper";

/** Default invocation kolu runs over SSH when the user hasn't set
 *  `KOLU_HELPER_REMOTE_CMD`. `bash -lc` makes the remote shell source
 *  the user's profile so `nix` lands on PATH for a non-interactive
 *  session. `--refresh` skips Nix's flake eval cache so the helper
 *  picks up new commits to the branch without an hour-long lag. */
const DEFAULT_HELPER_REMOTE_CMD = `bash -lc 'nix --extra-experimental-features "nix-command flakes" run --refresh ${DEFAULT_HELPER_FLAKE_REF} -- --serve'`;

interface RemoteHostOpts {
  alias: string;
  /** Full shell command to launch the helper on the remote. Defaults to
   *  `nix run github:juspay/kolu/<branch>#kolu-helper -- --serve` under
   *  `bash -lc` — works out of the box on any remote with Nix. Override
   *  for non-Nix remotes or custom deployment shapes. */
  helperRemoteCmd?: string;
}

export function createRemoteHost(opts: RemoteHostOpts): Host {
  const { alias, helperRemoteCmd } = opts;

  let child: ChildProcessWithoutNullStreams | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  /** Per-pty event listener pair + last-seen sequence number.
   *  `lastSeq` is what we pass as `sinceSeq` to `attach` on reconnect
   *  so the helper can replay only the events we missed. */
  interface PtyReg {
    onData(e: HelperDataEvent): void;
    onExit(e: HelperExitEvent): void;
    lastSeq: number;
  }
  const ptys = new Map<string, PtyReg>();
  let connectPromise: Promise<void> | null = null;
  /** Resolver for the in-flight `connect()` waiting on the helper's
   *  `ready` event. Set by `connect`, cleared by `dispatchFrame` on
   *  the first ready event. */
  let readyResolve: ((version: string) => void) | null = null;
  /** True once the user has explicitly disposed the host (or every
   *  PTY has been disposed). Reconnect attempts stop. */
  let shuttingDown = false;
  /** Backoff timer for the next reconnect attempt. */
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function dispatchFrame(line: string, baseLog: Logger): void {
    const log = baseLog.child({ host: alias });
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      log.warn({ err, line }, "helper sent unparseable frame");
      return;
    }
    // Try response shape first (presence of `id` + `result`/`error`).
    const asResponse = HelperResponseSchema.safeParse(parsed);
    if (
      asResponse.success &&
      (asResponse.data.result !== undefined || asResponse.data.error)
    ) {
      const p = pending.get(asResponse.data.id);
      if (!p) return;
      pending.delete(asResponse.data.id);
      if (asResponse.data.error) {
        p.reject(
          new Error(
            `helper error (${asResponse.data.error.kind}): ${asResponse.data.error.message}`,
          ),
        );
      } else {
        p.resolve(asResponse.data.result);
      }
      return;
    }
    // Otherwise treat as event.
    const asEvent = HelperEventSchema.safeParse(parsed);
    if (!asEvent.success) {
      log.debug({ line }, "helper sent unrecognized frame");
      return;
    }
    const event = asEvent.data;
    if (event.method === "ready") {
      // Fire the connect()-side resolver. Doing it through the
      // line-framing layer (not a substring match on raw chunks)
      // handles ready frames that get split across two stdout `data`
      // events.
      readyResolve?.(event.params.version);
      readyResolve = null;
      return;
    }
    if (event.method === "data") {
      const reg = ptys.get(event.params.ptyId);
      if (reg) {
        reg.lastSeq = event.params.seq;
        reg.onData(event);
      }
    } else if (event.method === "exit") {
      const reg = ptys.get(event.params.ptyId);
      if (reg) {
        reg.lastSeq = event.params.seq;
        reg.onExit(event);
      }
    }
  }

  function sendRequest<T>(
    method: string,
    params: unknown,
    baseLog: Logger,
  ): Promise<T> {
    const log = baseLog.child({ host: alias });
    if (!child) {
      return Promise.reject(new Error(`remote host ${alias}: not connected`));
    }
    const id = nextRequestId++;
    const promise = new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (r: unknown) => void,
        reject,
      });
    });
    const line = `${JSON.stringify({ id, method, params })}\n`;
    try {
      child.stdin.write(line);
    } catch (err) {
      pending.delete(id);
      log.error({ err, method }, "failed to write helper request");
      return Promise.reject(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    return promise;
  }

  async function connect(baseLog: Logger): Promise<void> {
    if (child) return;
    const log = baseLog.child({ host: alias });

    const remoteCmd = helperRemoteCmd ?? DEFAULT_HELPER_REMOTE_CMD;
    log.info({ remoteCmd }, "spawning ssh helper");
    const ssh = spawn("ssh", [alias, remoteCmd], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = ssh;

    // readline handles NDJSON framing: splits on '\n', buffers partial
    // chunks, and closes naturally when the SSH process exits.
    const rl = createInterface({ input: ssh.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => dispatchFrame(line, log));

    // Accumulate stderr so a failed-to-start helper surfaces its
    // real reason in the rejection message — without this, all the
    // caller sees is "exited (127) before ready" with no idea WHY.
    let stderrBuffer = "";
    ssh.stderr.setEncoding("utf8");
    ssh.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      log.warn({ stderr: chunk.trimEnd() }, "ssh helper stderr");
    });

    ssh.on("exit", (code, signal) => {
      log.info({ code, signal }, "ssh helper exited");
      child = null;
      connectPromise = null;
      // Reject in-flight requests so the controller can give up; the
      // PTY listeners stay registered so when the relay reconnects to
      // the daemon and we `attach(sinceSeq)`, replayed events still
      // reach the right xterm.
      for (const p of pending.values()) {
        p.reject(new Error(`ssh helper for ${alias} disconnected`));
      }
      pending.clear();

      // If there are no live PTYs nothing's worth reconnecting for —
      // skip the auto-reconnect entirely so a host with no terminals
      // doesn't spam ssh attempts forever.
      if (shuttingDown || ptys.size === 0) {
        for (const reg of ptys.values()) {
          reg.onExit({
            method: "exit",
            params: { ptyId: "", seq: Number.MAX_SAFE_INTEGER, exitCode: -1 },
          });
        }
        ptys.clear();
        return;
      }

      // Reconnect with a short backoff so a flapping ssh doesn't spin
      // on the CPU. The daemon on the remote outlives the SSH session
      // (its parent is detached + setsid'd), so reconnect lands back
      // in the SAME process holding the SAME PTYs.
      log.info({ pendingPtys: ptys.size }, "scheduling helper reconnect");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (shuttingDown) return;
        void ensureConnected(log).catch((err) => {
          log.warn({ err }, "reconnect attempt failed; will retry");
        });
      }, 1_000);
    });

    // Wait for the `ready` event (or stderr / exit) before resolving.
    // The resolver is fired from `dispatchFrame` once it parses a
    // `ready` frame — going through the line-framing layer (not a
    // substring match on the raw chunk) is what handles ready frames
    // split across two stdout `data` events.
    const helperVersion = await new Promise<string>((resolve, reject) => {
      // 120s — covers the first `nix run --refresh` against a cold
      // remote (flake evaluation + closure substitute + node-pty
      // native-binding fetch). Subsequent connects from a warm store
      // resolve in well under a second.
      const readyTimeout = setTimeout(() => {
        readyResolve = null;
        reject(new Error(`ssh helper for ${alias} did not signal ready`));
      }, 120_000);
      readyResolve = (version: string) => {
        clearTimeout(readyTimeout);
        resolve(version);
      };
      ssh.on("exit", (code) => {
        clearTimeout(readyTimeout);
        readyResolve = null;
        // Build a useful error: include the stderr tail (most failures
        // land there) and a hint for the common exit-127 case where
        // the remote shell can't find `nix` or `bash`.
        const stderrTail = stderrBuffer.trim().split("\n").slice(-5).join("\n");
        const hint =
          code === 127
            ? ` — exit 127 means the remote shell couldn't run the helper command. The default invocation requires \`nix\` on the remote's PATH (try logging in as ${alias} and running \`nix --version\`). Override with KOLU_HELPER_REMOTE_CMD if your remote uses a different deployment.`
            : "";
        const stderrPart = stderrTail ? `\nstderr:\n${stderrTail}` : "";
        reject(
          new Error(
            `ssh helper for ${alias} exited (${code}) before ready${hint}${stderrPart}`,
          ),
        );
      });
    });
    log.info({ helperVersion }, "helper ready");

    // Reconnect catch-up: for every PTY we already knew about, ask the
    // daemon to replay anything we missed since `lastSeq`. The daemon's
    // per-PTY ring buffer streams those events back through
    // `dispatchFrame` exactly the same way new output does, so the
    // xterm pumping from `onData` lands the missed bytes contiguously
    // with whatever was on screen before SSH dropped.
    if (ptys.size > 0) {
      log.info({ count: ptys.size }, "re-attaching PTYs after reconnect");
      for (const [ptyId, reg] of ptys.entries()) {
        sendRequest("attach", { ptyId, sinceSeq: reg.lastSeq }, log).catch(
          (err) => log.warn({ err, ptyId }, "attach after reconnect failed"),
        );
      }
    }
  }

  async function ensureConnected(log: Logger): Promise<void> {
    if (!connectPromise) connectPromise = connect(log);
    try {
      await connectPromise;
    } catch (err) {
      connectPromise = null;
      throw err;
    }
  }

  async function spawnPty(
    baseTlog: Logger,
    spOpts: SpawnPtyOpts,
  ): Promise<PtyHandle> {
    const tlog = baseTlog.child({ host: alias });
    await ensureConnected(tlog);

    // Remote shell: we don't run the wrapper-rc dance (the talk-mode
    // plan ships v0 with bash-only and no kolu OSC injection on remote).
    // The helper merges this overlay on top of its own process.env, so
    // the remote shell inherits the SSH user's normal PATH/HOME/USER
    // from their login shell. Sending kolu's LOCAL env (e.g. PATH full
    // of `/nix/store/...` paths) would brick the remote bash — it had
    // no working binaries on its PATH and exited immediately. Keep
    // this overlay minimal; the helper supplies the rest.
    const remoteEnvOverlay = {
      TERM: "xterm-256color",
    };
    // Force bash on remote and inject our OSC-7/2/633 wrapper rc. With
    // `--rcfile`, bash is non-login and reads the kolu rc instead of
    // `~/.bashrc`; the rc replays `$HOME/.bash_profile` / .bashrc and
    // adds OSC hooks so cwd/title/preexec land in kolu's metadata.
    // Bash is resolved via PATH on the remote (helper's process.env);
    // NixOS users get `/run/current-system/sw/bin/bash` automatically.
    const rcContent = buildRemoteBashRc();
    const result = await sendRequest<{ ptyId: string; pid: number }>(
      "spawnPty",
      {
        shell: "bash",
        args: [],
        cwd: spOpts.cwd ?? "",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        env: remoteEnvOverlay,
        rcContent,
      },
      tlog,
    );
    const { ptyId, pid } = result;
    tlog.info({ ptyId, pid }, "remote pty spawned");

    // Kolu-side OSC parser. Mirrors `pty.ts:124-198`.
    const headless = new Terminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      scrollback: 10_000,
      allowProposedApi: true,
    });
    const serializeAddon = new SerializeAddon();
    headless.loadAddon(serializeAddon);
    const parser = attachOscParser(headless, spOpts.cwd ?? "/", {
      onCwd: spOpts.onCwd,
      onTitleChange: spOpts.onTitleChange,
      onCommandRun: spOpts.onCommandRun,
      onDebug: (payload, message) => tlog.debug(payload, message),
    });

    const foregroundPoller = createForegroundPoller(ptyId, sendRequest, tlog);

    // Register the per-PTY listeners + initial sequence. `dispatchFrame`
    // bumps `lastSeq` on every event so a future SSH reconnect can pass
    // it as `sinceSeq` to `attach` and replay missed output transparently.
    ptys.set(ptyId, {
      lastSeq: 0,
      onData: (event) => {
        headless.write(event.params.data);
        spOpts.onData(event.params.data);
      },
      onExit: (event) => {
        cleanup();
        spOpts.onExit(event.params.exitCode);
      },
    });

    let disposed = false;
    function cleanup(): void {
      if (disposed) return;
      disposed = true;
      foregroundPoller.stop();
      parser.dispose();
      ptys.delete(ptyId);
      headless.dispose();
    }

    return {
      pid,
      get cwd() {
        return parser.currentCwd();
      },
      get process() {
        return foregroundPoller.processName();
      },
      get foregroundPid() {
        return foregroundPoller.foregroundPid();
      },
      write(data: string) {
        // Fire-and-forget — write errors land in the helper log via
        // the rejected promise's catch.
        sendRequest("write", { ptyId, data }, tlog).catch(() => {});
      },
      resize(cols: number, rows: number) {
        headless.resize(cols, rows);
        sendRequest("resize", { ptyId, cols, rows }, tlog).catch(() => {});
      },
      getScreenState: () => serializeAddon.serialize(),
      getScreenText: (startLine?: number, endLine?: number) =>
        getScreenText(headless.buffer.active, startLine, endLine),
      dispose() {
        if (disposed) return;
        sendRequest("dispose", { ptyId }, tlog).catch(() => {});
        cleanup();
      },
    };
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child = null;
  }

  /** Run a command on the remote host via the helper. Used by metadata
   *  providers (kolu-git) that historically shelled out to `git` locally.
   *  Connects the helper lazily if not already up — first call triggers
   *  the same `nix run` deploy path as `spawnPty`. */
  async function exec(
    cmd: string,
    args: string[],
    opts: ExecOpts,
  ): Promise<ExecResult> {
    const log = rootLog.child({ host: alias });
    await ensureConnected(log);
    return sendRequest<ExecResult>(
      "exec",
      {
        cmd,
        args,
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs,
        maxBytes: opts.maxBytes,
      },
      log,
    );
  }

  return {
    id: alias,
    label: alias,
    kind: "remote-ssh",
    spawnPty,
    exec,
    shutdown,
  };
}
