import { describe, expect, it } from "vitest";
import { mergeBrowseInventory } from "./browseInventory.ts";

const settled = {
  trackedPending: false,
  ignoredPending: false,
  showIgnored: true,
};

describe("mergeBrowseInventory", () => {
  describe("rule 1 — absent tracked is not empty tracked", () => {
    it("admits NO overlay while the tracked listing is absent", () => {
      // The defect: reading `undefined` as `[]` left nothing to subtract
      // against, so the whole overlay was admitted and the tree painted as
      // nothing but dimmed rows during a repo/host switch.
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
      // The case that makes rule 1 independent of readiness, and the one a
      // pending-only gate (`if (trackedPending) …; else tracked ?? []`) would
      // pass every other test in this file while getting wrong.
      //
      // It is reachable, not hypothetical: `createPolledQuery`'s `surfaceError`
      // runs `setError(err); if (pending()) setPending(false)` — it clears
      // pending WITHOUT ever writing a value. So after a failed first
      // `fs.listAll` the tracked listing is `undefined` while `trackedPending`
      // is already `false`, and a readiness-based gate would admit the whole
      // overlay: a tree of nothing but dimmed rows, on the exact screen where
      // the file list just failed to load.
      const out = mergeBrowseInventory(
        undefined,
        ["node_modules/", ".env"],
        undefined,
        { trackedPending: false, ignoredPending: false, showIgnored: true },
      );
      expect(out.paths).toEqual([]);
      expect(out.ignored).toEqual([]);
      // Asserted so readiness can't be smuggled in as the reason for the blank.
      expect(out.pending).toBe(false);
    });

    it("distinguishes that from a genuinely EMPTY tracked listing", () => {
      // An empty repo IS an authority — it says "nothing is tracked" — so the
      // overlay is admitted in full. This is the case `undefined` was being
      // conflated with.
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
      // The two `git ls-files` reads are taken at different instants, so a file
      // ignored between them appears in both. A duplicate handed to Pierre
      // desyncs its bookkeeping permanently.
      const out = mergeBrowseInventory(
        ["src/app.ts", "build.log"],
        ["build.log", "node_modules/"],
        undefined,
        settled,
      );
      expect(out.paths).toEqual(["src/app.ts", "build.log", "node_modules/"]);
      expect(out.ignored).toEqual(["node_modules/"]);
      // No path appears twice — the property Pierre actually depends on.
      expect(new Set(out.paths).size).toBe(out.paths.length);
    });

    it("keeps the overlay a strict subset of the rendered paths", () => {
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["b.log", "a.ts"],
        undefined,
        settled,
      );
      // The concrete expectation, not a loop over `out.ignored` — an empty
      // overlay would satisfy a loop vacuously, which is the failure mode this
      // case exists to catch.
      expect(out.ignored).toEqual(["b.log"]);
      expect(out.paths).toEqual(["a.ts", "b.log"]);
    });

    it("drops an overlay directory entry when tracked files exist under it", () => {
      // The two listings are independent polls: `fs.listIgnored` can collapse
      // a fully-ignored directory to one trailing-slash entry (".claude/")
      // while `fs.listAll` still has tracked children under it. Exact-string
      // overlap alone would keep BOTH and leave Pierre's `.claude/` node with
      // children — the non-recursive remove that freezes the Code tab after a
      // host switch. Tracked children own the prefix; the collapsed overlay
      // dir must not ride alongside them.
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
      // An idle createPolledQuery stays pending forever, so folding it in
      // unconditionally would wedge the tree permanently pending.
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
      // The defect (#2091): `git ls-files --directory` collapses a wholly
      // ignored directory to one entry, so `blog/out/` reached Pierre as a
      // childless row with a working chevron — expanding it opened onto
      // nothing while the directory held six files on disk.
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
      // The collapsed key must not ride alongside its own children — that
      // mixed inventory is what froze the tab on a non-recursive remove.
      expect(out.paths).not.toContain("blog/out/");
    });

    it("dims the fetched children — they are ignored too", () => {
      const out = mergeBrowseInventory(
        ["blog/000.md"],
        ["blog/out/"],
        new Map([["blog/out/", ["blog/out/000.html"]]]),
        settled,
      );
      expect(out.ignored).toEqual(["blog/out/000.html"]);
    });

    it("keeps a child directory collapsed and lazy in its turn", () => {
      // One cheap level per click: a nested ignored directory arrives as its
      // own trailing-slash row rather than being enumerated eagerly, which is
      // what keeps expanding `node_modules/` from listing 100k paths.
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
      // Both directories stay watchable so a re-expand of EITHER refetches —
      // nothing watches an ignored path, so reopening is the refresh gesture.
      expect(out.lazyDirs).toEqual(["blog/out/", "blog/out/assets/"]);
    });

    it("names the collapsed directories lazy even before anything is loaded", () => {
      // The wrapper can only report an expansion for a row the host named, so
      // an un-loaded collapsed directory must appear here from the start.
      const out = mergeBrowseInventory(
        ["a.ts"],
        ["node_modules/", ".env"],
        undefined,
        settled,
      );
      expect(out.lazyDirs).toEqual(["node_modules/"]);
      // A plain ignored FILE is not expandable and must not be watched.
      expect(out.lazyDirs).not.toContain(".env");
    });

    it("drops children for a directory tracked has since claimed", () => {
      // Rule 2 already removes such an overlay dir; its stale children must go
      // with it, or a `.gitignore` edit would leave a ghost subtree behind
      // alongside the tracked files that now own the prefix.
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
      // A cache entry outliving its directory (the `.gitignore` stopped
      // ignoring it, or it was deleted) must not resurrect rows.
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
