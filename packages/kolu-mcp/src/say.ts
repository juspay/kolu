/**
 * `agent_say` — say this to the agent in that terminal, and let kolu do the
 * keystrokes.
 *
 * The verb exists because the keystrokes are NOT the caller's business and
 * never were. A conductor driving six workers had to know that omp wants a
 * settle before its Enter, that claude-code's Enter opens a new turn rather
 * than joining the running one, that pi and xyne put the line in a steering
 * pane — knowledge it could only get by being told, one agent at a time, by a
 * human who had just watched a message vanish. kolu already knows WHICH agent
 * runs in a terminal (that is what agent detection is for), so the recipe lives
 * with the detection — each agent's own vocab (`packages/integrations/<agent>`,
 * `AgentVocab.say`) — and this tool performs it.
 *
 * What it does, in order:
 *
 *   1. **Read the terminal's record** — the live agent (`activeAgent`, padi's
 *      own narrowing) and its coarse state bucket (`agentBucket`). Nothing is
 *      typed before this: a plain shell, a sleeping terminal, an agent kolu
 *      has no recipe for and an agent that is still COMING UP (its screen is
 *      still being drawn) are all REFUSED, never guessed at. Typing a sentence
 *      meant for an agent into a bash prompt is a command the human did not
 *      write; typing one into a TUI that has not finished painting itself is a
 *      sentence nobody can say where it went.
 *   2. **Write the words** — through the SAME encoder `lifecycle_sendInput`
 *      uses (`@kolu/terminal-protocol`), so multiline text is bracketed-pasted
 *      and an empty payload is refused with the shared sentence. One policy,
 *      two faces.
 *   3. **Let the terminal settle** — a hard-capped `awaitOutputSettled`
 *      (`SAY_SETTLE_IDLE_MS` quiet, `SAY_SETTLE_TIMEOUT_MS` at the outside).
 *      This is the step the folklore was about: an Enter sent in the same
 *      breath as the paste is eaten by the TUI's paste debounce, which reads
 *      exactly like "this agent needs a second Enter". It needs a settle, and
 *      the settle is bounded here because a tool whose job is one keystroke
 *      must not become a place to block.
 *   4. **Press the recipe's keys** — one send per key, in order, so a recipe
 *      that ever needs two keys cannot deliver them fused into one write that a
 *      TUI reads as a single chord.
 *   5. **Watch, briefly, whether it TOOK** — for an agent that was IDLE, a
 *      hard-capped wait ({@link SAY_TAKE_CAP_MS}) for its state to turn
 *      `working`; for a WORKING agent that steers and whose steer kolu can
 *      see, a hard-capped watch ({@link SAY_STEER_CAP_MS}) for the newest
 *      prompt in its transcript to become THESE WORDS, then one screen read
 *      for its steering pane and one record read once the record's own lag
 *      has passed ({@link SAY_RECORD_LAG_MS}). A dropped Enter is the whole
 *      reason this verb exists, so "the keys were sent" is not a good enough
 *      answer; and because a refusal here would invite a blind resend, every
 *      outcome is an answer.
 *
 * Then it ANSWERS what it did: which agent, whether that agent was working, the
 * keys pressed, and — the fact a caller actually needs — whether those keys
 * STEER the running turn or QUEUE behind it; plus whether it took: an idle
 * agent began working, a steer LANDED in the turn or is HELD for the running
 * step to end. "I said it" and "it heard it" are different claims, and this
 * tool reports both rather than letting one stand for the other.
 *
 * And it never reports what it did not SEE. `did-not-land` is said only when
 * kolu read a steering pane without these words AND a transcript whose newest
 * prompt is not them; a pane it could not parse, a prompt whose text it cannot
 * compare, a record that would not decode are `cannot-tell`, and a terminal
 * that went away after the keys is `lost-sight`. A caller acts on a
 * non-delivery by saying it again, so a guessed one is the costliest answer
 * this tool can give.
 */

