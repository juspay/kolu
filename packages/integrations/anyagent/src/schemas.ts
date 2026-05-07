/** Browser-safe schemas and pure types from anyagent.
 *
 *  Split out from `index.ts` so kolu-common (and the client bundle) can
 *  import zod schemas without dragging in node-only modules transitively. */

import { z } from "zod";

/** Task/todo progress — total items and completed count.
 *  Used by both Claude Code (from TaskCreate/TaskUpdate tool calls)
 *  and OpenCode (from the `todo` SQLite table). */
export const TaskProgressSchema = z.object({
  total: z.number(),
  completed: z.number(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;
