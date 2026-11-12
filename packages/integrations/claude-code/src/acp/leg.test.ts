/**
 * The adapter's bets, over values.
 *
 * The payloads here are what the Claude Code adapter actually sends: the
 * plan-mode permission request whose first allow-flavoured option switches the
 * session to `auto`, an MCP call announced with its programmatic name in
 * `_meta`, the CLI `init` message a `/model` produces. Why any of that is worth
 * a unit test rather than a scenario is {@link ./leg.ts}'s own argument; what
 * this file adds is the near misses, which are cheap as values and expensive to
 * stage — a server we were not given, a name one character off the prefix, a
 * `_meta` from some other agent.
 *
 * NO SDK TYPES ARE NAMED HERE, deliberately, and the option fixtures are `as
 * const` for exactly that reason: `@kolu/acp`'s manifest holds that the
 * protocol's own package enters this tree in two places, and an integration is
 * neither of them. The shapes a leg signature needs ride `@kolu/acp/engine`.
 */

import { describe, expect, test } from "vitest";

import {
  allowedWithoutAsking,
  backgroundTaskIn,
  CLAUDE,
  liveModelIn,
  liveServersIn,
  OPEN_SESSION_META,
  parentToolUseIn,
  spawnedIn,
  spelling,
  taskNotificationIn,
  toolNameIn,
} from "./leg.ts";

/** The servers a session is handed: kolu's own MCP face, and whatever else this
 *  host handed over — called `alpha`, because what is being exercised is the
 *  tool-name grammar `mcp__<server>__<tool>` and any server name does that.
 *  `given` in the harness is exactly this list of names. */
const GIVEN = ["kolu", "alpha"];

/**
 * The adapter's plan-mode exit, as it builds it: `auto` FIRST and
 * allow-flavoured, which is the option a client answering by machine picks —
 * silently switching the session's permission mode.
 *
 * The real list is filtered against the session's available modes and can lead
 * with `bypassPermissions`, so a session may see fewer of these or one more.
 * What does not vary is that the first entry is an allow.
 */
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

/** The ordinary list for a tool call, which leads with the REFUSAL — so
 *  "the allow-flavoured one" and "the first one" are different answers. */
const TOOL_CALL = [
  { kind: "reject_once", name: "Deny", optionId: "reject" },
  { kind: "allow_once", name: "Allow Once", optionId: "allow" },
] as const;

/** A tool call as this adapter announces one: the programmatic name in the
 *  title AND in its own `_meta` corner. The e2e fake emits the same shape. */
const announced = (server: string, tool: string, args: unknown) => ({
  title: spelling(server) + tool,
  kind: "other" as const,
  rawInput: args,
  _meta: { claudeCode: { toolName: spelling(server) + tool } },
});

/** ... and a completed MCP result as it reaches the wire: real Claude sessions
 *  flatten a text-only MCP result to a JSON string, which is what `rawOutput`
 *  carries. */