import { terminalAsleepRefusal } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
// `PadiSurfaceClient` is a TYPE import of the dial entry — erased, so the
// table's static-load fence (`tools.test.ts`) is untouched by it.
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
// The agent-state wait's OUTCOME type, for the verdict mapper below — a type
// import of the banned `…/watch` entry, which the fence exempts because it is
// erased. The wait itself is pulled at call time, in the handler.
import type { AgentStateOutcome } from "@kolu/padi-client/watch";
// A PURE leaf of the dial kit — the narrowing only, no socket (that package's
// `terminalVocab.ts` exists for exactly this: `tools.test.ts`'s fence bans
// `@kolu/padi-client/dial` and `…/watch`, not the vocabulary below them).
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
  // The blurb sits on the encoded-side node (the `jsonschema.ts` law this
  // package's arg schemas all obey) — and it is where a model learns that this
  // tool is the one that knows the keys, so it stops inventing them.
  text: Schema.String.annotate({
    description:
      "What to say to the agent. kolu types it and presses that agent's own submit keys — never send Enter yourself. Multiline text is bracketed-paste wrapped automatically.",
  }),
});
export type AgentSayArgs = typeof AgentSayArgsSchema.Type;

/** This face's spelling of the shared send policy. `keyName` and
 *  `submitRitual` describe what a caller would otherwise have done BY HAND,
 *  because the only refusal this tool can raise through the shared policy is
 *  the empty-text one — and that sentence ends with "or use <keyName> to send a
 *  key", which must name a tool that exists. On this face that is
 *  `lifecycle_sendInput`'s `key`. */
const SAY_SEND_VOCABULARY: SendVocabulary = {
  keyName: "lifecycle_sendInput { key }",
  submitRitual:
    "  agent_say { id, text }   # kolu types the text, waits for the settle, and presses that agent's submit keys",
};

/** How quiet the terminal must go after the text before the submit keys are
 *  pressed, and how long that is worth waiting for.
 *
 *  Both are small ON PURPOSE. The settle exists to clear a TUI's paste
 *  debounce — tens of milliseconds of redraw — not to wait for an agent to
 *  think. A terminal that is still printing after `SAY_SETTLE_TIMEOUT_MS` gets
 *  its keys anyway: a working agent's screen may never go quiet (that is what
 *  working looks like), and refusing to submit into a busy terminal would make
 *  the mid-turn half of this tool unusable exactly when it matters. */
export const SAY_SETTLE_IDLE_MS = 250;
export const SAY_SETTLE_TIMEOUT_MS = 2_000;

/** How long an IDLE agent is given to BEGIN WORKING after its submit keys,
 *  before the answer says it did not.
 *
 *  A hard constant, and small: this is not a wait on the agent's turn (the
 *  Conductor never waits on one — it is woken when a watched terminal stops),
 *  it is the question "did the Enter land", and a TUI that accepted a prompt
 *  flips its state within a beat. Past this the tool still ANSWERS — the keys
 *  were sent, and the honest report is that taking was not observed, which is
 *  a screen to read rather than a reason to type the words again. */
export const SAY_TAKE_CAP_MS = 3_000;

/** How long a STEER is given to show up in the running turn's transcript
 *  before kolu reads the screen for the steering pane.
 *
 *  Measured on omp 18.20.2 (2026-11-15): a steer omp could take at once (it
 *  backgrounded a running `bash` call for it) was in the transcript within
 *  seconds, and a held one took up to ~5 s to be DRAWN in the steering pane
 *  while omp was busy — so the screen is read no sooner than that. */
export const SAY_STEER_CAP_MS = 5_000;

/** The screen rows the held check reads: the steering pane sits just above
 *  the input box, at the bottom of the screen. */
export const SAY_STEER_SCREEN_TAIL = 40;

