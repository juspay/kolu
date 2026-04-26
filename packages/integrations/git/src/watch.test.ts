import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GitResult } from "./errors.ts";
import type { FsWatchEvent } from "./schemas.ts";
import { test__activeFileTreeWatcherCount, watchFiles } from "./watch.ts";

describe("watchFiles", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-watch-test-"));
  });

  afterEach(() => {
    expect(test__activeFileTreeWatcherCount()).toBe(0);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function initRepo(name: string): Promise<string> {
    const dir = path.join(tmpDir, `${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    await simpleGit(dir).init();
    return dir;
  }

  async function nextEvent(
    iter: AsyncIterator<GitResult<FsWatchEvent>>,
  ): Promise<FsWatchEvent> {
    const result = await Promise.race([
      iter.next(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("timed out waiting for watch event")),
          5000,
        ),
      ),
    ]);
    expect(result.done).toBe(false);
    expect(result.value.ok).toBe(true);
    if (!result.value.ok) throw new Error(result.value.error.code);
    return result.value.value;
  }

  async function closeIterator(
    iter: AsyncIterator<GitResult<FsWatchEvent>>,
    controller: AbortController,
  ): Promise<void> {
    controller.abort();
    await iter.return?.();
  }

  it("yields a git-filtered snapshot first", async () => {
    const dir = await initRepo("snapshot");
    fs.writeFileSync(path.join(dir, ".gitignore"), "*.log\n");
    fs.writeFileSync(path.join(dir, "visible.txt"), "visible\n");
    fs.writeFileSync(path.join(dir, "ignored.log"), "ignored\n");

    const controller = new AbortController();
    const iter = watchFiles(dir, undefined, controller.signal)[
      Symbol.asyncIterator
    ]();

    const event = await nextEvent(iter);
    expect(event).toEqual({
      kind: "snapshot",
      paths: [".gitignore", "visible.txt"],
    });
    await closeIterator(iter, controller);
  });

  it("emits debounced add and remove deltas", async () => {
    const dir = await initRepo("delta");
    const controller = new AbortController();
    const iter = watchFiles(dir, undefined, controller.signal)[
      Symbol.asyncIterator
    ]();

    await nextEvent(iter);

    fs.writeFileSync(path.join(dir, "live.txt"), "live\n");
    expect(await nextEvent(iter)).toEqual({
      kind: "delta",
      added: ["live.txt"],
    });

    fs.rmSync(path.join(dir, "live.txt"));
    expect(await nextEvent(iter)).toEqual({
      kind: "delta",
      removed: ["live.txt"],
    });
    await closeIterator(iter, controller);
  });

  it("watches git-visible node_modules paths when the repo does not ignore them", async () => {
    const dir = await initRepo("node-modules-visible");
    const controller = new AbortController();
    const iter = watchFiles(dir, undefined, controller.signal)[
      Symbol.asyncIterator
    ]();

    await nextEvent(iter);

    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "visible.txt"), "live\n");
    expect(await nextEvent(iter)).toEqual({
      kind: "delta",
      added: ["node_modules/visible.txt"],
    });
    await closeIterator(iter, controller);
  });

  it("emits a move delta for a single-file rename", async () => {
    const dir = await initRepo("move");
    fs.writeFileSync(path.join(dir, "old.txt"), "content\n");

    const controller = new AbortController();
    const iter = watchFiles(dir, undefined, controller.signal)[
      Symbol.asyncIterator
    ]();

    await nextEvent(iter);
    fs.renameSync(path.join(dir, "old.txt"), path.join(dir, "new.txt"));

    expect(await nextEvent(iter)).toEqual({
      kind: "delta",
      moved: [{ from: "old.txt", to: "new.txt" }],
    });
    await closeIterator(iter, controller);
  });

  it("shares one chokidar watcher across subscribers", async () => {
    const dir = await initRepo("shared");
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = watchFiles(dir, undefined, firstController.signal)[
      Symbol.asyncIterator
    ]();
    const second = watchFiles(dir, undefined, secondController.signal)[
      Symbol.asyncIterator
    ]();

    await nextEvent(first);
    await nextEvent(second);
    expect(test__activeFileTreeWatcherCount()).toBe(1);

    await closeIterator(first, firstController);
    expect(test__activeFileTreeWatcherCount()).toBe(1);
    await closeIterator(second, secondController);
  });
});
