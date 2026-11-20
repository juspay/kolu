import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { childEnvOf } from "@kolu/child";
import {
  type Agent,
  adopt,
  authOf,
  fromElsewhere,
  goneOf,
  make,
  missingOf,
  refusalData,
  saidOf,
} from "./agent.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";
import type { AgentEvent, Stored } from "./events.ts";
import type { Memory } from "./memory.ts";

const NOWHERE = "/nonexistent/olai-test/acp-agent";

const REMEMBERS_NOTHING: Memory = {
  recall: Effect.succeed(null),
  remember: () => Effect.void,
};

const NEWEST: Stored = {
  id: "b",
  title: "somebody else's",
  updatedAt: "2026-08-13T10:00:00Z",
  messageCount: null,
  supersededBy: null,
};
const OLDER: Stored = {
  id: "a",
  title: "mine",
  updatedAt: "2026-07-01T09:00:00Z",
  messageCount: null,
  supersededBy: null,
};
const STORED: ReadonlyArray<Stored> = [NEWEST, OLDER];

describe("which conversation a boot opens in", () => {
  test("the one this panel was last in, however fresh the others are", () => {
    expect(adopt("a", STORED)).toBe(OLDER);
  });

  test("the newest, when nothing was remembered", () => {
    expect(adopt(null, STORED)).toBe(NEWEST);
  });

  test("the newest, when the remembered one is gone", () => {
    expect(adopt("nowhere", STORED)).toBe(NEWEST);
  });

  test("nothing at all, when the directory has no conversations", () => {
    expect(adopt("a", [])).toBeUndefined();
  });
});

describe("an agent that will not start", () => {
  test("refuses with the file it was pointed at, not with our end of the pipe", async () => {
    const agent = await Effect.runPromise(
      make({
        id: "an-agent",
        leg: SAYS_NOTHING,
        command: NOWHERE,
        args: [],
        cwd: process.cwd(),
        tools: () => [],
        memory: REMEMBERS_NOTHING,
        onEvent: () => {},
      }),
    );

    const outcome = await Effect.runPromise(Effect.result(agent.boot));

    expect(outcome._tag).toBe("Failure");
    const why = outcome._tag === "Failure" ? outcome.failure.why : "";
    expect(why).toContain(NOWHERE);
    expect(why).toContain("ENOENT");
    expect(why).not.toContain("stream was destroyed");
    expect(outcome._tag === "Failure" ? outcome.failure.gone : null).toBe(
      "unreachable",
    );

    await Effect.runPromise(agent.stop);
  });
});

describe("what a failure says about whether the message went", () => {
  test("an error response is the agent answering: refused", () => {
    expect(
      goneOf(new RequestError(-32000, "this turn cannot be steered")),
    ).toBe("refused");
  });

  test("a connection that died is not an answer: unanswered", () => {
    expect(goneOf(new Error("ACP connection closed"))).toBe("unanswered");
  });

  test("anything else reads as unanswered, which is the safe direction", () => {
    expect(goneOf("something nobody has seen before")).toBe("unanswered");
  });

  test("nothing read off a rejection is ever `unreachable`", () => {
    for (const cause of [
      new RequestError(-32603, "internal error"),
      new Error("ACP connection closed"),
      "something nobody has seen before",
      null,
    ]) {
      expect(goneOf(cause)).not.toBe("unreachable");
    }
  });
});

describe("what a refusal says about a signature", () => {
  const AUTH_REQUIRED = -32000;

  test("the protocol's auth-required code is a sign-in", () => {
    expect(
      authOf(new RequestError(AUTH_REQUIRED, "Authentication required")),
    ).toBe(true);
    expect(
      goneOf(new RequestError(AUTH_REQUIRED, "Authentication required")),
    ).toBe("refused");
  });

  test("the code a failed sign-in answers with is NOT one", () => {
    expect(authOf(new RequestError(-32602, "Invalid params"))).toBe(false);
  });

  test("silence is not a signature either", () => {
    expect(authOf(new Error("ACP connection closed"))).toBe(false);
    expect(authOf("something nobody has seen before")).toBe(false);
    expect(authOf(null)).toBe(false);
  });
});

