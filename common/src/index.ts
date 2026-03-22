// Shared types for kolu server↔client communication.
// Zod schemas are the single source of truth; TS types are derived.

import { z } from "zod";

// --- Zod schemas ---

const TerminalIdSchema = z.string();

// Discriminated union: exitCode is required when exited, absent when running.
export const TerminalInfoSchema = z.discriminatedUnion("status", [
  z.object({
    id: TerminalIdSchema,
    pid: z.number(),
    status: z.literal("running"),
    themeName: z.string().optional(),
  }),
  z.object({
    id: TerminalIdSchema,
    pid: z.number(),
    status: z.literal("exited"),
    exitCode: z.number(),
    themeName: z.string().optional(),
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

export const TerminalSetThemeInputSchema = z.object({
  id: TerminalIdSchema,
  themeName: z.string(),
});

export const TerminalAttachInputSchema = z.object({ id: TerminalIdSchema });
export const TerminalAttachOutputSchema = z.string();
export const TerminalOnExitOutputSchema = z.number();

// --- Derived types ---

export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export type TerminalId = TerminalInfo["id"];
export type TerminalStatus = TerminalInfo["status"];

/** Extract the status discriminant from TerminalInfo for reuse (e.g. server-side TerminalEntry). */
export type TerminalRunning = Extract<TerminalInfo, { status: "running" }>;
export type TerminalExited = Extract<TerminalInfo, { status: "exited" }>;
