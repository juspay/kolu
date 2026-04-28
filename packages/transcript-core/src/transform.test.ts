import { describe, expect, it } from "vitest";
import {
  makeRelativizer,
  relativizeTranscript,
  transformStrings,
} from "./transform.ts";
import type { Transcript } from "./schemas.ts";

function transcriptWith(overrides: Partial<Transcript>): Transcript {
  return {
    agentKind: "claude-code",
    sessionId: "s1",
    title: null,
    repoName: null,
    cwd: null,
    model: null,
    contextTokens: null,
    pr: null,
    exportedAt: 0,
    events: [],
    ...overrides,
  };
}

describe("makeRelativizer", () => {
  it("returns null when cwd is null or empty", () => {
    expect(makeRelativizer(null)).toBeNull();
    expect(makeRelativizer("")).toBeNull();
    expect(makeRelativizer("/")).toBeNull();
  });

  it("rewrites in-cwd paths to ./relative form", () => {
    const fn = makeRelativizer("/home/srid/proj");
    if (!fn) throw new Error("expected transform");
    expect(fn("/home/srid/proj/src/foo.ts")).toBe("./src/foo.ts");
    expect(fn("/home/srid/proj/a/b/c.md")).toBe("./a/b/c.md");
  });

  it("leaves out-of-cwd absolute paths absolute", () => {
    // Sibling and ancestor paths stay verbatim — only paths strictly
    // inside cwd get rewritten. Keeps the regex anchored to one prefix
    // and avoids whole classes of prefix-collision bugs.
    const fn = makeRelativizer("/a/b/c");
    if (!fn) throw new Error("expected transform");
    expect(fn("/a/b/other/file.ts")).toBe("/a/b/other/file.ts");
    expect(fn("/a/x/file.ts")).toBe("/a/x/file.ts");
    expect(fn("/usr/bin/node")).toBe("/usr/bin/node");
    // Bare cwd has no /<continuation> to capture, so the regex doesn't
    // fire — the cwd stays absolute.
    expect(fn("/a/b/c")).toBe("/a/b/c");
  });

  it("does not eat prefix-similar sibling directories", () => {
    const fn = makeRelativizer("/a/b/c");
    if (!fn) throw new Error("expected transform");
    // /a/b/c-other shares characters with cwd but is not under it. The
    // regex requires a `/` after the cwd, so this stays absolute.
    expect(fn("/a/b/c-other/file.ts")).toBe("/a/b/c-other/file.ts");
  });

  it("handles multiple paths in one string", () => {
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    expect(fn("Edit /proj/a.ts and /proj/b.ts please")).toBe(
      "Edit ./a.ts and ./b.ts please",
    );
  });

  it("stops at quote/bracket/paren boundaries inside text", () => {
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    expect(fn("see (/proj/x.ts)")).toBe("see (./x.ts)");
    expect(fn(`run "/proj/y.ts"`)).toBe(`run "./y.ts"`);
  });

  it("trims a trailing slash on the cwd before computing replacements", () => {
    const fn = makeRelativizer("/a/b/c/");
    if (!fn) throw new Error("expected transform");
    expect(fn("/a/b/c/y.ts")).toBe("./y.ts");
  });
});

