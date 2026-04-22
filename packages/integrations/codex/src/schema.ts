import { z } from "zod";
import { TaskProgressSchema } from "anyagent";

export const CodexInfoSchema = z.object({
  kind: z.literal("codex"),
  state: z.enum(["thinking", "tool_use", "waiting"]),
  sessionId: z.string(),
  model: z.string().nullable(),
  summary: z.string().nullable(),
  taskProgress: TaskProgressSchema.nullable(),
  contextTokens: z.number().nullable(),
});

export type CodexInfo = z.infer<typeof CodexInfoSchema>;