/** How long kolu keeps watching the record AFTER the steer cap before it will
 *  say the words are not in the transcript.
 *
 *  The record a verdict reads is derived by the agent's session watcher, which
 *  polls the transcript on a 1 s floor (`DEFAULT_APPEND_POLL_MS`) and
 *  coalesces its edges under a 500 ms cap (`COALESCE_MAX_WAIT_MS`). A steer
 *  the turn takes in the last moment of {@link SAY_STEER_CAP_MS} has already
 *  LEFT the steering pane and is not in the record yet: reading the two
 *  back-to-back would answer `did-not-land` for a steer that landed. The
 *  screen is read at the cap and this lag is waited out before the record is
 *  read, so both halves of that verdict are facts.
 *
 *  A NUMBER here rather than an import of the two constants: kolu-mcp does not
 *  depend on the integrations' io package, and the lag is a property of what
 *  the watcher PUBLISHES, not of this tool's wiring. */
export const SAY_RECORD_LAG_MS = 1_500;

/** Why `agent_say` would not say it. Each kind is a different recovery:
 *
 *   - `text-refused` — the shared encoder refused the words (today: empty).
 *   - `terminal-not-active` — the terminal is asleep or parked (`asleep.ts`'s
 *     refusal, verbatim, so the one sentence about dormant terminals is the one
 *     sentence every tool here gives).
 *   - `no-agent` — a plain shell. Deliberately NOT "type it anyway": a sentence
 *     addressed to an agent, submitted at a bash prompt, is a command the human
 *     never wrote.
 *   - `agent-cannot-be-told` — kolu detects this agent but has no verified
 *     recipe for it. A guessed keystroke lands in someone's half-finished work,
 *     so the answer is a refusal that names the agent.
 *   - `agent-cannot-be-told-while-working` — there IS a recipe, but not for an
 *     agent mid-turn: this agent's TUI drops or mangles input while it works.
 *     The recovery is to wait for the turn to end and say it then.
 *   - `agent-starting` — the agent's process is up but its screen is still
 *     being drawn (padi's `starting` presence). Keys pressed into a TUI that
 *     is still painting itself are read by whatever it puts on screen next, or
 *     by nothing at all. The recovery is to WAIT — the Conductor's watch rings
 *     `ready`, a driver waits for the `fresh` bucket — and say it then. */
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

/** The SLICE of padi's terminal record this tool reads: which arm it is in,
 *  and — when it is live — the agent in it, as padi's own `AgentInfo` union.
 *
 *  A SLICE rather than `PadiTerminalSchema` on purpose. What must be CHECKED
 *  is what `agent_say` reads: an `agent` of an unknown shape is a frame this
 *  tool would otherwise have read fields off after a cast, while the rest of
 *  a live record (its pty, its git, its foreground) is padi's business and
 *  grows on padi's schedule — a tool that refused to speak because padi added
 *  a field would be a worse answer than the cast was. */
const SayRecordSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("active"),
    agent: Schema.NullOr(AgentInfoSchema),
  }),
  Schema.Struct({ state: Schema.Literals(["sleeping", "parked"]) }),
]);
export type SayRecord = typeof SayRecordSchema.Type;

const decodeSayRecord = Schema.decodeUnknownResult(SayRecordSchema);

/** padi's frame, decoded — never asserted. Nothing has been typed when this
 *  runs, so a frame that does not decode is a refusal naming the terminal. */
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

/** What the keys did, as the answer reports it.
 *
 *   - `submitted` — the agent was idle, so the words START a turn.
 *   - `steer` / `queue` — the agent was working; the recipe says whether its
 *     TUI hands the words to the running turn or holds them for the next one.
 *     This is the distinction the caller cannot see and cannot change. */
export type SayDelivery = "submitted" | "steer" | "queue";

