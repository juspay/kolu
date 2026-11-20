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
    write(".waterfall/first.bin", "");
    truncateSync(
      join(worktree, ".waterfall/first.bin"),
      WORK_FILES_KEPT_BYTES - 10,
    );
    const keep = (paths: ReadonlyArray<string>) =>
      files().keep({ host: "local", worktree, work: "w1", paths });
    await keep([".waterfall/first.bin"]);
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
