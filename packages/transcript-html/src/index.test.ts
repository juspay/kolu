import type { Transcript } from "kolu-common";
import { describe, expect, it } from "vitest";
import { renderMarkdown, transcriptToHtml } from "./index.ts";

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    agentKind: "claude-code",
    sessionId: "abcdef1234567890",
    title: "Hello session",
    repoName: null,
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
    // collapse before any JS runs (no flash of visible content). Edits
    // start visible (`data-hide-edits="false"`).
    const html = transcriptToHtml(makeTranscript());
    expect(html).toMatch(/<body[^>]*\bdata-hide-tools="true"/);
    expect(html).toMatch(/<body[^>]*\bdata-hide-edits="false"/);
    expect(html).toContain('body[data-hide-tools="true"] .event--tool');
    expect(html).toContain('body[data-hide-edits="true"] .event--edit');
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
            inputs: { kind: "read", filePath: "/x" },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain("<details>");
    expect(html).toContain("Read");
  });

  it("shows a one-line tool summary in the collapsed row", () => {
    // Renderer dispatches on inputs.kind: glob → pattern; bash →
    // command; read → shortened path. The vendor-specific tool name
    // (Glob / exec_command / Read) is just the label.
    const html = transcriptToHtml(
      makeTranscript({
        cwd: null,
        events: [
          {
            kind: "tool_call",
            id: "g1",
            toolName: "Glob",
            inputs: { kind: "glob", pattern: "**/*.ts", path: null },
            ts: null,
          },
          {
            kind: "tool_call",
            id: "b1",
            toolName: "exec_command",
            inputs: { kind: "bash", command: "ls -la" },
            ts: null,
          },
          {
            kind: "tool_call",
            id: "r1",
            toolName: "Read",
            inputs: { kind: "read", filePath: "/a/b/c/d.ts" },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="tool-summary">**/*.ts</span>');
    expect(html).toContain('class="tool-summary">ls -la</span>');
    expect(html).toContain('class="tool-summary">…/c/d.ts</span>');
  });

  it("relativizes absolute paths against the transcript's cwd", () => {
    // relativizeTranscript runs inside transcriptToHtml: any path
    // strictly inside cwd becomes `./...`. Saves the reader from staring
    // at /home/srid/code/kolu/.worktrees/damn-booth/... over and over.
    const html = transcriptToHtml(
      makeTranscript({
        cwd: "/home/srid/proj",
        events: [
          {
            kind: "tool_call",
            id: "r1",
            toolName: "Read",
            inputs: {
              kind: "read",
              filePath: "/home/srid/proj/src/foo.ts",
            },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain("./src/foo.ts");
    expect(html).not.toContain("/home/srid/proj/src/foo.ts");
  });

  it("falls back to the session id when title is null and there are no events", () => {
    const html = transcriptToHtml(
      makeTranscript({ title: null, sessionId: "01234567xyz" }),
    );
    expect(html).toContain("Session 01234567");
  });

  it("displays the first user prompt as the rendered title", () => {
    // Claude's `summary` field is a rolling summary that drifts toward
    // the latest prompt — useless as a session label. The first user
    // prompt is the question that started the conversation, which is
    // exactly the right one-line label.
    const html = transcriptToHtml(
      makeTranscript({
        title: "this is the rolling summary, not the title we want",
        events: [
          { kind: "user", text: "Build me a flake.nix", ts: null },
          { kind: "assistant", text: "ok", model: null, ts: null },
          { kind: "user", text: "now add a CI step", ts: null },
        ],
      }),
    );
    expect(html).toContain('class="title-text">Build me a flake.nix</span>');
    expect(html).not.toContain("rolling summary");
    expect(html).not.toContain("now add a CI step</span>");
  });

  it("truncates long first prompts to keep the title one line", () => {
    // The full prompt still appears in the user event card; only the
    // title's copy is truncated.
    const longPrompt = "x".repeat(200);
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "user", text: longPrompt, ts: null }],
      }),
    );
    const titleMatch = html.match(/class="title-text">([^<]*)</);
    expect(titleMatch?.[1]?.endsWith("…")).toBe(true);
    expect((titleMatch?.[1]?.length ?? 0) < 130).toBe(true);
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

  it("renders model + tokens in the byline and PR in the title prefix", () => {
    const html = transcriptToHtml(
      makeTranscript({
        repoName: "juspay/kolu",
        model: "claude-opus-4-6",
        contextTokens: 47_000,
        pr: { number: 742, url: "https://github.com/juspay/kolu/pull/742" },
      }),
    );
    expect(html).toContain("claude-opus-4-6");
    expect(html).toContain("47K");
    expect(html).toContain("PR #742");
    expect(html).toContain("https://github.com/juspay/kolu/pull/742");
    // PR + repo live inside the rich title's prefix line.
    expect(html).toMatch(
      /class="title-prefix"[\s\S]*juspay\/kolu[\s\S]*PR #742/,
    );
  });

  it("emits dock toggles for tools, reasoning, and theme", () => {
    const html = transcriptToHtml(makeTranscript());
    expect(html).toContain('data-toggle="tools"');
    expect(html).toContain('data-toggle="reasoning"');
    expect(html).toContain('data-toggle="theme"');
    // Manual override selectors for the auto theme.
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain(':root[data-theme="light"]');
  });

  it("hides reasoning by default at the body level", () => {
    // Same flash-of-content prevention as tools: collapse server-side
    // before any JS runs.
    const html = transcriptToHtml(makeTranscript());
    expect(html).toMatch(/<body[^>]*\bdata-hide-reasoning="true"/);
    expect(html).toContain(
      'body[data-hide-reasoning="true"] .event--reasoning',
    );
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

  it("places repo and PR in the title prefix above the title text", () => {
    const html = transcriptToHtml(
      makeTranscript({
        title: "Hello session",
        repoName: "juspay/kolu",
        pr: { number: 742, url: "https://github.com/juspay/kolu/pull/742" },
      }),
    );
    // Eyebrow no longer carries repo/PR.
    const eyebrowStart = html.indexOf('class="eyebrow"');
    const titleStart = html.indexOf('class="title"');
    const eyebrow = html.slice(eyebrowStart, titleStart);
    expect(eyebrow).not.toContain("juspay/kolu");
    expect(eyebrow).not.toContain("PR #742");
    // They live inside the rich-title prefix.
    expect(html).toMatch(
      /class="title-prefix"[\s\S]*juspay\/kolu[\s\S]*PR #742/,
    );
    // The actual title text follows.
    expect(html).toContain('class="title-text">Hello session</span>');
  });

  it("groups agent + model + tokens in the byline runtime stamp", () => {
    const html = transcriptToHtml(
      makeTranscript({
        agentKind: "claude-code",
        model: "claude-opus-4-6",
        contextTokens: 47_000,
      }),
    );
    expect(html).toContain('class="byline-runtime"');
    expect(html).toContain("Claude Code");
    expect(html).toContain("claude-opus-4-6");
    expect(html).toContain("47K tokens");
  });

  it("renders Edit-tool calls as a diff and exempts them from tool hiding", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "tool_call",
            id: "e1",
            toolName: "Edit",
            inputs: {
              kind: "edit",
              filePath: "/tmp/file.ts",
              edits: [{ oldText: "const x = 1;", newText: "const x = 2;" }],
            },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="event event--edit"');
    expect(html).not.toContain("event--tool-call"); // routed to edit, not tool-call
    expect(html).toContain("/tmp/file.ts");
    expect(html).toContain("diff-del");
    expect(html).toContain("diff-add");
  });

  it("collapses long user prompts behind a Show all N lines toggle", () => {
    // A 50-line slash-command body shouldn't dominate the page. The
    // wrapper carries the line count; the toggle button uses the same
    // CSS class as the diff toggle so both share the JS handler.
    const longPrompt = Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "user", text: longPrompt, ts: null }],
      }),
    );
    expect(html).toContain('class="msg-collapsible is-collapsed"');
    expect(html).toContain('data-line-count="50"');
    expect(html).toContain("Show all 50 lines");
    expect(html).toContain('class="msg-toggle"');
  });

  it("leaves short user prompts unwrapped", () => {
    // The CSS + JS reference these class names, so we can't assert
    // they're absent globally — check the wrapping attribute instead.
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "user", text: "just one line", ts: null }],
      }),
    );
    expect(html).not.toContain('class="msg-collapsible');
    expect(html).not.toContain('class="msg-toggle"');
  });

  it("collapses long assistant messages too", () => {
    const longReply = Array.from({ length: 30 }, (_, i) => `para ${i}`).join(
      "\n\n",
    );
    const html = transcriptToHtml(
      makeTranscript({
        events: [{ kind: "assistant", text: longReply, model: null, ts: null }],
      }),
    );
    expect(html).toContain('class="msg-collapsible is-collapsed"');
    expect(html).toContain('class="msg-toggle"');
  });

  it("indents nested subtasks via --subtask-depth so the inner block reads visually inside its parent", () => {
    // OpenCode's task tool can recursively spawn subagents — a child
    // subtask inside a parent subtask. The IR carries this as
    // start/start/end/end. Each event's left-pad uses an inline
    // --subtask-depth set per nesting level.
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          { kind: "user", text: "go", ts: null },
          {
            kind: "subtask_start",
            description: "outer",
            agentName: "lowy",
            sessionId: null,
            ts: null,
          },
          { kind: "assistant", text: "outer reply", model: null, ts: null },
          {
            kind: "subtask_start",
            description: "inner",
            agentName: "explore",
            sessionId: null,
            ts: null,
          },
          { kind: "assistant", text: "inner reply", model: null, ts: null },
          { kind: "subtask_end", ts: null },
          { kind: "subtask_end", ts: null },
          { kind: "assistant", text: "wrap", model: null, ts: null },
        ],
      }),
    );
    // Top-level events carry no --subtask-depth.
    expect(html).toContain('data-role="user" data-prompt-index="0">');
    // The outer subtask_start renders at depth 1.
    expect(html).toMatch(
      /subtask-boundary--start[^>]*style="--subtask-depth: 1"/,
    );
    // Events inside the outer subtask render at depth 1 too.
    expect(html).toMatch(
      /event--assistant"[^>]*style="--subtask-depth: 1">[^<]*<div class="gutter">[\s\S]*?outer reply/,
    );
    // The inner subtask_start renders at depth 2.
    expect(html).toMatch(
      /subtask-boundary--start[^>]*style="--subtask-depth: 2"/,
    );
    // Events inside the inner subtask render at depth 2.
    expect(html).toContain('--subtask-depth: 2"');
    // Inner end at depth 2, outer end at depth 1.
    const ends = html.match(
      /subtask-boundary--end"[^>]*style="--subtask-depth: (\d+)"/g,
    );
    expect(ends?.length).toBe(2);
    expect(ends?.[0]).toContain('"--subtask-depth: 2"'); // inner end first
    expect(ends?.[1]).toContain('"--subtask-depth: 1"'); // outer end after
    // After both subtasks close, the trailing assistant is back at depth 0.
    expect(html).toMatch(
      /event--assistant">[^<]*<div class="gutter">[\s\S]*?wrap/,
    );
    // CSS rule that reads the custom property.
    expect(html).toContain("--subtask-depth");
    expect(html).toContain(
      "padding-left: calc(var(--subtask-depth, 0) * 1.25rem)",
    );
  });

  it("renders subtask_start and subtask_end as visible boundary dividers", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          { kind: "user", text: "go", ts: null },
          {
            kind: "subtask_start",
            description: "Lowy review",
            agentName: "lowy",
            sessionId: "ses_child987654321xx",
            ts: null,
          },
          { kind: "user", text: "child prompt", ts: null },
          { kind: "subtask_end", ts: null },
        ],
      }),
    );
    expect(html).toContain("subtask-boundary--start");
    expect(html).toContain("subtask-boundary--end");
    expect(html).toContain("Lowy review");
    expect(html).toContain("@lowy");
    // Truncated to 12 chars in the renderer.
    expect(html).toContain("ses_child987");
    expect(html).toContain("End subtask");
    // Click affordance: the start divider is a button that toggles
    // collapse. The disclosure marker rotates via CSS.
    expect(html).toMatch(/subtask-boundary--start[^"]*"\s+role="button"/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-collapsed="false"');
    expect(html).toContain("subtask-disclosure");
  });

  it("renders OpenCode's edit-tool inputs as a diff", () => {
    // OpenCode emits `edit` with camelCase fields; the loader normalizes
    // it to {kind:"edit", filePath, edits: [...]} — same typed shape as
    // Claude Code. Renderer dispatches on kind, no shape probing.
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "tool_call",
            id: "oce1",
            toolName: "edit",
            inputs: {
              kind: "edit",
              filePath: "/tmp/file.ts",
              edits: [{ oldText: "const x = 1;", newText: "const x = 2;" }],
            },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="event event--edit"');
    expect(html).toContain("/tmp/file.ts");
    expect(html).toContain("diff-del");
    expect(html).toContain("diff-add");
  });

  it("renders write-tool inputs as a whole-file diff", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "tool_call",
            id: "ocw1",
            toolName: "write",
            inputs: {
              kind: "write",
              filePath: "/tmp/new.ts",
              content: "line1\nline2\n",
            },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="event event--edit"');
    expect(html).toContain("/tmp/new.ts");
    expect(html).toContain("diff-add");
  });

  it("renders reasoning text through the markdown pipeline", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "reasoning",
            text: "Let me think.\n\n1. **bold** point\n2. `code` point",
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="card-text card-text--reasoning md"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('class="md-list md-list--ordered"');
  });

  it("renders apply_patch payloads as a colored unified diff", () => {
    const html = transcriptToHtml(
      makeTranscript({
        events: [
          {
            kind: "tool_call",
            id: "p1",
            toolName: "apply_patch",
            inputs: {
              kind: "patch",
              text: "*** Begin Patch\n*** Add File: a.txt\n+hello\n+world\n*** End Patch",
            },
            ts: null,
          },
        ],
      }),
    );
    expect(html).toContain('class="event event--edit"');
    expect(html).toContain("diff-add");
    expect(html).toContain("Begin Patch");
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
    expect(out).toContain("<th>Lines</th>");
    expect(out).toContain("<th>Description</th>");
    expect(out).toContain("<tbody>");
    expect(out).toContain("<td>index.ts</td>");
    expect(out).toContain("<td>1-245</td>");
    expect(out).toContain("<td>RPC router</td>");
    // The literal `|` separators must not survive into the rendered output.
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
    // The screenshot bug: each `- bullet` was rendering as its own
    // `<ul>` because the indented "See ..." line below it broke list
    // detection. With continuation handling, the bullet and its sub-
    // paragraph should live inside one `<li>`.
    const md =
      "- Adds a new `postBuild` stage.\n\n  See [Type.hs](/x).\n\n- Adds webhook config types.";
    const out = renderMarkdown(md);
    // One `<ul>` with two `<li>`s, not two `<ul>`s.
    expect((out.match(/<ul/g) ?? []).length).toBe(1);
    expect((out.match(/<li>/g) ?? []).length).toBe(2);
    // The continuation paragraph wraps in `<p>` inside the first `<li>`.
    expect(out).toContain("<p>See");
  });
});
