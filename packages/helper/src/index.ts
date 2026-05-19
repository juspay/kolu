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
  HelperDisposeParamsSchema,
  type HelperErrorShape,
  type HelperEvent,
  HelperRequestSchema,
  HelperResizeParamsSchema,
  HelperSpawnPtyParamsSchema,
  HelperWriteParamsSchema,
} from "kolu-common/helper-protocol";
import { DEFAULT_COLS, DEFAULT_ROWS } from "kolu-common/config";
import { koluIdentityEnv, prepareShellInit } from "kolu-shared/shell";
import * as pty from "node-pty";
import pkg from "../package.json" with { type: "json" };

interface PtyEntry {
  proc: pty.IPty;
  cleanup: () => void;
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

function writeFrame(frame: unknown): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function writeError(id: number, error: HelperErrorShape): void {
  writeFrame({ id, error });
}

function writeEvent(event: HelperEvent): void {
  writeFrame(event);
}

function spawnPty(params: unknown): {
  ptyId: string;
  pid: number;
  cwd: string;
  process?: string;
  foregroundPid?: number;
} {
  const input = HelperSpawnPtyParamsSchema.parse(params);
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
  ptys.set(ptyId, { proc, cleanup: init.cleanup });

  proc.onData((data) => {
    writeEvent({
      method: "data",
      params: { ptyId, data, ...status(proc) },
    });
  });
  proc.onExit(({ exitCode }) => {
    init.cleanup();
    ptys.delete(ptyId);
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
    if (req.method === "spawnPty") {
      writeFrame({ id: req.id, result: spawnPty(req.params) });
      return;
    }
    if (req.method === "write") {
      const input = HelperWriteParamsSchema.parse(req.params);
      requirePty(input.ptyId).proc.write(input.data);
      writeFrame({ id: req.id, result: null });
      return;
    }
    if (req.method === "resize") {
      const input = HelperResizeParamsSchema.parse(req.params);
      requirePty(input.ptyId).proc.resize(input.cols, input.rows);
      writeFrame({ id: req.id, result: null });
      return;
    }
    const input = HelperDisposeParamsSchema.parse(req.params);
    const entry = requirePty(input.ptyId);
    entry.cleanup();
    entry.proc.kill();
    ptys.delete(input.ptyId);
    writeFrame({ id: req.id, result: null });
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
  writeEvent({ method: "ready", params: { version: pkg.version } });
  createInterface({ input: process.stdin }).on("line", (line) => {
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
}

if (process.argv.includes("--serve")) {
  serve();
} else {
  console.error("usage: kolu-helper --serve");
  process.exit(2);
}
