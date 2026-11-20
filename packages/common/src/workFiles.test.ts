import { FileGone } from "@kolu/padi-client/surface";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { listWorkFiles, notKeptWhy, WORK_FILES_LISTED } from "./workFiles.ts";

const listDirectoryFrom =
  (levels: Record<string, ReadonlyArray<string>>) => (dirPath: string) =>
    dirPath in levels
      ? Effect.succeed({ paths: levels[dirPath] ?? [] })
      : Effect.fail(new FileGone({ path: dirPath }));

const walk = (levels: Record<string, ReadonlyArray<string>>) =>
  Effect.runPromise(listWorkFiles(listDirectoryFrom(levels)));

describe("listing a work's files", () => {
  it("finds every file three levels deep, in tree order", async () => {
    expect(
      await walk({
        ".waterfall": [
          ".waterfall/plan.md",
          ".waterfall/mockup/",
          ".waterfall/notes.md",
        ],
        ".waterfall/mockup": [
          ".waterfall/mockup/fonts/",
          ".waterfall/mockup/index.html",
        ],
        ".waterfall/mockup/fonts": [".waterfall/mockup/fonts/a.woff2"],
      }),
    ).toEqual({
      paths: [
        ".waterfall/notes.md",
        ".waterfall/plan.md",
        ".waterfall/mockup/index.html",
        ".waterfall/mockup/fonts/a.woff2",
      ],
      more: false,
    });
  });

  it("reads a missing .waterfall/ as no files", async () => {
    expect(await walk({})).toEqual({ paths: [], more: false });
  });

  it("skips a folder that went away mid-walk", async () => {
    expect(
      await walk({
        ".waterfall": [".waterfall/plan.md", ".waterfall/gone/"],
      }),
    ).toEqual({ paths: [".waterfall/plan.md"], more: false });
  });

  it("fails on any other failure, with what the host said", async () => {
    await expect(
      Effect.runPromise(
        listWorkFiles(() => Effect.fail(new Error("the host went away"))),
      ),
    ).rejects.toThrow("the host went away");
  });

  it("stops at the limit, saying so, with the top-level files still there", async () => {
    const deep = Array.from(
      { length: WORK_FILES_LISTED },
      (_, at) => `.waterfall/build/f${String(at).padStart(3, "0")}.js`,
    );
    const listed = await walk({
      ".waterfall": [".waterfall/build/", ".waterfall/plan.md"],
      ".waterfall/build": deep,
    });
    expect(listed.more).toBe(true);
    expect(listed.paths).toContain(".waterfall/plan.md");
    expect(listed.paths).toHaveLength(WORK_FILES_LISTED - 1);
  });

  it("ends on a folder symlinked onto itself", async () => {
    const listed = await Effect.runPromise(
      listWorkFiles((dirPath) =>
        Effect.succeed({ paths: [`${dirPath}/a.md`, `${dirPath}/self/`] }),
      ),
    );
    expect(listed.more).toBe(true);
    expect(listed.paths).toHaveLength(WORK_FILES_LISTED / 2);
  });
});

describe("saying what a keep left out", () => {
  it("names the files over the budget, by the budget's own words", () => {
    expect(
      notKeptWhy({ tooBig: [".waterfall/mockup/big.mov"], more: false }),
    ).toEqual(
      Option.some(
        "mockup/big.mov did not fit in the 50 MiB kolu keeps of a work",
      ),
    );
  });

  it("says a cut listing, and nothing when nothing was left out", () => {
    expect(notKeptWhy({ tooBig: [], more: true })).toEqual(
      Option.some(
        `kolu stopped listing .waterfall/ at ${WORK_FILES_LISTED} files and folders`,
      ),
    );
    expect(notKeptWhy({ tooBig: [], more: false })).toEqual(Option.none());
  });
});
