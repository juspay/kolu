/**
 * The transcript, as a pure function of what crossed the wire.
 *
 * These run without spawning anything, so the rendering rules stay pinned in
 * the ordinary unit lane even though the end-to-end criteria need real
 * processes.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatEvent, formatUpdate, TranscriptRenderer } from "./render.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("formatUpdate", () => {
  it("names the tool and its kind on a tool call", () => {
    expect(
      formatUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "grep -r retry test-results/",
        kind: "execute",
      }),
    ).toBe("◀ tool_call · execute — grep -r retry test-results/");
  });

  it("reports the status on a tool call update", () => {
    expect(
      formatUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      }),
    ).toBe("◀ tool_call_update · completed");
  });

  it("collapses a multi-line title onto one line", () => {
    expect(
      formatUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "edit\n  src/a.ts\n  src/b.ts",
        kind: "edit",
      }),
    ).toBe("◀ tool_call · edit — edit src/a.ts src/b.ts");
  });

  it("defers message chunks, which are streamed rather than lined", () => {
    expect(
      formatUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hi" },
      }),
    ).toBeNull();
  });
});

describe("formatEvent", () => {
  it("quotes the prompt as it was sent", () => {
    expect(formatEvent({ kind: "prompt", text: "why is it flaky?" })).toBe(
      '▶ session/prompt · "why is it flaky?"',
    );
  });

  it("says which option answered a permission request", () => {
    expect(
      formatEvent({
        kind: "permissionAutoAnswered",
        title: "git push",
        optionName: "Allow once",
      }),
    ).toBe(
      "◀ session/request_permission · git push → auto-answered Allow once",
    );
  });

  it("says plainly when a cancel had to be escalated", () => {
    expect(formatEvent({ kind: "cancelGraceExpired", graceMs: 3000 })).toBe(
      "⎯ cancel grace expired after 3000ms · killing adapter",
    );
  });
});

describe("TranscriptRenderer", () => {
  const render = (): { renderer: TranscriptRenderer; out: () => string } => {
    let out = "";
    return {
      renderer: new TranscriptRenderer((text) => {
        out += text;
      }),
      out: () => out,
    };
  };

  it("coalesces streamed chunks into one line", () => {
    const { renderer, out } = render();
    for (const text of ["It's a ", "port ", "collision."]) {
      renderer.event({
        kind: "update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    }
    renderer.event({ kind: "turnEnded", stopReason: "end_turn" });

    expect(out()).toBe(
      "◀ agent_message_chunk · It's a port collision.\n● turn end · stopReason: end_turn\n",
    );
  });

  it("closes the open chunk line before an interleaved tool call", () => {
    const { renderer, out } = render();
    renderer.event({
      kind: "update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "looking" },
      },
    });
    renderer.event({
      kind: "update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "ls",
        kind: "execute",
      },
    });

    expect(out().split("\n")).toEqual([
      "◀ agent_message_chunk · looking",
      "◀ tool_call · execute — ls",
      "",
    ]);
  });
});

describe("the transcript's sources", () => {
  it("is built from the wire and nothing else", () => {
    // The tile must be a view of the protocol, not a second reader of the
    // agent's private state — an agent's session files are its own business,
    // and a transcript assembled from them drifts from what actually happened.
    const sources = readdirSync(here)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !name.includes(".test.") && !name.includes(".fixture."))
      .map((name) => ({ name, text: readFileSync(join(here, name), "utf8") }));

    expect(sources.length).toBeGreaterThan(0);
    for (const { name, text } of sources) {
      expect({
        file: name,
        matches: text.match(/\.claude|\.codex|projects\//g),
      }).toEqual({ file: name, matches: null });
      expect({ file: name, matches: text.match(/readFile\w*\(/g) }).toEqual({
        file: name,
        matches: null,
      });
    }
  });
});
