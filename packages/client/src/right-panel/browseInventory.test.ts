import { FileTree as PierreFileTree } from "@pierre/trees";
import { describe, expect, it } from "vitest";
import {
  diffInventory,
  diskInventory,
  foldTypeChanges,
  mergeBrowseInventory,
} from "./browseInventory.ts";

const settled = {
  trackedPending: false,
  ignoredPending: false,
  showIgnored: true,
};

describe("mergeBrowseInventory", () => {
  describe("rule 1 — absent tracked is not empty tracked", () => {
    it("admits NO overlay while the tracked listing is absent", () => {
      const out = mergeBrowseInventory(
        undefined,
        ["node_modules/", ".env"],
        undefined,
        { ...settled, trackedPending: true },
      );
      expect(out.paths).toEqual([]);
      expect(out.ignored).toEqual([]);
      expect(out.pending).toBe(true);
    });

    it("admits NO overlay when tracked is absent and NOT pending — the error path", () => {
      const out = mergeBrowseInventory(
        undefined,
        ["node_modules/", ".env"],
        undefined,
        { trackedPending: false, ignoredPending: false, showIgnored: true },
      );
      expect(out.paths).toEqual([]);
      expect(out.ignored).toEqual([]);
      expect(out.pending).toBe(false);
    });

    it("distinguishes that from a genuinely EMPTY tracked listing", () => {
      const out = mergeBrowseInventory(
        [],
        ["node_modules/"],
        undefined,
        settled,
      );
      expect(out.paths).toEqual(["node_modules/"]);
      expect(out.ignored).toEqual(["node_modules/"]);
    });
  });

  describe("rule 2 — tracked wins the overlap", () => {
    it("drops a path claimed by both listings from the overlay", () => {
      const out = mergeBrowseInventory(
        ["src/app.ts", "build.log"],
        ["build.log", "node_modules/"],
        undefined,
        settled,
      );
      expect(out.paths).toEqual(["src/app.ts", "build.log", "node_modules/"]);
      expect(out.ignored).toEqual(["node_modules/"]);
      expect(new Set(out.paths).size).toBe(out.paths.length);
    });

    it("keeps the overlay a strict subset of the rendered paths", () => {
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["b.log", "a.ts"],
        undefined,
        settled,
      );
      expect(out.ignored).toEqual(["b.log"]);
      expect(out.paths).toEqual(["a.ts", "b.log"]);
    });

    it("drops an overlay directory entry when tracked files exist under it", () => {
      const out = mergeBrowseInventory(
        [".claude/skills/foo.md"],
        [".claude/"],
        undefined,
        settled,
      );
      expect(out.paths).toEqual([".claude/skills/foo.md"]);
      expect(out.ignored).toEqual([]);
    });
  });

  describe("rule 3 — readiness covers the consulted sources only", () => {
    it("ignores the overlay's readiness while the toggle is OFF", () => {
      const out = mergeBrowseInventory(["a.ts"], undefined, undefined, {
        trackedPending: false,
        ignoredPending: true,
        showIgnored: false,
      });
      expect(out.pending).toBe(false);
    });

    it("counts the overlay's readiness while the toggle is ON", () => {
      const out = mergeBrowseInventory(["a.ts"], undefined, undefined, {
        trackedPending: false,
        ignoredPending: true,
        showIgnored: true,
      });
      expect(out.pending).toBe(true);
    });

    it("is pending whenever the tracked listing is, toggle regardless", () => {
      for (const showIgnored of [true, false]) {
        const out = mergeBrowseInventory(["a.ts"], [], undefined, {
          trackedPending: true,
          ignoredPending: false,
          showIgnored,
        });
        expect(out.pending).toBe(true);
      }
    });
  });

  describe("rule 4 — a loaded directory yields to its children", () => {
    it("replaces the collapsed row with the level that was fetched", () => {
      const out = mergeBrowseInventory(
        ["blog/000.md"],
        ["blog/out/"],
        new Map([["blog/out/", ["blog/out/000.html", "blog/out/style.css"]]]),
        settled,
      );
      expect(out.paths).toEqual([
        "blog/000.md",
        "blog/out/000.html",
        "blog/out/style.css",
      ]);
      expect(out.paths).not.toContain("blog/out/");
    });

    it("dims the fetched children AND the folder they replaced", () => {
      const out = mergeBrowseInventory(
        ["blog/000.md"],
        ["blog/out/"],
        new Map([["blog/out/", ["blog/out/000.html"]]]),
        settled,
      );
      expect(out.ignored.sort()).toEqual(
        ["blog/out/", "blog/out/000.html"].sort(),
      );
    });

    it("applies rule 2's membership test to loaded children too", () => {
      const out = mergeBrowseInventory(
        ["src/app.ts"],
        ["out/"],
        new Map([["out/", ["out/gen.js", "src/app.ts"]]]),
        settled,
      );
      expect(out.paths.filter((p) => p === "src/app.ts")).toEqual([
        "src/app.ts",
      ]);
      expect(out.paths).toContain("out/gen.js");
    });

    it("keeps a child directory collapsed and lazy in its turn", () => {
      const out = mergeBrowseInventory(
        [],
        ["node_modules/"],
        new Map([
          ["node_modules/", ["node_modules/solid-js/", "node_modules/.bin/"]],
        ]),
        settled,
      );
      expect(out.paths).toEqual([
        "node_modules/solid-js/",
        "node_modules/.bin/",
      ]);
      expect(out.lazyDirs).toContain("node_modules/solid-js/");
      expect(out.lazyDirs).toContain("node_modules/.bin/");
    });

    it("expands a nested load through both levels", () => {
      const out = mergeBrowseInventory(
        [],
        ["blog/out/"],
        new Map([
          ["blog/out/", ["blog/out/index.html", "blog/out/assets/"]],
          ["blog/out/assets/", ["blog/out/assets/logo.png"]],
        ]),
        settled,
      );
      expect(out.paths).toEqual([
        "blog/out/index.html",
        "blog/out/assets/logo.png",
      ]);
      expect(out.lazyDirs).toEqual(["blog/out/", "blog/out/assets/"]);
    });

    it("names the collapsed directories lazy even before anything is loaded", () => {
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["node_modules/", ".env"],
        undefined,
        settled,
      );
      expect(out.lazyDirs).toEqual(["node_modules/"]);
      expect(out.lazyDirs).not.toContain(".env");
    });

    it("keeps the row for a directory that reads back EMPTY", () => {
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["build/"],
        new Map([["build/", []]]),
        settled,
      );
      expect(out.paths).toEqual(["a.ts", "build/"]);
      expect(out.ignored).toEqual(["build/"]);
      expect(out.lazyDirs).toEqual(["build/"]);
    });

    it("keeps an empty NESTED directory revealed by its parent's load", () => {
      const out = mergeBrowseInventory(
        [],
        ["out/"],
        new Map([
          ["out/", ["out/index.html", "out/assets/"]],
          ["out/assets/", []],
        ]),
        settled,
      );
      expect(out.paths).toEqual(["out/index.html", "out/assets/"]);
      expect(out.lazyDirs).toEqual(["out/", "out/assets/"]);
    });

    it("drops children for a directory tracked has since claimed", () => {
      const out = mergeBrowseInventory(
        [".claude/skills/foo.md"],
        [".claude/"],
        new Map([[".claude/", [".claude/settings.json"]]]),
        settled,
      );
      expect(out.paths).toEqual([".claude/skills/foo.md"]);
      expect(out.ignored).toEqual([]);
      expect(out.lazyDirs).toEqual([]);
    });

    it("ignores children for a directory absent from the overlay", () => {
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["node_modules/"],
        new Map([["build/", ["build/out.js"]]]),
        settled,
      );
      expect(out.paths).toEqual(["a.ts", "node_modules/"]);
      expect(out.paths).not.toContain("build/out.js");
    });
  });

  it("settles to exactly the tracked listing when nothing is ignored", () => {
    const out = mergeBrowseInventory(["a.ts", "b.ts"], [], undefined, settled);
    expect(out).toEqual({
      paths: ["a.ts", "b.ts"],
      ignored: [],
      lazyDirs: [],
      pending: false,
    });
  });
});

