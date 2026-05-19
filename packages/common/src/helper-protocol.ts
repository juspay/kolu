/**
 * NDJSON protocol between the Kolu server and `kolu-helper` over SSH stdio.
 *
 * This protocol intentionally covers only PTY lifecycle. Host-local git,
 * GitHub, filesystem, and agent state need a separate executor design; this
 * file must not become a generic remote shell escape hatch by accident.
 */

import { z } from "zod";

/** Increment when the helper wire protocol changes incompatibly. */
export const HELPER_PROTOCOL_VERSION = 1;

const PositiveIntSchema = z.number().int().positive();

/** Process status fields piggybacked on PTY data frames. */
export const HelperPtyStatusSchema = z.object({
  process: z.string().optional(),
  foregroundPid: z.number().int().positive().optional(),
});

/** Request payload for spawning one remote PTY. */
export const HelperSpawnPtyParamsSchema = z.object({
  terminalId: z.string(),
  cwd: z.string().optional(),
  cols: PositiveIntSchema,
  rows: PositiveIntSchema,
});
export type HelperSpawnPtyParams = z.infer<typeof HelperSpawnPtyParamsSchema>;

/** Request payload for writing bytes to an existing remote PTY. */
export const HelperWriteParamsSchema = z.object({
  ptyId: z.string(),
  data: z.string(),
});
export type HelperWriteParams = z.infer<typeof HelperWriteParamsSchema>;

/** Request payload for resizing an existing remote PTY. */
export const HelperResizeParamsSchema = z.object({
  ptyId: z.string(),
  cols: PositiveIntSchema,
  rows: PositiveIntSchema,
});
export type HelperResizeParams = z.infer<typeof HelperResizeParamsSchema>;

/** Request payload for disposing an existing remote PTY. */
export const HelperDisposeParamsSchema = z.object({
  ptyId: z.string(),
});
export type HelperDisposeParams = z.infer<typeof HelperDisposeParamsSchema>;

const HelperRequestIdSchema = z.number().int().nonnegative();

/** PTY-only helper request method names. */
export const HelperRpcMethodSchema = z.enum([
  "spawnPty",
  "write",
  "resize",
  "dispose",
]);
export type HelperRpcMethod = z.infer<typeof HelperRpcMethodSchema>;

/** Helper response payload for a successful spawn. */
export const HelperSpawnPtyResultSchema = z
  .object({
    ptyId: z.string(),
    pid: z.number().int(),
    cwd: z.string(),
  })
  .merge(HelperPtyStatusSchema);
export type HelperSpawnPtyResult = z.infer<typeof HelperSpawnPtyResultSchema>;

/** Method-keyed helper RPC contract. */
export interface HelperRpcSpec {
  spawnPty: {
    params: HelperSpawnPtyParams;
    result: HelperSpawnPtyResult;
  };
  write: {
    params: HelperWriteParams;
    result: null;
  };
  resize: {
    params: HelperResizeParams;
    result: null;
  };
  dispose: {
    params: HelperDisposeParams;
    result: null;
  };
}

export type HelperParams<M extends HelperRpcMethod> =
  HelperRpcSpec[M]["params"];
export type HelperResult<M extends HelperRpcMethod> =
  HelperRpcSpec[M]["result"];

/** Discriminated helper request frame. */
export const HelperRequestSchema = z.discriminatedUnion("method", [
  z.object({
    id: HelperRequestIdSchema,
    method: z.literal("spawnPty"),
    params: HelperSpawnPtyParamsSchema,
  }),
  z.object({
    id: HelperRequestIdSchema,
    method: z.literal("write"),
    params: HelperWriteParamsSchema,
  }),
  z.object({
    id: HelperRequestIdSchema,
    method: z.literal("resize"),
    params: HelperResizeParamsSchema,
  }),
  z.object({
    id: HelperRequestIdSchema,
    method: z.literal("dispose"),
    params: HelperDisposeParamsSchema,
  }),
]);

/** Method-keyed response validators. */
export const HelperResultSchemaByMethod = {
  spawnPty: HelperSpawnPtyResultSchema,
  write: z.null(),
  resize: z.null(),
  dispose: z.null(),
} satisfies {
  [M in HelperRpcMethod]: z.ZodType<HelperResult<M>>;
};

/** Parse the response payload for a known request method. */
export function parseHelperResult<M extends HelperRpcMethod>(
  method: M,
  result: unknown,
): HelperResult<M> {
  return HelperResultSchemaByMethod[method].parse(result) as HelperResult<M>;
}

/** Error payload returned by the helper for failed requests. */
export const HelperErrorShapeSchema = z.object({
  kind: z.enum(["not-found", "spawn-failed", "invalid", "internal"]),
  message: z.string(),
});
export type HelperErrorShape = z.infer<typeof HelperErrorShapeSchema>;

const HelperResponseResultSchema = z.union([
  HelperSpawnPtyResultSchema,
  z.null(),
]);

export const HelperResponseSchema = z
  .object({
    id: HelperRequestIdSchema,
    result: HelperResponseResultSchema.optional(),
    error: HelperErrorShapeSchema.optional(),
  })
  .refine((frame) => frame.result !== undefined || frame.error !== undefined, {
    message: "helper response must include result or error",
  });

/** Helper startup event, including protocol compatibility metadata. */
export const HelperReadyEventSchema = z.object({
  method: z.literal("ready"),
  params: z.object({
    version: z.string(),
    protocolVersion: z.number().int().positive(),
  }),
});

/** Helper PTY output event. */
export const HelperDataEventSchema = z.object({
  method: z.literal("data"),
  params: z
    .object({
      ptyId: z.string(),
      data: z.string(),
    })
    .merge(HelperPtyStatusSchema),
});

/** Helper PTY exit event. */
export const HelperExitEventSchema = z.object({
  method: z.literal("exit"),
  params: z.object({
    ptyId: z.string(),
    exitCode: z.number().int(),
  }),
});

export const HelperEventSchema = z.union([
  HelperReadyEventSchema,
  HelperDataEventSchema,
  HelperExitEventSchema,
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;
export type HelperDataEvent = z.infer<typeof HelperDataEventSchema>;
export type HelperExitEvent = z.infer<typeof HelperExitEventSchema>;
