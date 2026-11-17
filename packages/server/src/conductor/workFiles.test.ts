/** KEEPING A WORK'S FILES, against a fake padi whose byte read is the REAL
 *  serve-dir read over a temporary worktree — the same stand-in the preview
 *  route's own tests use. What is pinned: where nested files land, the size
 *  budget, and the containment guard. */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serveFile } from "@kolu/serve-dir";
import { Effect } from "effect";
import { WORK_FILES_KEPT_BYTES } from "kolu-common/workFiles";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workFilesDir, workFilesOverHosts } from "./workFiles.ts";

let worktree: string;
let stateRoot: string;

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), "kolu-work-files-tree-"));
  stateRoot = mkdtempSync(join(tmpdir(), "kolu-work-files-state-"));
});

afterEach(() => {
  rmSync(worktree, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(worktree, path)), { recursive: true });
  writeFileSync(join(worktree, path), content);
};

/** A host whose padi reads bytes the way padi's `preview.read` does. */
const files = () =>
  workFilesOverHosts({
    hosts: {
      padi: () =>
        ({
          surface: {
            preview: {
              read: (input: { filePath: string; range?: string }) =>
                Effect.flatMap(
                  serveFile(worktree, input.filePath, input.range ?? null),
                  (served) =>
                    Effect.promise(async () => ({
                      status: served.status,
                      headers: served.headers,
                      bodyBase64:
                        typeof served.body === "string"
                          ? Buffer.from(served.body).toString("base64")
                          : Buffer.from(
                              await new Response(served.body).arrayBuffer(),
                            ).toString("base64"),
                    })),
                ),
            },
          },
        }) as never,
      display: (host) => host,
      state: () => "connected" as never,
    },
    stateRoot,
    log: pino({ level: "silent" }),
  });

describe("keeping a work's files", () => {
  it("keeps nested files under the work's own directory, folders and all", async () => {
    write(".waterfall/plan.md", "# Plan");
    write(".waterfall/mockup/index.html", "<p>hi</p>");
    write(".waterfall/mockup/fonts/a.woff2", "\0font");
    const done = await files().keep({
      host: "local",
      worktree,
      work: "w1",
      paths: [
        ".waterfall/plan.md",
        ".waterfall/mockup/index.html",
        ".waterfall/mockup/fonts/a.woff2",
      ],
    });
    const dir = workFilesDir(stateRoot, "w1");
    expect(
      readFileSync(join(dir, ".waterfall/mockup/fonts/a.woff2"), "utf8"),
    ).toBe("\0font");
    expect(done).toEqual({
      kept: [
        { path: ".waterfall/plan.md", bytes: 6 },
        { path: ".waterfall/mockup/index.html", bytes: 9 },
        { path: ".waterfall/mockup/fonts/a.woff2", bytes: 5 },
      ],
      tooBig: [],
    });
  });

  it("leaves out a file past the budget, off the disk, and keeps a smaller one after it", async () => {
    write(".waterfall/plan.md", "# Plan");
    write(".waterfall/big.bin", "");
    // Past the budget on its own, whatever is copied before it.
    truncateSync(
      join(worktree, ".waterfall/big.bin"),
      WORK_FILES_KEPT_BYTES + 1,
    );
    write(".waterfall/mockup/a.css", "body{}");
    const done = await files().keep({
      host: "local",
      worktree,
      work: "w1",
      paths: [
        ".waterfall/plan.md",
        ".waterfall/big.bin",
        ".waterfall/mockup/a.css",
      ],
    });
    const dir = workFilesDir(stateRoot, "w1");
    expect(existsSync(join(dir, ".waterfall/big.bin"))).toBe(false);
    expect(done.tooBig).toEqual([".waterfall/big.bin"]);
    expect(done.kept.map((one) => one.path)).toEqual([
      ".waterfall/plan.md",
      ".waterfall/mockup/a.css",
    ]);
  });

  it("copies in tree order whatever order it is handed, so the plan lands first", async () => {
    // A folder's file that would fit only if copied before the plan.
    write(".waterfall/mockup/big.bin", "");
    truncateSync(
      join(worktree, ".waterfall/mockup/big.bin"),
      WORK_FILES_KEPT_BYTES - 3,
    );
    write(".waterfall/plan.md", "# Plan");
    const done = await files().keep({
      host: "local",
      worktree,
      work: "w1",
      paths: [".waterfall/mockup/big.bin", ".waterfall/plan.md"],
    });
    expect(done.tooBig).toEqual([".waterfall/mockup/big.bin"]);
    expect(done.kept.map((one) => one.path)).toEqual([".waterfall/plan.md"]);
  });

  it("holds the budget per work, across endings, without counting a rewrite twice", async () => {
    // The first ending keeps a file that leaves 10 bytes of the budget.
    write(".waterfall/first.bin", "");
    truncateSync(
      join(worktree, ".waterfall/first.bin"),
      WORK_FILES_KEPT_BYTES - 10,
    );
    const keep = (paths: ReadonlyArray<string>) =>
      files().keep({ host: "local", worktree, work: "w1", paths });
    await keep([".waterfall/first.bin"]);
    // Reopened and ended again with different files: what the first ending
    // left is still the work's, so only 10 bytes are free.
    write(".waterfall/notes.md", "twenty bytes of note");
    write(".waterfall/tiny.md", "five!");
    const again = await keep([".waterfall/notes.md", ".waterfall/tiny.md"]);
    const dir = workFilesDir(stateRoot, "w1");
    expect(again.tooBig).toEqual([".waterfall/notes.md"]);
    expect(existsSync(join(dir, ".waterfall/notes.md"))).toBe(false);
    expect(again.kept.map((one) => one.path)).toEqual([
      ".waterfall/first.bin",
      ".waterfall/tiny.md",
    ]);
    // A third ending that rewrites both: each replaces its own copy, so
    // neither is charged on top of what it replaces.
    const third = await keep([".waterfall/first.bin", ".waterfall/tiny.md"]);
    expect(third.tooBig).toEqual([]);
  });

  it("refuses a path that climbs out of the work's directory", async () => {
    await expect(
      files().keep({
        host: "local",
        worktree,
        work: "w1",
        paths: ["../../escape.md"],
      }),
    ).rejects.toThrow(/refusing to keep/);
  });
});