/** What kolu can WATCH after the keys to say whether they took — one arm per
 *  thing that can be seen, so the handler cannot open a wait the recipe has
 *  no evidence for:
 *
 *   - `start` — an idle agent: its state turning `working` is the proof.
 *   - `steer` — a working agent whose steer is seen ({@link SteerSight}): the
 *     newest prompt in its transcript (`before`, read with the record) moving
 *     is the proof, and its steering pane says whether it is held.
 *   - `nothing` — a working agent that queues, or one whose steer nobody has
 *     measured: there is no fact to watch. */
export type SayWatch =
  | { readonly kind: "start" }
  | {
      readonly kind: "steer";
      readonly sight: SteerSight<AgentInfo>;
      readonly before: string | null;
    }
  | { readonly kind: "nothing" };

/** Everything the handler needs after reading the record: what to write, what
 *  to press, what to say it did, and what to watch. Resolved PURELY so the
 *  recipe selection and every refusal are unit-tested without a padi. */
export interface SayPerformance {
  readonly text: SendPlan;
  readonly keys: readonly string[];
  readonly agent: AgentInfo["kind"];
  readonly working: boolean;
  readonly delivery: SayDelivery;
  readonly watch: SayWatch;
}

/** The one bucket whose arrival PROVES the words took ({@link SayTook}), for
 *  every idle agent alike. An agent idle mid-conversation turns `working` when
 *  its transcript starts the turn; one that was `fresh` (up, never prompted)
 *  turns `working` the instant padi forwards the submit, as the `prompted`
 *  presence — padi's own reading of the input it carried, so a first prompt
 *  needs no transcript to be seen landing. */
export const SAY_TAKES: ReadonlySet<WaitState> = new Set<WaitState>([
  "working",
]);

/** Whether the words TOOK — the half of this tool's promise the delivery word
 *  cannot answer.
 *
 *  An Enter that is silently dropped is the whole reason `agent_say` exists,
 *  so the answer may not stop at "the keys were sent". For an agent that was
 *  IDLE, kolu watches its state for {@link SAY_TAKE_CAP_MS} and says which of
 *  the two happened. Neither is a failure — a refusal here would invite a
 *  blind resend, which is how a prompt gets typed twice — so both arms are an
 *  answer, and the one that did not take names the screen read that settles
 *  it.
 *
 *   - `began-working` — its transcript started a turn: the agent itself says
 *     it is working. It took.
 *   - `submit-landed` — the agent had written no transcript yet (it was
 *     `fresh`), and padi saw the submit reach it: it is `prompted`, padi's own
 *     reading of the input it carried. A DIFFERENT fact from `began-working`,
 *     and named as one, because it is made by the very keys this tool pressed —
 *     it says the Enter got there, not that the agent has answered. What comes
 *     of it arrives with the transcript; the Conductor's watch rings when it
 *     does.
 *   - `did-not-begin` — it had not within the cap. The keys WERE sent.
 *   - `not-observable` — the agent was already working and kolu has nothing
 *     to watch (it queues, or its steer is unmeasured); what happens to the
 *     words is the recipe's `delivery`, which the answer carries.
 *   - `landed` — a steer: the running turn's transcript gained a new prompt
 *     after the keys, and its text IS these words. They are in the turn.
 *   - `held` — a steer: not in the transcript yet, and the screen shows them
 *     in the agent's steering pane. The TUI took them and is holding them for
 *     the running step to end, which it then hands them over at on its own.
 *   - `did-not-land` — a steer: kolu read a steering pane WITHOUT them and a
 *     transcript whose newest prompt is not them. Both facts were seen. The
 *     keys WERE sent.
 *   - `cannot-tell` — a steer kolu could not read a verdict for: a steering
 *     pane the reader could not parse, a prompt whose text it cannot compare,
 *     a record that would not decode. NOT a non-delivery — reporting one would
 *     be claiming an absence nobody saw — and `why` names what stopped it.
 *   - `lost-sight` — the watch ended for its own reason (the terminal went
 *     away, the subscription dropped, the call was interrupted) before either
 *     verdict. */
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

