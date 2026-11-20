import { describe, expect, test } from "vitest";

import {
  accountRefusalIn,
  allowedWithoutAsking,
  asksThroughForm,
  backgroundTaskIn,
  CLAUDE,
  listedIn,
  liveModelIn,
  liveServersIn,
  OPEN_SESSION_META,
  parentToolUseIn,
  QUEUES_WHEN_BUSY,
  spawnedIn,
  spelling,
  STEERING,
  taskNotificationIn,
  toolNameIn,
} from "./leg.ts";

const GIVEN = ["kolu", "alpha"];

const EXIT_PLAN_MODE = [
  { kind: "allow_always", name: 'Yes, and use "auto" mode', optionId: "auto" },
  {
    kind: "allow_always",
    name: "Yes, and auto-accept edits",
    optionId: "acceptEdits",
  },
  {
    kind: "allow_once",
    name: "Yes, and manually approve edits",
    optionId: "default",
  },
  { kind: "reject_once", name: "No, keep planning", optionId: "plan" },
] as const;

const TOOL_CALL = [
  { kind: "reject_once", name: "Deny", optionId: "reject" },
  { kind: "allow_once", name: "Allow Once", optionId: "allow" },
] as const;

const announced = (server: string, tool: string, args: unknown) => ({
  title: spelling(server) + tool,
  kind: "other" as const,
  rawInput: args,
  _meta: { claudeCode: { toolName: spelling(server) + tool } },
});

const wrapped = (result: {
  readonly content: ReadonlyArray<{ type: "text"; text: string }>;
}): { rawOutput: unknown } => ({
  rawOutput: result.content.map((part) => part.text).join("\n"),
});

describe("which refused turn another account could run", () => {
  test("reads the SDK's error kind the adapter forwards, never the sentence", () => {
    expect(accountRefusalIn({ errorKind: "rate_limit" })).toBe(true);
    for (const kind of [
      "authentication_failed",
      "oauth_org_not_allowed",
      "billing_error",
      "account_on_hold",
    ])
      expect(accountRefusalIn({ errorKind: kind })).toBe(true);
    for (const kind of ["overloaded", "server_error", "max_output_tokens"])
      expect(accountRefusalIn({ errorKind: kind })).toBe(false);
    expect(accountRefusalIn({ details: "You've hit your weekly limit" })).toBe(
      false,
    );
    expect(accountRefusalIn(undefined)).toBe(false);
  });
});

