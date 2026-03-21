// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string();

// Discriminated union: exitCode is required when exited, absent when running.
// Mirrors the server-side TerminalEntry discriminated union exactly.
export const TerminalInfoSchema = z.discriminatedUnion("status", [
  z.object({
    id: TerminalIdSchema,
    pid: z.number(),
    status: z.literal("running"),
  }),
  z.object({
    id: TerminalIdSchema,
    pid: z.number(),
    status: z.literal("exited"),
    exitCode: z.number(),
  }),
]);

export const TerminalResizeInputSchema = z.object({
  id: TerminalIdSchema,
  cols: z.number(),
  rows: z.number(),
});

export const TerminalSendInputSchema = z.object({
  id: TerminalIdSchema,
  data: z.string(),
});

export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalAttachOutputSchema = z.string();
export const TerminalOnExitOutputSchema = z.number();

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];
export type TerminalStatus = TerminalInfo["status"];
