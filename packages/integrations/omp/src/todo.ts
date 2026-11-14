/** omp's todo list → `TaskProgress`.
 *
 *  Three separate questions, answered by three separate pieces:
 *
 *   - **Which entries are a snapshot of the list** (`todoSnapshotOf`). omp's
 *     `todo` tool answers EVERY call — `init`, `start`, `done`, `rm`, `drop`,
 *     `block`, `unblock`, `append`, `view` — with the whole list in the tool
 *     result's `details.phases`:
 *
 *       `[{ name, tasks: [{ content, status, blocker? }] }]`
 *
 *     with `status` one of `pending` / `in_progress` / `completed` /
 *     `abandoned` / `blocked`. omp's own `/todo` command, and its automatic
 *     task bookkeeping, write the same shape as a `custom` entry
 *     (`customType: "user_todo_edit"`, `data.phases`). A failed call and a
 *     `view` read are not snapshots. kolu reads the snapshot instead of
 *     replaying the ops — the ops' meaning (the in-progress pointer advancing,
 *     phase-wide `done`, rejected duplicates, a failed batch not committing)
 *     belongs to omp, and a replay would be a second implementation of it.
 *   - **Which snapshot is current** (`createTodoProgressReader`). When omp
 *     reopens a session it takes the newest snapshot ON THE ACTIVE BRANCH
 *     (`getLatestTodoPhasesFromEntries` over `getBranch()`); `branch.ts` is
 *     omp's rule for that branch, shared with the transcript export, so a
 *     `/tree` jump back to before the newest todo call shows the list that
 *     branch had.
 *   - **How a list is counted** (`countTodo`): the `Overall: N/M done` line
 *     omp prints under every result, so kolu and omp's own screen never show
 *     two numbers.
 *
 *  These mirror omp 18.18's `src/tools/todo.ts` and session index; a change
 *  there is the thing to compare against. */

import type { TaskProgress } from "anyagent";
import { Schema } from "effect";
import { createAppendedLineReader, type Logger } from "kolu-shared";
import { branchEntryOf, createOmpBranch, type OmpBranch } from "./branch.ts";

/** The slice of an omp entry a todo snapshot is read from. */
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

/** omp's list shape — its own `isTodoPhase` check, as a schema: each phase a
 *  name and tasks that carry string content and one of omp's five statuses.
 *  A task's optional `blocker` note is not read. */
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

/** The list a parsed entry carries, or `undefined` when the entry is not a
 *  snapshot: only a `user_todo_edit` entry, or a `todo` tool result that
 *  neither failed nor was a `view` read, is one. Pure. */
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

/** omp's count: `total` is every task in every phase; `completed` counts
 *  `completed` AND `abandoned` (a dropped task is closed — omp counts it
 *  done); `blocked` stays open; `rm` has already taken a task out of the list.
 *  A list with no tasks (omp clearing it) is `null`, the same "no list" answer
 *  as a session that never made one. Pure. */
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
  /** Read what omp appended since the last call and answer the current
   *  list's progress — `null` when the active branch has no list. */
  read(): TaskProgress | null;
}

/** The todo progress of one session file, read incrementally.
 *
 *  The list can be set once and then sit untouched while megabytes of tool
 *  output follow, so the state fold's 256 KB tail window cannot hold it — and
 *  the active branch needs every entry's place in the tree anyway. So the
 *  whole file is read once, then only what is appended
 *  (`createAppendedLineReader`, which also restarts on a rewritten file). A
 *  read failure is logged, and the answer stays what was read before it. */
export function createTodoProgressReader(
  file: string,
  log?: Logger,
): TodoProgressReader {
  let branch: OmpBranch = createOmpBranch();
  /** Each snapshot entry's count, by entry id. */
  let snapshots = new Map<string, TaskProgress | null>();

  const lines = createAppendedLineReader({
    path: file,
    onLine(line) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // a malformed line is not an entry
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
