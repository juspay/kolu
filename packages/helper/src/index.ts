#!/usr/bin/env node
/**
 * `kolu-helper` — the remote arm of a Kolu remote terminal. Runs on the
 * SSH host, owns the actual `node-pty` processes, and proxies operations
 * back to kolu over its own stdin/stdout (newline-delimited JSON).
 *
 * Launched by the kolu controller via SSH:
 *
 *   ssh <host> /nix/store/.../bin/kolu-helper --serve
 *
 * Lifecycle in v0: the helper's lifetime is exactly the SSH session's
 * lifetime. When stdin closes (EOF — SSH dropped, controller quit, etc.)
 * the helper kills every PTY and exits. v1 will run the helper as a
 * detached daemon (Unix socket + nohup) so PTYs survive SSH drops; the
 * sequence-numbered ring buffer is already in place to support that.
 */

import {
  type HelperFrame,
  type HelperPtyEvent,
  HelperRequestSchema,
} from "kolu-common/helper-protocol";
import pkg from "../package.json" with { type: "json" };
import {
  HelperAttachParamsSchema,
  HelperDisposeParamsSchema,
  HelperForegroundPidParamsSchema,
  HelperListPtysParamsSchema,
  HelperProcessNameParamsSchema,
  HelperResizeParamsSchema,
  HelperSpawnPtyParamsSchema,
  HelperWriteParamsSchema,
} from "kolu-common/helper-protocol";
import { createManager } from "./manager.ts";

const HELPER_VERSION: string = pkg.version;

function writeFrame(frame: HelperFrame): void {
  // newline-delimited JSON; one frame per line. process.stdout.write is
  // synchronous on TTY/pipe targets (we always run under a parent SSH),
  // so frame interleaving is safe.
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

const manager = createManager((event: HelperPtyEvent) => writeFrame(event));

function respond(id: number, result: unknown): void {
  writeFrame({ id, result });
}

function respondError(
  id: number,
  kind: "not-found" | "spawn-failed" | "exec-failed" | "invalid",
  message: string,
): void {
  writeFrame({ id, error: { kind, message } });
}

function handleRequest(req: {
  id: number;
  method: string;
  params: unknown;
}): void {
  try {
    switch (req.method) {
      case "spawnPty": {
        const params = HelperSpawnPtyParamsSchema.parse(req.params);
        const { ptyId, pid } = manager.spawn(params);
        respond(req.id, { ptyId, pid });
        return;
      }
      case "write": {
        const params = HelperWriteParamsSchema.parse(req.params);
        manager.write(params.ptyId, params.data);
        respond(req.id, {});
        return;
      }
      case "resize": {
        const params = HelperResizeParamsSchema.parse(req.params);
        manager.resize(params.ptyId, params.cols, params.rows);
        respond(req.id, {});
        return;
      }
      case "dispose": {
        const params = HelperDisposeParamsSchema.parse(req.params);
        manager.dispose(params.ptyId);
        respond(req.id, {});
        return;
      }
      case "attach": {
        const params = HelperAttachParamsSchema.parse(req.params);
        const events = manager.replay(params.ptyId, params.sinceSeq);
        for (const event of events) writeFrame(event);
        respond(req.id, { replayed: events.length });
        return;
      }
      case "detach": {
        // No-op for v0 — the helper has no per-controller subscription
        // state; events accumulate in the ring buffer regardless.
        respond(req.id, {});
        return;
      }
      case "foregroundPid": {
        const params = HelperForegroundPidParamsSchema.parse(req.params);
        respond(req.id, { pid: manager.foregroundPid(params.ptyId) });
        return;
      }
      case "processName": {
        const params = HelperProcessNameParamsSchema.parse(req.params);
        respond(req.id, { name: manager.processName(params.ptyId) });
        return;
      }
      case "listPtys": {
        HelperListPtysParamsSchema.parse(req.params);
        respond(req.id, { ptys: manager.list() });
        return;
      }
      default:
        respondError(req.id, "invalid", `unknown method: ${req.method}`);
    }
  } catch (err) {
    respondError(
      req.id,
      err && typeof err === "object" && "issues" in err
        ? "invalid"
        : "spawn-failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

let stdinBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  stdinBuffer += chunk;
  let newlineIdx = stdinBuffer.indexOf("\n");
  while (newlineIdx !== -1) {
    const line = stdinBuffer.slice(0, newlineIdx);
    stdinBuffer = stdinBuffer.slice(newlineIdx + 1);
    if (line.trim().length > 0) {
      try {
        const parsed = JSON.parse(line);
        const req = HelperRequestSchema.safeParse(parsed);
        if (req.success) {
          handleRequest(req.data);
        } else {
          // Malformed request — we don't have an id to respond to. Emit
          // a diagnostic on stderr (visible in kolu's helper log) and
          // continue. Throwing here would kill the whole helper for one
          // bad line, which is the wrong failure mode.
          process.stderr.write(
            `kolu-helper: malformed request: ${req.error.message}\n`,
          );
        }
      } catch (err) {
        process.stderr.write(
          `kolu-helper: JSON parse error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    newlineIdx = stdinBuffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  // Controller dropped the connection. v0: kill every PTY and exit.
  manager.shutdown();
  process.exit(0);
});

// Defensive: surface unhandled rejections to stderr instead of crashing
// silently. The helper has no persistent log; stderr lands in kolu's
// helper-stderr stream by way of SSH.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `kolu-helper: unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`,
  );
});

// Ready signal — controller waits for this single line before sending
// requests, so it can distinguish "helper crashed before printing
// anything" from "helper running but slow to respond to first request."
writeFrame({
  method: "ready",
  params: { version: HELPER_VERSION },
});
