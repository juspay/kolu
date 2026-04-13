/** Shared schemas and types used by multiple integration packages.
 *  Lives here (not in kolu-common) to avoid circular dependencies:
 *  kolu-common imports from integration packages for their agent schemas,
 *  so integration packages can't import back from kolu-common. */

import { z } from "zod";

/** Task/todo progress — total items and completed count.
 *  Used by both Claude Code (from TaskCreate/TaskUpdate tool calls)
 *  and OpenCode (from the `todo` SQLite table). */
export const TaskProgressSchema = z.object({
  total: z.number(),
  completed: z.number(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** Logger interface accepted by integration library functions.
 *  Structurally compatible with pino child loggers — the server
 *  creates a `log.child(...)` and passes it through. */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};
