import type { Transcript } from "kolu-common";
import { describe, expect, it } from "vitest";
import { renderMarkdown, transcriptToHtml } from "./transcriptHtml.ts";

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    agentKind: "claude-code",
    sessionId: "abcdef1234567890",
    title: "Hello session",
    cwd: "/tmp/x",
    model: null,
    contextTokens: null,
    pr: null,
    exportedAt: 1_700_000_000_000,
    events: [],
    ...overrides,
  };
}

describe("transcriptToHtml", () => {
  it("emits a self-contained HTML document", () => {
    const html = transcriptToHtml(makeTranscript());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain("Hello session");
    // No external CSS or JS references.
    expect(html).not.toContain('<link rel="stylesheet"');
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
  });

  it("hides tool calls by default at the body level", () => {
    // The body carries `data-hide-tools="true"` server-side so tools
    // collapse before any JS runs (no flash of visible content).
    const html = transcriptToHtml(makeTranscript());
    expect(html).toContain('<body data-hide-tools="true">');
    expect(html).toContain('body[data-hide-tools="true"] .event--tool');
  });

  it("escapes user content to prevent HTML injection", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "user", text: "<script>alert(1)</script>", ts: null }],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders an empty-state when events is []", () => {
    const html = transcriptToHtml(makeTranscript({ events: [] }));
    expect(html).toContain("No conversation events found");
  });

  it("marks user events with data-role for prompt navigation", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          { kind: "user", text: "first", ts: null },
          { kind: "assistant", text: "ok", model: null, ts: null },
          { kind: "user", text: "second", ts: null },
        ],
      }),
    );
    const matches = html.match(/<section[^>]*data-role="user"/g);
    expect(matches?.length).toBe(2);
  });

  it("renders tool calls inside <details> with the tool name", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "tool_call",
            id: "t1",
            toolName: "Read",
            inputs: { path: "/x" },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain("<details>");
    expect(html).toContain("Read");
    expect(html).toContain("&quot;path&quot;");
  });

  it("falls back to the session id when title is null", () => {
    const html = transcriptToHtml(
      makeTranscript({ title: null, sessionId: "01234567xyz" }),
    );
    expect(html).toContain("Session 01234567");
  });

  it("uses the friendly agent label in the masthead eyebrow", () => {
    expect(
      transcriptToHtml(makeTranscript({ agentKind: "claude-code" })),
    ).toContain("Claude Code");
    expect(
      transcriptToHtml(makeTranscript({ agentKind: "opencode" })),
    ).toContain("OpenCode");
    expect(transcriptToHtml(makeTranscript({ agentKind: "codex" }))).toContain(
      "Codex",
    );
  });

  it("renders model, compact token count, and PR link in the byline", () => {
    const html = transcriptToHtml(
      makeTranscript({
        model: "claude-opus-4-6",
        contextTokens: 47_000,
        pr: { number: 742, url: "https://github.com/juspay/kolu/pull/742" },
      }),
    );
    expect(html).toContain("claude-opus-4-6");
    expect(html).toContain("47K");
    expect(html).toContain("PR #742");
    expect(html).toContain("https://github.com/juspay/kolu/pull/742");
  });

  it("emits dock toggles for tools and theme", () => {
    const html = transcriptToHtml(makeTranscript());
    expect(html).toContain('data-toggle="tools"');
    expect(html).toContain('data-toggle="theme"');
    // Manual override selectors for the auto theme.
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain(':root[data-theme="light"]');
  });

  it("renders role icons inline as SVG (no external assets)", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          { kind: "user", text: "hi", ts: null },
          { kind: "assistant", text: "hello", model: null, ts: null },
        ],
      }),
    );
    expect(html).toContain('aria-label="User"');
    expect(html).toContain('aria-label="Assistant"');
    expect(html.match(/<svg[^>]*viewBox/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders assistant messages through the markdown pipeline", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "assistant",
            text: "**Bold** and *italic* and `code` and a [link](https://example.com).",
            model: null,
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('href="https://example.com"');
  });

  it("leaves user prompts as plain text (no markdown processing)", () => {
    // User prompts often contain literal ** or backticks that should NOT
    // be transformed. Markdown is for the assistant's output only.
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "user", text: "show me **bold** in code", ts: null }],
      }),
    );
    expect(html).not.toContain("<strong>bold</strong>");
    expect(html).toContain("**bold**");
  });
});

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

  it("escapes HTML in markdown content", () => {
    const out = renderMarkdown("a <script>alert(1)</script> b");
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });
});