describe("which permissions are answered without asking", () => {
  test("a call to a server we handed this session is allowed", () => {
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", GIVEN, TOOL_CALL),
    ).toBe("allow");
    expect(
      allowedWithoutAsking("mcp__alpha__terminal_read", GIVEN, TOOL_CALL),
    ).toBe("allow");
  });

  test("the plan-mode exit is a person's, whatever its first option offers", () => {
    expect(
      allowedWithoutAsking("ExitPlanMode", GIVEN, EXIT_PLAN_MODE),
    ).toBeNull();
  });

  test("a tool nothing named is a person's, not a guess", () => {
    expect(allowedWithoutAsking(null, GIVEN, EXIT_PLAN_MODE)).toBeNull();
  });

  test("a built-in tool of the agent's own is a person's", () => {
    expect(allowedWithoutAsking("Bash", GIVEN, TOOL_CALL)).toBeNull();
    expect(allowedWithoutAsking("Write", GIVEN, TOOL_CALL)).toBeNull();
  });

  test("an MCP server we did not hand this session is a person's", () => {
    expect(
      allowedWithoutAsking("mcp__github__create_pr", GIVEN, TOOL_CALL),
    ).toBeNull();
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", [], TOOL_CALL),
    ).toBeNull();
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", ["alpha"], TOOL_CALL),
    ).toBeNull();
  });

  test("the separator is part of the name, so a longer server name is not ours", () => {
    expect(
      allowedWithoutAsking("mcp__koluplus__send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
    expect(
      allowedWithoutAsking("kolu__send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
  });

  test("an agent that names its MCP tools some other way asks a person", () => {
    expect(
      allowedWithoutAsking("kolu/send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
    expect(allowedWithoutAsking("screen_text", GIVEN, TOOL_CALL)).toBeNull();
  });

  test("one of ours that offers no allow at all is a person's", () => {
    const refusals = [
      { kind: "reject_once", name: "Deny", optionId: "reject" },
      {
        kind: "reject_always",
        name: "Deny, and stop asking",
        optionId: "rejectAlways",
      },
    ] as const;
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", GIVEN, refusals),
    ).toBeNull();
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", GIVEN, []),
    ).toBeNull();
  });

  test("the allow is the allow-flavoured one, not the first one", () => {
    expect(
      allowedWithoutAsking("mcp__kolu__screen_text", GIVEN, [
        { kind: "reject_once", name: "Deny", optionId: "reject" },
        { kind: "allow_always", name: "Allow Always", optionId: "allowAlways" },
        { kind: "allow_once", name: "Allow Once", optionId: "allow" },
      ] as const),
    ).toBe("allowAlways");
  });
});

describe("which tool a call is", () => {
  test("the adapter's `_meta` carries the programmatic name", () => {
    expect(
      toolNameIn({ claudeCode: { toolName: "mcp__kolu__screen_text" } }),
    ).toBe("mcp__kolu__screen_text");
    expect(toolNameIn({ claudeCode: { toolName: "ExitPlanMode" } })).toBe(
      "ExitPlanMode",
    );
  });

  test("an agent that said nothing is a name we do not know", () => {
    expect(toolNameIn(undefined)).toBeNull();
    expect(toolNameIn(null)).toBeNull();
    expect(toolNameIn({})).toBeNull();
    expect(toolNameIn({ someOtherAgent: { toolName: "Bash" } })).toBeNull();
  });

  test("a `_meta` that is there but says nothing usable is the same no", () => {
    expect(toolNameIn({ claudeCode: {} })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: "" } })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: 7 } })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: null } })).toBeNull();
    expect(toolNameIn({ claudeCode: "mcp__kolu__screen_text" })).toBeNull();
    expect(toolNameIn({ claudeCode: null })).toBeNull();
  });

  test("an unnameable tool and a plan exit are the same answer downstream", () => {
    const named = { claudeCode: { toolName: "mcp__kolu__screen_text" } };
    expect(allowedWithoutAsking(toolNameIn(named), GIVEN, TOOL_CALL)).toBe(
      "allow",
    );
    expect(allowedWithoutAsking(toolNameIn({}), GIVEN, TOOL_CALL)).toBeNull();
    expect(
      allowedWithoutAsking(
        toolNameIn({ claudeCode: { toolName: "ExitPlanMode" } }),
        GIVEN,
        EXIT_PLAN_MODE,
      ),
    ).toBeNull();
  });
});

describe("whose question reaches a person as a form", () => {
  test("the built-in question tool, and nothing else", () => {
    expect(asksThroughForm("AskUserQuestion")).toBe(true);
    expect(asksThroughForm("ExitPlanMode")).toBe(false);
    expect(asksThroughForm("Read")).toBe(false);
    expect(asksThroughForm("mcp__kolu__screen_text")).toBe(false);
    expect(asksThroughForm("mcp__other__AskUserQuestion")).toBe(false);
    expect(asksThroughForm("")).toBe(false);
  });

  test("it is what the leg answers", () => {
    expect(CLAUDE.asksThroughForm?.("AskUserQuestion")).toBe(true);
  });
});

describe("which agent made a call", () => {
  test("a subagent's frame names the Agent call that spawned it", () => {
    expect(
      parentToolUseIn({ claudeCode: { parentToolUseId: "toolu_01AGENT" } }),
    ).toBe("toolu_01AGENT");
  });

  test("the two readings of one `_meta` are independent", () => {
    const both = {
      claudeCode: { toolName: "Bash", parentToolUseId: "toolu_01AGENT" },
    };
    expect(toolNameIn(both)).toBe("Bash");
    expect(parentToolUseIn(both)).toBe("toolu_01AGENT");
    expect(
      toolNameIn({ claudeCode: { parentToolUseId: "toolu_01AGENT" } }),
    ).toBeNull();
    expect(parentToolUseIn({ claudeCode: { toolName: "Bash" } })).toBeNull();
  });

  test("a frame that says nothing is the main agent's own", () => {
    expect(parentToolUseIn(undefined)).toBeNull();
    expect(parentToolUseIn(null)).toBeNull();
    expect(parentToolUseIn({})).toBeNull();
    expect(
      parentToolUseIn({ someOtherAgent: { parentToolUseId: "x" } }),
    ).toBeNull();
    expect(parentToolUseIn({ claudeCode: {} })).toBeNull();
    expect(parentToolUseIn({ claudeCode: { parentToolUseId: "" } })).toBeNull();
    expect(parentToolUseIn({ claudeCode: { parentToolUseId: 7 } })).toBeNull();
    expect(parentToolUseIn({ claudeCode: null })).toBeNull();
    expect(parentToolUseIn({ claudeCode: "toolu_01AGENT" })).toBeNull();
  });
});