describe("what a refusal says about a chat that is not here", () => {
  const RESOURCE_NOT_FOUND = -32002;

  test("the protocol's not-found code is a missing conversation", () => {
    expect(
      missingOf(new RequestError(RESOURCE_NOT_FOUND, "Session not found")),
    ).toBe(true);
    expect(
      goneOf(new RequestError(RESOURCE_NOT_FOUND, "Session not found")),
    ).toBe("refused");
    expect(
      authOf(new RequestError(RESOURCE_NOT_FOUND, "Session not found")),
    ).toBe(false);
  });

  test("an agent that words it as an internal error is NOT one", () => {
    expect(
      missingOf(new RequestError(-32603, "no such conversation: ede56b25")),
    ).toBe(false);
    expect(missingOf(new RequestError(-32602, "Resource not found"))).toBe(
      false,
    );
  });

  test("silence is not a missing conversation either", () => {
    expect(missingOf(new Error("ACP connection closed"))).toBe(false);
    expect(missingOf("something nobody has seen before")).toBe(false);
    expect(missingOf(null)).toBe(false);
  });
});

describe("what a refusal says", () => {
  const internal = (data?: unknown): RequestError =>
    new RequestError(-32603, "Internal error", data);

  test("the agent's sentence in `data.details` wins over the code word", () => {
    const said = saidOf(
      internal({
        details:
          "Fable 5.1 isn't available for your account yet. Run /model to pick another model.",
      }),
    );
    expect(said).toBe(
      "Fable 5.1 isn't available for your account yet. Run /model to pick another model.",
    );
    expect(said).not.toContain("Internal error");
  });

  test("a parsed body's `data.message` is the sentence when there are no details", () => {
    expect(
      saidOf(
        internal({ message: "Model switch blocked by a PreModelSwitch hook" }),
      ),
    ).toBe("Model switch blocked by a PreModelSwitch hook");
  });

  test("a refusal with nothing behind it still says what it is", () => {
    expect(saidOf(internal())).toBe("Internal error");
    expect(saidOf(internal({ details: 42 }))).toBe("Internal error");
    expect(saidOf(internal({ details: "  " }))).toBe("Internal error");
    expect(saidOf(internal("a bare string"))).toBe("Internal error");
  });

  test("anything that is not a refusal reads as it always did", () => {
    expect(saidOf(new Error("ACP connection closed"))).toBe(
      "ACP connection closed",
    );
    expect(saidOf("something nobody has seen before")).toBe(
      "something nobody has seen before",
    );
  });

  test("the logged `data` is JSON, bounded, and never throws", () => {
    expect(refusalData(undefined)).toBeUndefined();
    expect(refusalData({ details: "no" })).toBe('{"details":"no"}');
    expect(refusalData({ details: "x".repeat(10_000) })!.length).toBeLessThan(
      2100,
    );
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(refusalData(cycle)).toBe("[object Object]");
  });
});

