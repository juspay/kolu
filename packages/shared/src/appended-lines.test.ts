import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAppendedLineReader } from "./appended-lines.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-appended-lines-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A reader over `file` whose every event lands in one log, in order. */
function follow(file: string) {
  const events: string[] = [];
  const errors: unknown[] = [];
  const reader = createAppendedLineReader({
    path: file,
    onLine: (line) => events.push(line),
    onRestart: () => events.push("<restart>"),
    onError: (err) => errors.push(err),
  });
  /** Read, and answer what that read handed over. */
  const read = (): string[] => {
    const from = events.length;
    reader.read();
    return events.slice(from);
  };
  return { read, errors };
}

describe("createAppendedLineReader", () => {
  it("hands over each appended line once, and holds a half-written one until its newline", () => {
    const file = path.join(tmp, "append.jsonl");
    fs.writeFileSync(file, "one\ntwo\n");
    const { read } = follow(file);
    expect(read()).toEqual(["one", "two"]);
    expect(read()).toEqual([]);

    fs.appendFileSync(file, "thr");
    expect(read()).toEqual([]);
    fs.appendFileSync(file, "ee\n\nfour\n");
    expect(read()).toEqual(["three", "four"]);
  });

  it("keeps a character whole when a read boundary splits it", () => {
    // Put a 3-byte character across the 1 MiB read boundary.
    const file = path.join(tmp, "utf8.jsonl");
    const filler = "x".repeat(1024 * 1024 - 1);
    fs.writeFileSync(file, `${filler}—tail\n`);
    const { read } = follow(file);
    expect(read()).toEqual([`${filler}—tail`]);
  });

  it("starts again from the top when the file is rewritten shorter or replaced", () => {
    const file = path.join(tmp, "rewrite.jsonl");
    fs.writeFileSync(file, "alpha\nbravo\ncharlie\n");
    const { read } = follow(file);
    expect(read()).toEqual(["alpha", "bravo", "charlie"]);

    // Rewritten in place, shorter: the old offset is past the end.
    fs.writeFileSync(file, "delta\n");
    expect(read()).toEqual(["<restart>", "delta"]);

    // Replaced (a new inode) by a LONGER file: the old offset is inside it,
    // and continuing from there would start mid-line.
    const next = path.join(tmp, "rewrite.next");
    fs.writeFileSync(next, "echo\nfoxtrot\ngolf\n");
    fs.renameSync(next, file);
    expect(read()).toEqual(["<restart>", "echo", "foxtrot", "golf"]);
  });

  it("reports a missing file and picks it up once it exists", () => {
    const file = path.join(tmp, "later.jsonl");
    const { read, errors } = follow(file);
    expect(read()).toEqual([]);
    expect(errors).toHaveLength(1);

    fs.writeFileSync(file, "here\n");
    expect(read()).toEqual(["here"]);
  });
});