describe("which call started an agent", () => {
  const SPAWN = { claudeCode: { toolName: "Agent", subagent: true } };
  const ASKED = {
    description: "explore the host",
    prompt: "read every terminal and report back",
    subagent_type: "Explore",
  };

  test("the spawn's own frame says an agent was sent out, and which kind", () => {
    expect(spawnedIn(SPAWN, ASKED)).toEqual({
      kind: "Explore",
      said: "explore the host",
    });
    expect(
      spawnedIn({ claudeCode: { toolName: "Task", subagent: true } }, {}),
    ).toEqual({});
  });

  test("a call nobody flagged is no spawn, whatever its ARGUMENTS are called", () => {
    expect(
      spawnedIn({ claudeCode: { toolName: "mcp__other__dispatch" } }, ASKED),
    ).toBeNull();
    expect(spawnedIn(undefined, ASKED)).toBeNull();
  });

  test("... nor whatever its RESPONSE is shaped like", () => {
    const answered = {
      claudeCode: {
        toolName: "mcp__other__dispatch",
        toolResponse: { ok: true, subagentType: "Explore" },
      },
    };
    expect(spawnedIn(answered, { query: "anything" })).toBeNull();
    expect(
      spawnedIn(
        {
          claudeCode: {
            toolName: "mcp__other__dispatch",
            toolResponse: { elapsedTimeSeconds: 12, subagentType: "Explore" },
          },
        },
        undefined,
      ),
    ).toBeNull();
  });

  test("a real beat is not a source either, and does not need to be", () => {
    expect(
      spawnedIn(
        {
          claudeCode: {
            toolName: "Agent",
            toolResponse: { elapsedTimeSeconds: 12, subagentType: "Explore" },
          },
        },
        undefined,
      ),
    ).toBeNull();
  });

  test("nothing else is a spawn", () => {
    expect(
      spawnedIn({ claudeCode: { toolName: "Grep" } }, { pattern: "x" }),
    ).toBeNull();
    expect(
      spawnedIn({ claudeCode: { parentToolUseId: "toolu_01AGENT" } }, {}),
    ).toBeNull();
    expect(spawnedIn(undefined, undefined)).toBeNull();
    expect(spawnedIn(null, null)).toBeNull();
    expect(spawnedIn({}, {})).toBeNull();
    expect(spawnedIn({ claudeCode: null }, null)).toBeNull();
    expect(spawnedIn({ someOtherAgent: { subagent: true } }, {})).toBeNull();
    expect(spawnedIn({ claudeCode: { subagent: "yes" } }, {})).toBeNull();
    expect(spawnedIn({ claudeCode: { subagent: 1 } }, {})).toBeNull();
  });

  test("a spawn that named no kind of agent says so, rather than guessing", () => {
    const { subagent_type: _named, ...anonymous } = ASKED;
    expect(spawnedIn(SPAWN, anonymous)).toEqual({ said: "explore the host" });
    expect(spawnedIn(SPAWN, undefined)).toEqual({});
    expect(spawnedIn(SPAWN, { subagent_type: "" })).toEqual({});
    expect(spawnedIn(SPAWN, { subagent_type: 7 })).toEqual({});
  });

  test("... and it says WHAT the agent was sent to do, which is not the row's name", () => {
    expect(spawnedIn(SPAWN, { description: "count the terminals" })).toEqual({
      said: "count the terminals",
    });
    expect(spawnedIn({ claudeCode: { toolName: "Agent" } }, ASKED)).toBeNull();
    expect(spawnedIn(SPAWN, { description: "" })).toEqual({});
    expect(spawnedIn(SPAWN, { description: 7 })).toEqual({});
  });

  test("a spawn's own response cannot name the agent either", () => {
    expect(
      spawnedIn(
        {
          claudeCode: {
            subagent: true,
            toolResponse: { subagentType: "Explore" },
          },
        },
        undefined,
      ),
    ).toEqual({});
    expect(
      spawnedIn(
        {
          claudeCode: {
            subagent: true,
            toolResponse: { subagentType: "general-purpose" },
          },
        },
        ASKED,
      ),
    ).toEqual({ kind: "Explore", said: "explore the host" });
  });
});