/** Where a steer stands once the watch is over.
 *
 *  Four arms, because three of them are CLAIMS kolu made about what it saw and
 *  the fourth is the honest absence of one: `did-not-land` is reported only
 *  when kolu read a steering pane that did not hold these words AND a record
 *  whose newest prompt is not them. A pane the reader could not parse, a
 *  prompt with no readable text, a record that would not decode — every one of
 *  those is `cannot-tell`, never a non-delivery kolu did not witness.
 *  `lost-sight` is the terminal going away after the keys were pressed: the
 *  same fact the start arm reports, and for the same reason — a steer whose
 *  terminal died must not reach the caller as an error that invites a resend. */
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

/** What the watch after the keys saw, by the {@link SayWatch} it ran. */
export type SayWatched =
  | { readonly kind: "nothing" }
  | { readonly kind: "start"; readonly outcome: AgentStateOutcome }
  | { readonly kind: "steer"; readonly outcome: SteerOutcome };

/** What the newest prompt in this agent's transcript says about THESE words:
 *
 *   - `took` — the prompt moved past `before` and its text IS these words.
 *     That is the only reading that proves this steer landed: an older held
 *     steer being handed over, or the human typing in that terminal, moves the
 *     id too, and the words would still be sitting in the input box.
 *   - `other` — it moved, and carries someone else's words.
 *   - `unreadable` — it moved and carries no text kolu can compare.
 *   - `unmoved` — no prompt, or the same one the keys were pressed behind. */
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

/** The steer's verdict once the watch ran out without seeing it land — pure,
 *  over the screen and the record read AFTER it (in that order, so a step that
 *  ends between the two reads is caught by the record: the words left the pane
 *  because the turn took them). */
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
      // BOTH facts seen: a pane that does not hold them and a transcript whose
      // newest prompt is not them. Only here is a non-delivery kolu's own
      // sighting rather than a guess from silence.
      return { kind: "did-not-land", waitedMs };
  }
}

/** The watch's outcome, read as the answer's verdict — pure, so every arm is
 *  pinned without a terminal that refuses to start working on cue. */
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
      // A presence in the `working` bucket is `prompted`: padi's sight of the
      // submit, before any transcript — said as that, never as a turn.
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

/** The live agent in a record, or the refusal that says why there is none to
 *  talk to — dormant terminal and plain shell are different facts and get
 *  different sentences. */
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

/** The slice of an agent's vocab the recipe selection reads. Named as its own
 *  shape so {@link sayableRecipe} is a pure function OVER a vocabulary rather
 *  than over the registry: the `say: null` and `working: null` arms are
 *  refusals the shipped agents cannot reach today (every one of the seven has
 *  a measured recipe), and a branch no test can enter is a branch nobody has
 *  ever run. A fake vocabulary reaches both. */
export interface SayVocabulary {
  readonly displayName: string;
  readonly say: AgentSayRecipe<AgentInfo> | null;
}

/** Every agent's vocab, by kind — the production lookup, and the default of
 *  the one argument {@link resolveSay} takes for it. */
export type SayVocabularyOf = (kind: AgentInfo["kind"]) => SayVocabulary;

/** The registry's answer: the agent's display name, and its say recipe with
 *  the steer sight read over the wire union (`agentSayRecipe`). */
const registryVocabulary: SayVocabularyOf = (kind) => ({
  displayName: agentVocab(kind).displayName,
  say: agentSayRecipe(kind),
});

/** The recipe for this agent in this state, or the refusal that names the agent
 *  and why kolu will not improvise. */
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
  // WHICH RECIPE, by the agent's coarse bucket — an exhaustive switch rather
  // than a `!== "working"` test, because the fold now carries the two PRESENCE
  // buckets and they do not mean the same thing: one of them is a refusal. A
  // bucket added to `agentBucket` stops this compiling instead of silently
  // taking the idle keys.
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
      // UP AND NOT MID-TURN, so the words start a turn. `fresh` is an agent
      // that has come up and never been prompted — exactly the agent a
      // conductor briefs, and its first prompt is an ordinary idle submit.
      return {
        keys: recipe.idle,
        delivery: "submitted",
        watch: { kind: "start" },
      };
    case "working":
      break;
    default:
      // The fence: every bucket above is answered, so nothing reaches here.
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

