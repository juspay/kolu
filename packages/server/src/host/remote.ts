import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  type HelperDataEvent,
  HelperEventSchema,
  type HelperExitEvent,
  type HelperRpcMethod,
  HelperResponseSchema,
  HelperSpawnPtyResultSchema,
} from "kolu-common/helper-protocol";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import type { HostSummary } from "kolu-common/contract";
import type { z } from "zod";
import type { Logger } from "../log.ts";
import { createPtyScreen, type PtyHandle, type PtyScreen } from "../pty.ts";
import type { Host } from "./types.ts";

const HELPER_READY_TIMEOUT_MS = 120_000;
const DEFAULT_HELPER_REMOTE_CMD = `bash -lc 'nix --extra-experimental-features "nix-command flakes" run --refresh github:juspay/kolu#kolu-helper -- --serve'`;

interface PendingRequest {
  resolve(result: unknown): void;
  reject(err: Error): void;
}

interface RemoteHostOpts {
  summary: HostSummary;
  helperRemoteCmd?: string;
}

export function createRemoteHost(opts: RemoteHostOpts): Host {
  const { summary } = opts;
  const helperRemoteCmd = opts.helperRemoteCmd ?? DEFAULT_HELPER_REMOTE_CMD;
  let child: ChildProcessWithoutNullStreams | null = null;
  let connectPromise: Promise<void> | null = null;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  const ptys = new Map<
    string,
    {
      onData(event: HelperDataEvent): void;
      onExit(event: HelperExitEvent): void;
    }
  >();

  function rejectAll(err: Error): void {
    for (const req of pending.values()) req.reject(err);
    pending.clear();
    readyReject?.(err);
    readyReject = null;
    readyResolve = null;
  }

  function dispatchFrame(line: string, tlog: Logger): void {
    if (line.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      tlog.warn({ err, host: summary.id, line }, "helper sent invalid JSON");
      return;
    }

    const response = HelperResponseSchema.safeParse(parsed);
    if (
      response.success &&
      (response.data.result !== undefined || response.data.error)
    ) {
      const req = pending.get(response.data.id);
      if (!req) return;
      pending.delete(response.data.id);
      if (response.data.error) {
        req.reject(
          new Error(
            `helper ${response.data.error.kind}: ${response.data.error.message}`,
          ),
        );
      } else {
        req.resolve(response.data.result);
      }
      return;
    }

    const event = HelperEventSchema.safeParse(parsed);
    if (!event.success) {
      tlog.warn({ host: summary.id, line }, "helper sent unknown frame");
      return;
    }

    if (event.data.method === "ready") {
      tlog.info(
        { host: summary.id, version: event.data.params.version },
        "remote helper ready",
      );
      readyResolve?.();
      readyResolve = null;
      readyReject = null;
      return;
    }

    if (event.data.method === "data") {
      ptys.get(event.data.params.ptyId)?.onData(event.data);
      return;
    }

    ptys.get(event.data.params.ptyId)?.onExit(event.data);
  }

  function ensureConnected(tlog: Logger): Promise<void> {
    if (child) return Promise.resolve();
    if (connectPromise !== null) return connectPromise;

    connectPromise = new Promise<void>((resolve, reject) => {
      const ssh = spawn("ssh", ["-T", summary.id, helperRemoteCmd], {
        stdio: "pipe",
      });
      child = ssh;
      readyResolve = resolve;
      readyReject = reject;

      const readyTimer = setTimeout(() => {
        reject(
          new Error(`remote helper on ${summary.id} did not become ready`),
        );
        ssh.kill();
      }, HELPER_READY_TIMEOUT_MS);
      readyResolve = () => {
        clearTimeout(readyTimer);
        resolve();
      };

      createInterface({ input: ssh.stdout }).on("line", (line) =>
        dispatchFrame(line, tlog),
      );
      ssh.stderr.on("data", (data: Buffer) => {
        tlog.debug({ host: summary.id, stderr: data.toString() }, "ssh stderr");
      });
      ssh.on("exit", (code, signal) => {
        clearTimeout(readyTimer);
        child = null;
        connectPromise = null;
        const err = new Error(
          `ssh helper for ${summary.id} exited (${signal ?? code ?? "unknown"})`,
        );
        rejectAll(err);
        for (const [ptyId, reg] of [...ptys]) {
          ptys.delete(ptyId);
          reg.onExit({
            method: "exit",
            params: { ptyId, exitCode: typeof code === "number" ? code : 255 },
          });
        }
      });
    }).finally(() => {
      if (child) connectPromise = null;
    });

    return connectPromise;
  }

  async function sendRequest<T>(
    method: HelperRpcMethod,
    params: unknown,
    tlog: Logger,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    await ensureConnected(tlog);
    if (!child) throw new Error(`remote host ${summary.id}: not connected`);
    const id = nextRequestId++;
    const promise = new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (result) => {
          if (!schema) {
            resolve(result as T);
            return;
          }
          const parsed = schema.safeParse(result);
          if (parsed.success) resolve(parsed.data);
          else reject(new Error(`invalid helper response for ${method}`));
        },
        reject,
      });
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return promise;
  }

  function maybeShutdown(): void {
    if (ptys.size > 0) return;
    child?.kill();
    child = null;
  }

  return {
    summary,
    async spawnPty(tlog, terminalId, opts, cwd): Promise<PtyHandle> {
      const result = await sendRequest(
        "spawnPty",
        {
          terminalId,
          cwd,
          cols: DEFAULT_COLS,
          rows: DEFAULT_ROWS,
        },
        tlog,
        HelperSpawnPtyResultSchema,
      );

      const ptyId = result.ptyId;
      let currentCwd = result.cwd;
      let currentProcess = result.process ?? "";
      let currentForegroundPid = result.foregroundPid;
      let disposed = false;
      let screen: PtyScreen | null = null;

      function writeRemote(data: string): void {
        void sendRequest("write", { ptyId, data }, tlog).catch((err) =>
          tlog.warn({ err, host: summary.id }, "remote pty write failed"),
        );
      }

      screen = createPtyScreen(
        tlog,
        {
          ...opts,
          onCwd: (newCwd) => {
            currentCwd = newCwd;
            opts.onCwd?.(newCwd);
          },
        },
        writeRemote,
      );

      ptys.set(ptyId, {
        onData: (event) => {
          currentProcess = event.params.process ?? currentProcess;
          currentForegroundPid =
            event.params.foregroundPid ?? currentForegroundPid;
          screen?.writeOutput(event.params.data);
        },
        onExit: (event) => {
          if (disposed) return;
          disposed = true;
          ptys.delete(ptyId);
          screen?.dispose();
          opts.onExit(event.params.exitCode);
          maybeShutdown();
        },
      });

      return {
        pid: result.pid,
        get cwd() {
          return currentCwd;
        },
        get process() {
          return currentProcess;
        },
        get foregroundPid() {
          return currentForegroundPid;
        },
        write: writeRemote,
        resize: (cols, rows) => {
          screen?.resize(cols, rows);
          void sendRequest("resize", { ptyId, cols, rows }, tlog).catch((err) =>
            tlog.warn({ err, host: summary.id }, "remote pty resize failed"),
          );
        },
        getScreenState: () => screen?.getScreenState() ?? "",
        getScreenText: (startLine?: number, endLine?: number) =>
          screen?.getScreenText(startLine, endLine) ?? "",
        dispose() {
          if (disposed) return;
          disposed = true;
          ptys.delete(ptyId);
          screen?.dispose();
          void sendRequest("dispose", { ptyId }, tlog).catch(() => {});
          maybeShutdown();
        },
      };
    },
    shutdown() {
      child?.kill();
      child = null;
      ptys.clear();
      rejectAll(new Error(`remote host ${summary.id} shut down`));
    },
  };
}
