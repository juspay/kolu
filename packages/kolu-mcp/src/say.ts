import { terminalAsleepRefusal } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { AgentStateOutcome } from "@kolu/padi-client/watch";
import { activeAgent } from "@kolu/padi-client/terminalVocab";
import {
  firstFrameOfCollectionItem,
  firstFrameOrThrow,
  ITEM_READ_DEADLINE_MS,
} from "@kolu/surface/first-frame";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import {
  encodeSend,
  type SendPlan,
  type SendVocabulary,
} from "@kolu/terminal-protocol";
import {
  agentBucket,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Result, Schema } from "effect";
import type { AgentSayRecipe, SteerSight } from "kolu-agents/vocab";
import {
  AgentInfoSchema,
  agentSayRecipe,
  agentVocab,
  isAgentPresence,
  promptTextIs,
} from "kolu-agents/vocab";
import { rosterStandingOf, stillSettling } from "./rosterEvidence.ts";

export const AgentSayArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  text: Schema.String.annotate({
    description:
      "What to say to the agent. kolu types it and presses that agent's own submit keys — never send Enter yourself. Multiline text is bracketed-paste wrapped automatically.",
  }),
});
export type AgentSayArgs = typeof AgentSayArgsSchema.Type;

const SAY_SEND_VOCABULARY: SendVocabulary = {
  keyName: "lifecycle_sendInput { key }",
  submitRitual:
    "  agent_say { id, text }   # kolu types the text, waits for the settle, and presses that agent's submit keys",
};

export const SAY_SETTLE_IDLE_MS = 250;
export const SAY_SETTLE_TIMEOUT_MS = 2_000;

export const SAY_TAKE_CAP_MS = 3_000;

export const SAY_STEER_CAP_MS = 5_000;

export const SAY_STEER_SCREEN_TAIL = 40;

export const SAY_RECORD_LAG_MS = 1_500;

export type SayRefusal =
  | { readonly kind: "text-refused" }
  | { readonly kind: "no-agent"; readonly id: string }
  | {
      readonly kind: "agent-cannot-be-told";
      readonly id: string;
      readonly agent: string;
    }
  | {
      readonly kind: "agent-cannot-be-told-while-working";
      readonly id: string;
      readonly agent: string;
    }
  | {
      readonly kind: "agent-starting";
      readonly id: string;
      readonly agent: string;
    }
  | { readonly kind: "record-unreadable"; readonly id: string };

const SayRecordSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("active"),
    agent: Schema.NullOr(AgentInfoSchema),
  }),
  Schema.Struct({ state: Schema.Literals(["sleeping", "parked"]) }),
]);
export type SayRecord = typeof SayRecordSchema.Type;

const decodeSayRecord = Schema.decodeUnknownResult(SayRecordSchema);

export function terminalRecord(id: string, frame: unknown): SayRecord {
  const decoded = decodeSayRecord(frame);
  if (Result.isFailure(decoded)) {
    throw new ToolFailure<SayRefusal>(
      `terminal ${id} answered a record kolu could not read (${String(decoded.failure)}) — nothing was typed. This is a kolu/padi version mismatch, not something to retry blind.`,
      { kind: "record-unreadable", id },
    );
  }
  return decoded.success;
}

export type SayDelivery = "submitted" | "steer" | "queue";

export type SayWatch =
  | { readonly kind: "start" }
  | {
      readonly kind: "steer";
      readonly sight: SteerSight<AgentInfo>;
      readonly before: string | null;
    }
  | { readonly kind: "nothing" };

export interface SayPerformance {
  readonly text: SendPlan;
  readonly keys: readonly string[];
  readonly agent: AgentInfo["kind"];
  readonly working: boolean;
  readonly delivery: SayDelivery;
  readonly watch: SayWatch;
}

export const SAY_TAKES: ReadonlySet<WaitState> = new Set<WaitState>([
  "working",
]);