describe("the environment a spawned child gets", () => {
  test("the adapter's unset list is removed and everything else survives", () => {
    const env = childEnvOf(
      { PATH: "/bin", SSH_CONNECTION: "10.0.0.1 1 2", KEEP: "yes" },
      { EXTRA: "1" },
      [
        "NO_BROWSER",
        "SSH_CONNECTION",
        "SSH_CLIENT",
        "SSH_TTY",
        "CLAUDE_CODE_REMOTE",
      ],
    );
    expect(env).toEqual({ PATH: "/bin", KEEP: "yes", EXTRA: "1" });
  });

  test("olai's own environment is not edited", () => {
    const base: NodeJS.ProcessEnv = { SSH_TTY: "/dev/pts/1", PATH: "/bin" };
    childEnvOf(base, undefined, ["SSH_TTY"]);
    expect(base).toEqual({ SSH_TTY: "/dev/pts/1", PATH: "/bin" });
  });

  test("an adapter that unset nothing inherits exactly what it was given", () => {
    expect(childEnvOf({ PATH: "/bin" }, undefined, undefined)).toEqual({
      PATH: "/bin",
    });
  });

  test("an engine's env entry beats the same name in the base environment", () => {
    expect(
      childEnvOf(
        { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0", PATH: "/bin" },
        { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
        undefined,
      ),
    ).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", PATH: "/bin" });
  });
});

describe("who gets a sign-in attempt", () => {
  const bench = async (
    body: (it: { agent: Agent; spawned: () => number }) => Promise<void>,
  ): Promise<void> => {
    const cwd = mkdtempSync(join(tmpdir(), "olai-signin-"));
    const log = join(cwd, "spawns.log");
    const agent = await Effect.runPromise(
      make({
        id: "auth-agent",
        leg: SAYS_NOTHING,
        command: process.execPath,
        args: [join(import.meta.dirname, "fixtures/auth-agent.ts")],
        env: {
          OLAI_TEST_LOGIN_SCRIPT: join(
            import.meta.dirname,
            "fixtures/auth-login.ts",
          ),
          OLAI_TEST_LOGIN_LOG: log,
        },
        cwd,
        tools: () => [],
        memory: REMEMBERS_NOTHING,
        onEvent: () => {},
      }),
    );
    try {
      await body({
        agent,
        spawned: () =>
          existsSync(log)
            ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
                .length
            : 0,
      });
    } finally {
      await Effect.runPromise(agent.stop);
      rmSync(cwd, { recursive: true, force: true });
    }
  };

  test("two presses in one instant take ONE attempt, and the second attaches", async () => {
    await bench(async ({ agent, spawned }) => {
      const outcomes = await Effect.runPromise(
        Effect.forEach([1, 2], () => agent.signIn("fake-login"), {
          concurrency: "unbounded",
        }),
      );
      expect([...outcomes].sort()).toEqual(["attached", "signed-in"]);
      expect(spawned()).toBe(1);
    });
  });

  test("a different method while one is running is refused, not attached", async () => {
    await bench(async ({ agent, spawned }) => {
      const outcomes = await Effect.runPromise(
        Effect.forEach(
          ["fake-login", "other-login"],
          (method) => Effect.result(agent.signIn(method)),
          { concurrency: "unbounded" },
        ),
      );
      const ran = outcomes.filter((outcome) => outcome._tag === "Success");
      expect(ran).toHaveLength(1);
      expect(ran[0]?._tag === "Success" ? ran[0].success : null).toBe(
        "signed-in",
      );
      const refused = outcomes.filter((outcome) => outcome._tag === "Failure");
      expect(refused).toHaveLength(1);
      expect(
        refused[0]?._tag === "Failure" ? refused[0].failure.why : "",
      ).toContain("already running");
      expect(spawned()).toBe(1);
    });
  });

  test("a method that wrote no command line runs the agent binary with its own args", async () => {
    await bench(async ({ agent, spawned }) => {
      expect(await Effect.runPromise(agent.signIn("other-login"))).toBe(
        "signed-in",
      );
      expect(spawned()).toBe(1);
    });
  });
});

describe("who the agent is signed in as", () => {
  test("the handshake's push arrives typed, before any conversation exists", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "olai-identity-"));
    const seen =
      Promise.withResolvers<Extract<AgentEvent, { _tag: "identity" }>>();
    const agent = await Effect.runPromise(
      make({
        id: "identity-agent",
        leg: SAYS_NOTHING,
        command: process.execPath,
        args: [join(import.meta.dirname, "fixtures/auth-agent.ts")],
        cwd,
        tools: () => [],
        memory: REMEMBERS_NOTHING,
        onEvent: (event) => {
          if (event._tag === "identity") seen.resolve(event);
        },
      }),
    );
    try {
      await Effect.runPromise(agent.boot);
      expect(await seen.promise).toEqual({
        _tag: "identity",
        identity: {
          kind: "account",
          label: "Fake Max",
          detail: "a fake second line",
          account: {
            email: "fake@example.com",
            organization: null,
            plan: null,
          },
        },
      });
    } finally {
      await Effect.runPromise(agent.stop);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("whose session a leftover notification is about", () => {
  const closed = new Set(["old"]);

  test("a leftover from a conversation we left is from elsewhere, even in none", () => {
    expect(fromElsewhere("old", null, closed)).toBe(true);
  });

  test("a leftover is from elsewhere once we are in the next conversation too", () => {
    expect(fromElsewhere("old", "new", closed)).toBe(true);
  });

  test("the conversation we are in is not from elsewhere", () => {
    expect(fromElsewhere("new", "new", closed)).toBe(false);
  });

  test("a load's replay is not from elsewhere: we are in none, and it is not closed", () => {
    expect(fromElsewhere("loading", null, closed)).toBe(false);
  });

  test("an unnamed notification is not a mismatch", () => {
    expect(fromElsewhere(undefined, null, closed)).toBe(false);
    expect(fromElsewhere(undefined, "new", closed)).toBe(false);
  });

  test("a different conversation than the one we are in is from elsewhere", () => {
    expect(fromElsewhere("other", "new", new Set())).toBe(true);
  });
});
