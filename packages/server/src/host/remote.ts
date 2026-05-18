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
 * Helper deployment (v0 prototype):
 *   The user is responsible for deploying `kolu-helper` to the remote
 *   host. The simplest deployment is:
 *     - rsync `packages/helper` + its node_modules to `~/.kolu-helper/`
 *       on the remote, OR
 *     - on a Nix-based remote, `nix copy --to ssh-ng://<host>` the kolu
 *       derivation and use its helper store path.
 *
 *   The kolu controller invokes the remote helper via the command in
 *   `$KOLU_HELPER_REMOTE_CMD`, falling back to `kolu-helper --serve`
 *   (assumes the binary is on the remote PATH). Set the env var to
 *   something like `tsx /home/srid/.kolu-helper/src/index.ts --serve`
 *   if you're running the helper from source over tsx.
 *
 *   Auto-deploy via `nix copy` on first connect is on the v1 list —
 *   the talk-mode design called for it, but for the prototype the
 *   manual one-time deploy keeps the change focused on the architecture
 *   (Host abstraction + helper RPC) rather than packaging.
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
import {
  type HelperDataEvent,
  type HelperExitEvent,
  HelperEventSchema,
  HelperResponseSchema,
} from "kolu-common/helper-protocol";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import type { Logger } from "../log.ts";
import type { PtyHandle } from "../pty.ts";
import { getScreenText } from "../pty.ts";
import { cleanEnv } from "../shell.ts";
import type { Host, SpawnPtyOpts } from "./types.ts";

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

interface PendingRequest {
  resolve(result: unknown): void;
  reject(err: Error): void;
}

interface RemoteHostOpts {
  alias: string;
  /** Full shell command to launch the helper on the remote — e.g.
   *  `tsx /home/srid/.kolu-helper/src/index.ts --serve`. Defaults to
   *  `kolu-helper --serve` (PATH lookup on the remote). */
  helperRemoteCmd?: string;
}

/** Convert headless xterm OSC events on the data stream into the same
 *  callbacks the LocalHost emits. Mirrors the parser block in
 *  `pty.ts:124-198` so consumers can't tell local from remote. */
function attachOscParser(
  headless: import("@xterm/headless").Terminal,
  initialCwd: string,
  opts: {
    onCwd?(cwd: string): void;
    onTitleChange?(title: string): void;
    onCommandRun?(command: string): void;
    log: Logger;
  },
): { currentCwd: () => string; disposers: Array<{ dispose(): void }> } {
  let cwd = initialCwd;
  const oscCwd = headless.parser.registerOscHandler(7, (data: string) => {
    try {
      const url = new URL(data);
      if (url.protocol === "file:") {
        cwd = decodeURIComponent(url.pathname);
        opts.onCwd?.(cwd);
      }
    } catch {
      // ignore malformed OSC 7
    }
    return true;
  });
  const titleDisp = headless.onTitleChange((title: string) => {
    opts.onTitleChange?.(title);
  });
  const oscCmd = headless.parser.registerOscHandler(633, (data: string) => {
    if (!data.startsWith("E;")) return false;
    opts.onCommandRun?.(data.slice(2));
    return true;
  });
  return {
    currentCwd: () => cwd,
    disposers: [oscCwd, titleDisp, oscCmd],
  };
}