export type SayTook =
  | {
      readonly observed: "began-working";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "submit-landed";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "did-not-begin";
      readonly waitedMs: number;
      readonly note: string;
    }
  | { readonly observed: "not-observable"; readonly note: string }
  | {
      readonly observed: "landed";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "held";
      readonly waitedMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "did-not-land";
      readonly waitedMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "cannot-tell";
      readonly waitedMs: number;
      readonly why: string;
      readonly note: string;
    }
  | {
      readonly observed: "lost-sight";
      readonly why: "gone" | "closed" | "interrupted";
      readonly note: string;
    };

export type SteerOutcome =
  | { readonly kind: "landed"; readonly elapsedMs: number }
  | { readonly kind: "held"; readonly waitedMs: number }
  | { readonly kind: "did-not-land"; readonly waitedMs: number }
  | {
      readonly kind: "cannot-tell";
      readonly waitedMs: number;
      readonly why: string;
    }
  | {
      readonly kind: "lost-sight";
      readonly why: "gone" | "closed" | "interrupted";
      readonly detail: string;
    };

export type SayWatched =
  | { readonly kind: "nothing" }
  | { readonly kind: "start"; readonly outcome: AgentStateOutcome }
  | { readonly kind: "steer"; readonly outcome: SteerOutcome };

export type PromptReading = "took" | "other" | "unreadable" | "unmoved";

export function promptReading(
  sight: SteerSight<AgentInfo>,
  before: string | null,
  agent: AgentInfo,
  words: string,
): PromptReading {
  const now = sight.lastPrompt(agent);
  if (now === null || now.id === before) return "unmoved";
  if (now.text === null) return "unreadable";
  return promptTextIs(now.text, words) ? "took" : "other";
}

export function steerVerdict(input: {
  readonly sight: SteerSight<AgentInfo>;
  readonly before: string | null;
  readonly after: AgentInfo | null;
  readonly screen: string;
  readonly words: string;
  readonly waitedMs: number;
}): SteerOutcome {
  const { sight, before, after, screen, words, waitedMs } = input;
  if (after === null) {
    return {
      kind: "cannot-tell",
      waitedMs,
      why: "its record no longer carries a live agent, so kolu could not read the transcript the words would have landed in",
    };
  }
  const prompt = promptReading(sight, before, after, words);
  if (prompt === "took") return { kind: "landed", elapsedMs: waitedMs };
  if (prompt === "unreadable") {
    return {
      kind: "cannot-tell",
      waitedMs,
      why: "its transcript gained a prompt whose text kolu cannot read, so whether it is these words is unknown",
    };
  }
  const pane = sight.pane(screen, words);
  switch (pane.kind) {
    case "holds":
      return { kind: "held", waitedMs };
    case "unreadable":
      return { kind: "cannot-tell", waitedMs, why: pane.why };
    case "absent":
      return { kind: "did-not-land", waitedMs };
  }
}

export function sayTook(delivery: SayDelivery, watched: SayWatched): SayTook {
  switch (watched.kind) {
    case "nothing":
      return {
        observed: "not-observable",
        note: `The agent was already working, so there is no state change that would prove it heard this; the keys went in with delivery "${delivery}" — ${delivery === "steer" ? "its TUI hands them to the turn that is running at its next step" : "its TUI holds them for the next turn"}. Read the screen to see them land.`,
      };
    case "steer":
      return steerTook(watched.outcome);
    case "start":
      return startTook(watched.outcome);
  }
}

