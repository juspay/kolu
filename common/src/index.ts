// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string();

export const TerminalInfoSchema = z.object({
  id: TerminalIdSchema,
  pid: z.number(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().optional(),
});

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