describe("which call armed a background task", () => {
  const ARMED = {
    claudeCode: {
      toolName: "Monitor",
      backgroundTask: {
        taskId: "bu13xz2ie",
        taskType: "local_bash",
        description: "tick watch",
      },
    },
  };

  const ENDED = {
    claudeCode: {
      toolName: "Bash",
      taskStatus: "failed",
      backgroundTask: {
        taskId: "bwa85c0r2",
        taskType: "local_bash",
        description: "Run sleep and exit 3 in background",
        status: "failed",
        summary:
          'Background command "Run sleep and exit 3 in background" failed with exit code 3',
      },
    },
  };

  test("reads the task and what it was armed with", () => {
    expect(backgroundTaskIn(ARMED)).toEqual({
      task: "bu13xz2ie",
      description: "tick watch",
    });
  });

  test("an arming frame says nothing about an ending", () => {
    expect(backgroundTaskIn(ARMED)?.ended).toBeUndefined();
  });

  test("reads how it ENDED in the harness's own word, not ACP's", () => {
    expect(backgroundTaskIn(ENDED)?.ended).toBe("failed");
    expect(
      backgroundTaskIn({
        claudeCode: { backgroundTask: { taskId: "t", status: "stopped" } },
      })?.ended,
    ).toBe("stopped");
  });

  test("a frame that says nothing about a task arms nothing", () => {
    expect(backgroundTaskIn({ claudeCode: { toolName: "Bash" } })).toBeNull();
    expect(backgroundTaskIn({ claudeCode: {} })).toBeNull();
    expect(backgroundTaskIn({})).toBeNull();
    expect(backgroundTaskIn(null)).toBeNull();
    expect(backgroundTaskIn(undefined)).toBeNull();
  });

  test("NO TASK ID, NO TASK", () => {
    expect(backgroundTaskIn({ claudeCode: { backgroundTask: {} } })).toBeNull();
    expect(
      backgroundTaskIn({ claudeCode: { backgroundTask: { taskId: "" } } }),
    ).toBeNull();
    expect(
      backgroundTaskIn({ claudeCode: { backgroundTask: { taskId: 7 } } }),
    ).toBeNull();
    expect(
      backgroundTaskIn({ claudeCode: { backgroundTask: "bu13xz2ie" } }),
    ).toBeNull();
    expect(
      backgroundTaskIn({ claudeCode: { backgroundTask: null } }),
    ).toBeNull();
  });

  test("a field of the wrong shape is dropped, never repaired", () => {
    expect(
      backgroundTaskIn({
        claudeCode: {
          backgroundTask: { taskId: "t", description: "", status: null },
        },
      }),
    ).toEqual({ task: "t" });
  });

  test("a later frame can file the report on the same stamp the ending uses", () => {
    expect(
      backgroundTaskIn({
        claudeCode: {
          backgroundTask: {
            taskId: "a4015bf2ba1fa514d",
            report: "there are three terminals.",
          },
        },
      }),
    ).toEqual({
      task: "a4015bf2ba1fa514d",
      report: "there are three terminals.",
    });
    expect(
      backgroundTaskIn({
        claudeCode: { backgroundTask: { taskId: "t", report: "" } },
      }),
    ).toEqual({ task: "t" });
  });

  test("a tool's OWN answer cannot arm a call", () => {
    expect(
      backgroundTaskIn({
        claudeCode: {
          toolName: "Monitor",
          toolResponse: { taskId: "bu13xz2ie" },
        },
      }),
    ).toBeNull();
  });
});

