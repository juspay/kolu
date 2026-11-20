import { describe, expect, it } from "vitest";
import { backfillSurface } from "./backfillSurface";
import type { Comment } from "./types";

const mk = (path: string, surface?: Comment["surface"]): Comment => ({
  id: `${path}:${surface ?? "none"}`,
  path,
  locator: { quote: "q", prefix: "", suffix: "" },
  surface,
  body: "b",
  createdAt: 0,
});

describe("backfillSurface", () => {
  it("pins a surface-less Markdown comment to source", () => {
    const [c] = backfillSurface([mk("doc.md")]);
    expect(c?.surface).toBe("source");
  });

  it("leaves a surface-less non-Markdown comment undefined (single-surface)", () => {
    expect(backfillSurface([mk("main.ts")])[0]?.surface).toBeUndefined();
    expect(backfillSurface([mk("page.html")])[0]?.surface).toBeUndefined();
  });

  it("does not clobber an already-tagged Markdown comment", () => {
    const out = backfillSurface([
      mk("doc.md", "prose"),
      mk("doc.md", "source"),
    ]);
    expect(out.map((c) => c.surface)).toEqual(["prose", "source"]);
  });

  it("preserves every other field of a backfilled comment", () => {
    const original = mk("doc.md");
    const [out] = backfillSurface([original]);
    expect(out).toEqual({ ...original, surface: "source" });
  });
});
