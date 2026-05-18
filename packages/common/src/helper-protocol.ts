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
  /** Optional shell wrapper rc content. When set, the helper writes it
   *  to a per-pty file on the remote and prepends the corresponding
   *  `--rcfile <path>` to `args` (bash-specific). The content typically
   *  carries the OSC 7 / OSC 2 / OSC 633;E injection that kolu needs to
   *  track cwd, title, and preexec command marks. Cleaned up on dispose. */
  rcContent: z.string().optional(),
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

export const HelperListPtysParamsSchema = z.object({}).strict();

/** Host-side process execution — the controller's escape hatch for any
 *  local-machine command kolu-git / agent-providers historically shelled
 *  out for (`git rev-parse`, `git status`, …). Helper runs `cmd` with
 *  the given args, captures stdout/stderr, and reports the exit code.
 *  Timeout is enforced server-side; the controller's only job is to
 *  pick a reasonable upper bound. */
export const HelperExecParamsSchema = z.object({
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
  /** Hard ceiling in milliseconds. Default 30s when omitted. */
  timeoutMs: z.number().int().positive().optional(),
  /** Cap on captured stdout (bytes). Output beyond this is truncated. */
  maxBytes: z.number().int().positive().optional(),
});

/** Host-side recursive filesystem watch — the inotify-over-SSH plumbing
 *  the working-tree-watcher needs. Helper uses `fs.watch(path, { recursive
 *  : true })` on the remote and streams change events back as
 *  `watchEvent` frames keyed by `subId`. Idle hosts pay no cost — the
 *  watch is per-subscription, torn down on `unwatch`. */
export const HelperWatchParamsSchema = z.object({
  path: z.string(),
  /** When true, watch the entire subtree. Defaults to false (single
   *  directory). */
  recursive: z.boolean().optional(),
});

export const HelperUnwatchParamsSchema = z.object({
  subId: z.string(),
});

/** Host-side SQLite query — used by agent providers whose live state
 *  lives in a SQLite DB on the remote (OpenCode's `opencode.db`,
 *  Codex's `state_<N>.sqlite`). Helper opens the DB read-only via
 *  `node:sqlite`, runs the parameterized query, returns rows.
 *  WAL-friendly: opens with `readonly: true` so concurrent writers
 *  aren't blocked. */
export const HelperQueryDbParamsSchema = z.object({
  path: z.string(),
  sql: z.string(),
  params: z.array(z.union([z.string(), z.number(), z.null()])).optional(),
});

/** Host-side file read — used by kolu-git's `readFile` (Code tab) so
 *  the controller doesn't have to ship a separate cat-via-exec path.
 *  Helper truncates at `maxBytes` and reports the flag back so the
 *  UI can warn. */
export const HelperReadFileParamsSchema = z.object({
  path: z.string(),
  maxBytes: z.number().int().positive().optional(),
});

/** Host-side stat for cache-busting iframe previews. Returns mtime in
 *  ms since epoch, matching what `fs.stat().mtimeMs` produces. */
export const HelperStatMtimeMsParamsSchema = z.object({
  path: z.string(),
});

export const HelperRpcMethodSchema = z.enum([
  "spawnPty",
  "write",
  "resize",
  "dispose",
  "foregroundPid",
  "processName",
  "attach",
  "detach",
  "listPtys",
  "exec",
  "watch",
  "unwatch",
  "queryDb",
  "readFile",
  "statMtimeMs",
]);

export type HelperRpcMethod = z.infer<typeof HelperRpcMethodSchema>;

export const HelperRequestSchema = z.object({
  id: z.number().int().nonnegative(),
  method: HelperRpcMethodSchema,
  params: z.unknown(),
});
export type HelperRequest = z.infer<typeof HelperRequestSchema>;

// ── Responses ─────────────────────────────────────────────────────────

/** Result of an `exec` request — stdout/stderr captured up to maxBytes,
 *  plus the process exit code (or null if killed by signal/timeout). */
export const HelperExecResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
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

/** Filesystem change observed by a `watch` subscription. The helper
 *  doesn't try to classify Create/Update/Delete reliably (fs.watch's
 *  event types are notoriously platform-dependent) — the controller
 *  treats every event as "something changed under this path", which is
 *  what kolu-git's working-tree-watcher actually does anyway. */
export const HelperWatchEventSchema = z.object({
  method: z.literal("watchEvent"),
  params: z.object({
    subId: z.string(),
    /** Path relative to the watched root, or "" for the root itself. */
    path: z.string(),
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
  HelperWatchEventSchema,
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;
export type HelperDataEvent = z.infer<typeof HelperDataEventSchema>;
export type HelperExitEvent = z.infer<typeof HelperExitEventSchema>;
export type HelperReadyEvent = z.infer<typeof HelperReadyEventSchema>;
export type HelperWatchEvent = z.infer<typeof HelperWatchEventSchema>;

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