describe("which model a turn is running on", () => {
  const init = (model: unknown) => ({
    sessionId: "s1",
    message: { type: "system", subtype: "init", model, cwd: "/home/kolu" },
  });

  test("the `init` message names the model the CLI is running", () => {
    expect(liveModelIn(init("claude-opus-4-5"))).toBe("claude-opus-4-5");
  });

  test("what we asked to be forwarded is what is read", () => {
    const [subscribed] = OPEN_SESSION_META.claudeCode.emitRawSDKMessages;
    expect(
      liveModelIn({ message: { ...subscribed, model: "claude-opus-4-5" } }),
    ).toBe("claude-opus-4-5");
  });

  test("another message of the CLI's is not a model", () => {
    expect(
      liveModelIn({
        message: { type: "result", subtype: "success", model: "x" },
      }),
    ).toBeNull();
    expect(
      liveModelIn({
        message: { type: "system", subtype: "compact", model: "x" },
      }),
    ).toBeNull();
    expect(
      liveModelIn({ message: { type: "assistant", model: "x" } }),
    ).toBeNull();
  });

  test("a message that says nothing readable leaves the model alone", () => {
    expect(liveModelIn(init(undefined))).toBeNull();
    expect(liveModelIn(init(""))).toBeNull();
    expect(liveModelIn(init(42))).toBeNull();
    expect(liveModelIn({ sessionId: "s1" })).toBeNull();
    expect(liveModelIn({ message: "system init" })).toBeNull();
    expect(liveModelIn({ message: null })).toBeNull();
    expect(liveModelIn(null)).toBeNull();
    expect(liveModelIn(undefined)).toBeNull();
  });
});

describe("which of this conversation's servers the agent attached", () => {
  const init = (servers: unknown) => ({
    sessionId: "s1",
    message: {
      type: "system",
      subtype: "init",
      model: "claude-opus-4-5",
      mcp_servers: servers,
    },
  });

  test("`connected` is the word this CLI uses for a server it has", () => {
    expect(
      liveServersIn(
        init([
          { name: "kolu", status: "connected" },
          { name: "alpha", status: "connected" },
        ]),
      ),
    ).toEqual([
      { name: "kolu", attached: true, said: "connected" },
      { name: "alpha", attached: true, said: "connected" },
    ]);
  });

  test("every other word is NOT attached, and travels verbatim anyway", () => {
    expect(
      liveServersIn(
        init([
          { name: "alpha", status: "needs-auth" },
          { name: "deepwiki", status: "failed" },
          { name: "later", status: "a word no version has sent yet" },
        ]),
      ),
    ).toEqual([
      { name: "alpha", attached: false, said: "needs-auth" },
      { name: "deepwiki", attached: false, said: "failed" },
      {
        name: "later",
        attached: false,
        said: "a word no version has sent yet",
      },
    ]);
  });

  test("the match is the whole word, so a longer one is not a connection", () => {
    expect(
      liveServersIn(init([{ name: "kolu", status: "connected-ish" }])),
    ).toEqual([{ name: "kolu", attached: false, said: "connected-ish" }]);
    expect(
      liveServersIn(init([{ name: "kolu", status: "Connected" }])),
    ).toEqual([{ name: "kolu", attached: false, said: "Connected" }]);
  });

  test("what we asked to be forwarded is what is read", () => {
    const [subscribed] = OPEN_SESSION_META.claudeCode.emitRawSDKMessages;
    expect(
      liveServersIn({
        message: {
          ...subscribed,
          mcp_servers: [{ name: "kolu", status: "connected" }],
        },
      }),
    ).toEqual([{ name: "kolu", attached: true, said: "connected" }]);
  });

  test("another message of the CLI's says nothing about servers", () => {
    expect(
      liveServersIn({
        message: {
          type: "system",
          subtype: "compact",
          mcp_servers: [{ name: "kolu", status: "connected" }],
        },
      }),
    ).toBeNull();
    expect(
      liveServersIn({
        message: {
          type: "result",
          mcp_servers: [{ name: "kolu", status: "connected" }],
        },
      }),
    ).toBeNull();
  });

  test("an init that names no servers is a message that says nothing, not an empty roster", () => {
    expect(liveServersIn(init(undefined))).toBeNull();
    expect(liveServersIn(init("kolu, alpha"))).toBeNull();
    expect(liveServersIn({ sessionId: "s1" })).toBeNull();
    expect(liveServersIn(null)).toBeNull();
    expect(liveServersIn(undefined)).toBeNull();
    expect(liveServersIn(init([]))).toEqual([]);
  });

  test("a row that cannot be read is dropped, never repaired", () => {
    expect(
      liveServersIn(
        init([
          { name: "kolu", status: "connected" },
          { status: "connected" },
          { name: "", status: "connected" },
          { name: "alpha" },
          { name: "alpha", status: "" },
          { name: "alpha", status: 7 },
          null,
          "alpha",
        ]),
      ),
    ).toEqual([{ name: "kolu", attached: true, said: "connected" }]);
  });
});

