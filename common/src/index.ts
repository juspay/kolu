// Shared types for kolu server↔client communication.
// Used by oRPC procedure schemas and client state.

import { z } from "zod";

// --- Terminal types ---

export type TerminalId = string;
export type TerminalStatus = "running" | "exited";

export interface TerminalInfo {
  id: TerminalId;
  pid: number;
  status: TerminalStatus;
  exitCode?: number;
}

// --- oRPC schemas (Zod) ---

export const TerminalInfoSchema = z.object({
  id: z.string(),
  pid: z.number(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().optional(),
});

export const TerminalCreateOutputSchema = TerminalInfoSchema;

export const TerminalResizeInputSchema = z.object({
  id: z.string(),
  cols: z.number(),
  rows: z.number(),
});

export const TerminalSendInputSchema = z.object({
  id: z.string(),
  data: z.string(),
});

export const TerminalAttachInputSchema = z.object({
  id: z.string(),
});

export const TerminalAttachOutputSchema = z.string();

export const TerminalOnExitOutputSchema = z.number();
