import { describe, expect, it } from "vitest";
import { rowPathsCss } from "./rowPathsCss.ts";

/** Stand-in for the host theme's declaration — the appearance is the caller's
 *  to decide, so this file only pins the selector construction around it. */
const DECL = "opacity: 0.5;";

describe("rowPathsCss", () => {
  it("emits no sheet for an empty set — never a selector-less rule", () => {
    expect(rowPathsCss([], DECL)).toBe("");
  });

  it("carries the caller's declaration verbatim as the rule body", () => {
    // No `var(--…, fallback)` indirection: a custom property nothing sets is a
    // knob with no configurator, and it would put a second answer to "what does
    // a dimmed row look like" outside the theme that owns every other one.
    const css = rowPathsCss([".env"], DECL);
    expect(css).toContain("opacity: 0.5;");
    expect(css).not.toContain("var(");
  });

  it("targets each path by the data-item-path Pierre stamps on the row", () => {
    const css = rowPathsCss(["node_modules/", ".env"], DECL);
    expect(css).toContain('[data-item-path="node_modules/"]');
    expect(css).toContain('[data-item-path=".env"]');
    // One rule body for the whole selector list, not one rule per path.
    expect(css.match(/\{/g)).toHaveLength(1);
  });

  it("keeps a collapsed directory's trailing slash — it IS the row's key", () => {
    // The collapsed listing is what keeps this sheet small: `node_modules/` is
    // one row, so one selector, never one per contained file. Stripping the
    // slash would target a non-existent row and silently dim nothing.
    expect(rowPathsCss(["node_modules/"], DECL)).toContain(
      '[data-item-path="node_modules/"]',
    );
  });

  it("escapes a quote in a filename so it cannot terminate the selector", () => {
    // git hands paths through verbatim under `-z`, so `"` is legal in a name.
    const css = rowPathsCss(['weird".log'], DECL);
    expect(css).toContain('[data-item-path="weird\\".log"]');
    // The raw, unescaped form must not appear — that would close the string
    // early and turn the rest of the path into malformed selector syntax.
    expect(css).not.toContain('[data-item-path="weird".log"]');
  });

  it("escapes a backslash before escaping quotes, so the two can't combine", () => {
    // A trailing backslash would otherwise escape the closing quote.
    const css = rowPathsCss(["dir\\"], DECL);
    expect(css).toContain('[data-item-path="dir\\\\"]');
  });
});
