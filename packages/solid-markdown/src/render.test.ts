import { describe, expect, it } from "vitest";
import { renderMarkdownToRawHtml } from "./render";
import { hasOwnScheme, safeHref } from "./url-policy";

const html = (md: string, inline = false) =>
  renderMarkdownToRawHtml(md, { inline });

describe("renderMarkdownToRawHtml — raw-HTML boundary", () => {
  it("passes raw HTML through for the document preview (rawHtml defaults on)", () => {
    expect(html("press <kbd>K</kbd>")).toContain("<kbd>K</kbd>");
    expect(html("<div>block</div>")).toContain("<div>block</div>");
  });

  it("escapes raw block + inline HTML for intent slots (rawHtml off)", () => {
    const out = renderMarkdownToRawHtml("<h1>raw</h1> and <kbd>K</kbd>", {
      rawHtml: false,
    });
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("<kbd>");
    expect(out).toContain("&lt;h1&gt;");
  });

  it("still renders markdown-produced tags when rawHtml is off", () => {
    // `#`/`**` produce <h1>/<strong> via the renderer, not the html hook, so
    // they survive even with raw HTML escaped.
    const out = renderMarkdownToRawHtml("# Heading\n\n**bold**", {
      rawHtml: false,
    });
    expect(out).toContain("<h1");
    expect(out).toContain("<strong>bold</strong>");
  });
});

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

describe("hasOwnScheme", () => {
  it("is true for refs with their own origin/scheme", () => {
    expect(hasOwnScheme("https://cdn.example.com/x.png")).toBe(true);
    expect(hasOwnScheme("data:image/png;base64,AAAA")).toBe(true);
    expect(hasOwnScheme("mailto:a@b.com")).toBe(true);
    expect(hasOwnScheme("//cdn.example.com/x.png")).toBe(true); // protocol-rel
    expect(hasOwnScheme("#section")).toBe(true); // in-page anchor
    expect(hasOwnScheme("  https://x.test/a  ")).toBe(true); // trimmed first
  });

  it("is false for bare repo-relative paths", () => {
    expect(hasOwnScheme("logo.png")).toBe(false);
    expect(hasOwnScheme("./docs/logo.png")).toBe(false);
    expect(hasOwnScheme("../img/x.png")).toBe(false);
    expect(hasOwnScheme("/img/x.png")).toBe(false); // root-absolute, not scheme
  });
});

