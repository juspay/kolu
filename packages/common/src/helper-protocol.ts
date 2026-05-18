/**
 * Wire protocol between kolu (the controller) and the remote `kolu-helper`
 * process. The helper runs on the SSH host, owns the actual PTYs, and
 * proxies operations over stdio.
 *
 * Transport: newline-delimited JSON over the helper's stdin/stdout. One
 * message per line. PTY data is carried as JSON strings (node-pty exposes
 * UTF-8 strings, so no base64 encoding is needed for the prototype).
 *
 * The protocol is request/response for control operations (`spawnPty`,
 * `write`, `resize`, `dispose`, `foregroundPid`, `listPtys`, `attach`,
 * `exec`) plus unsolicited server-pushed events (`data`, `exit`). Requests
 * carry a numeric `id`; responses echo it. Events have no `id`.
 *
 * Why not full JSON-RPC 2.0? The subset we use is identical to JSON-RPC
 * 2.0's request/response shape minus the `"jsonrpc": "2.0"` tag — keeping
 * the field optional lets the protocol stay machine-readable as JSON-RPC
 * if we later want to layer something on top, without paying the per-line
 * cost today.
 */

import { z } from "zod";

// ── Requests ──────────────────────────────────────────────────────────

export const HelperSpawnPtyParamsSchema = z.object({
  shell: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  env: z.record(z.string(), z.string()),
});

export const HelperWriteParamsSchema = z.object({
  ptyId: z.string(),
  data: z.string(),
});

export const HelperResizeParamsSchema = z.object({
  ptyId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const HelperDisposeParamsSchema = z.object({
  ptyId: z.string(),
});

export const HelperForegroundPidParamsSchema = z.object({
  ptyId: z.string(),
});

export const HelperProcessNameParamsSchema = z.object({
  ptyId: z.string(),
});

export const HelperAttachParamsSchema = z.object({
  ptyId: z.string(),
  /** Last sequence number the controller has already received. Helper
   *  replays buffered events with `seq > sinceSeq`. If omitted, treats
   *  as a fresh attach (all buffered events replayed). */
  sinceSeq: z.number().int().nonnegative().optional(),
});

export const HelperDetachParamsSchema = z.object({
  ptyId: z.string(),
});

export const HelperExecParamsSchema = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
});

export const HelperListPtysParamsSchema = z.object({}).strict();

export const HelperRpcMethodSchema = z.enum([
  "spawnPty",
  "write",
  "resize",
  "dispose",
  "foregroundPid",
  "processName",
  "attach",
  "detach",
  "exec",
  "listPtys",
]);

export type HelperRpcMethod = z.infer<typeof HelperRpcMethodSchema>;

export const HelperRequestSchema = z.object({
  id: z.number().int().nonnegative(),
  method: HelperRpcMethodSchema,
  params: z.unknown(),
});
export type HelperRequest = z.infer<typeof HelperRequestSchema>;

// ── Responses ─────────────────────────────────────────────────────────

export const HelperSpawnPtyResultSchema = z.object({
  ptyId: z.string(),
  pid: z.number(),
});

export const HelperForegroundPidResultSchema = z.object({
  /** undefined if no foreground process (shell idle) or tcgetpgrp unavailable. */
  pid: z.number().optional(),
});

export const HelperProcessNameResultSchema = z.object({
  /** undefined if the PTY's foreground process can't be inspected. */
  name: z.string().optional(),
});

export const HelperExecResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

export const HelperListPtysResultSchema = z.object({
  ptys: z.array(
    z.object({
      ptyId: z.string(),
      pid: z.number(),
      /** Most recent sequence number assigned to this PTY's event stream. */
      lastSeq: z.number().int().nonnegative(),
    }),
  ),
});

export const HelperErrorShape = z.object({
  kind: z.enum(["not-found", "spawn-failed", "exec-failed", "invalid"]),
  message: z.string(),
});

export const HelperResponseSchema = z.object({
  id: z.number().int().nonnegative(),
  result: z.unknown().optional(),
  error: HelperErrorShape.optional(),
});
export type HelperResponse = z.infer<typeof HelperResponseSchema>;

// ── Server-pushed events ──────────────────────────────────────────────

/** PTY produced output. `seq` is monotonically increasing per ptyId; the
 *  controller uses it to dedupe on reconnect (helper retains the last
 *  N bytes in a ring buffer; reconnect replays events with seq > lastSeen). */
export const HelperDataEventSchema = z.object({
  method: z.literal("data"),
  params: z.object({
    ptyId: z.string(),
    seq: z.number().int().nonnegative(),
    data: z.string(),
  }),
});

/** PTY exited. Final `seq` so the controller knows nothing else is coming. */
export const HelperExitEventSchema = z.object({
  method: z.literal("exit"),
  params: z.object({
    ptyId: z.string(),
    seq: z.number().int().nonnegative(),
    exitCode: z.number(),
  }),
});

/** Emitted exactly once, as the very first frame the helper writes after
 *  startup. Lets the controller distinguish "helper running but slow to
 *  service the first request" from "helper crashed/missing/wrong binary."
 *  Carries the helper's own version so the controller can warn on
 *  mismatched store paths down the road. */
export const HelperReadyEventSchema = z.object({
  method: z.literal("ready"),
  params: z.object({
    version: z.string(),
  }),
});

/** Per-PTY events — every variant has a `seq` for ring-buffer ordering
 *  + replay. Distinct from the singleton ready signal which has no PTY
 *  identity and no sequence. */
export const HelperPtyEventSchema = z.union([
  HelperDataEventSchema,
  HelperExitEventSchema,
]);
export type HelperPtyEvent = z.infer<typeof HelperPtyEventSchema>;

export const HelperEventSchema = z.union([
  HelperDataEventSchema,
  HelperExitEventSchema,
  HelperReadyEventSchema,
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;
export type HelperDataEvent = z.infer<typeof HelperDataEventSchema>;
export type HelperExitEvent = z.infer<typeof HelperExitEventSchema>;
export type HelperReadyEvent = z.infer<typeof HelperReadyEventSchema>;

// ── Top-level frame (request or response or event) ────────────────────

/** A frame arriving in either direction. Disambiguation:
 *   - has `id` + `method` → request (controller → helper)
 *   - has `id` + (`result` or `error`) → response (helper → controller)
 *   - has `method` only → event (helper → controller, unsolicited) */
export const HelperFrameSchema = z.union([
  HelperRequestSchema,
  HelperResponseSchema,
  HelperEventSchema,
]);
export type HelperFrame = z.infer<typeof HelperFrameSchema>;
