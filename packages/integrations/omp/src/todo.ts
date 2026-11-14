/** omp's todo list → `TaskProgress`.
 *
 *  Where the list lives. omp's `todo` tool answers EVERY call — `init`,
 *  `start`, `done`, `rm`, `drop`, `block`, `unblock`, `append`, `view` — with
 *  the whole list in the tool result's `details.phases`:
 *
 *    `[{ name, tasks: [{ content, status, blocker? }] }]`
 *
 *  with `status` one of `pending` / `in_progress` / `completed` / `abandoned` /
 *  `blocked`. omp's own `/todo` command, and its automatic task bookkeeping,
 *  write the same shape as a `custom` entry (`customType: "user_todo_edit"`,
 *  `data.phases`). When omp reopens a session it restores its list by taking
 *  the NEWEST of those two (`getLatestTodoPhasesFromEntries`: a failed call and
 *  a `view` read do not count). kolu reads that same snapshot instead of
 *  replaying the ops — the ops' meaning (the in-progress pointer advancing,
 *  phase-wide `done`, rejected duplicates, a failed batch not committing)
 *  belongs to omp, and a replay would be a second implementation of it.
 *
 *  Counting matches the `Overall: N/M done` line omp prints under every
 *  result, so kolu and omp's own screen never show two numbers: `total` is
 *  every task in every phase; `completed` counts `completed` AND `abandoned`
 *  (a dropped task is closed — omp counts it done); `blocked` stays open. A
 *  list with no tasks (omp clearing it) is `null`, the same "no list" answer
 *  as a session that never made one. `rm` takes a task out of the list, so it
 *  leaves `total` too.
 *
 *  Order. The newest snapshot in FILE order wins, not the newest along the
 *  `parentId` tree. The tree's leaf is not the file's last line: out-of-band
 *  entries (`model_usage`) parent onto an older entry, so a walk from the last
 *  line can skip the newest todo result. File order agreed with omp's own
 *  restore on every real session with a todo list checked when this was
 *  written; the one case it cannot see is a `/tree` jump back to before the
 *  newest todo call, which shows the abandoned branch's list until the next
 *  todo call (the state fold in `core.ts` reads file order the same way).
 *
 *  Why a whole-file scan. The list can be set once and then sit untouched
 *  while megabytes of tool output follow, so the state fold's 256 KB tail
 *  window cannot hold it. The reader below scans the file once from byte 0,
 *  then only the bytes appended since — the same incremental shape as Claude
 *  Code's task scan. */

import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { TaskProgress } from "anyagent";
import { Schema } from "effect";
import type { Logger } from "kolu-shared";

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

type TodoPhases = typeof TodoPhasesSchema.Type;

const isTodoPhases = Schema.is(TodoPhasesSchema);

/** The list a snapshot entry carries, or `undefined` when the entry is not
 *  one: a `user_todo_edit` entry, or a `todo` tool result that neither failed
 *  nor was a `view` read. */
function snapshotPhases(entry: TodoEntry): TodoPhases | undefined {
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

/** Fold one transcript line. `undefined`: the line is not a todo snapshot
 *  (leave the current answer alone). `null`: a snapshot of an empty list.
 *  Otherwise the snapshot's progress. Pure. */
export function todoProgressOfLine(
  line: string,
): TaskProgress | null | undefined {
  // Every snapshot names `"todo"` (`"toolName":"todo"`) or `"user_todo_edit"`;
  // checking the raw text first keeps the whole-file scan from parsing every
  // tool output in the session. A hit is only a candidate — the parse below
  // decides.
  if (!line.includes('"todo"') && !line.includes('"user_todo_edit"')) {
    return undefined;
  }
  let entry: TodoEntry;
  try {
    entry = JSON.parse(line) as TodoEntry;
  } catch {
    return undefined; // a malformed line is not a snapshot
  }
  if (typeof entry !== "object" || entry === null) return undefined;
  const phases = snapshotPhases(entry);
  if (phases === undefined) return undefined;
  let total = 0;
  let completed = 0;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      total++;
      // omp's `Overall: N/M done` counts a dropped task as closed.
      if (task.status === "completed" || task.status === "abandoned") {
        completed++;
      }
    }
  }
  return total === 0 ? null : { total, completed };
}

/** Bytes read per step of a scan, so a large session costs one bounded buffer
 *  at a time rather than the whole file. */
const SCAN_CHUNK_BYTES = 1024 * 1024;

export interface TodoProgressReader {
  /** Read the bytes appended since the last call and answer the newest
   *  snapshot's progress — `null` when the session has no list. */
  read(): TaskProgress | null;
}

/** An incremental reader of one session file's todo progress.
 *
 *  The first `read()` scans from byte 0; later ones read only what omp
 *  appended. A line still being written (no newline yet) waits for the next
 *  read. omp rewrites a session file whole on some paths (an atomic replace,
 *  which changes the inode, or a rewrite that can leave it shorter); either
 *  restarts the scan from byte 0, so a rewrite is never read from the middle.
 *  A read failure is logged and the previous answer stands — never a fall to
 *  "no list". */
export function createTodoProgressReader(
  file: string,
  log?: Logger,
): TodoProgressReader {
  let ino: number | null = null;
  let offset = 0;
  let decoder = new StringDecoder("utf8");
  let carry = "";
  let progress: TaskProgress | null = null;

  return {
    read() {
      let fd: number;
      try {
        fd = fs.openSync(file, "r");
      } catch (err) {
        log?.error({ err, path: file }, "omp: todo scan could not open");
        return progress;
      }
      try {
        const stat = fs.fstatSync(fd);
        if (stat.ino !== ino || stat.size < offset) {
          ino = stat.ino;
          offset = 0;
          decoder = new StringDecoder("utf8");
          carry = "";
          progress = null;
        }
        while (offset < stat.size) {
          const want = Math.min(SCAN_CHUNK_BYTES, stat.size - offset);
          const buf = Buffer.allocUnsafe(want);
          const got = fs.readSync(fd, buf, 0, want, offset);
          if (got === 0) break;
          offset += got;
          // The decoder holds back a multi-byte character split across reads.
          const lines = (carry + decoder.write(buf.subarray(0, got))).split(
            "\n",
          );
          carry = lines.pop() ?? "";
          for (const line of lines) {
            const snapshot = todoProgressOfLine(line);
            if (snapshot !== undefined) progress = snapshot;
          }
        }
      } catch (err) {
        log?.error({ err, path: file, offset }, "omp: todo scan failed");
      } finally {
        fs.closeSync(fd);
      }
      return progress;
    },
  };
}