/** Resolve a record plus the words into the whole performance — pure, throwing
 *  {@link ToolFailure} for every refusal, so the branch table is testable
 *  without a terminal. */
export function resolveSay(
  id: string,
  text: string,
  record: SayRecord,
  vocabOf: SayVocabularyOf = registryVocabulary,
): SayPerformance {
  // The words are encoded FIRST: an empty `text` is refused before the record
  // read decides whose fault the silence is, and the refusal is the shared
  // policy's own sentence (`kolu send` gives the same one for the same intent).
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

/** One key, as its own write. Per key rather than one fused write: a recipe
 *  with two keys in one `sendInput` arrives as a single byte run, which a TUI
 *  may read as one chord — and the whole point of this tool is that the
 *  keystrokes are correct. */
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
    // A recipe naming a key the shared grammar does not know is a BUG in the
    // agent's vocab, not a user's mistake — so it crashes with the recipe
    // named, rather than reaching the caller as a refusal they cannot act on.
    throw new Error(
      `kolu-mcp agent_say: the say recipe names key ${JSON.stringify(name)}, which @kolu/terminal-protocol does not encode — ${encoded.message}`,
    );
  }
  return Effect.asVoid(
    padi.surface.lifecycle.sendInput({ id, data: encoded.plan.write }),
  );
}

/** What the transcript watch ended with: these words in a new prompt, the
 *  terminal leaving the roster, or the cap. */
type SteerWatchEnd =
  | { readonly kind: "took"; readonly elapsedMs: number }
  | { readonly kind: "gone" }
  | { readonly kind: "ran-out" };

/** Watch the record until this agent's newest prompt is THESE words, the
 *  terminal goes away, or `capMs` passes. The watch kit is lifted at CALL
 *  time — the table's static-load fence, the same as the settle's. */
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
          // THESE words, not merely a new prompt id: an older held steer
          // being handed over, or the human typing in that terminal, moves
          // the id while what was said sits in the input box.
          if (promptReading(watch.sight, watch.before, agent, words) !== "took")
            return;
          end = { kind: "took", elapsedMs: Date.now() - started };
          stop.abort();
        },
        // THE TERMINAL LEFT THE ROSTER after the keys were pressed — an
        // answer, not an error. A thrown failure here would read to a caller
        // as "say it again", which is the one thing this tool exists to stop.
        onRemove: (key) => {
          if (key !== id) return;
          end = { kind: "gone" };
          stop.abort();
        },
      },
      // The id this watch is about, so a terminal that went away BEFORE the
      // subscription opened (it died on the very keys this tool pressed) is
      // reported gone on the first frame — the mirror's departed-while-away
      // sweep, the same seed `awaitAgentState` passes.
      initialKeys: () => [id],
    });
  } finally {
    clearTimeout(timer);
  }
  return end;
}

/** The record after the keys, DECODED — or the outcome that says why there is
 *  none to read. Never a failure: the keys are already pressed, so every
 *  ending here is an answer rather than something that reads as "say it
 *  again".
 *
 *  The BOUNDED collection read, not a bare first frame: a collection `get`
 *  holds open until the key is a member, so a terminal that died on the keys
 *  would hang this read forever — the one hang
 *  {@link firstFrameOfCollectionItem} exists to make unspellable. Membership
 *  answers `gone`; the deadline answers `cannot-tell`, because a padi that
 *  said nothing is not a terminal that lost the words. */
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

