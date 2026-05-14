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

/** Most-recent assistant utterance or tool call for a session — the peek
 *  surface shown next to each terminal in the workspace switcher. Lives
 *  as a peer of `agent` on `LiveTerminalFieldsSchema` (not inside it)
 *  because its update cadence is a streaming-token feed; folding it into
 *  the `AgentInfo` equality gate would either thrash the gate for every
 *  other field or carve out a per-field exception. */
export const AgentSnippetSchema = z.object({
  /** Whether the latest signal is assistant prose or a tool invocation. */
  kind: z.enum(["assistant", "tool_use"]),
  /** Truncated preview text — assistant prose first line, or tool name
   *  with a compact summary of inputs. */
  text: z.string(),
  /** Epoch-millis the underlying transcript entry landed. */
  ts: z.number(),
});

export type AgentSnippet = z.infer<typeof AgentSnippetSchema>;