describe("transformStrings", () => {
  it("rewrites tool_call.inputs filePath fields", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        {
          kind: "tool_call",
          id: "1",
          toolName: "Read",
          inputs: { kind: "read", filePath: "/proj/src/foo.ts" },
          ts: null,
        },
        {
          kind: "tool_call",
          id: "2",
          toolName: "Edit",
          inputs: {
            kind: "edit",
            filePath: "/proj/x.ts",
            edits: [{ oldText: "/proj/old", newText: "/proj/new" }],
          },
          ts: null,
        },
      ],
    });
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    const out = transformStrings(t, fn);
    if (out.events[0]?.kind !== "tool_call") throw new Error("kind");
    if (out.events[0].inputs.kind !== "read") throw new Error("input kind");
    expect(out.events[0].inputs.filePath).toBe("./src/foo.ts");
    if (out.events[1]?.kind !== "tool_call") throw new Error("kind");
    if (out.events[1].inputs.kind !== "edit") throw new Error("input kind");
    expect(out.events[1].inputs.filePath).toBe("./x.ts");
    expect(out.events[1].inputs.edits[0]).toEqual({
      oldText: "./old",
      newText: "./new",
    });
  });

  it("rewrites bash command strings inline", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        {
          kind: "tool_call",
          id: "1",
          toolName: "Bash",
          inputs: { kind: "bash", command: "cat /proj/a.ts /proj/b.ts" },
          ts: null,
        },
      ],
    });
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    const out = transformStrings(t, fn);
    if (out.events[0]?.kind !== "tool_call") throw new Error("kind");
    if (out.events[0].inputs.kind !== "bash") throw new Error("input kind");
    expect(out.events[0].inputs.command).toBe("cat ./a.ts ./b.ts");
  });

  it("walks tool_result.output strings (output stays unknown)", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        {
          kind: "tool_result",
          id: "1",
          output: { stdout: "loaded /proj/x.ts ok", code: 0 },
          isError: false,
          ts: null,
        },
      ],
    });
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    const out = transformStrings(t, fn);
    if (out.events[0]?.kind !== "tool_result") throw new Error("kind");
    expect(out.events[0].output).toEqual({
      stdout: "loaded ./x.ts ok",
      code: 0,
    });
  });

  it("rewrites paths inside user/assistant/reasoning text", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        { kind: "user", text: "look at /proj/foo.ts", ts: null },
        {
          kind: "assistant",
          text: "I edited /proj/foo.ts",
          model: null,
          ts: null,
        },
        { kind: "reasoning", text: "/proj/bar.ts is the file", ts: null },
      ],
    });
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    const out = transformStrings(t, fn);
    expect(out.events[0]).toMatchObject({ text: "look at ./foo.ts" });
    expect(out.events[1]).toMatchObject({ text: "I edited ./foo.ts" });
    expect(out.events[2]).toMatchObject({ text: "./bar.ts is the file" });
  });

  it("leaves opaque tool inputs alone", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        {
          kind: "tool_call",
          id: "1",
          toolName: "VendorThing",
          inputs: {
            kind: "opaque",
            toolName: "VendorThing",
            raw: { weird_field: "/proj/x.ts" },
          },
          ts: null,
        },
      ],
    });
    const fn = makeRelativizer("/proj");
    if (!fn) throw new Error("expected transform");
    const out = transformStrings(t, fn);
    if (out.events[0]?.kind !== "tool_call") throw new Error("kind");
    if (out.events[0].inputs.kind !== "opaque") throw new Error("input kind");
    expect(out.events[0].inputs.raw).toEqual({ weird_field: "/proj/x.ts" });
  });
});

describe("relativizeTranscript", () => {
  it("is a no-op when cwd is null", () => {
    const t = transcriptWith({
      cwd: null,
      events: [{ kind: "user", text: "/abs/path", ts: null }],
    });
    expect(relativizeTranscript(t)).toEqual(t);
  });

  it("uses the transcript's own cwd as the base", () => {
    const t = transcriptWith({
      cwd: "/proj",
      events: [
        {
          kind: "tool_call",
          id: "1",
          toolName: "Read",
          inputs: { kind: "read", filePath: "/proj/src/foo.ts" },
          ts: null,
        },
      ],
    });
    const out = relativizeTranscript(t);
    if (out.events[0]?.kind !== "tool_call") throw new Error("kind");
    if (out.events[0].inputs.kind !== "read") throw new Error("input kind");
    expect(out.events[0].inputs.filePath).toBe("./src/foo.ts");
    expect(out.cwd).toBe("/proj"); // bare cwd unchanged
  });
});