export function createRemoteHost(opts: RemoteHostOpts): Host {
  const { alias, helperRemoteCmd } = opts;

  let child: ChildProcessWithoutNullStreams | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  /** Per-pty event listeners — registered by spawnPty, fired by the
   *  stdin parser when an event for that ptyId arrives. */
  const dataListeners = new Map<string, (e: HelperDataEvent) => void>();
  const exitListeners = new Map<string, (e: HelperExitEvent) => void>();
  let stdinBuffer = "";
  let connectPromise: Promise<void> | null = null;

  function dispatchFrame(line: string, log: Logger): void {
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
    if (event.method === "ready") return; // handled by connect()
    if (event.method === "data") {
      dataListeners.get(event.params.ptyId)?.(event);
    } else if (event.method === "exit") {
      exitListeners.get(event.params.ptyId)?.(event);
    }
  }

  function sendRequest<T>(
    method: string,
    params: unknown,
    log: Logger,
  ): Promise<T> {
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

  async function connect(log: Logger): Promise<void> {
    if (child) return;

    const remoteCmd = helperRemoteCmd ?? "kolu-helper --serve";
    log.info({ alias, remoteCmd }, "spawning ssh helper");
    const ssh = spawn("ssh", [alias, remoteCmd], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = ssh;

    ssh.stdout.setEncoding("utf8");
    ssh.stdout.on("data", (chunk: string) => {
      stdinBuffer += chunk;
      let nl = stdinBuffer.indexOf("\n");
      while (nl !== -1) {
        const line = stdinBuffer.slice(0, nl);
        stdinBuffer = stdinBuffer.slice(nl + 1);
        dispatchFrame(line, log);
        nl = stdinBuffer.indexOf("\n");
      }
    });

    ssh.stderr.setEncoding("utf8");
    ssh.stderr.on("data", (chunk: string) => {
      log.warn({ stderr: chunk.trimEnd() }, "ssh helper stderr");
    });

    ssh.on("exit", (code, signal) => {
      log.info({ code, signal }, "ssh helper exited");
      child = null;
      // Reject any in-flight requests so callers don't hang forever.
      for (const p of pending.values()) {
        p.reject(new Error(`ssh helper for ${alias} exited`));
      }
      pending.clear();
      // Synthesize exit events for every PTY so consumers tear down.
      for (const [ptyId, listener] of exitListeners.entries()) {
        listener({
          method: "exit",
          params: { ptyId, seq: Number.MAX_SAFE_INTEGER, exitCode: -1 },
        });
      }
      dataListeners.clear();
      exitListeners.clear();
    });

    // Wait for the `ready` event (or stderr / exit) before resolving.
    await new Promise<void>((resolve, reject) => {
      const readyTimeout = setTimeout(() => {
        reject(new Error(`ssh helper for ${alias} did not signal ready`));
      }, 15_000);
      const readyHandler = (chunk: string) => {
        if (chunk.includes('"method":"ready"')) {
          clearTimeout(readyTimeout);
          ssh.stdout.off("data", readyHandler);
          resolve();
        }
      };
      ssh.stdout.on("data", readyHandler);
      ssh.on("exit", (code) => {
        clearTimeout(readyTimeout);
        reject(
          new Error(`ssh helper for ${alias} exited (${code}) before ready`),
        );
      });
    });
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
    tlog: Logger,
    spOpts: SpawnPtyOpts,
  ): Promise<PtyHandle> {
    await ensureConnected(tlog);

    // Remote shell: we don't run the wrapper-rc dance (the talk-mode
    // plan ships v0 with bash-only and no kolu OSC injection on remote).
    // Let SSH's invocation of the remote shell handle its own dotfiles.
    // OSC 7 will not fire from the remote shell, so `currentCwd` stays
    // at the initial cwd we asked for. Remote agent detection is
    // deferred to a follow-up that wires the wrapper rc through the
    // helper (see plan; `prepareShellInit` in shell.ts is the local
    // equivalent).
    const remoteEnv = {
      PATH:
        cleanEnv().PATH ??
        "/run/current-system/sw/bin:/usr/bin:/bin:/usr/local/bin",
      TERM: "xterm-256color",
    };
    const result = await sendRequest<{ ptyId: string; pid: number }>(
      "spawnPty",
      {
        shell: "/bin/bash",
        args: ["--login"],
        cwd: spOpts.cwd ?? "/",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        env: remoteEnv,
      },
      tlog,
    );
    const { ptyId, pid } = result;
    tlog.info({ ptyId, pid, alias }, "remote pty spawned");

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
      log: tlog,
    });

    // Foreground PID / process polling. Cached values feed the
    // synchronous getters on PtyHandle.
    let cachedForegroundPid: number | undefined;
    let cachedProcess = "";
    const pollTimer = setInterval(() => {
      sendRequest<{ pid?: number }>("foregroundPid", { ptyId }, tlog)
        .then((r) => {
          cachedForegroundPid = r.pid;
        })
        .catch(() => {
          // Helper gone or PTY missing — leave cached value.
        });
      sendRequest<{ name?: string }>("processName", { ptyId }, tlog)
        .then((r) => {
          cachedProcess = r.name ?? "";
        })
        .catch(() => {});
    }, FOREGROUND_POLL_MS);

    // Track per-PTY high-water-mark sequence on every event we receive
    // so a future reconnect-replay path can pass `sinceSeq` to the
    // helper's `attach`. v0 does not wire the reconnect yet (SSH drop
    // tears the helper down with it — see the file comment).
    dataListeners.set(ptyId, (event) => {
      headless.write(event.params.data);
      spOpts.onData(event.params.data);
    });
    exitListeners.set(ptyId, (event) => {
      cleanup();
      spOpts.onExit(event.params.exitCode);
    });

    let disposed = false;
    function cleanup(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(pollTimer);
      for (const d of parser.disposers) d.dispose();
      dataListeners.delete(ptyId);
      exitListeners.delete(ptyId);
      headless.dispose();
    }

    return {
      pid,
      get cwd() {
        return parser.currentCwd();
      },
      get process() {
        return cachedProcess;
      },
      get foregroundPid() {
        return cachedForegroundPid;
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
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child = null;
  }

  return {
    id: alias,
    label: alias,
    kind: "remote-ssh",
    spawnPty,
    shutdown,
  };
}
