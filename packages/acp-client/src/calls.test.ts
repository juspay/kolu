/**
 * What is known about a call, over values.
 *
 * Every rule here is one the panel depends on at a moment nobody can arrange:
 * a permission request arriving after the frame that named its tool, a
 * subagent's question arriving after the frame that said whose it was, a
 * completion arriving after both. Reaching any of them through the real thing
 * means starting a subprocess and talking it into a fan-out — so they are
 * asserted here, the way {@link ./questions.ts}'s state machine is — and, one
 * wall out, the way each engine's own readings are in its own package.
 *
 * THE LEGS BELOW ARE FIXTURES ({@link ./agents/legs.testlib.ts}) rather than
 * real engines, and that is the phase: what this file is about is what `Calls`
 * REMEMBERS, and the two shapes it has to remember it out of are "the frame said
 * it" and "the id said it". Reading those off a real adapter made every case
 * here quietly depend on facts that adapter is free to change on its own release
 * clock — which is exactly why those facts now live in that engine's directory.
 */

import { describe, expect, test } from "vitest";

import {
  NAMES_IN_ID,
  NAMES_IN_META,
  NAMES_ON_FRAME,
  OWN_SESSIONS,
} from "./testlib/legs.ts";
import { Calls } from "./calls.ts";

/** A frame's `_meta`, as an adapter that writes one builds it — either field,
 *  both, or an empty corner. Spelled once, because every test here is about what
 *  one of these does to what is remembered. */
const meta = (corner: Record<string, unknown>) => ({ corner });

/** A registry reading the leg that writes its two facts into a `_meta` corner,
 *  which is what every test below but the last block is about: the facts arrive
 *  on the frame, and the call id says nothing. */
const inMeta = () => new Calls(NAMES_IN_META);

describe("what a frame said about its call", () => {
  test("a call nothing said anything about is known by nothing", () => {
    expect(inMeta().about("call-1")).toEqual({});
  });

  test("an announcement's name is what a later question is answered with", () => {
    // The whole reason this exists: a permission request carries a DISPLAY
    // title and never the programmatic name, and the name is what decides
    // whether a person is asked at all.
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
    // The shapes the adapter actually has: a subagent's terminal output
    // arrives with only the parent, a plan exit's with only the name.
    const calls = inMeta();
    calls.heard("call-1", meta({ toolName: "Bash" }));
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about("call-1")).toEqual({ name: "Bash", parent: "agent-1" });
  });

  test("a completion that says nothing leaves everything where it was", () => {
    // The shape that catches a reader treating silence as an answer: a row
    // that read this as "no agent now" would step out of its lane at the
    // moment the call finished, which is the moment somebody looks.
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
    // A permission request carries the adapter's stamp on the tool call it is
    // about, in the shape every frame carries it. It goes in the same door —
    // so precedence falls out of the order rather than being a second rule.
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
    // The reason this is a fold rather than a precedence applied at each read:
    // an `elicitation/create` names a call and carries no attribution at all,
    // so what an earlier request said about that call is the answer it gets.
    const calls = inMeta();
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about("call-1").parent).toBe("agent-1");
  });

  test("a question that names no call is answered rather than refused", () => {
    // A form elicitation may be scoped to a request rather than a session. A
    // question that named nothing is an ordinary question the main agent
    // asked, which is what an empty answer says.
    const calls = inMeta();
    calls.heard("call-1", meta({ parentToolUseId: "agent-1" }));
    expect(calls.about(null)).toEqual({});
  });
});

describe("the conversation ending", () => {
  test("what was said about a call goes with the session that minted it", () => {
    // A call id is only meaningful inside its own session, and this map would
    // otherwise be every call the process had ever seen — held for the life of
    // a server meant to run for weeks.
    const calls = inMeta();
    calls.heard("call-1", meta({ toolName: "Bash" }));
    calls.forget();
    expect(calls.about("call-1")).toEqual({});
  });
});

describe("what nothing here reads", () => {
  test("a `_meta` with no adapter corner in it says nothing", () => {
    // The losing direction, and the safe one: an agent that is not that
    // adapter has no subagents here, and every call is one a person is asked
    // about by name rather than approved by accident.
    const calls = inMeta();
    calls.heard("call-1", { toolName: "Bash", parentToolUseId: "agent-1" });
    expect(calls.about("call-1")).toEqual({});
  });
});

describe("a leg that reads the call id instead of a meta", () => {
  test("a tool name off the id is remembered like any other", () => {
    // The same registry, the same rule, a different place the name was written
    // down: two of the four engines olai ships send no `_meta` at all and put
    // the tool at the head of the call id. What a later permission request is
    // answered with is the same lookup either way.
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
    // The opencode 2 shape: the name is a field, the id is a hash, and the
    // permission request about that call is answered from what was announced.
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
  // An empty list is a frame that recognised nothing, and a frame refines
  // rather than retracts: what was recognised stays recognised.
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
