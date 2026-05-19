#!/usr/bin/env node
/**
 * SSH-side helper for remote Kolu terminals.
 *
 * The helper speaks newline-delimited JSON on stdio. It owns node-pty on the
 * SSH host; the controller owns screen serialization and metadata parsing.
 */

import { createInterface } from "node:readline";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import {
  HELPER_PROTOCOL_VERSION,
  type HelperErrorShape,
  type HelperEvent,
  HelperRequestSchema,
  type HelperSpawnPtyParams,
  type HelperSpawnPtyResult,
} from "kolu-common/helper-protocol";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import { koluIdentityEnv, prepareShellInit } from "kolu-shared/shell";
import * as pty from "node-pty";
import { match } from "ts-pattern";
import pkg from "../package.json" with { type: "json" };

interface PtyEntry {
  proc: pty.IPty;
  cleanup: () => void;
  pausedForBackpressure: boolean;
}

const ptys = new Map<string, PtyEntry>();
const shellInitDir = join(homedir(), ".kolu-helper", "shell");

function status(proc: pty.IPty): {
  process?: string;
  foregroundPid?: number;
} {
  const foregroundPid = (proc as unknown as { foregroundPid?: number })
    .foregroundPid;
  return {
    process: proc.process || undefined,
    foregroundPid:
      foregroundPid && foregroundPid > 0 ? foregroundPid : undefined,
  };
}

function writeFrame(frame: unknown): boolean {
  return process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function writeError(id: number, error: HelperErrorShape): void {
  writeFrame({ id, error });
}

function writeEvent(event: HelperEvent): void {
  writeFrame(event);
}

function writePtyData(ptyId: string, proc: pty.IPty, data: string): void {
  const entry = ptys.get(ptyId);
  if (!entry) return;
  const accepted = writeFrame({
    method: "data",
    params: { ptyId, data, ...status(proc) },
  } satisfies HelperEvent);
  if (accepted || entry.pausedForBackpressure) return;

  entry.pausedForBackpressure = true;
  proc.pause();
  process.stdout.once("drain", () => {
    const latest = ptys.get(ptyId);
    if (!latest) return;
    latest.pausedForBackpressure = false;
    latest.proc.resume();
  });
}

function removePty(ptyId: string, kill: boolean): void {
  const entry = ptys.get(ptyId);
  if (!entry) return;
  ptys.delete(ptyId);
  entry.cleanup();
  if (kill) entry.proc.kill();
}

function cleanupAll(): void {
  for (const ptyId of [...ptys.keys()]) removePty(ptyId, true);
}

function spawnPty(input: HelperSpawnPtyParams): HelperSpawnPtyResult {
  const env = { ...(process.env as Record<string, string>) };
  env.SHELL ??= userInfo().shell || "/bin/sh";
  env.HOME ??= homedir();
  Object.assign(env, koluIdentityEnv(pkg.version));

  const shell = env.SHELL;
  const cwd = input.cwd ?? env.HOME ?? "/";
  const init = prepareShellInit({
    shell,
    home: env.HOME,
    terminalId: input.terminalId,
    shellInitDir,
  });
  Object.assign(env, init.env);

  const proc = pty.spawn(shell, init.args, {
    name: "xterm-256color",
    cols: input.cols || DEFAULT_COLS,
    rows: input.rows || DEFAULT_ROWS,
    cwd,
    env,
  });
  const ptyId = input.terminalId;
  ptys.set(ptyId, {
    proc,
    cleanup: init.cleanup,
    pausedForBackpressure: false,
  });

  proc.onData((data) => {
    writePtyData(ptyId, proc, data);
  });
  proc.onExit(({ exitCode }) => {
    removePty(ptyId, false);
    writeEvent({ method: "exit", params: { ptyId, exitCode } });
  });

  return { ptyId, pid: proc.pid, cwd, ...status(proc) };
}

function requirePty(ptyId: string): PtyEntry {
  const entry = ptys.get(ptyId);
  if (!entry)
    throw Object.assign(new Error(`PTY ${ptyId} not found`), {
      helperKind: "not-found" as const,
    });
  return entry;
}

function handleRequest(raw: unknown): void {
  const req = HelperRequestSchema.parse(raw);
  try {
    match(req)
      .with({ method: "spawnPty" }, (r) =>
        writeFrame({ id: r.id, result: spawnPty(r.params) }),
      )
      .with({ method: "write" }, (r) => {
        requirePty(r.params.ptyId).proc.write(r.params.data);
        writeFrame({ id: r.id, result: null });
      })
      .with({ method: "resize" }, (r) => {
        requirePty(r.params.ptyId).proc.resize(r.params.cols, r.params.rows);
        writeFrame({ id: r.id, result: null });
      })
      .with({ method: "dispose" }, (r) => {
        requirePty(r.params.ptyId);
        removePty(r.params.ptyId, true);
        writeFrame({ id: r.id, result: null });
      })
      .exhaustive();
  } catch (err) {
    const helperKind =
      (err as { helperKind?: HelperErrorShape["kind"] }).helperKind ??
      (req.method === "spawnPty" ? "spawn-failed" : "internal");
    writeError(req.id, {
      kind: helperKind,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function serve(): void {
  writeEvent({
    method: "ready",
    params: { version: pkg.version, protocolVersion: HELPER_PROTOCOL_VERSION },
  });
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (line.trim() === "") return;
    try {
      handleRequest(JSON.parse(line));
    } catch (err) {
      writeError(0, {
        kind: "invalid",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
  input.on("close", cleanupAll);
}

if (process.argv.includes("--serve")) {
  process.once("SIGHUP", () => {
    cleanupAll();
    process.exit(128 + 1);
  });
  process.once("SIGINT", () => {
    cleanupAll();
    process.exit(128 + 2);
  });
  process.once("SIGTERM", () => {
    cleanupAll();
    process.exit(128 + 15);
  });
  process.once("exit", cleanupAll);
  serve();
} else {
  console.error("usage: kolu-helper --serve");
  process.exit(2);
}