describe("renderMarkdownToRawHtml — GFM structure", () => {
  it("renders headings at their level with a stable anchor id", () => {
    expect(html("# Title")).toContain('<h1 id="title">Title</h1>');
    expect(html("## Sub Section")).toContain(
      '<h2 id="sub-section">Sub Section</h2>',
    );
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

  it("emits each task checkbox as its list item's leading element, tight or loose", () => {
    // A tight list (no blank line between items) puts the checkbox directly
    // under the <li>; a loose list (blank-line-separated, GitHub's common
    // README shape) wraps it in the item's leading <p>. The sanitize pass
    // disables both shapes' checkboxes (read-only), so this pins the GFM
    // task-list output contract — a marked upgrade that changed the wrapper
    // would fail here rather than silently altering how checkboxes render.
    const tight = html("- [ ] a\n- [ ] b");
    expect(tight).toContain("<li><input");
    const loose = html("- [ ] a\n\n- [ ] b");
    expect(loose).toContain("<li><p><input");
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
    const out = html("a **b**", true);
    expect(out).not.toContain("<p>");
    expect(out).toContain("<strong>b</strong>");
  });
});

describe("renderMarkdownToRawHtml — code + breaks", () => {
  it("stamps the fence language on data-lang (for downstream highlighting)", () => {
    const out = html("```ts\nconst x = 1;\n```");
    expect(out).toContain('<code data-lang="ts">');
    expect(out).toContain("const x = 1;");
  });

  it("emits a bare <pre><code> for an unlabelled fence", () => {
    const out = html("```\nplain\n```");
    expect(out).toContain("<pre><code>");
    expect(out).not.toContain("data-lang");
  });

  it("honours the breaks option (GitHub folds soft breaks; chat keeps them)", () => {
    const folded = renderMarkdownToRawHtml("a\nb", { breaks: false });
    expect(folded).not.toContain("<br>");
    const broken = renderMarkdownToRawHtml("a\nb", { breaks: true });
    expect(broken).toContain("<br>");
  });
});

describe("renderMarkdownToRawHtml — GFM extensions", () => {
  it("renders footnotes as a superscript ref + a footnotes section", () => {
    const out = html("text[^1] here\n\n[^1]: the note");
    expect(out).toContain("<sup>");
    expect(out).toContain('href="#footnote-1"');
    expect(out).toContain('<section class="footnotes"');
    expect(out).toContain("the note");
    // The literal marker must NOT leak as text.
    expect(out).not.toContain("[^1]");
  });

  it("flags the forward ref with data-md-footnote and the back-ref with data-md-footnote-backref", () => {
    // marked-footnote marks a forward reference with the bare `data-footnote-ref`
    // attribute and the back-ref (↩) with `data-footnote-backref`; both are
    // stripped by the sanitizer. rewriteFootnotes stamps allowlist-safe sibling
    // flags — `data-md-footnote` on the forward ref (the host opens its
    // definition in a popover) and `data-md-footnote-backref` on the back-ref
    // (the popover strips these from its clone) — so each is recognisable after
    // sanitization. This test pins BOTH contracts: a marked-footnote bump that
    // changed either marker fails here loudly rather than silently breaking the
    // popover (a dangling forward ref) or leaving stray ↩ links in it.
    const out = html("body[^1] more\n\n[^1]: the note");
    // The forward flag rides the forward ref (which still carries
    // marked-footnote's own `data-footnote-ref`) and nothing else.
    expect(out).toMatch(/<a data-md-footnote [^>]*data-footnote-ref/);
    expect(out.match(/data-md-footnote(?![-\w])/g)).toHaveLength(1);
    // The forward ref's href targets the definition <li> (`#footnote-1`); the
    // host resolves the popover content from that landing id.
    expect(out).toContain('href="#footnote-1"');
    // The back-ref flag rides the back-ref (which still carries marked-footnote's
    // own `data-footnote-backref`) — and the forward ref does NOT carry it.
    expect(out).toMatch(
      /<a data-md-footnote-backref [^>]*data-footnote-backref/,
    );
    expect(out.match(/data-md-footnote-backref/g)).toHaveLength(1);
    expect(out).not.toMatch(/data-md-footnote [^>]*data-footnote-backref/);
  });

  it("tags every citation of a re-cited footnote, all pointing at one definition", () => {
    // A footnote cited twice mints two forward refs (`footnote-ref-1` and
    // `footnote-ref-1-2`), both linking to the single definition `#footnote-1`.
    // Both citations carry the forward flag; the definition's two back-refs carry
    // the back-ref flag, never the forward one. The `(?![-\w])` boundary keeps
    // the forward count from matching the `data-md-footnote-backref` substring.
    const out = html("a[^1] b[^1]\n\n[^1]: once");
    expect(out.match(/data-md-footnote(?![-\w])/g)).toHaveLength(2);
    expect(
      out.match(/data-md-footnote(?![-\w])[^>]*href="#footnote-1"/g),
    ).toHaveLength(2);
    expect(out).not.toMatch(
      /data-md-footnote(?![-\w])[^>]*data-footnote-backref/,
    );
    // Both back-refs carry the back-ref flag and never the forward one.
    expect(out.match(/data-md-footnote-backref/g)).toHaveLength(2);
  });

  it("rewrites GitHub alert blockquotes to a data-md-alert attribute", () => {
    const out = html("> [!WARNING]\n> be careful");
    expect(out).toContain('data-md-alert="warning"');
    expect(out).toContain("data-md-alert-title");
    expect(out).toContain("be careful");
    // The class-based markup and the literal token must be gone.
    expect(out).not.toContain('class="markdown-alert');
    expect(out).not.toContain("[!WARNING]");
  });

  it("renders a leading YAML front-matter block as a metadata table", () => {
    const out = html("---\ntitle: Hello\nauthor: Jane\n---\n\n# Real Heading");
    // The metadata renders as a marked table at the top, not an hr + Setext
    // heading, and the body still parses as plain markdown below it.
    expect(out).toContain("<table data-md-frontmatter>");
    expect(out).toContain("<th>title</th><td>Hello</td>");
    expect(out).toContain("<th>author</th><td>Jane</td>");
    expect(out).toContain('<h1 id="real-heading">Real Heading</h1>');
    expect(out).not.toContain("<hr>");
  });

  it("joins a list value with commas (the `tags:` case)", () => {
    const out = html("---\ntags:\n  - solid\n  - markdown\n---\n\nbody");
    expect(out).toContain("<th>tags</th><td>solid, markdown</td>");
  });

  it("escapes front-matter keys and values", () => {
    const out = html('---\nname: "<script>"\n---\n\nbody');
    expect(out).toContain("<td>&lt;script&gt;</td>");
    expect(out).not.toContain("<script>");
  });

  it("renders malformed front-matter raw instead of dropping it", () => {
    // Unparseable YAML (an unterminated flow sequence) can't become a table —
    // but it must stay *visible and fixable* as a raw YAML code block, never
    // silently dropped, and never misrendered as a half-parsed table or hr.
    const out = html("---\ntags: [a, b\n---\n\n# Body");
    expect(out).not.toContain("data-md-frontmatter");
    expect(out).toContain('<code data-lang="yaml">');
    expect(out).toContain("tags: [a, b");
    expect(out).toContain('<h1 id="body">Body</h1>');
  });

  it("renders a non-mapping front-matter block raw, not as a table", () => {
    // Valid YAML that isn't a key/value mapping (here a bare scalar) has no
    // rows to tabulate — show it raw rather than dropping the user's content.
    const out = html("---\njust a bare string\n---\n\n# Body");
    expect(out).not.toContain("data-md-frontmatter");
    expect(out).toContain('<code data-lang="yaml">');
    expect(out).toContain("just a bare string");
    expect(out).toContain('<h1 id="body">Body</h1>');
  });

  it("drops front-matter when `frontMatter` is off (the compact slot)", () => {
    const out = renderMarkdownToRawHtml(
      "---\ntitle: Hello\n---\n\n# Real Heading",
      { frontMatter: false },
    );
    expect(out).not.toContain("data-md-frontmatter");
    expect(out).not.toContain("title");
    expect(out).toContain('<h1 id="real-heading">Real Heading</h1>');
  });

  it("only treats a `---` block at the very start as front-matter", () => {
    const out = html("# Heading\n\n---\ntitle: Hello\n---\n");
    expect(out).not.toContain("data-md-frontmatter");
  });

  it("survives a cyclic YAML alias instead of crashing the preview", () => {
    // `&a [*a]` is valid YAML but builds a self-referential array, which
    // `JSON.stringify` rejects — formatting must degrade, not throw, and the
    // document body must still render.
    const out = html("---\na: &a [*a]\n---\n\n# Body");
    expect(out).toContain('<h1 id="body">Body</h1>');
    expect(out).toContain("data-md-frontmatter");
  });

  it("makes an empty front-matter block disappear cleanly", () => {
    // The shortest form, `---\n---`, has no body and no top-level mapping — it
    // must vanish (no table, no spurious hr) rather than fall through as
    // markdown.
    const out = html("---\n---\n# Body");
    expect(out).not.toContain("data-md-frontmatter");
    expect(out).not.toContain("<hr>");
    expect(out).toContain('<h1 id="body">Body</h1>');
  });
});

describe("wikilinks", () => {
  it("renders [[Note]] as a tagged anchor carrying the bare target payload", () => {
    const out = html("see [[Architecture]] for more");
    expect(out).toContain('data-md-wikilink="Architecture"');
    expect(out).toContain(">Architecture</a>");
  });

  it("uses the alias as the display text", () => {
    const out = html("[[Architecture|the arch doc]]");
    expect(out).toContain('data-md-wikilink="Architecture"');
    expect(out).toContain(">the arch doc</a>");
  });

  it("carries a #heading in the payload and the default display", () => {
    const out = html("[[Architecture#Overview]]");
    expect(out).toContain('data-md-wikilink="Architecture#Overview"');
    expect(out).toContain(">Architecture#Overview</a>");
  });

  it("supports a qualified target path", () => {
    const out = html("[[docs/Guide|read it]]");
    expect(out).toContain('data-md-wikilink="docs/Guide"');
    expect(out).toContain(">read it</a>");
  });

  it("leaves the ![[embed]] form inert (literal text, never a link)", () => {
    const out = html("![[Big Note]]");
    expect(out).not.toContain("data-md-wikilink");
    expect(out).toContain("![[Big Note]]");
  });

  it("does not produce wikilinks in intent slots (rawHtml off)", () => {
    // The compact/inline scales don't admit the wikilink syntax — `[[Note]]`
    // stays literal there, so a chat message can't mint a file-opening anchor.
    const out = renderMarkdownToRawHtml("[[Note]]", { rawHtml: false });
    expect(out).not.toContain("data-md-wikilink");
  });
});
