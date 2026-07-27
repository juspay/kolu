// @vitest-environment happy-dom
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
    const css = rowPathsCss(["src/app.ts", ".env"], DECL);
    expect(css).toContain(`[data-item-path=${CSS.escape("src/app.ts")}]`);
    expect(css).toContain(`[data-item-path=${CSS.escape(".env")}]`);
    // One rule body for the whole selector list, not one rule per path.
    expect(css.match(/\{/g)).toHaveLength(1);
  });

  it("keeps a collapsed directory's trailing slash — it IS the row's key", () => {
    // The collapsed listing is what keeps this sheet small: `node_modules/` is
    // one row, so one selector, never one per contained file. Stripping the
    // slash would target a row that does not exist and silently dim nothing.
    // Asserted on the ESCAPED form, since that is what reaches the sheet.
    expect(rowPathsCss(["node_modules/"], DECL)).toContain(
      `[data-item-path=${CSS.escape("node_modules/")}]`,
    );
    expect(CSS.escape("node_modules/")).toContain("node_modules");
  });

  it("leaves no raw value-terminating character in the selector", () => {
    // Delegated to `CSS.escape`, so this pins the INTEGRATION (that escaping
    // happens at all, on the value, for every path) rather than re-deriving the
    // CSS Syntax escape table the platform already owns. Each of these
    // characters is legal in a filename and would otherwise end the attribute
    // value — and because the caller concatenates this output with its other
    // rules into one `replaceSync` payload, one raw path would drop every
    // sibling rule in that sheet, not just its own selector.
    const nasty = ['a"b.log', "a\\b.log", "a\nb.log", "a\rb.log", "a\fb.log"];
    const css = rowPathsCss(nasty, DECL);
    // Per SELECTOR, not over the whole list: the list is joined with `,\n`, so
    // its newlines are this function's own formatting. Asserting over the joined
    // string would be asserting something false.
    const selectors = css.slice(0, css.indexOf("{")).split(",\n");
    expect(selectors).toHaveLength(nasty.length);
    for (const sel of selectors) {
      // Line terminators cannot appear literally inside a value at all —
      // `CSS.escape` emits them as numeric escapes (`\a `, `\d `, `\c `).
      for (const raw of ["\n", "\r", "\f"]) expect(sel).not.toContain(raw);
      // A quote CAN appear, but only backslash-escaped. Assert that shape
      // rather than banning the character, which would be stricter than CSS
      // requires and would fail against correct output.
      expect(sel).not.toMatch(/(^|[^\\])"/);
    }
    // And every path is still represented — escaped, not dropped.
    for (const p of nasty) expect(css).toContain(CSS.escape(p));
  });

  it("escapes a leading digit, which a hand-rolled quote/newline pass misses", () => {
    // The case that motivated delegating: `2024/report.log` starts with a digit,
    // which is invalid at the head of an ident and needs a numeric escape. A
    // hand-rolled escaper written around quotes and newlines has no reason to
    // think of it.
    const css = rowPathsCss(["2024/report.log"], DECL);
    expect(css).toContain(`[data-item-path=${CSS.escape("2024/report.log")}]`);
    expect(css).not.toContain("[data-item-path=2024/report.log]");
  });
});