describe("what the adapter says it can do at the handshake", () => {
  const HANDSHAKE = {
    protocolVersion: 1,
    agentCapabilities: {
      _meta: { claudeCode: { promptQueueing: true } },
      promptCapabilities: { image: true },
      loadSession: true,
    },
    agentInfo: {
      name: "@agentclientprotocol/claude-agent-acp",
      version: "0.73.0",
    },
    _meta: {
      steering: { supported: true },
      goal: { version: 1, controlMethod: "_session/goal" },
    },
  };

  test("it HOLDS a prompt sent while it is busy, and says so", () => {
    expect(QUEUES_WHEN_BUSY(HANDSHAKE)).toBe(true);
  });

  test("... and it takes an interruption, said one level out", () => {
    expect(STEERING.advertised(HANDSHAKE)).toBe(true);
  });

  test("an agent that says NEITHER is promised nothing and offered nothing", () => {
    const quiet = { protocolVersion: 1, agentCapabilities: {} };
    expect(QUEUES_WHEN_BUSY(quiet)).toBe(false);
    expect(STEERING.advertised(quiet)).toBe(false);
  });

  test("and neither is read out of the OTHER one's corner", () => {
    expect(
      QUEUES_WHEN_BUSY({ _meta: { claudeCode: { promptQueueing: true } } }),
    ).toBe(false);
    expect(
      STEERING.advertised({
        agentCapabilities: { _meta: { steering: { supported: true } } },
      }),
    ).toBe(false);
  });

  test("POSITIVE RECOGNITION: only the word itself is yes", () => {
    expect(
      QUEUES_WHEN_BUSY({ agentCapabilities: { _meta: { claudeCode: {} } } }),
    ).toBe(false);
    expect(
      QUEUES_WHEN_BUSY({
        agentCapabilities: { _meta: { claudeCode: { promptQueueing: "yes" } } },
      }),
    ).toBe(false);
    expect(STEERING.advertised({ _meta: { steering: {} } })).toBe(false);
    expect(STEERING.advertised({ _meta: { steering: "supported" } })).toBe(
      false,
    );
  });

  test("a handshake that is not an object at all answers no", () => {
    for (const nothing of [null, undefined, "", 0, []]) {
      expect(QUEUES_WHEN_BUSY(nothing)).toBe(false);
      expect(STEERING.advertised(nothing)).toBe(false);
    }
  });
});

describe("steering a turn that is already running", () => {
  test("the method and the idle behaviour are the wire's own spellings", () => {
    expect(STEERING.method).toBe("_session/steering");
    expect(STEERING.meta).toEqual({
      steering: { idleBehavior: "promptRequired" },
    });
  });

  test("`injected` is the answer that means the running turn has it", () => {
    expect(STEERING.taken({ outcome: "injected" })).toBe(true);
  });

  test("nothing was running, so the caller still has the message", () => {
    expect(
      STEERING.taken({ outcome: "promptRequired", reason: "noRunningTurn" }),
    ).toBe(false);
  });

  test("an outcome nobody here knows is NOT taken", () => {
    expect(STEERING.taken({ outcome: "startedNewTurn" })).toBe(false);
    expect(STEERING.taken({ outcome: "somethingLater" })).toBe(false);
    expect(STEERING.taken({})).toBe(false);
    expect(STEERING.taken(null)).toBe(false);
    expect(STEERING.taken(undefined)).toBe(false);
    expect(STEERING.taken({ outcome: true })).toBe(false);
  });
});