describe("diffInventory — directory→file type change (blank-tree repro)", () => {
  const typeChanged = [
    ".claude/skills/odu",
    ".claude/skills/odu/serve",
    ".claude/skills/odu/SKILL.md",
    "skills/odu/SKILL.md",
  ];

  it("builds a real Pierre tree from the diff inventory without throwing", () => {
    const { paths } = diffInventory(typeChanged, false);
    let tree: PierreFileTree | undefined;
    expect(() => {
      tree = new PierreFileTree({
        paths,
        search: false,
        flattenEmptyDirectories: true,
        initialExpansion: "open",
      });
    }).not.toThrow();
    expect(tree?.getItem(".claude/skills/odu")).not.toBeNull();
    tree?.cleanUp();
  });
});

describe("foldTypeChanges", () => {
  it.each([
    {
      name: "file listed before its old children",
      input: ["a/b", "a/b/c", "a/b/d", "z.ts"],
      expected: ["a/b", "z.ts"],
    },
    {
      name: "old children listed before the file",
      input: ["a/b/c", "a/b/d", "a/b", "z.ts"],
      expected: ["a/b", "z.ts"],
    },
    {
      name: "file replaced by a directory keeps the deleted file's row",
      input: ["a/b", "a/b/new1.ts", "a/b/new2.ts"],
      expected: ["a/b"],
    },
    {
      name: "file replaced by a directory, children listed first",
      input: ["a/b/new1.ts", "a/b", "z.ts"],
      expected: ["a/b", "z.ts"],
    },
    {
      name: "nested collision keeps only the outermost file",
      input: ["a", "a/b", "a/b/c", "a/x"],
      expected: ["a"],
    },
    {
      name: "a sibling sharing the name prefix is not a child",
      input: ["a/b", "a/bc", "a/b.ts"],
      expected: ["a/b", "a/bc", "a/b.ts"],
    },
  ])("$name", ({ input, expected }) => {
    expect(foldTypeChanges(input)).toEqual(expected);
  });

  it("returns the same array when nothing collides", () => {
    const input = ["a/b.ts", "a/c/d.ts", "e.ts"];
    const out = foldTypeChanges(input);
    expect(out).toBe(input);
    expect(out).toEqual(["a/b.ts", "a/c/d.ts", "e.ts"]);
  });

  it("diffInventory folds the type change into one row", () => {
    expect(
      diffInventory(
        [
          ".claude/skills/odu",
          ".claude/skills/odu/serve",
          ".claude/skills/odu/SKILL.md",
          "skills/odu/SKILL.md",
        ],
        false,
      ).paths,
    ).toEqual([".claude/skills/odu", "skills/odu/SKILL.md"]);
  });
});

