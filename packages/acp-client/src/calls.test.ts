import { describe, expect, test } from "vitest";

import {
  NAMES_IN_ID,
  NAMES_IN_META,
  NAMES_ON_FRAME,
  OWN_SESSIONS,
} from "./testlib/legs.ts";
import { Calls } from "./calls.ts";

const meta = (corner: Record<string, unknown>) => ({ corner });

const inMeta = () => new Calls(NAMES_IN_META);

describe("what a frame said about its call", () => {
  test("a call nothing said anything about is known by nothing", () => {
    expect(inMeta().about("call-1")).toEqual({});
  });

  test("an announcement's name is what a later question is answered with", () => {
    const calls = inMeta();
    calls.heard("call-1", meta({ toolName: "Bash" }));
    expect(calls.about("call-1").name).toBe("Bash");
  });

  test("an announcement's agent is what a later question is attributed to", () => {
    const calls = inMeta();
    calls.heard(
      "call-1",
      meta({ toolName: "Bash", parentToolUseId: "agent-1" }),
    );
    expect(calls.about("call-1")).toEqual({ name: "Bash", parent: "agent-1" });
  });

  test("a frame that says half of it does not take the other half back", () => {
    const calls = inMeta();
    calls.heard("call-1", meta({ toolName: "Bash" }));
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about("call-1")).toEqual({ name: "Bash", parent: "agent-1" });
  });

  test("a completion that says nothing leaves everything where it was", () => {
    const calls = inMeta();
    calls.heard(
      "call-1",
      meta({ toolName: "Bash", parentToolUseId: "agent-1" }),
    );
    calls.heard("call-1", undefined);
    calls.heard("call-1", meta({}));
    expect(calls.about("call-1")).toEqual({ name: "Bash", parent: "agent-1" });
  });

  test("what one call was is never what another was", () => {
    const calls = inMeta();
    calls.heard(
      "call-1",
      meta({ toolName: "Bash", parentToolUseId: "agent-1" }),
    );
    calls.heard("call-2", meta({ toolName: "Edit" }));
    expect(calls.about("call-2")).toEqual({ name: "Edit" });
  });
});

describe("a question with words of its own", () => {
  test("a request's tool call is a frame, so the last word is its own", () => {
    const calls = inMeta();
    calls.heard(
      "call-1",
      meta({ toolName: "Bash", parentToolUseId: "agent-1" }),
    );
    calls.heard(
      "call-1",
      meta({ toolName: "Edit", parentToolUseId: "agent-2" }),
    );
    expect(calls.about("call-1")).toEqual({ name: "Edit", parent: "agent-2" });
  });

  test("and what it said stays known for the next question about that call", () => {
    const calls = inMeta();
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about("call-1").parent).toBe("agent-1");
  });

  test("a question that names no call is answered rather than refused", () => {
    const calls = inMeta();
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about(null)).toEqual({});
  });
});

describe("the conversation ending", () => {
  test("what was said about a call goes with the session that minted it", () => {
    const calls = inMeta();
    calls.heard("call-1", meta({ toolName: "Bash" }));
    calls.forget();
    expect(calls.about("call-1")).toEqual({});
  });
});

describe("what nothing here reads", () => {
  test("a `_meta` with no adapter corner in it says nothing", () => {
    const calls = inMeta();
    calls.heard("call-1", { toolName: "Bash", parentToolUseId: "agent-1" });
    expect(calls.about("call-1")).toEqual({});
  });
});

describe("a leg that reads the call id instead of a meta", () => {
  test("a tool name off the id is remembered like any other", () => {
    const calls = new Calls(NAMES_IN_ID);
    calls.heard("bash:0", undefined);
    expect(calls.about("bash:0")).toEqual({ name: "bash" });
  });

  test("and nothing is attributed to a subagent, because nothing says", () => {
    const calls = new Calls(NAMES_IN_ID);
    calls.heard("task:0", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about("task:0").parent).toBeUndefined();
  });
});

describe("native session call identity", () => {
  test("observations and permission lookups keep same-ID child calls distinct", () => {
    const calls = new Calls({ ...NAMES_IN_META, nativeActivity: OWN_SESSIONS });
    calls.heard("same", meta({ toolName: "RootTool" }), undefined, "root");
    calls.heard("same", meta({ toolName: "ChildTool" }), undefined, "child");
    expect(calls.about("same", "root").name).toBe("RootTool");
    expect(calls.about("same", "child").name).toBe("ChildTool");
    calls.heard(
      "same",
      meta({ toolName: "PermissionTool" }),
      undefined,
      "child",
    );
    expect(calls.about("same", "root").name).toBe("RootTool");
    expect(calls.about("same", "child").name).toBe("PermissionTool");
    calls.forget();
    expect(calls.about("same", "child")).toEqual({});
  });
  test("name interpretation receives the raw wire ID", () => {
    const calls = new Calls({
      ...NAMES_IN_META,
      nativeActivity: OWN_SESSIONS,
      toolNameOf: (id) => (id === "wire-id" ? "KnownTool" : null),
    });
    expect(calls.about("wire-id", "child").name).toBe("KnownTool");
  });
});

describe("what the frame's own name field said", () => {
  test("is remembered for the question that arrives without one", () => {
    const calls = new Calls(NAMES_ON_FRAME);
    calls.heard("chatcmpl-tool-a273", undefined, { name: "execute" });
    expect(calls.about("chatcmpl-tool-a273").name).toBe("execute");
  });

  test("a frame that named nothing leaves the call unnamed", () => {
    const calls = new Calls(NAMES_ON_FRAME);
    calls.heard("chatcmpl-tool-a273", undefined, undefined);
    calls.heard("chatcmpl-tool-b000", undefined, { name: "" });
    expect(calls.about("chatcmpl-tool-a273")).toEqual({});
    expect(calls.about("chatcmpl-tool-b000")).toEqual({});
  });
});

test("MCP identity shares session keys and lifetime with call facts", () => {
  const calls = new Calls({ ...NAMES_IN_META, nativeActivity: OWN_SESSIONS });
  calls.recognized("same", [{ server: "olai", tool: "outlines_read" }], "one");
  calls.recognized("same", [{ server: "foreign", tool: "read" }], "two");
  calls.recognized("same", [], "one");
  expect(calls.about("same", "one").mcp).toEqual([
    { server: "olai", tool: "outlines_read" },
  ]);
  expect(calls.about("same", "two").mcp).toEqual([
    { server: "foreign", tool: "read" },
  ]);
  calls.forget();
  expect(calls.about("same", "one").mcp).toBeUndefined();
});