describe("what a listed conversation holds", () => {
  test("reads the count and the link together", () => {
    expect(
      listedIn({ claudeCode: { messageCount: 3, supersededBy: "s2" } }),
    ).toEqual({ messageCount: 3, supersededBy: "s2" });
    expect(listedIn({ claudeCode: { messageCount: 4 } })).toEqual({
      messageCount: 4,
      supersededBy: null,
    });
  });

  test("zero is an answer", () => {
    expect(listedIn({ claudeCode: { messageCount: 0 } })).toEqual({
      messageCount: 0,
      supersededBy: null,
    });
  });

  test("a row that said nothing reads as nothing", () => {
    expect(listedIn({ claudeCode: {} })).toBeNull();
    expect(listedIn({})).toBeNull();
    expect(listedIn(null)).toBeNull();
    expect(listedIn(undefined)).toBeNull();
    expect(listedIn({ claudeCode: { messageCount: "3" } })).toBeNull();
    expect(listedIn({ claudeCode: { messageCount: Number.NaN } })).toBeNull();
    expect(listedIn({ claudeCode: { messageCount: -1 } })).toBeNull();
    expect(listedIn({ claudeCode: { messageCount: 3.5 } })).toBeNull();
    expect(listedIn({ claudeCode: { supersededBy: "" } })).toBeNull();
    expect(listedIn({ claudeCode: { supersededBy: 4 } })).toBeNull();
  });

  test("... and neither stamp is read out of the other one's corner", () => {
    expect(listedIn({ claudeCode: { origin: { kind: "human" } } })).toBeNull();
    expect(listedIn({ messageCount: 3, supersededBy: "s2" })).toBeNull();
    expect(CLAUDE.listedIn({ claudeCode: { messageCount: 2 } })).toEqual({
      messageCount: 2,
      supersededBy: null,
    });
  });
});

describe("a shell command is a terminal pane", () => {
  test("the extension is asked for, because this adapter answers it", () => {
    expect(CLAUDE.terminalOutput).toBe(true);
  });
});

describe("the leg", () => {
  test("reads a tool's name out of the meta, never out of the call id", () => {
    expect(CLAUDE.toolNameIn({ claudeCode: { toolName: "Bash" } })).toBe(
      "Bash",
    );
    expect(CLAUDE.toolNameOf("Bash:0")).toBeNull();
  });

  test("answers about a background task the same way it answers about a spawn", () => {
    expect(
      CLAUDE.backgroundTask({
        claudeCode: { backgroundTask: { taskId: "t1" } },
      }),
    ).toEqual({ task: "t1" });
    expect(
      CLAUDE.backgroundTask({ claudeCode: { toolName: "Bash" } }),
    ).toBeNull();
  });

  test("a task-notification is not a person speaking", () => {
    const xml =
      "<task-notification>\n" +
      "<task-id>a4015bf2ba1fa514d</task-id>\n" +
      "<tool-use-id>toolu_014mD8gkPSCXNL6gF11GK7hv</tool-use-id>\n" +
      "<status>completed</status>\n" +
      '<summary>Agent "Explore the host" finished</summary>\n' +
      "<result>I have thorough coverage now.\n\n# Findings\n</result>\n" +
      "</task-notification>";
    expect(taskNotificationIn(xml, undefined)).toEqual({
      onto: {
        toolUseId: "toolu_014mD8gkPSCXNL6gF11GK7hv",
        task: "a4015bf2ba1fa514d",
        report: "I have thorough coverage now.\n\n# Findings\n",
      },
    });
    expect(
      taskNotificationIn("hello", {
        claudeCode: { origin: { kind: "task-notification" } },
      }),
    ).toEqual({ onto: null });
    expect(
      taskNotificationIn("hello", {
        claudeCode: { origin: { kind: "human" } },
      }),
    ).toBeNull();
    expect(taskNotificationIn("hello", undefined)).toBeNull();
    expect(
      taskNotificationIn(xml, { claudeCode: { origin: { kind: "human" } } }),
    ).toBeNull();
    expect(
      taskNotificationIn(`see this:\n${xml}\nthanks`, undefined),
    ).toBeNull();
    expect(taskNotificationIn(`${xml}\ntrailing`, undefined)).toBeNull();
    expect(CLAUDE.taskNotification(xml, undefined)?.onto?.toolUseId).toBe(
      "toolu_014mD8gkPSCXNL6gF11GK7hv",
    );
  });

  test("has a bypass mode to ask for, and a refusal of it is not fatal", () => {
    expect(CLAUDE.bypassMode).toBe("bypassPermissions");
    expect(CLAUDE.bypassModeRequired).toBe(false);
  });

  test("subscribes to the CLI's own messages when a session is opened", () => {
    expect(CLAUDE.rawMessages?.openMeta).toEqual(OPEN_SESSION_META);
    expect(
      CLAUDE.rawMessages?.modelIn({
        message: { type: "system", subtype: "init", model: "claude-sonnet-5" },
      }),
    ).toBe("claude-sonnet-5");
  });
});

