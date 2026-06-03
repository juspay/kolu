import { describe, expect, it } from "vitest";
import { renderMarkdownToRawHtml, safeHref } from "./render";

const html = (md: string, links = true, inline = false) =>
  renderMarkdownToRawHtml(md, { links, inline });

describe("safeHref", () => {
  it("allows http(s), mailto, and in-page anchors", () => {
    expect(safeHref("https://example.com/x")).toBe("https://example.com/x");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeHref("#section")).toBe("#section");
  });

  it("allows relative refs (resolved, not rewritten)", () => {
    expect(safeHref("./docs/guide.md")).toBe("./docs/guide.md");
    expect(safeHref("../up.md")).toBe("../up.md");
  });

  it("blocks script-capable schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHref("   ")).toBeUndefined();
  });
});

describe("renderMarkdownToRawHtml — GFM structure", () => {
  it("renders headings at their level", () => {
    expect(html("# Title")).toContain("<h1>Title</h1>");
    expect(html("## Sub")).toContain("<h2>Sub</h2>");
  });

  it("renders emphasis, strong, and strikethrough", () => {
    const out = html("_i_ **b** ~~s~~");
    expect(out).toContain("<em>i</em>");
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<del>s</del>");
  });

  it("renders inline code and fenced code blocks", () => {
    expect(html("a `code` b")).toContain("<code>code</code>");
    const block = html("```js\nconst x = 1;\n```");
    expect(block).toContain("<pre>");
    expect(block).toContain("const x = 1;");
  });

  it("renders GFM tables with alignment", () => {
    const out = html("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain('<th align="left">a</th>');
    expect(out).toContain('<th align="right">b</th>');
    expect(out).toContain("<td");
  });

  it("renders GFM task lists with checkbox state", () => {
    const out = html("- [x] done\n- [ ] todo");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("checked");
    expect(out).toContain("done");
    expect(out).toContain("todo");
  });
});

describe("renderMarkdownToRawHtml — links", () => {
  it("renders safe links as anchors with rel/target", () => {
    const out = html("[site](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(">site</a>");
  });

  it("autolinks bare URLs (GFM)", () => {
    expect(html("see https://example.com now")).toContain(
      'href="https://example.com"',
    );
  });

  it("renders a javascript: link as inert text, never an anchor", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("renders no anchors at all when links are disabled", () => {
    const out = html("[site](https://example.com)", false);
    expect(out).not.toContain("<a ");
    expect(out).toContain("site");
  });
});

describe("renderMarkdownToRawHtml — images", () => {
  // The parse layer just emits <img>; the load-or-fallback decision lives in
  // the DOM sanitize pass (covered by the e2e suite), where markdown- and
  // inline-HTML images converge.
  it("emits an <img> with src and alt for a markdown image", () => {
    const out = html("![logo](https://cdn.example.com/logo.png)");
    expect(out).toContain('src="https://cdn.example.com/logo.png"');
    expect(out).toContain('alt="logo"');
  });

  it("emits an <img> for a relative image too (fallback is downstream)", () => {
    const out = html("![the logo](./assets/logo.png)");
    expect(out).toContain("<img");
    expect(out).toContain('src="./assets/logo.png"');
  });
});

describe("renderMarkdownToRawHtml — inline HTML passthrough", () => {
  it("passes through inline elements verbatim (to be sanitized downstream)", () => {
    expect(html("press <kbd>Ctrl</kbd>")).toContain("<kbd>Ctrl</kbd>");
  });

  it("passes through block-level alignment wrappers", () => {
    const out = html('<p align="center">centered</p>');
    expect(out).toContain('align="center"');
    expect(out).toContain("centered");
  });
});

describe("renderMarkdownToRawHtml — inline variant", () => {
  it("emits no block wrapper", () => {
    const out = html("a **b**", true, true);
    expect(out).not.toContain("<p>");
    expect(out).toContain("<strong>b</strong>");
  });
});
