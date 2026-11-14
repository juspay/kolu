/** omp's todo list → taskProgress, pinned against lines cut from real omp
 *  session files (`fixtures/todo/*.jsonl`). Each fixture keeps the entries
 *  around the todo traffic it is about — the `todo` calls and results, and the
 *  `session_exit` / `model_change` / `compaction` / `user_todo_edit` entries
 *  between them — with ids, timestamps and `details` exactly as omp wrote
 *  them. Slimmed: each result's text is cut to omp's own `Overall: N/M done`
 *  line, and other tools' payloads to `…`. `rm` and `resume` come from
 *  sessions in other repositories, so their task and phase names are replaced
 *  with `task N` / `phase N`; everything else is verbatim. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskProgress } from "anyagent";
import { afterAll, describe, expect, it } from "vitest";
import { createTodoProgressReader, todoProgressOfLine } from "./todo.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "todo");

const fixtureLines = (name: string): string[] =>
  fs
    .readFileSync(path.join(FIXTURES, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);

/** The answer after each snapshot line, in file order — what kolu publishes
 *  as omp writes the session. */
function progression(lines: string[]): (TaskProgress | null)[] {
  const out: (TaskProgress | null)[] = [];
  for (const line of lines) {
    const snapshot = todoProgressOfLine(line);
    if (snapshot !== undefined) out.push(snapshot);
  }
  return out;
}

/** The answer a fresh reader gives over exactly these lines. */
function readerOver(lines: string[]): TaskProgress | null {
  const file = path.join(tmp, `read-${readerFiles++}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => `${line}\n`).join(""));
  return createTodoProgressReader(file).read();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-todo-"));
let readerFiles = 0;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const progress = (completed: number, total: number): TaskProgress => ({
  total,
  completed,
});

describe("todoProgressOfLine — omp's list, counted the way omp counts it", () => {
  it("agrees with the `Overall: N/M done` line omp printed under every result", () => {
    let checked = 0;
    for (const name of fs.readdirSync(FIXTURES)) {
      for (const line of fixtureLines(name.replace(/\.jsonl$/, ""))) {
        const overall = /"text":"Overall: (\d+)\/(\d+) done/.exec(line);
        if (!overall) continue;
        expect(todoProgressOfLine(line), `${name}: ${overall[0]}`).toEqual(
          progress(Number(overall[1]), Number(overall[2])),
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it("a new init replaces the list: the finished one's count does not carry over", () => {
    // 17 tasks in 4 phases, finished, then a fresh 9-task init in 3 phases.
    expect(progression(fixtureLines("reinit"))).toEqual([
      progress(0, 17),
      progress(17, 17),
      progress(0, 9),
      progress(9, 9),
    ]);
  });

  it("`rm` takes a task out of the total; `drop` closes it", () => {
    expect(progression(fixtureLines("rm"))).toEqual([
      progress(1, 15),
      progress(1, 14), // rm
      progress(1, 15), // append
    ]);
    // A list finished with one task dropped reads done, as omp says.
    expect(progression(fixtureLines("drop"))).toEqual([
      progress(3, 5),
      progress(4, 5), // drop
      progress(5, 5),
    ]);
  });

  it("a blocked task stays open", () => {
    expect(progression(fixtureLines("blocked"))).toEqual([
      progress(12, 13),
      progress(12, 13), // the last open task, blocked
    ]);
  });

  it("follows omp's own `user_todo_edit` entries, not only tool results", () => {
    expect(progression(fixtureLines("user-edit"))).toEqual([
      progress(2, 10),
      progress(3, 10),
      progress(4, 10),
      progress(5, 10),
      progress(6, 10),
      progress(7, 10),
      progress(8, 10),
    ]);
  });

  it("a cleared list is no list", () => {
    // What omp writes when it empties the list (a background clone starts
    // with `user_todo_edit { phases: [] }`); no real session here has one.
    const cleared = JSON.stringify({
      type: "custom",
      customType: "user_todo_edit",
      data: { phases: [] },
      id: "c1",
      parentId: "p1",
      timestamp: "2026-11-13T00:00:00.000Z",
    });
    expect(readerOver([...fixtureLines("drop"), cleared])).toBeNull();
  });
});

describe("createTodoProgressReader — the session file", () => {
  it("a resumed session shows the list from before omp exited", () => {
    const lines = fixtureLines("resume");
    // Through the resumed session's first prompt: omp exited, relaunched
    // (`model_change`), and the user typed — no todo call yet.
    const firstPrompt = lines.findIndex((line) =>
      line.includes('"role":"user"'),
    );
    expect(firstPrompt).toBeGreaterThan(
      lines.findIndex((line) => line.includes('"session_exit"')),
    );
    expect(readerOver(lines.slice(0, firstPrompt + 1))).toEqual(progress(4, 5));
    // Hours later the resumed session blocks the last task.
    expect(readerOver(lines)).toEqual(progress(4, 5));
  });

  it("the list survives a compaction", () => {
    const lines = fixtureLines("compaction");
    const compaction = lines.findIndex((line) =>
      line.includes('"type":"compaction"'),
    );
    // Through the compaction and the turn after it: nothing re-states the
    // list, and it still stands.
    expect(readerOver(lines.slice(0, compaction + 3))).toEqual(progress(9, 24));
    expect(readerOver(lines)).toEqual(progress(10, 24));
  });

  it("reads what omp appends, and waits for a half-written line's newline", () => {
    const lines = fixtureLines("reinit");
    const file = path.join(tmp, "append.jsonl");
    fs.writeFileSync(file, `${lines[0]}\n${lines[1]}\n`);
    const reader = createTodoProgressReader(file);
    expect(reader.read()).toEqual(progress(0, 17));

    const next = `${lines[2]}\n${lines[3]}`;
    const cut = next.length - 200;
    fs.appendFileSync(file, next.slice(0, cut));
    expect(reader.read()).toEqual(progress(0, 17));

    fs.appendFileSync(file, `${next.slice(cut)}\n`);
    expect(reader.read()).toEqual(progress(17, 17));
  });

  it("starts over when omp rewrites the file", () => {
    const file = path.join(tmp, "rewrite.jsonl");
    fs.writeFileSync(file, `${fixtureLines("reinit").join("\n")}\n`);
    const reader = createTodoProgressReader(file);
    expect(reader.read()).toEqual(progress(9, 9));

    // Rewritten in place, shorter: the old offset is past the end.
    fs.writeFileSync(file, `${fixtureLines("drop").join("\n")}\n`);
    expect(reader.read()).toEqual(progress(5, 5));

    // Replaced atomically (a new inode) by a LONGER file: the old offset is
    // inside it, and reading on from there would land mid-line.
    const replacement = path.join(tmp, "rewrite.next");
    fs.writeFileSync(
      replacement,
      `${[...fixtureLines("rm"), ...fixtureLines("blocked")].join("\n")}\n`,
    );
    fs.renameSync(replacement, file);
    expect(reader.read()).toEqual(progress(12, 13));
  });
});
