import { describe, expect, it } from "vitest";
import { backfillSurface } from "./backfillSurface";
import type { Comment } from "./types";

/** `surface` arrived with the rendered-Markdown comment surface (#1162).
 *  The overlay now keeps both Source ⇄ Rendered surfaces mounted and filters
 *  each by EXACT surface match, so a Markdown comment persisted before the
 *  field existed (surface-less, made on the only-then-commentable source view)
 *  would match neither overlay and silently lose its highlight + tray jump.
 *  `backfillSurface` pins those legacy entries to `"source"` at load. These
 *  tests pin that regression and the boundaries it must not cross. */

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
    // plain source / diff / HTML-iframe stay undefined so their lone overlay
    // matches `undefined === undefined`.
    expect(backfillSurface([mk("main.ts")])[0]?.surface).toBeUndefined();
    expect(backfillSurface([mk("page.html")])[0]?.surface).toBeUndefined();
  });

  it("does not clobber an already-tagged Markdown comment", () => {
    const out = backfillSurface([mk("doc.md", "prose"), mk("doc.md", "source")]);
    expect(out.map((c) => c.surface)).toEqual(["prose", "source"]);
  });

  it("preserves every other field of a backfilled comment", () => {
    const original = mk("doc.md");
    const [out] = backfillSurface([original]);
    expect(out).toEqual({ ...original, surface: "source" });
  });
});
