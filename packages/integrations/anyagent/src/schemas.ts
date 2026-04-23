/** Browser-safe schemas and pure types from anyagent.
 *
 *  Split out from `index.ts` so kolu-common (and the client bundle) can
 *  import zod schemas without dragging in `with-db.ts`/`wal-subscription.ts`/
 *  `tail-lines.ts`, which transitively pull `node:fs`, `node:path`, and
 *  `node:sqlite` (see juspay/kolu#682 for the same fix in the SDK packages). */

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
  error: (obj: Record<string, unknown>, msg: string) => void;
};