const wrapped = (result: {
  readonly content: ReadonlyArray<{ type: "text"; text: string }>;
}): { rawOutput: unknown } => ({
  rawOutput: result.content.map((part) => part.text).join("\n"),
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
    // The one that matters. `auto` is first and allow-flavoured, and answering
    // it is switching the session's permission mode on somebody's behalf.
    expect(
      allowedWithoutAsking("ExitPlanMode", GIVEN, EXIT_PLAN_MODE),
    ).toBeNull();
  });

  test("a tool nothing named is a person's, not a guess", () => {
    // No `_meta`, no announcement to have learned the name from. The request
    // still leads with an allow, and that is still not ours to press.
    expect(allowedWithoutAsking(null, GIVEN, EXIT_PLAN_MODE)).toBeNull();
  });

  test("a built-in tool of the agent's own is a person's", () => {
    expect(allowedWithoutAsking("Bash", GIVEN, TOOL_CALL)).toBeNull();
    expect(allowedWithoutAsking("Write", GIVEN, TOOL_CALL)).toBeNull();
  });

  test("an MCP server we did not hand this session is a person's", () => {
    // Recognition is positive and it is of OURS: an MCP tool is not trusted for
    // being an MCP tool. A server a `.mcp.json` named for itself was never
    // kolu's to mediate.
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
    // `mcp__kolu__` and not `mcp__kolu`: a server called `koluplus` shares a
    // prefix with ours and is not ours.
    expect(
      allowedWithoutAsking("mcp__koluplus__send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
    expect(
      allowedWithoutAsking("kolu__send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
  });

  test("an agent that names its MCP tools some other way asks a person", () => {
    // The bet on the adapter's naming, losing in the direction it can afford.
    expect(
      allowedWithoutAsking("kolu/send_input", GIVEN, TOOL_CALL),
    ).toBeNull();
    expect(allowedWithoutAsking("screen_text", GIVEN, TOOL_CALL)).toBeNull();
  });

  test("one of ours that offers no allow at all is a person's", () => {
    // Nothing is invented to answer with, and a refusal is certainly not
    // pressed on somebody's behalf either.
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
    // Both kinds count as an allow, and the order is the agent's own.
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
    // What a `tool_call` announcement looks like: the permission request that
    // follows it says "Ready to code?" or a display title, and this is the
    // question the answer turns on.
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
    // Somebody else's extension, a shape that moved, an empty string: all of
    // them are "we cannot name this tool", which is answered by asking.
    expect(toolNameIn({ claudeCode: {} })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: "" } })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: 7 } })).toBeNull();
    expect(toolNameIn({ claudeCode: { toolName: null } })).toBeNull();
    expect(toolNameIn({ claudeCode: "mcp__kolu__screen_text" })).toBeNull();
    expect(toolNameIn({ claudeCode: null })).toBeNull();
  });

  test("an unnameable tool and a plan exit are the same answer downstream", () => {
    // The pair the whole rule rests on, read end to end: what `_meta` says, put
    // through the decision. Neither is bypassed.
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

describe("which agent made a call", () => {
  test("a subagent's frame names the Agent call that spawned it", () => {
    // What the adapter stamps onto every frame that comes out of a spawned
    // task: the id of the `Agent`/`Task` tool call it was started by.
    expect(
      parentToolUseIn({ claudeCode: { parentToolUseId: "toolu_01AGENT" } }),
    ).toBe("toolu_01AGENT");
  });

  test("the two readings of one `_meta` are independent", () => {
    // A frame carries either, both or neither, and the adapter sends all three
    // shapes: a streamed subagent `tool_call` carries the name AND the parent,
    // its terminal output carries only the parent, and a plan exit only the
    // name. Neither reader may need the other to be there.
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
    // The losing direction this can afford: an agent that is not that adapter
    // has no subagents as far as the transcript is concerned, and it looks
    // exactly as it did before any of this was read.
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
  /** The spawn's own frame, as the adapter builds one: the flag beside the tool
   *  name (`claudeCodeMetaFromToolUse`), and the `Agent` tool's own arguments as
   *  `rawInput`. */
  const SPAWN = { claudeCode: { toolName: "Agent", subagent: true } };
  const ASKED = {
    description: "explore the host",
    prompt: "read every terminal and report back",
    subagent_type: "Explore",
  };

  test("the spawn's own frame says an agent was sent out, and which kind", () => {
    // The whole point of reading this rather than waiting for the parent stamp:
    // it is on the frame that ANNOUNCES the spawn, so it is known before the
    // agent has done anything anybody could draw.
    expect(spawnedIn(SPAWN, ASKED)).toEqual({
      kind: "Explore",
      said: "explore the host",
    });
    // ... and what says so is the FLAG rather than the tool name, which the
    // adapter maps two of its own words onto.
    expect(
      spawnedIn({ claudeCode: { toolName: "Task", subagent: true } }, {}),
    ).toEqual({});
  });

  test("a call nobody flagged is no spawn, whatever its ARGUMENTS are called", () => {
    // The tools on a session are not a closed set: `subagent_type` is a name
    // the `Agent` tool gives one of ITS arguments, and an MCP server kolu never
    // handed this conversation is free to take one by the same name. A reader
    // that trusted any `rawInput` would put a kind of agent, and a live rail,
    // on that server's call.
    expect(
      spawnedIn({ claudeCode: { toolName: "mcp__other__dispatch" } }, ASKED),
    ).toBeNull();
    expect(spawnedIn(undefined, ASKED)).toBeNull();
  });

  test("... nor whatever its RESPONSE is shaped like", () => {
    // The same hole on the other side, and the sharper one, because this
    // payload is not the adapter's at all: `_meta.claudeCode.toolResponse` is
    // built by the adapter on the `tool_progress` path and FORWARDED VERBATIM
    // from the tool's own response on the PostToolUse path (`onPostToolUseHook`,
    // for any tool). So a server answering with a `subagentType` in its
    // structured output is one string away from being drawn as an agent
    // somebody spawned, with a live rail under it.
    const answered = {
      claudeCode: {
        toolName: "mcp__other__dispatch",
        toolResponse: { ok: true, subagentType: "Explore" },
      },
    };
    expect(spawnedIn(answered, { query: "anything" })).toBeNull();
    // ... including when it is shaped like the beat it is imitating.
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
    // The adapter's own `tool_progress` forwarding for an Agent call carries no
    // flag, so it is answered `null` like anything else unflagged. Nothing is
    // lost: the kind rode the flagged frames that announced and refined the
    // spawn, and the transcript holds it from there.
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
    // The frames a subagent's own calls arrive on say who they came from and
    // never that they started anybody.
    expect(
      spawnedIn({ claudeCode: { parentToolUseId: "toolu_01AGENT" } }, {}),
    ).toBeNull();
    expect(spawnedIn(undefined, undefined)).toBeNull();
    expect(spawnedIn(null, null)).toBeNull();
    expect(spawnedIn({}, {})).toBeNull();
    expect(spawnedIn({ claudeCode: null }, null)).toBeNull();
    expect(spawnedIn({ someOtherAgent: { subagent: true } }, {})).toBeNull();
    // Truthy is not the word: an agent that answers something else here has
    // not said this.
    expect(spawnedIn({ claudeCode: { subagent: "yes" } }, {})).toBeNull();
    expect(spawnedIn({ claudeCode: { subagent: 1 } }, {})).toBeNull();
  });

  test("a spawn that named no kind of agent says so, rather than guessing", () => {
    // `subagent_type` is optional on the tool that spawns one, and the
    // arguments arrive incrementally besides. The frame is still a spawn; the
    // kind is still unsaid, and an absent field is how this says that.
    const { subagent_type: _named, ...anonymous } = ASKED;
    expect(spawnedIn(SPAWN, anonymous)).toEqual({ said: "explore the host" });
    expect(spawnedIn(SPAWN, undefined)).toEqual({});
    expect(spawnedIn(SPAWN, { subagent_type: "" })).toEqual({});
    expect(spawnedIn(SPAWN, { subagent_type: 7 })).toEqual({});
  });

  test("... and it says WHAT the agent was sent to do, which is not the row's name", () => {
    // MEASURED ON A REAL FAN-OUT: this adapter titles an `Agent` call with the
    // TOOL's name, so four agents dispatched in one message reach a reader as
    // four rows reading `Task`.
    //
    // Through the SAME gate as the kind, and for the same reason: `description`
    // is a name one tool gives one of its arguments, and the tools on a session
    // are not a closed set.
    expect(spawnedIn(SPAWN, { description: "count the terminals" })).toEqual({
      said: "count the terminals",
    });
    expect(spawnedIn({ claudeCode: { toolName: "Agent" } }, ASKED)).toBeNull();
    // Absent rather than empty when nobody said, which is how every other field
    // here spells "unchanged" — the arguments arrive across frames, and a blank
    // taken as an answer would take the description back off a row that had it.
    expect(spawnedIn(SPAWN, { description: "" })).toEqual({});
    expect(spawnedIn(SPAWN, { description: 7 })).toEqual({});
  });

  test("a spawn's own response cannot name the agent either", () => {
    // The flag opens the door and the ARGUMENTS are what is read through it. A
    // flagged frame carrying a `subagentType` and no `subagent_type` is a spawn
    // whose kind nobody stated — not a spawn named by its response, which is
    // the reading that let any tool's output through.
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
    // ... and where they disagree, what was asked for is what a person reading
    // the row is owed.
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
  /** What the patched adapter stamps when a task is ARMED — the harness's own
   *  `task_started`, translated onto the call it named. Recorded from a real
   *  session (`Monitor`), which is why the kind is the harness's `local_bash`
   *  rather than anything a reader might expect a monitor to say. */
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

  /** ... and what it stamps when the task settles: the same id, the harness's
   *  own word for the ending, and the sentence that carries a background
   *  shell's exit code. */
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
    // ... and NOT the harness's `taskType`, which is on the frame and says
    // `local_bash` for a monitor and for a background shell alike. A field
    // nothing draws is a field that is wrong the first time somebody draws it.
    expect(backgroundTaskIn(ARMED)).toEqual({
      task: "bu13xz2ie",
      description: "tick watch",
    });
  });

  test("an arming frame says nothing about an ending", () => {
    // Which is what lets the transcript hold the two together: an absent field
    // is "unchanged", so the frame that arms a call cannot take an ending back
    // off a row and the frame that ends one cannot take the description off.
    expect(backgroundTaskIn(ARMED)?.ended).toBeUndefined();
  });

  test("reads how it ENDED in the harness's own word, not ACP's", () => {
    // The whole reason the field is carried: ACP has four statuses, so
    // `failed`, `killed` and `stopped` all reach the row as `failed`. A monitor
    // somebody STOPPED did not fail.
    expect(backgroundTaskIn(ENDED)?.ended).toBe("failed");
    expect(
      backgroundTaskIn({
        claudeCode: { backgroundTask: { taskId: "t", status: "stopped" } },
      })?.ended,
    ).toBe("stopped");
  });

  test("a frame that says nothing about a task arms nothing", () => {
    // Nearly every frame, and every frame from an agent that is not this
    // adapter — whose background work is then drawn exactly as it was before
    // any of this: a call that completed at the moment it started.
    expect(backgroundTaskIn({ claudeCode: { toolName: "Bash" } })).toBeNull();
    expect(backgroundTaskIn({ claudeCode: {} })).toBeNull();
    expect(backgroundTaskIn({})).toBeNull();
    expect(backgroundTaskIn(null)).toBeNull();
    expect(backgroundTaskIn(undefined)).toBeNull();
  });

  test("NO TASK ID, NO TASK", () => {
    // The id is the one field every frame about a task carries — the harness
    // says everything else under it — so a payload without one is not a task
    // this end can follow, and a live face drawn on it could never be taken off
    // by anything.
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
    // The rule this file's other readers follow: a description that is not a
    // sentence and an ending that is not a word are said by nobody, and
    // defaulting either would be inventing the fact the row exists to report.
    // The task survives, because the task is what was actually said.
    expect(
      backgroundTaskIn({
        claudeCode: {
          backgroundTask: { taskId: "t", description: "", status: null },
        },
      }),
    ).toEqual({ task: "t" });
  });

  test("a later frame can file the report on the same stamp the ending uses", () => {
    // The report is the other half of a task-notification. It is not a spawn
    // fact — the spawn's door is the `subagent` flag, and this frame does not
    // carry one — and inventing a second `_meta` field for it would be the
    // vocabulary the rest of this file already has, respelt.
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
    // The reading a future reader will reach for, and the reason it is not
    // here: `taskId` is a name the `Monitor` tool gives one of its results and
    // `backgroundTaskId` is what `Bash` gives one of its own, so a reader that
    // trusted either off a payload would put a ticking clock and a live rail on
    // any MCP server that answered with a field by that name. What the ADAPTER
    // registered is what this reads.
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
  /** What the adapter forwards under `_claude/sdkMessage`, having been asked to
   *  by {@link OPEN_SESSION_META}: the CLI's own `init`, verbatim, with the
   *  sessionId the notification carries. */
  const init = (model: unknown) => ({
    sessionId: "s1",
    message: { type: "system", subtype: "init", model, cwd: "/home/kolu" },
  });

  test("the `init` message names the model the CLI is running", () => {
    expect(liveModelIn(init("claude-opus-4-5"))).toBe("claude-opus-4-5");
  });

  test("what we asked to be forwarded is what is read", () => {
    // The ask and the read are one bet, so the message is built out of the
    // filter we subscribed with: a reader that drifted from the subscription
    // would go quiet on exactly the messages the adapter still sends.
    const [subscribed] = OPEN_SESSION_META.claudeCode.emitRawSDKMessages;
    expect(
      liveModelIn({ message: { ...subscribed, model: "claude-opus-4-5" } }),
    ).toBe("claude-opus-4-5");
  });

  test("another message of the CLI's is not a model", () => {
    // Only `system`/`init` carries it. A result, an assistant turn, a system
    // message of some other subtype: all say nothing about which model is
    // running, and a field lifted out of one would be a guess.
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

/**
 * The other field of that same message.
 *
 * It is worth its own block for the reason the model's is: it is a bet on ONE
 * agent's private channel, and the near misses are the interesting half — a
 * status word nobody here has seen, a row with no name, a message of some other
 * kind. Every one of them is cheap as a value and expensive to stage against a
 * real CLI, which would have to be talked into failing to connect to something.
 *
 * What is being locked is that the STATUS SURVIVES VERBATIM. The one word that
 * means yes is matched here; this file's job is to hand the layer above the
 * CLI's own spelling and to drop anything it cannot read, rather than to
 * translate a set that grows on somebody else's release schedule.
 */
describe("which of this conversation's servers the agent attached", () => {
  /** The `init` message again, with the servers half of it. */
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
    // WHICH WORD MEANS YES is decided here, because it is a fact about this
    // adapter in exactly the way `mcp__<server>__` is. The roster one layer up
    // reads the verdict and never the word.
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
    // POSITIVE RECOGNITION, the rule this file keeps everywhere: a word that is
    // not the one is read as no, including one no release has sent. And the
    // word survives, because the CLI carries `connected`, `failed`,
    // `needs-auth`, `pending` and `disabled` today and the SDK types the field
    // as a bare `string` — an open set. Flattened into a vocabulary of ours,
    // this file would have to be edited on somebody else's release for a person
    // to find out that their server wants signing in rather than that it broke.
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
    // The same narrowing the tool-name prefix gets, for the same reason: a
    // status that merely starts with the word is not the word.
    expect(
      liveServersIn(init([{ name: "kolu", status: "connected-ish" }])),
    ).toEqual([{ name: "kolu", attached: false, said: "connected-ish" }]);
    expect(
      liveServersIn(init([{ name: "kolu", status: "Connected" }])),
    ).toEqual([{ name: "kolu", attached: false, said: "Connected" }]);
  });

  test("what we asked to be forwarded is what is read", () => {
    // The ask and the read are one bet, exactly as they are for the model.
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
    // `null` and `[]` are two different instructions to the layer above: one
    // leaves every row where the client put it, and the other would be the
    // agent reporting on a list with nothing in it. An absent field is the
    // first.
    expect(liveServersIn(init(undefined))).toBeNull();
    expect(liveServersIn(init("kolu, alpha"))).toBeNull();
    expect(liveServersIn({ sessionId: "s1" })).toBeNull();
    expect(liveServersIn(null)).toBeNull();
    expect(liveServersIn(undefined)).toBeNull();
    // ... and an init that carried an EMPTY list really did say so.
    expect(liveServersIn(init([]))).toEqual([]);
  });

  test("a row that cannot be read is dropped, never repaired", () => {
    // A row with no name is about nothing and a row with no status has nothing
    // to say. Defaulting either would be this file inventing the fact it is
    // here to report; dropped, the roster row stays where the client put it,
    // which is what it already says.
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

describe("the leg", () => {
  test("reads a tool's name out of the meta, never out of the call id", () => {
    // A Claude call id is an opaque `toolu_…` and says nothing about the tool.
    // Reading it as a name — which a leg on a wire where it IS one does — would
    // answer for a call nothing has named, which is the one direction this file
    // may not fail in.
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
    // A person who pasted the wrapper is still a person: origin human wins, and
    // a quote of the tags inside a larger message is not the whole payload.
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
    // The pinned adapter omits this mode under root unless IS_SANDBOX is set,
    // and a host that cannot have it still gets a conductor: the refusal is
    // reported and `allowedWithoutAsking` is the backstop underneath it.
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
    // The adapter announces a call on the SDK's `content_block_start`, with
    // `rawInput: {}` — an input object with nothing in it — and a title derived
    // from no arguments at all.
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call",
        title: "Terminal",
        rawInput: {},
      }),
    ).toBe(true);
    // The refinement that follows is the real name, however empty a later
    // frame's own report happens to be.
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
    // An announcement that CAME with its arguments names its row at once —
    // which is every frame this adapter sends for a replayed conversation.
    expect(
      CLAUDE.provisionalTitle?.({
        sessionUpdate: "tool_call",
        title: "Read",
        rawInput: { file_path: "/home/kolu/notes.md" },
      }),
    ).toBe(false);
    // ... and the losing direction, which is "this is a real name": a frame
    // with no input field, another agent's shape, nothing at all.
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

// The SDK stores `tool_result.content` as a string, forwarded unchanged by ACP.
// This literal is independent of the fixtures above so a fixture mistake cannot
// hide it.
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
  // The Claude SDK forwards only MCP text blocks, so a refusal from kolu's own
  // MCP face reaches this leg as the brand `@kolu/surface-mcp` prints and
  // nothing else. Its kind and its reason are what a person can act on.
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
  // Unbranded, foreign and TRUNCATED are all "not a refusal": the brand without
  // a reason says nothing a person could read.
  expect(CLAUDE.replyIn("surface-mcp: unavailable")).toBeUndefined();
  expect(
    CLAUDE.replyIn("surface-mcp: `x` was refused (usage): "),
  ).toBeUndefined();
});