function steerTook(outcome: SteerOutcome): SayTook {
  switch (outcome.kind) {
    case "landed":
      return {
        observed: "landed",
        afterMs: outcome.elapsedMs,
        note: `The words are in its transcript ${outcome.elapsedMs} ms after the keys: the running turn took them.`,
      };
    case "held":
      return {
        observed: "held",
        waitedMs: outcome.waitedMs,
        note: "Its TUI accepted the words and is HOLDING them in its steering pane: the step it is running cannot be interrupted (a long tool call), and the words join the turn when that step ends, on their own. Do NOT say it again, and do not send Enter: a bare Enter delivers a held steer in omp by INTERRUPTING the running tool, which kills that step.",
      };
    case "did-not-land":
      return {
        observed: "did-not-land",
        waitedMs: outcome.waitedMs,
        note: `The keys were sent, but ${outcome.waitedMs} ms later the words are neither in its transcript nor held in its steering pane — kolu read both. Do NOT say it again blind — read the screen (screen_text): they may still be in its input box, or a dialog may have taken the keys.`,
      };
    case "cannot-tell":
      return {
        observed: "cannot-tell",
        waitedMs: outcome.waitedMs,
        why: outcome.why,
        note: `The keys were sent, and ${outcome.waitedMs} ms later kolu could not tell what became of them: ${outcome.why}. This is NOT "they did not arrive" — read the screen (screen_text) before saying anything again, because a second copy of a steer that DID land is a second instruction to the agent.`,
      };
    case "lost-sight":
      return {
        observed: "lost-sight",
        why: outcome.why,
        note:
          outcome.why === "gone"
            ? "The keys were sent, and then the terminal went away — whatever was said died with it. Nothing is running there."
            : `The keys were sent; the watch over this terminal ended before kolu could tell what became of them (${outcome.detail}) — the terminal is not known to be dead. Read the screen.`,
      };
  }
}

function startTook(outcome: AgentStateOutcome): SayTook {
  switch (outcome.kind) {
    case "met":
      return isAgentPresence(outcome.agent)
        ? {
            observed: "submit-landed",
            afterMs: outcome.elapsedMs,
            note: `The submit reached the agent ${outcome.elapsedMs} ms after the keys; it has written nothing yet, so this says the Enter got there, not that it has answered. Do not say it again — its reply arrives with its transcript.`,
          }
        : {
            observed: "began-working",
            afterMs: outcome.elapsedMs,
            note: `The agent began a turn ${outcome.elapsedMs} ms after the keys — it took.`,
          };
    case "timeout":
      return {
        observed: "did-not-begin",
        waitedMs: outcome.elapsedMs,
        note: `The keys were sent, but the agent had not begun working ${outcome.elapsedMs} ms later. Do NOT say it again blind — read the screen (screen_text): the words may be staged at its prompt, it may be waiting on a dialog, or it may just be slow to start.`,
      };
    case "gone":
      return {
        observed: "lost-sight",
        why: "gone",
        note: "The keys were sent, and then the terminal went away — whatever was said died with it. Nothing is running there.",
      };
    case "interrupted":
      return {
        observed: "lost-sight",
        why: "interrupted",
        note: "The keys were sent; the call was interrupted before kolu could see whether the agent started. Read the screen.",
      };
    case "closed":
      return {
        observed: "lost-sight",
        why: "closed",
        note: `The keys were sent; the watch over this terminal dropped before kolu could see whether the agent started${outcome.error === undefined ? "" : ` (${outcome.error})`} — the terminal is not known to be dead. Read the screen.`,
      };
  }
}

function sayableAgent(id: string, record: SayRecord): AgentInfo {
  if (record.state !== "active") throw terminalAsleepRefusal(id, record.state);
  const agent = record.agent;
  if (agent === null) {
    throw new ToolFailure<SayRefusal>(
      `Terminal ${id} has no agent — it is a plain shell, and a sentence meant for an agent typed at a shell prompt is a command nobody wrote. Use lifecycle_sendInput if you meant to type into the shell.`,
      { kind: "no-agent", id },
    );
  }
  return agent;
}

export interface SayVocabulary {
  readonly displayName: string;
  readonly say: AgentSayRecipe<AgentInfo> | null;
}

export type SayVocabularyOf = (kind: AgentInfo["kind"]) => SayVocabulary;

const registryVocabulary: SayVocabularyOf = (kind) => ({
  displayName: agentVocab(kind).displayName,
  say: agentSayRecipe(kind),
});

