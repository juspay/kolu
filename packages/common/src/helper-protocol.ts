/**
 * NDJSON protocol between the Kolu server and `kolu-helper` over SSH stdio.
 *
 * This protocol intentionally covers only PTY lifecycle. Host-local git,
 * GitHub, filesystem, and agent state need a separate executor design; this
 * file must not become a generic remote shell escape hatch by accident.
 */

import { z } from "zod";

const PositiveIntSchema = z.number().int().positive();

export const HelperPtyStatusSchema = z.object({
  process: z.string().optional(),
  foregroundPid: z.number().int().positive().optional(),
});
export type HelperPtyStatus = z.infer<typeof HelperPtyStatusSchema>;

export const HelperSpawnPtyParamsSchema = z.object({
  terminalId: z.string(),
  cwd: z.string().optional(),
  cols: PositiveIntSchema,
  rows: PositiveIntSchema,
});

export const HelperWriteParamsSchema = z.object({
  ptyId: z.string(),
  data: z.string(),
});

export const HelperResizeParamsSchema = z.object({
  ptyId: z.string(),
  cols: PositiveIntSchema,
  rows: PositiveIntSchema,
});

export const HelperDisposeParamsSchema = z.object({
  ptyId: z.string(),
});

export const HelperRpcMethodSchema = z.enum([
  "spawnPty",
  "write",
  "resize",
  "dispose",
]);
export type HelperRpcMethod = z.infer<typeof HelperRpcMethodSchema>;

export const HelperRequestSchema = z.object({
  id: z.number().int().nonnegative(),
  method: HelperRpcMethodSchema,
  params: z.unknown(),
});
export type HelperRequest = z.infer<typeof HelperRequestSchema>;

export const HelperSpawnPtyResultSchema = z
  .object({
    ptyId: z.string(),
    pid: z.number().int(),
    cwd: z.string(),
  })
  .merge(HelperPtyStatusSchema);
export type HelperSpawnPtyResult = z.infer<typeof HelperSpawnPtyResultSchema>;

export const HelperErrorShapeSchema = z.object({
  kind: z.enum(["not-found", "spawn-failed", "invalid", "internal"]),
  message: z.string(),
});
export type HelperErrorShape = z.infer<typeof HelperErrorShapeSchema>;

export const HelperResponseSchema = z.object({
  id: z.number().int().nonnegative(),
  result: z.unknown().optional(),
  error: HelperErrorShapeSchema.optional(),
});
export type HelperResponse = z.infer<typeof HelperResponseSchema>;

export const HelperReadyEventSchema = z.object({
  method: z.literal("ready"),
  params: z.object({ version: z.string() }),
});

export const HelperDataEventSchema = z.object({
  method: z.literal("data"),
  params: z
    .object({
      ptyId: z.string(),
      data: z.string(),
    })
    .merge(HelperPtyStatusSchema),
});

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
export type HelperReadyEvent = z.infer<typeof HelperReadyEventSchema>;
export type HelperDataEvent = z.infer<typeof HelperDataEventSchema>;
export type HelperExitEvent = z.infer<typeof HelperExitEventSchema>;

export const HelperFrameSchema = z.union([
  HelperRequestSchema,
  HelperResponseSchema,
  HelperEventSchema,
]);
export type HelperFrame = z.infer<typeof HelperFrameSchema>;
