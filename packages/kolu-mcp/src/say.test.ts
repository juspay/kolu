import type { PadiTerminal } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp";
import { describe, expect, it } from "vitest";
import type { AgentStateOutcome } from "@kolu/padi-client/watch";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import {
  agentPresence,
  agentVocab,
  type PaneReading,
  type SteerSight,
} from "kolu-agents/vocab";
import {
  resolveSay,
  type SayRefusal,
  type SayVocabulary,
  sayTook,
  steerVerdict,
  terminalRecord,
} from "./say.ts";

const ID = "11111111-1111-4111-8111-111111111111";

const withAgent = (kind: string, state: string): PadiTerminal =>
  ({
    state: "active",
    title: "worker",
    agent: { kind, state },
  }) as unknown as PadiTerminal;

const SHELL = {
  state: "active",
  title: "shell",
  agent: null,
} as unknown as PadiTerminal;

const refusalFrom = (
  text: string,
  record: PadiTerminal,
): ToolFailure<SayRefusal> => {
  try {
    resolveSay(ID, text, record);
  } catch (e) {
    if (e instanceof ToolFailure) return e as ToolFailure<SayRefusal>;
    throw new Error(`expected a ToolFailure, got ${String(e)}`);
  }
  throw new Error("expected a refusal, but the say resolved");
};

describe("resolveSay — which keys, and what they do", () => {
  it("an IDLE agent gets its idle keys, and the words start a turn", () => {
    const say = resolveSay(ID, "ship it", withAgent("omp", "waiting"));
    expect(say.agent).toBe("omp");
    expect(say.working).toBe(false);
    expect(say.keys).toEqual(agentVocab("omp").say?.idle);
    expect(say.delivery).toBe("submitted");
  });

  it("an agent BLOCKED ON THE HUMAN is not working — it is at a prompt", () => {
    const say = resolveSay(
      ID,
      "yes",
      withAgent("claude-code", "awaiting_user"),
    );
    expect(say.working).toBe(false);
    expect(say.delivery).toBe("submitted");
  });

  it("a FRESH agent — up, settled, never prompted — gets the idle keys", () => {
    const say = resolveSay(ID, "here is the brief", withAgent("omp", "fresh"));
    expect(say.working).toBe(false);
    expect(say.keys).toEqual(agentVocab("omp").say?.idle);
    expect(say.delivery).toBe("submitted");
  });

  it("a PROMPTED agent — submitted to, no transcript yet — is WORKING, and a second say steers or queues", () => {
    const omp = resolveSay(ID, "also this", withAgent("omp", "prompted"));
    expect(omp.working).toBe(true);
    expect(omp.keys).toEqual(agentVocab("omp").say?.working?.keys);
    expect(omp.delivery).toBe("steer");
    const claude = resolveSay(
      ID,
      "also this",
      withAgent("claude-code", "prompted"),
    );
    expect(claude.delivery).toBe("queue");
  });

  it("a WORKING agent gets its mid-turn keys and its own delivery word", () => {
    const steering = resolveSay(
      ID,
      "also the Nile",
      withAgent("omp", "thinking"),
    );
    expect(steering.working).toBe(true);
    expect(steering.delivery).toBe("steer");

    const queueing = resolveSay(
      ID,
      "also the Nile",
      withAgent("claude-code", "tool_use"),
    );
    expect(queueing.working).toBe(true);
    expect(queueing.delivery).toBe("queue");
  });

  it("the TEXT is encoded by the shared send policy, paste rule included", () => {
    const one = resolveSay(ID, "hello", withAgent("codex", "waiting"));
    expect(one.text.write).toBe("hello");
    expect(one.text.paste).toBe(false);

    const many = resolveSay(ID, "a\nb", withAgent("codex", "waiting"));
    expect(many.text.write).toBe("\x1b[200~a\nb\x1b[201~");
    expect(many.text.paste).toBe(true);
  });

  it("every agent kolu detects has a recipe for both states", () => {
    for (const kind of [
      "claude-code",
      "codex",
      "opencode",
      "grok",
      "pi",
      "omp",
      "xyne",
    ] as const) {
      const recipe = agentVocab(kind).say;
      expect(recipe, `${kind} has no say recipe`).not.toBeNull();
      expect(recipe?.idle.length, `${kind} idle keys`).toBeGreaterThan(0);
      expect(recipe?.verified, `${kind} verified`).toMatch(/\w/);
      expect(resolveSay(ID, "hi", withAgent(kind, "waiting")).keys).toEqual(
        recipe?.idle,
      );
    }
  });
});