export function sayableRecipe(
  id: string,
  agent: AgentInfo,
  vocab: SayVocabulary,
): {
  readonly keys: readonly string[];
  readonly delivery: SayDelivery;
  readonly watch: SayWatch;
} {
  const recipe: AgentSayRecipe<AgentInfo> | null = vocab.say;
  if (recipe === null) {
    throw new ToolFailure<SayRefusal>(
      `kolu has no verified way to say something to ${vocab.displayName} (terminal ${id}): nobody has established which keys submit a message in its TUI, and a guessed keystroke lands in whatever that agent is doing. Say it to the human, or drive the terminal yourself with lifecycle_sendInput.`,
      { kind: "agent-cannot-be-told", id, agent: agent.kind },
    );
  }
  const bucket = agentBucket(agent.state);
  switch (bucket) {
    case "starting":
      throw new ToolFailure<SayRefusal>(
        `${vocab.displayName} (terminal ${id}) is still coming up — its process is there, but its screen is still being drawn. Keys pressed into a TUI that has not finished painting itself are read by whatever it draws next, or by nothing at all. Wait until it is READY and say it then: the Conductor's watch rings "ready" on its own, and a driver can wait for it with wait_agentState until: ["fresh"].`,
        { kind: "agent-starting", id, agent: agent.kind },
      );
    case "fresh":
    case "waiting":
    case "awaiting":
    case "other":
      return {
        keys: recipe.idle,
        delivery: "submitted",
        watch: { kind: "start" },
      };
    case "working":
      break;
    default:
      bucket satisfies never;
      break;
  }
  if (recipe.working === null) {
    throw new ToolFailure<SayRefusal>(
      `${vocab.displayName} (terminal ${id}) is working, and kolu has no verified way to hand it words mid-turn — its input is dropped or mangled while a turn runs, so typing now would lose what you said silently. Wait for it to finish and say it then.`,
      { kind: "agent-cannot-be-told-while-working", id, agent: agent.kind },
    );
  }
  const working = recipe.working;
  return {
    keys: working.keys,
    delivery: working.delivery,
    watch:
      working.delivery === "queue" || working.sight === "unmeasured"
        ? { kind: "nothing" }
        : {
            kind: "steer",
            sight: working.sight,
            before: working.sight.lastPrompt(agent)?.id ?? null,
          },
  };
}

export function resolveSay(
  id: string,
  text: string,
  record: SayRecord,
  vocabOf: SayVocabularyOf = registryVocabulary,
): SayPerformance {
  const encoded = encodeSend(
    {
      kind: "text",
      text,
      sourceLabel: "text",
      paste: undefined,
      fromStream: false,
    },
    SAY_SEND_VOCABULARY,
  );
  if (encoded.kind === "refused") {
    throw new ToolFailure<SayRefusal>(encoded.message, {
      kind: "text-refused",
    });
  }
  const agent = sayableAgent(id, record);
  const { keys, delivery, watch } = sayableRecipe(
    id,
    agent,
    vocabOf(agent.kind),
  );
  const bucket = agentBucket(agent.state);
  return {
    text: encoded.plan,
    keys,
    agent: agent.kind,
    working: bucket === "working",
    delivery,
    watch,
  };
}

function pressKey(
  padi: PadiSurfaceClient,
  id: string,
  name: string,
): Effect.Effect<void, unknown> {
  const encoded = encodeSend(
    { kind: "keys", names: [name] },
    SAY_SEND_VOCABULARY,
  );
  if (encoded.kind === "refused") {
    throw new Error(
      `kolu-mcp agent_say: the say recipe names key ${JSON.stringify(name)}, which @kolu/terminal-protocol does not encode — ${encoded.message}`,
    );
  }
  return Effect.asVoid(
    padi.surface.lifecycle.sendInput({ id, data: encoded.plan.write }),
  );
}

type SteerWatchEnd =
  | { readonly kind: "took"; readonly elapsedMs: number }
  | { readonly kind: "gone" }
  | { readonly kind: "ran-out" };

async function awaitPromptTook(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  watch: Extract<SayWatch, { kind: "steer" }>,
  words: string,
  capMs: number,
  signal: AbortSignal,
): Promise<SteerWatchEnd> {
  const { watchTerminals } = await import("@kolu/padi-client/watch");
  const started = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), capMs);
  let end: SteerWatchEnd = { kind: "ran-out" };
  try {
    await watchTerminals(padi, {
      signal: AbortSignal.any([stop.signal, signal]),
      handlers: {
        onUpsert: (key, value) => {
          if (key !== id) return;
          const agent = activeAgent(value);
          if (agent === null) return;
          if (promptReading(watch.sight, watch.before, agent, words) !== "took")
            return;
          end = { kind: "took", elapsedMs: Date.now() - started };
          stop.abort();
        },
        onRemove: (key) => {
          if (key !== id) return;
          end = { kind: "gone" };
          stop.abort();
        },
      },
      initialKeys: () => [id],
    });
  } finally {
    clearTimeout(timer);
  }
  return end;
}

