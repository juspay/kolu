import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskProgress } from "anyagent";
import { afterAll, describe, expect, it } from "vitest";
import { countTodo, createTodoProgressReader, todoSnapshotOf } from "./todo.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "todo");

const fixtureLines = (name: string): string[] =>
  fs
    .readFileSync(path.join(FIXTURES, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-todo-"));
let files = 0;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const isSnapshot = (line: string): boolean =>
  todoSnapshotOf(JSON.parse(line)) !== undefined;

function progression(lines: string[]): (TaskProgress | null)[] {
  const file = path.join(tmp, `grow-${files++}.jsonl`);
  fs.writeFileSync(file, "");
  const reader = createTodoProgressReader(file);
  const out: (TaskProgress | null)[] = [];
  for (const line of lines) {
    fs.appendFileSync(file, `${line}\n`);
    if (isSnapshot(line)) out.push(reader.read());
  }
  return out;
}

function readerOver(lines: string[]): TaskProgress | null {
  const file = path.join(tmp, `read-${files++}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => `${line}\n`).join(""));
  return createTodoProgressReader(file).read();
}

const progress = (completed: number, total: number): TaskProgress => ({
  total,
  completed,
});

describe("countTodo — omp's list, counted the way omp counts it", () => {
  it("agrees with the `Overall: N/M done` line omp printed under every result", () => {
    let checked = 0;
    for (const name of fs.readdirSync(FIXTURES)) {
      for (const line of fixtureLines(name.replace(/\.jsonl$/, ""))) {
        const overall = /"text":"Overall: (\d+)\/(\d+) done/.exec(line);
        if (!overall) continue;
        const phases = todoSnapshotOf(JSON.parse(line));
        expect(phases, `${name}: ${overall[0]} is a snapshot`).toBeDefined();
        if (phases === undefined) continue;
        expect(countTodo(phases), `${name}: ${overall[0]}`).toEqual(
          progress(Number(overall[1]), Number(overall[2])),
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });
});

describe("createTodoProgressReader — the current list of a session file", () => {
  it("a new init replaces the list: the finished one's count does not carry over", () => {
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
      progress(1, 14),
      progress(1, 15),
    ]);
    expect(progression(fixtureLines("drop"))).toEqual([
      progress(3, 5),
      progress(4, 5),
      progress(5, 5),
    ]);
  });

  it("a blocked task stays open", () => {
    expect(progression(fixtureLines("blocked"))).toEqual([
      progress(12, 13),
      progress(12, 13),
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

  it("a resumed session shows the list from before omp exited", () => {
    const lines = fixtureLines("resume");
    const firstPrompt = lines.findIndex((line) =>
      line.includes('"role":"user"'),
    );
    expect(firstPrompt).toBeGreaterThan(
      lines.findIndex((line) => line.includes('"session_exit"')),
    );
    expect(readerOver(lines.slice(0, firstPrompt + 1))).toEqual(progress(4, 5));
    expect(readerOver(lines)).toEqual(progress(4, 5));
  });

  it("the list survives a compaction", () => {
    const lines = fixtureLines("compaction");
    const compaction = lines.findIndex((line) =>
      line.includes('"type":"compaction"'),
    );
    expect(readerOver(lines.slice(0, compaction + 3))).toEqual(progress(9, 24));
    expect(readerOver(lines)).toEqual(progress(10, 24));
  });

  const jumpBackTo = (parentId: string) =>
    JSON.stringify({
      type: "message",
      id: "jump0001",
      parentId,
      timestamp: "2026-10-07T14:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "…" }] },
    });

  it("a `/tree` jump back before the newest todo call shows that branch's list", () => {
    const lines = fixtureLines("reinit");
    const snapshots = lines.filter(isSnapshot);
    const finished = JSON.parse(snapshots[1] ?? "").id as string;
    expect(readerOver([...lines, jumpBackTo(finished)])).toEqual(
      progress(17, 17),
    );
    const first = JSON.parse(lines[0] ?? "").id as string;
    expect(readerOver([...lines, jumpBackTo(first)])).toBeNull();
  });

  it("a cleared list is no list", () => {
    const lines = fixtureLines("drop");
    const cleared = JSON.stringify({
      type: "custom",
      customType: "user_todo_edit",
      data: { phases: [] },
      id: "c1",
      parentId: JSON.parse(lines.at(-1) ?? "").id,
      timestamp: "2026-11-13T00:00:00.000Z",
    });
    expect(readerOver([...lines, cleared])).toBeNull();
  });
});
