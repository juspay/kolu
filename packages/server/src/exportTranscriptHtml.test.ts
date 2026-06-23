import type { Transcript } from "kolu-common/transcript";
import { transcriptToHtml } from "kolu-transcript-html";
import { describe, expect, it } from "vitest";

const bigToolOutput = `secret-output\n${"x".repeat(20_000)}`;

const transcript: Transcript = {
  agentKind: "codex",
  sessionId: "thread-1234567890",
  title: null,
  repoName: "juspay/kolu",
  cwd: "/home/srid/code/kolu",
  model: "gpt-test",
  contextTokens: 42_000,
  pr: { number: 12, url: "https://github.com/juspay/kolu/pull/12" },
  exportedAt: Date.UTC(2026, 5, 23, 12, 0, 0),
  events: [
    { kind: "user", text: "Can you explain this?", ts: null },
    {
      kind: "assistant",
      text: "Yes.\n\n```ts\nconst answer = 42;\n```",
      model: "gpt-test",
      ts: null,
    },
    {
      kind: "tool_call",
      id: "call-1",
      toolName: "bash",
      inputs: { kind: "bash", command: "printf secret-output" },
      ts: null,
    },
    {
      kind: "tool_result",
      id: "call-1",
      output: bigToolOutput,
      isError: false,
      ts: null,
    },
  ],
};

const navigationTranscript: Transcript = {
  ...transcript,
  events: [
    { kind: "user", text: "First question?", ts: null },
    {
      kind: "assistant",
      text: "First answer.",
      model: "gpt-test",
      ts: null,
    },
    { kind: "user", text: "Second question?", ts: null },
    {
      kind: "assistant",
      text: "Second answer.",
      model: "gpt-test",
      ts: null,
    },
  ],
};

describe("transcriptToHtml export modes", () => {
  it("renders a lightweight chat log without serialized tool payloads", async () => {
    const html = await transcriptToHtml(transcript, { mode: "chat" });

    expect(html).toContain("Chat log");
    expect(html).toContain("Can you explain this?");
    expect(html).toContain('aria-label="Human message 1 of 1"');
    expect(html).toContain('aria-label="AI message"');
    expect(html).toContain('<strong class="speaker">Human</strong>');
    expect(html).toContain('<strong class="speaker">AI</strong>');
    expect(html).toContain("const answer = 42;");
    expect(html).not.toContain("secret-output");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('<nav class="prompt-jump"');
    expect(html).not.toContain("diffs-container");
    expect(html.length).toBeLessThan(12_000);
  });

  it("renders the same shell with collapsed full-transcript details", async () => {
    const html = await transcriptToHtml(transcript, { mode: "full" });

    expect(html).toContain("Full transcript");
    expect(html).toContain('<details class="detail tool-call">');
    expect(html).toContain("printf secret-output");
    expect(html).toContain(bigToolOutput);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("diffs-container");
  });

  it("adds prompt-jump controls for multi-prompt conversations", async () => {
    const html = await transcriptToHtml(navigationTranscript, {
      mode: "chat",
    });

    expect(html).toContain('id="human-1"');
    expect(html).toContain('id="human-2"');
    expect(html).toContain('aria-label="Human message 1 of 2"');
    expect(html).toContain('aria-label="Human message 2 of 2"');
    expect(html).toContain('class="prompt-jump"');
    expect(html).toContain('data-prompt-nav-action="prev"');
    expect(html).toContain('data-prompt-nav-action="next"');
    expect(html).toContain("<script>");
  });
});