function recordAfterSteer(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  waitedMs: number,
): Effect.Effect<
  | { readonly kind: "record"; readonly record: SayRecord }
  | { readonly kind: "outcome"; readonly outcome: SteerOutcome },
  never
> {
  const outcome = (
    one: SteerOutcome,
  ): { readonly kind: "outcome"; readonly outcome: SteerOutcome } => ({
    kind: "outcome",
    outcome: one,
  });
  return Effect.catch(
    Effect.map(
      firstFrameOfCollectionItem(
        padi.surface.terminals.get({ key: id }),
        padi.surface.terminals.keys(undefined),
        id,
        `terminal ${id} answered no record after the steer`,
        ITEM_READ_DEADLINE_MS,
      ),
      (frame) => {
        if (!frame.present) {
          return frame.reason === "absent"
            ? outcome({
                kind: "lost-sight",
                why: "gone",
                detail: `terminal ${id} is no longer in this host's roster`,
              })
            : outcome({
                kind: "cannot-tell",
                waitedMs,
                why: `terminal ${id} did not answer its record within ${ITEM_READ_DEADLINE_MS} ms`,
              });
        }
        const decoded = decodeSayRecord(frame.value);
        return Result.isSuccess(decoded)
          ? ({ kind: "record", record: decoded.success } as const)
          : outcome({
              kind: "cannot-tell",
              waitedMs,
              why: `terminal ${id} answered a record kolu could not decode (${String(decoded.failure)})`,
            });
      },
    ),
    (cause) =>
      Effect.succeed(
        outcome({
          kind: "lost-sight",
          why: "closed",
          detail: String(cause),
        }),
      ),
  );
}

function watchSteer(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  watch: Extract<SayWatch, { kind: "steer" }>,
  words: string,
  signal: AbortSignal | undefined,
): Effect.Effect<SteerOutcome, never> {
  const waitedMs = SAY_STEER_CAP_MS + SAY_RECORD_LAG_MS;
  const gone = {
    kind: "lost-sight",
    why: "gone",
    detail: `terminal ${id} left the roster after the keys`,
  } satisfies SteerOutcome;
  return Effect.catch(
    Effect.gen(function* () {
      const first = yield* Effect.tryPromise((fiberSignal) =>
        awaitPromptTook(
          padi,
          id,
          watch,
          words,
          SAY_STEER_CAP_MS,
          signal ?? fiberSignal,
        ),
      );
      if (first.kind === "took") {
        return {
          kind: "landed",
          elapsedMs: first.elapsedMs,
        } satisfies SteerOutcome;
      }
      if (first.kind === "gone") return gone;
      const screen = yield* padi.surface.screen.text({
        id,
        tail: SAY_STEER_SCREEN_TAIL,
      });
      yield* Effect.sleep(SAY_RECORD_LAG_MS);
      const read = yield* recordAfterSteer(padi, id, waitedMs);
      if (read.kind === "outcome") return read.outcome;
      return steerVerdict({
        sight: watch.sight,
        before: watch.before,
        after: read.record.state === "active" ? read.record.agent : null,
        screen,
        words,
        waitedMs,
      });
    }),
    (cause) =>
      Effect.succeed<SteerOutcome>({
        kind: "lost-sight",
        why: signal?.aborted === true ? "interrupted" : "closed",
        detail: String(cause),
      }),
  );
}

