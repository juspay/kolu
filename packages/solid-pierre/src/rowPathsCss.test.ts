// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { rowPathsCss } from "./rowPathsCss.ts";

const DECL = "opacity: 0.5;";

describe("rowPathsCss", () => {
  it("emits no sheet for an empty set — never a selector-less rule", () => {
    expect(rowPathsCss([], DECL)).toBe("");
  });

  it("carries the caller's declaration verbatim as the rule body", () => {
    const css = rowPathsCss([".env"], DECL);
    expect(css).toContain("opacity: 0.5;");
    expect(css).not.toContain("var(");
  });

  it("targets each path by the data-item-path Pierre stamps on the row", () => {
    const css = rowPathsCss(["src/app.ts", ".env"], DECL);
    expect(css).toContain(`[data-item-path=${CSS.escape("src/app.ts")}]`);
    expect(css).toContain(`[data-item-path=${CSS.escape(".env")}]`);
    expect(css.match(/\{/g)).toHaveLength(1);
  });

  it("keeps a collapsed directory's trailing slash — it IS the row's key", () => {
    expect(rowPathsCss(["node_modules/"], DECL)).toContain(
      `[data-item-path=${CSS.escape("node_modules/")}]`,
    );
    expect(CSS.escape("node_modules/")).toContain("node_modules");
  });

  it("leaves no raw value-terminating character in the selector", () => {
    const nasty = ['a"b.log', "a\\b.log", "a\nb.log", "a\rb.log", "a\fb.log"];
    const css = rowPathsCss(nasty, DECL);
    const selectors = css.slice(0, css.indexOf("{")).split(",\n");
    expect(selectors).toHaveLength(nasty.length);
    for (const sel of selectors) {
      for (const raw of ["\n", "\r", "\f"]) expect(sel).not.toContain(raw);
      expect(sel).not.toMatch(/(^|[^\\])"/);
    }
    for (const p of nasty) expect(css).toContain(CSS.escape(p));
  });

  it("escapes a leading digit, which a hand-rolled quote/newline pass misses", () => {
    const css = rowPathsCss(["2024/report.log"], DECL);
    expect(css).toContain(`[data-item-path=${CSS.escape("2024/report.log")}]`);
    expect(css).not.toContain("[data-item-path=2024/report.log]");
  });
});