describe("the first title a call carries is not its name", () => {
  test("the announcement's title is a placeholder, and nothing else is", () => {
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call",
        title: "Terminal",
        rawInput: {},
      }),
    ).toBe(true);
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call_update",
        title: "echo hello",
        rawInput: { command: "echo hello" },
      }),
    ).toBe(false);
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call_update",
        status: "completed",
        rawInput: {},
      }),
    ).toBe(false);
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call",
        title: "Read",
        rawInput: { file_path: "/home/kolu/notes.md" },
      }),
    ).toBe(false);
    for (const frame of [
      { sessionUpdate: "tool_call", title: "Terminal" },
      { sessionUpdate: "tool_call", title: "Terminal", rawInput: null },
      { sessionUpdate: "tool_call", title: "Terminal", rawInput: [] },
      { sessionUpdate: "tool_call", title: "Terminal", rawInput: "" },
      { sessionUpdate: "agent_message_chunk" },
      {},
      null,
      undefined,
    ])
      expect(CLAUDE.provisionalTitle?.(frame)).toBe(false);
  });
});

test("MCP display reads this adapter's announcement and completion", () => {
  const reply = { id: "t1", title: "a terminal", kind: "toplevel" };
  const result = {
    content: [{ type: "text" as const, text: JSON.stringify(reply) }],
  };
  const frame = {
    ...announced("kolu", "lifecycle_create", { placement: "toplevel" }),
    name: CLAUDE.toolNameOf("kolu_lifecycle_create:1"),
  };
  expect(CLAUDE.mcpCall(frame, ["kolu"])).toEqual([
    { server: "kolu", tool: "lifecycle_create" },
  ]);
  expect(CLAUDE.mcpCall(frame, ["foreign"])).toEqual([]);
  expect(
    CLAUDE.mcpCall(
      { title: "bash", rawInput: { server: "kolu", tool: "lifecycle_create" } },
      ["kolu"],
    ),
  ).toEqual([]);
  expect(CLAUDE.replyIn(wrapped(result).rawOutput)).toEqual(reply);
  expect(CLAUDE.replyIn("permission denied")).toBeUndefined();
  expect(CLAUDE.replyIn({ stdout: "foreign tool" })).toBeUndefined();
  expect(
    CLAUDE.replyIn(
      wrapped({ content: [{ type: "text", text: "permission denied" }] })
        .rawOutput,
    ),
  ).toBeUndefined();
});

test("the first text block is the reply, and only a record is a reply", () => {
  expect(CLAUDE.replyIn([{ type: "text", text: "[]" }])).toBeUndefined();
  expect(
    CLAUDE.replyIn([
      { type: "text", text: "refused" },
      { type: "text", text: "{}" },
    ]),
  ).toBeUndefined();
  expect(CLAUDE.replyIn({ structuredContent: { id: "t1" } })).toBeUndefined();
  expect(
    CLAUDE.mcpCall({ name: "bash", title: "mcp__kolu__screen_text" }, ["kolu"]),
  ).toEqual([]);
});

test("a real JSON-string result retains every fact the tool answered", () => {
  const raw =
    '{"id":"t1","title":"claude — ~/code/kolu","kind":"toplevel","rows":48,"cols":180,"agent":"claude-code"}';
  const reply = JSON.parse(raw);
  expect(CLAUDE.replyIn(raw)).toEqual(reply);
  expect(CLAUDE.replyIn([{ type: "text", text: raw }])).toEqual(reply);
  for (const nothing of [
    "permission denied",
    "{broken",
    "[]",
    "null",
    "42",
    '"text"',
    "true",
    undefined,
  ]) {
    expect(CLAUDE.replyIn(nothing)).toBeUndefined();
  }
});

test("a branded MCP refusal survives the SDK dropping structuredContent", () => {
  const result = {
    content: [
      {
        type: "text" as const,
        text: "surface-mcp: `lifecycle_create` was refused (usage): no host is attached to this serve — attach one first",
      },
    ],
  };
  expect(CLAUDE.replyIn(wrapped(result).rawOutput)).toEqual({
    kind: "usage",
    reason: "no host is attached to this serve — attach one first",
  });
  expect(CLAUDE.replyIn("permission denied")).toBeUndefined();
  expect(CLAUDE.replyIn("surface-mcp: unavailable")).toBeUndefined();
  expect(
    CLAUDE.replyIn("surface-mcp: `x` was refused (usage): "),
  ).toBeUndefined();
});