function watchAfterKeys(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  watch: SayWatch,
  words: string,
  signal: AbortSignal | undefined,
): Effect.Effect<SayWatched, unknown> {
  switch (watch.kind) {
    case "nothing":
      return Effect.succeed({ kind: "nothing" });
    case "start":
      return Effect.map(
        Effect.tryPromise(async (fiberSignal) => {
          const { awaitAgentState } = await import("@kolu/padi-client/watch");
          return awaitAgentState(padi, {
            id,
            targets: SAY_TAKES,
            timeoutMs: SAY_TAKE_CAP_MS,
            signal: signal ?? fiberSignal,
          });
        }),
        (outcome) => ({ kind: "start", outcome }),
      );
    case "steer":
      return Effect.map(
        watchSteer(padi, id, watch, words, signal),
        (outcome) => ({ kind: "steer", outcome }),
      );
  }
}

export const agentSayTool: BespokeTool = {
  input: AgentSayArgsSchema,
  mutates: true,
  title: "Say something to the agent in a terminal",
  description:
    'Say this to the agent running in that terminal — kolu knows which agent it is and presses that agent\'s own submit keys, so you never send Enter yourself. Types the text, waits for the terminal to settle (hard-capped), then submits. Answers what it did: the agent, whether it was WORKING, the keys pressed, and the delivery — "steer" (the words join the running turn at its next step), "queue" (they wait for the current turn to end) or "submitted" (it was idle or freshly up, so they start a turn) — AND whether it took. For an agent that was not working kolu watches a few seconds and reports "began-working" (its transcript started a turn), "submit-landed" (an agent that has written nothing yet: kolu saw the Enter reach it, and its reply comes with its transcript — do not say it again) or "did-not-begin". For a steer kolu can see, it reports "landed" (the running turn\'s transcript gained a prompt CARRYING these words), "held" (its TUI is holding them in its steering pane until the running step — a long tool call — ends, then hands them over on its own: do not say it again and do not press Enter, which in omp interrupts the running tool), "did-not-land" (kolu read BOTH a steering pane without them and a transcript without them), "cannot-tell" (one of those two could not be read — a pane kolu cannot parse, a prompt whose text it cannot compare — so what became of the words is unknown; read the screen, never resend blind) or "lost-sight" (the terminal went away, or the watch dropped, after the keys). The keys were sent either way — read the screen rather than saying it again. REFUSED, never guessed: a terminal with no agent (a plain shell), an agent with no verified recipe, an agent that cannot be told anything mid-turn, an agent that is still COMING UP (its screen is still being drawn — wait until it is ready), a terminal that is asleep, a record kolu could not decode, and empty text.',
  handler: (args, client, signal) => {
    const { id, text } = args as AgentSayArgs;
    const padi = padiOf(client);
    return Effect.flatMap(
      Effect.flatMap(rosterStandingOf(padi, id, id), (standing) =>
        firstFrameOrThrow(
          padi.surface.terminals.get({ key: id }),
          standing === "absent"
            ? `terminal ${id} answered no record — it is not in this host's roster, so there is no agent to say anything to.`
            : stillSettling(id),
        ),
      ),
      (record) =>
        Effect.flatMap(
          Effect.try({
            try: () => resolveSay(id, text, terminalRecord(id, record)),
            catch: (refusal) => refusal,
          }),
          (say) =>
            Effect.flatMap(
              padi.surface.lifecycle.sendInput({ id, data: say.text.write }),
              () =>
                Effect.flatMap(
                  Effect.tryPromise(async (fiberSignal) => {
                    const { awaitOutputSettled } = await import(
                      "@kolu/padi-client/watch"
                    );
                    return awaitOutputSettled(padi, {
                      id,
                      idleMs: SAY_SETTLE_IDLE_MS,
                      timeoutMs: SAY_SETTLE_TIMEOUT_MS,
                      signal: signal ?? fiberSignal,
                    });
                  }),
                  () =>
                    Effect.flatMap(
                      Effect.forEach(
                        say.keys,
                        (key) => pressKey(padi, id, key),
                        {
                          discard: true,
                        },
                      ),
                      () =>
                        Effect.map(
                          watchAfterKeys(padi, id, say.watch, text, signal),
                          (watched) => ({
                            said: {
                              agent: say.agent,
                              working: say.working,
                              keys: say.keys,
                              delivery: say.delivery,
                              textBytes: say.text.bytes,
                            },
                            took: sayTook(say.delivery, watched),
                          }),
                        ),
                    ),
                ),
            ),
        ),
    );
  },
};
