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
      const out = mergeBrowseInventory(undefined, ["node_modules/", ".env"], {
        ...settled,
        trackedPending: true,
      });
      expect(out.paths).toEqual([]);
      expect(out.ignored).toEqual([]);
      expect(out.pending).toBe(true);
    });

    it("distinguishes that from a genuinely EMPTY tracked listing", () => {
      // An empty repo IS an authority — it says "nothing is tracked" — so the
      // overlay is admitted in full. This is the case `undefined` was being
      // conflated with.
      const out = mergeBrowseInventory([], ["node_modules/"], settled);
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
        settled,
      );
      expect(out.paths).toEqual(["src/app.ts", "build.log", "node_modules/"]);
      expect(out.ignored).toEqual(["node_modules/"]);
      // No path appears twice — the property Pierre actually depends on.
      expect(new Set(out.paths).size).toBe(out.paths.length);
    });

    it("keeps the overlay a strict subset of the rendered paths", () => {
      const out = mergeBrowseInventory(["a.ts"], ["b.log", "a.ts"], settled);
      for (const p of out.ignored) expect(out.paths).toContain(p);
    });
  });

  describe("rule 3 — readiness covers the consulted sources only", () => {
    it("ignores the overlay's readiness while the toggle is OFF", () => {
      // An idle createPolledQuery stays pending forever, so folding it in
      // unconditionally would wedge the tree permanently pending.
      const out = mergeBrowseInventory(["a.ts"], undefined, {
        trackedPending: false,
        ignoredPending: true,
        showIgnored: false,
      });
      expect(out.pending).toBe(false);
    });

    it("counts the overlay's readiness while the toggle is ON", () => {
      const out = mergeBrowseInventory(["a.ts"], undefined, {
        trackedPending: false,
        ignoredPending: true,
        showIgnored: true,
      });
      expect(out.pending).toBe(true);
    });

    it("is pending whenever the tracked listing is, toggle regardless", () => {
      for (const showIgnored of [true, false]) {
        const out = mergeBrowseInventory(["a.ts"], [], {
          trackedPending: true,
          ignoredPending: false,
          showIgnored,
        });
        expect(out.pending).toBe(true);
      }
    });
  });

  it("settles to exactly the tracked listing when nothing is ignored", () => {
    const out = mergeBrowseInventory(["a.ts", "b.ts"], [], settled);
    expect(out).toEqual({
      paths: ["a.ts", "b.ts"],
      ignored: [],
      pending: false,
    });
  });
});
