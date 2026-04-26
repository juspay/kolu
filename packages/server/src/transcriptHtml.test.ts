import type { Transcript } from "kolu-common";
import { describe, expect, it } from "vitest";
import { transcriptToHtml } from "./transcriptHtml.ts";

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    agentKind: "claude-code",
    sessionId: "abcdef1234567890",
    title: "Hello session",
    cwd: "/tmp/x",
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
    // Two user prompts → two <section> anchors. (The selector string in
    // the embedded <script> also contains data-role="user", so match the
    // surrounding section element to count actual events.)
    const matches = html.match(/<section[^>]*data-role="user"/g);
    expect(matches?.length).toBe(2);
  });

  it("renders tool calls inside <details> for collapse/expand", () => {
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

  it("uses the friendly agent label in the header", () => {
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
});
