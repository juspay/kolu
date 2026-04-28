import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./index.ts";

describe("renderMarkdown", () => {
  it("turns paragraphs into <p>", () => {
    expect(renderMarkdown("hello\n\nworld")).toContain("<p>hello</p>");
    expect(renderMarkdown("hello\n\nworld")).toContain("<p>world</p>");
  });

  it("supports headings as h3/h4/h5", () => {
    const out = renderMarkdown("# H1\n\n## H2\n\n### H3");
    expect(out).toContain("<h3");
    expect(out).toContain("<h4");
    expect(out).toContain("<h5");
  });

  it("supports bullet and numbered lists", () => {
    expect(renderMarkdown("- one\n- two")).toContain('<ul class="md-list">');
    expect(renderMarkdown("1. one\n2. two")).toContain(
      'class="md-list md-list--ordered"',
    );
  });

  it("supports fenced code blocks with optional lang", () => {
    const out = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(out).toContain('data-lang="ts"');
    expect(out).toContain("const x = 1;");
  });

  it("supports blockquotes", () => {
    expect(renderMarkdown("> a quote")).toContain(
      '<blockquote class="md-quote">',
    );
  });

  it("renders GFM tables with header + body rows", () => {
    const md = [
      "| File | Lines | Description |",
      "|------|-------|-------------|",
      "| index.ts | 1-245 | Main entry |",
      "| router.ts | 1-305 | RPC router |",
    ].join("\n");
    const out = renderMarkdown(md);
    expect(out).toContain('<table class="md-table">');
    expect(out).toContain("<thead>");
    expect(out).toContain("<th>File</th>");
    expect(out).toContain("<tbody>");
    expect(out).toContain("<td>index.ts</td>");
    expect(out).not.toContain("| File | Lines |");
  });

  it("respects column alignment markers in the separator row", () => {
    const md = ["| L | C | R |", "|:---|:---:|---:|", "| a | b | c |"].join(
      "\n",
    );
    const out = renderMarkdown(md);
    expect(out).toContain('style="text-align:left"');
    expect(out).toContain('style="text-align:center"');
    expect(out).toContain('style="text-align:right"');
  });

  it("applies inline formatting inside table cells", () => {
    const md = [
      "| Name | Note |",
      "|------|------|",
      "| **bold** | `code` |",
    ].join("\n");
    const out = renderMarkdown(md);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<code>code</code>");
  });

  it("escapes HTML in markdown content", () => {
    const out = renderMarkdown("a <script>alert(1)</script> b");
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("absorbs indented continuation paragraphs into the same list item", () => {
    const md =
      "- Adds a new `postBuild` stage.\n\n  See [Type.hs](/x).\n\n- Adds webhook config types.";
    const out = renderMarkdown(md);
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
    expect((out.match(/<li>/g) ?? []).length).toBe(2);
    expect(out).toContain("<p>See");
  });
});