/** Did the steer land: the transcript watch, then — only if it ran out — one
 *  screen read, the record's own lag waited out, and one record read for
 *  {@link steerVerdict}.
 *
 *  The SCREEN is read first and the record last, in that order on purpose: a
 *  step that ends between the two is caught by the record (the words left the
 *  pane because the turn took them), and a steer the turn takes in the last
 *  moment of the cap is caught by {@link SAY_RECORD_LAG_MS} — the record is
 *  derived from a polled, coalesced transcript read and lags the pane. */
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
      const late = yield* Effect.tryPromise((fiberSignal) =>
        awaitPromptTook(
          padi,
          id,
          watch,
          words,
          SAY_RECORD_LAG_MS,
          signal ?? fiberSignal,
        ),
      );
      if (late.kind === "took") {
        return {
          kind: "landed",
          elapsedMs: SAY_STEER_CAP_MS + late.elapsedMs,
        } satisfies SteerOutcome;
      }
      if (late.kind === "gone") return gone;
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
    // The keys are already pressed, so a link that drops or a call that is
    // interrupted is reported as what kolu stopped being able to SEE — never
    // as a failure of the say.
    (cause) =>
      Effect.succeed<SteerOutcome>({
        kind: "lost-sight",
        why: signal?.aborted === true ? "interrupted" : "closed",
        detail: String(cause),
      }),
  );
}

/** The watch the recipe allows, run after the keys — exhaustive over
 *  {@link SayWatch}, so a recipe with nothing to see opens no wait at all. */
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
          // Same call-time lift as the settle, and for the same fence.
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
      // THE HOST'S ROSTER FIRST. "No record" only means "there is no such
      // terminal" once this host has finished adopting the terminals it
      // supervises AND does not hold this one; before that it means "no
      // answer yet", and saying the agent is gone is the defect of
      // juspay/kolu#2376. The standing and the census are one frame, so the
      // two facts cannot arrive apart.
      Effect.flatMap(rosterStandingOf(padi, id, id), (standing) =>
        // The RECORD read, not a screen read: who is in there and what are
        // they doing. `firstFrameOrThrow` because a collection `get` is a
        // live stream and this is a one-shot question. A host that HOLDS the
        // terminal and has no record for it yet is late, not empty — the
        // sentence says so rather than declaring the agent gone.
        firstFrameOrThrow(
          padi.surface.terminals.get({ key: id }),
          standing === "absent"
            ? `terminal ${id} answered no record — it is not in this host's roster, so there is no agent to say anything to.`
            : stillSettling(id),
        ),
      ),
      (record) =>
        // `Effect.try`, not a bare throw inside `suspend`: a synchronous throw
        // while BUILDING an effect is a defect, and a defect skips the error
        // channel — which is what the fleet face rewrites a refusal's terminal
        // id in (`fleet/lift.ts`). A refusal raised as a defect still reaches
        // the agent, but naming a bare id no tool on that face accepts.
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
                  // The settle, bounded. Lifted out of `@kolu/padi-client/watch`
                  // at CALL time (the table's static-load fence: a tool module
                  // may not drag the mirror onto every `kolu --help`), and given
                  // the request's signal so an interrupted call stops waiting.
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
                  // The outcome is deliberately not branched on. `timeout` is the
                  // expected answer for a WORKING agent (its screen never goes
                  // quiet), and `gone`/`closed` are answered by the key send
                  // itself failing with padi's own words — a second verdict here
                  // would be this face guessing about a terminal padi can speak
                  // for.
                  () =>
                    Effect.flatMap(
                      Effect.forEach(
                        say.keys,
                        (key) => pressKey(padi, id, key),
                        {
                          discard: true,
                        },
                      ),
                      // DID IT TAKE — by what the recipe says can be seen: an
                      // idle agent's state turning `working`, a steer's prompt
                      // landing in the transcript (or its steering pane holding
                      // it), or nothing at all for a queue. Every cap is a
                      // constant, and the answer is an answer either way — see
                      // {@link sayTook}.
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