describe("resolveSay — every refusal reaches the agent as DATA", () => {
  it("empty text is refused by the shared policy, never written as 0 bytes", () => {
    const refusal = refusalFrom("", withAgent("omp", "waiting"));
    expect(refusal.detail).toEqual({ kind: "text-refused" });
    expect(refusal.message).toMatch(/nothing to send/);
  });

  it("a plain shell is refused — the words are not typed at a bash prompt", () => {
    const refusal = refusalFrom("ship it", SHELL);
    expect(refusal.detail).toEqual({ kind: "no-agent", id: ID });
    expect(refusal.message).toMatch(/no agent/);
    expect(refusal.message).toMatch(/lifecycle_sendInput/);
  });

  it("an agent still COMING UP is refused — its screen is still being drawn", () => {
    const refusal = refusalFrom(
      "here is the brief",
      withAgent("omp", "starting"),
    );
    expect(refusal.detail).toEqual({
      kind: "agent-starting",
      id: ID,
      agent: "omp",
    });
    expect(refusal.message).toMatch(/still coming up/);
    expect(refusal.message).toMatch(/fresh/);
  });

  it("a DORMANT terminal is refused as asleep, not as a shell with no agent", () => {
    const asleep = { state: "sleeping" } as unknown as PadiTerminal;
    const refusal = refusalFrom("ship it", asleep);
    expect(refusal.detail).toMatchObject({
      kind: "terminal-not-active",
      tag: "TerminalNotActive",
      state: "sleeping",
      id: ID,
    });

    const parked = { state: "parked" } as unknown as PadiTerminal;
    expect(refusalFrom("ship it", parked).message).toMatch(/parked/);
  });

  it("the refusal names the terminal, so the fleet face can re-qualify it", () => {
    const refusal = refusalFrom("ship it", SHELL);
    expect(refusal.detail).toMatchObject({ id: ID });
    expect(refusal.message).toContain(ID);
  });
});

describe("the two refusals no shipped agent can reach", () => {
  const fake = (say: SayVocabulary["say"]): SayVocabulary => ({
    displayName: "Rumour",
    say,
  });

  it("an agent with NO recipe is refused by name, never guessed at", () => {
    try {
      resolveSay(ID, "ship it", withAgent("omp", "waiting"), () => fake(null));
    } catch (e) {
      const refusal = e as ToolFailure<SayRefusal>;
      expect(refusal.detail).toEqual({
        kind: "agent-cannot-be-told",
        id: ID,
        agent: "omp",
      });
      expect(refusal.message).toContain("Rumour");
      return;
    }
    throw new Error("expected a refusal, but the say resolved");
  });

  it("an agent with no MID-TURN recipe is refused only while it works", () => {
    const idleOnly = fake({
      idle: ["Enter"],
      working: null,
      verified: "a test",
    });
    const said = resolveSay(
      ID,
      "ship it",
      withAgent("omp", "waiting"),
      () => idleOnly,
    );
    expect(said.keys).toEqual(["Enter"]);
    expect(said.delivery).toBe("submitted");

    try {
      resolveSay(ID, "ship it", withAgent("omp", "thinking"), () => idleOnly);
    } catch (e) {
      const refusal = e as ToolFailure<SayRefusal>;
      expect(refusal.detail).toEqual({
        kind: "agent-cannot-be-told-while-working",
        id: ID,
        agent: "omp",
      });
      expect(refusal.message).toMatch(/Wait for it to finish/);
      return;
    }
    throw new Error("expected a refusal, but the say resolved");
  });
});

describe("sayTook — did the keys take, and what the answer says either way", () => {
  const started = (outcome: AgentStateOutcome) =>
    sayTook("submitted", { kind: "start", outcome });

  it("an idle agent that starts working took it", () => {
    const took = started({
      kind: "met",
      agent: { kind: "omp", state: "thinking" } as never,
      elapsedMs: 120,
    });
    expect(took).toMatchObject({ observed: "began-working", afterMs: 120 });
    expect(took.note).toContain("120");
  });

  it("a fresh agent padi saw the submit reach is `submit-landed`, never claimed as a turn begun", () => {
    const took = started({
      kind: "met",
      agent: agentPresence("omp", "prompted", null),
      elapsedMs: 3,
    });
    expect(took).toMatchObject({ observed: "submit-landed", afterMs: 3 });
    expect(took.note).toMatch(/not that it has answered/);
  });

  it("an idle agent that does NOT start is an ANSWER, not a failure — and it names the screen read", () => {
    const took = started({ kind: "timeout", elapsedMs: 3000 });
    expect(took).toMatchObject({ observed: "did-not-begin", waitedMs: 3000 });
    expect(took.note).toContain("keys were sent");
    expect(took.note).toContain("screen_text");
  });

  it("a working agent with nothing to watch is told plainly that taking is not observable — with its delivery", () => {
    const steered = sayTook("steer", { kind: "nothing" });
    expect(steered.observed).toBe("not-observable");
    expect(steered.note).toContain("turn that is running");

    const queued = sayTook("queue", { kind: "nothing" });
    expect(queued.observed).toBe("not-observable");
    expect(queued.note).toContain("next turn");
  });

  it("a HELD steer says it will be delivered on its own, and warns off the Enter that would interrupt", () => {
    const took = sayTook("steer", {
      kind: "steer",
      outcome: { kind: "held", waitedMs: 5000 },
    });
    expect(took).toMatchObject({ observed: "held", waitedMs: 5000 });
    expect(took.note).toContain("on their own");
    expect(took.note).toContain("do not send Enter");
  });

  it("losing sight of the terminal says which way it was lost", () => {
    expect(started({ kind: "gone", elapsedMs: 10 })).toMatchObject({
      observed: "lost-sight",
      why: "gone",
    });
    expect(started({ kind: "closed", error: "link dropped" })).toMatchObject({
      observed: "lost-sight",
      why: "closed",
    });
    expect(started({ kind: "closed", error: "link dropped" }).note).toContain(
      "link dropped",
    );
    expect(started({ kind: "interrupted" })).toMatchObject({
      observed: "lost-sight",
      why: "interrupted",
    });
  });
});

