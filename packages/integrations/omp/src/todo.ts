import type { TaskProgress } from "anyagent";
import { Schema } from "effect";
import { createAppendedLineReader, type Logger } from "kolu-shared";
import { branchEntryOf, createOmpBranch, type OmpBranch } from "./branch.ts";

interface TodoEntry {
  type?: string;
  customType?: string;
  data?: { phases?: unknown };
  message?: {
    role?: string;
    toolName?: string;
    isError?: boolean;
    details?: { op?: unknown; phases?: unknown };
  };
}

const TodoPhasesSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({
        content: Schema.String,
        status: Schema.Literals([
          "pending",
          "in_progress",
          "completed",
          "abandoned",
          "blocked",
        ]),
      }),
    ),
  }),
);

export type TodoPhases = typeof TodoPhasesSchema.Type;

const isTodoPhases = Schema.is(TodoPhasesSchema);

export function todoSnapshotOf(value: unknown): TodoPhases | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry: TodoEntry = value;
  let phases: unknown;
  if (entry.type === "custom" && entry.customType === "user_todo_edit") {
    phases = entry.data?.phases;
  } else if (
    entry.type === "message" &&
    entry.message?.role === "toolResult" &&
    entry.message.toolName === "todo" &&
    entry.message.isError !== true &&
    entry.message.details?.op !== "view"
  ) {
    phases = entry.message.details?.phases;
  } else {
    return undefined;
  }
  return isTodoPhases(phases) ? phases : undefined;
}

export function countTodo(phases: TodoPhases): TaskProgress | null {
  let total = 0;
  let completed = 0;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      total++;
      if (task.status === "completed" || task.status === "abandoned") {
        completed++;
      }
    }
  }
  return total === 0 ? null : { total, completed };
}

export interface TodoProgressReader {
  read(): TaskProgress | null;
}

export function createTodoProgressReader(
  file: string,
  log?: Logger,
): TodoProgressReader {
  let branch: OmpBranch = createOmpBranch();
  let snapshots = new Map<string, TaskProgress | null>();

  const lines = createAppendedLineReader({
    path: file,
    onLine(line) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const entry = branchEntryOf(parsed);
      if (entry === undefined) return;
      branch.add(entry);
      const phases = todoSnapshotOf(parsed);
      if (phases !== undefined) snapshots.set(entry.id, countTodo(phases));
    },
    onRestart() {
      branch = createOmpBranch();
      snapshots = new Map();
    },
    onError(err) {
      log?.error({ err, path: file }, "omp: todo scan failed");
    },
  });

  return {
    read() {
      lines.read();
      if (snapshots.size === 0) return null;
      for (const id of branch.idsFromLeaf()) {
        const snapshot = snapshots.get(id);
        if (snapshot !== undefined) return snapshot;
      }
      return null;
    },
  };
}