describe("diskInventory — a folder git cannot list, read one level at a time", () => {
  const ROOT = [".claude/", ".git/", ".worktrees/", "notes.md"];
  it.each([
    {
      name: "a root not read yet is pending, never empty",
      root: undefined,
      loaded: new Map<string, string[]>(),
      pending: true,
      expected: { paths: [], lazyDirs: [], pending: true },
    },
    {
      name: "every folder is a lazy row, and nothing is dimmed",
      root: ROOT,
      loaded: new Map<string, string[]>(),
      pending: false,
      expected: {
        paths: ROOT,
        lazyDirs: [".claude/", ".git/", ".worktrees/"],
        pending: false,
      },
    },
    {
      name: "a loaded folder yields to its children, recursively",
      root: ROOT,
      loaded: new Map([
        [".worktrees/", [".worktrees/feat/"]],
        [".worktrees/feat/", [".worktrees/feat/README.md"]],
      ]),
      pending: false,
      expected: {
        paths: [".claude/", ".git/", ".worktrees/feat/README.md", "notes.md"],
        lazyDirs: [".claude/", ".git/", ".worktrees/", ".worktrees/feat/"],
        pending: false,
      },
    },
    {
      name: "an empty loaded folder keeps its own row",
      root: ROOT,
      loaded: new Map([[".claude/", []]]),
      pending: false,
      expected: {
        paths: ROOT,
        lazyDirs: [".claude/", ".git/", ".worktrees/"],
        pending: false,
      },
    },
    {
      name: "a loaded level whose folder left the root resurrects nothing",
      root: ["notes.md"],
      loaded: new Map([[".worktrees/", [".worktrees/feat/"]]]),
      pending: false,
      expected: { paths: ["notes.md"], lazyDirs: [], pending: false },
    },
  ])("$name", ({ root, loaded, pending, expected }) => {
    expect(diskInventory(root, loaded, pending)).toEqual({
      ...expected,
      ignored: [],
    });
  });
});