describe("steerVerdict — where a steer stands when the watch runs out", () => {
  const WORDS = "also check the staging logs";
  const sight = (pane: PaneReading): SteerSight<AgentInfo> => ({
    lastPrompt: (info) => {
      const { lastPromptId, lastPromptText } = info as unknown as {
        lastPromptId: string | null;
        lastPromptText: string | null;
      };
      return lastPromptId === null
        ? null
        : { id: lastPromptId, text: lastPromptText };
    },
    pane: () => pane,
  });
  const omp = (
    lastPromptId: string | null,
    lastPromptText: string | null = WORDS,
  ): AgentInfo =>
    ({
      kind: "omp",
      state: "thinking",
      lastPromptId,
      lastPromptText,
    }) as unknown as AgentInfo;
  const verdict = (after: AgentInfo | null, pane: PaneReading) =>
    steerVerdict({
      sight: sight(pane),
      before: "686ac209",
      after,
      screen: "",
      words: WORDS,
      waitedMs: 6500,
    });
  const ABSENT: PaneReading = { kind: "absent" };

  it("a new prompt CARRYING THESE WORDS is LANDED, held or not", () => {
    expect(verdict(omp("7d8bf8bc"), ABSENT)).toEqual({
      kind: "landed",
      elapsedMs: 6500,
    });
  });

  it("a new prompt carrying SOMEONE ELSE'S words is not landed", () => {
    expect(
      verdict(omp("7d8bf8bc", "whatever the human just typed"), ABSENT),
    ).toEqual({ kind: "did-not-land", waitedMs: 6500 });
  });

  it("a new prompt whose text kolu cannot read is CANNOT-TELL", () => {
    const outcome = verdict(omp("7d8bf8bc", null), ABSENT);
    expect(outcome.kind).toBe("cannot-tell");
  });

  it("the same prompt and the words in the pane is HELD", () => {
    expect(verdict(omp("686ac209"), { kind: "holds" })).toEqual({
      kind: "held",
      waitedMs: 6500,
    });
  });

  it("the same prompt and an EMPTY pane is DID-NOT-LAND — both facts seen", () => {
    expect(verdict(omp("686ac209"), ABSENT)).toEqual({
      kind: "did-not-land",
      waitedMs: 6500,
    });
  });

  it("a pane kolu could not parse is CANNOT-TELL, never did-not-land", () => {
    const outcome = verdict(omp("686ac209"), {
      kind: "unreadable",
      why: "its steering pane runs past the rows kolu read",
    });
    expect(outcome).toEqual({
      kind: "cannot-tell",
      waitedMs: 6500,
      why: "its steering pane runs past the rows kolu read",
    });
  });

  it("no live agent in the record after the keys is CANNOT-TELL", () => {
    expect(verdict(null, ABSENT).kind).toBe("cannot-tell");
  });
});

describe("terminalRecord — padi's frame is decoded, never asserted", () => {
  it("a malformed frame is a named refusal, and nothing is typed", () => {
    try {
      terminalRecord(ID, { state: "active", agent: { kind: 42 } });
      throw new Error("expected the decode to refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure<SayRefusal>).detail).toEqual({
        kind: "record-unreadable",
        id: ID,
      });
      expect((e as ToolFailure<SayRefusal>).message).toContain(
        "nothing was typed",
      );
    }
  });

  it("a real record decodes to padi's own shape", () => {
    const record = terminalRecord(ID, {
      state: "active",
      title: "worker",
      agent: null,
    });
    expect(record.state).toBe("active");
  });
});
