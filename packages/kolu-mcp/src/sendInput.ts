/**
 * `lifecycle_sendInput` — the MCP face's input tool, wrapping padiSurface's
 * `lifecycle.sendInput` (raw write) and `lifecycle.submitInput` (the one-call
 * dispatch) behind ONE tool, with the NAMED-KEY vocabulary and the submit
 * discipline the driving skills depend on.
 *
 * ## `submit: true` is the default path now
 *
 * `{ text, submit: true }` is a whole dispatch: padi waits for the target's
 * prompt to be idle, types the text, waits for the TUI to take it, then presses
 * Enter — three calls collapsed into one, with the observation moved to the ONE
 * process that can actually make it. The manual trio (text → `wait_outputSettled`
 * → `key: "Enter"`) is still here and still correct, but it is now the ESCAPE
 * HATCH: reach for it when you need to interleave something between the text and
 * the Enter, not as the everyday way to prompt an agent.
 *
 * The mid-turn policy, which callers must know because it changes what they do
 * on a refusal: a submit to a busy agent REFUSES with nothing typed rather than
 * queueing — several TUIs clear a typed-but-unsubmitted input box when their turn
 * ends, so "type now, submit later" loses the message outright. `./submitInput.ts`
 * in `@kolu/padi` carries the full doctrine.
 *
 * Text XOR key, enforced hard: a same-breath text+Enter is raced by the driven
 * TUI's paste debounce and silently dropped (the exact footgun kaval-tui's
 * `send` refuses the same way). So `{ text, key }` in one call is a loud
 * error, never a fused submit — `submit: true` is how you fuse them SAFELY,
 * because padi observes the gap the caller cannot.
 *
 * The key grammar is `@kolu/terminal-protocol`'s `encodeKey` — the SAME
 * vocabulary kaval-tui's `--key`, the rich client, and the mobile key bar
 * speak (named keys case-insensitively, `C-<char>` control chords,
 * `M-<char>` meta chords).
 *
 * Multiline text is auto-wrapped in BRACKETED PASTE (kaval-tui's auto rule):
 * the agent's input box takes it as one block instead of firing a half-written
 * prompt per `\n`. Single-line text types literally.
 *
 * An EMPTY `text` is refused, not written: a 0-byte write answered with success
 * reads, to the agent whose prompt template rendered empty, exactly like a send
 * that landed. That refusal is the shared policy's, so this face and `kolu send`
 * give the same answer to the same intent.
 */

import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import {
  ACCEPTED_KEY_NAMES,
  encodeSend,
  type SendPlan,
  type SendVocabulary,
  sendShapeRefusal,
} from "@kolu/terminal-protocol";
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { hasTag, SUBMIT_SETTLE_MS, SubmitRefused } from "@kolu/padi/surface";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp";
import { Effect, Schema } from "effect";

export const SendInputArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  // The per-field blurb an MCP host renders is the `description` ANNOTATION,
  // and it must sit on the encoded-side node INSIDE `optionalKey` for the
  // converter to see it (`@kolu/surface-mcp`'s `jsonschema.ts` law). These two
  // are CHECK-FREE, so a plain `.annotate` lands on the node; a CHECKED schema
  // needs the annotate-first order `wait.ts`'s `MillisecondsSchema` explains.
  text: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Text to type into the terminal. Multiline text is bracketed-paste wrapped automatically. Pair it with submit: true to have padi deliver AND submit it in this one call.",
    }),
  ),
  key: Schema.optionalKey(
    Schema.String.annotate({
      description: `A named key (${ACCEPTED_KEY_NAMES}) or a modifier chord (C-c, M-b) to press. Mutually exclusive with text.`,
    }),
  ),
  submit: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Deliver the text as a whole message: wait for the target's prompt to be IDLE, type, wait for the TUI to take it, then press Enter — one call instead of three. Refuses (typing nothing) if the target stays mid-turn, because a TUI that ends its turn clears a typed-but-unsubmitted box. Requires `text`; meaningless with `key`.",
    }),
  ),
  settleMs: Schema.optionalKey(
    // Annotate first, check second — see `wait.ts`'s `MillisecondsSchema` for
    // why a blurb on a checked schema lands where no host reads it.
    Schema.Number.annotate({
      description: `How quiet the terminal must be (ms) before padi believes the prompt is idle / the paste has landed. Only with submit: true. Default ${SUBMIT_SETTLE_MS}, the field-calibrated value — raise it for a chattier TUI.`,
    }).check(Schema.isInt(), Schema.isGreaterThan(0)),
  ),
});
export type SendInputArgs = typeof SendInputArgsSchema.Type;

/** This face's spelling of the shared send policy — the field it names in a
 *  refusal, and the tool-call ritual it quotes. The RULES themselves
 *  (text-XOR-key, the unknown-key refusal, auto bracketed paste, the
 *  empty-payload refusal) are
 *  `@kolu/terminal-protocol`'s `sendPolicy`, shared with `kolu send`: they are
 *  one policy about a TUI's paste debounce, not two faces' vocabularies, and
 *  they used to be implemented independently on each — so a driver that
 *  switched from argv to MCP could get a different answer to the same intent. */
export const MCP_SEND_VOCABULARY: SendVocabulary = {
  keyName: "key",
  submitRitual:
    "  lifecycle_sendInput { text }   # 1. the text\n" +
    "  wait_outputSettled             # 2. observe the terminal settle\n" +
    "  lifecycle_sendInput { key: 'Enter' }   # 3. submit",
};

/** The machine-readable half of a refusal, carried beside the shared policy's
 *  sentence in `ToolFailure.detail` — because a driver's recovery differs per
 *  kind, and reading it out of the prose means parsing English:
 *  `text-and-key` ⇒ re-send as two calls; `key-refused` ⇒ pick a name from the
 *  accepted list (the rejected spelling rides along as `key`); `text-refused`
 *  ⇒ the shared encoder refused this face's text — today, because it was empty;
 *  `no-input` ⇒ neither field was passed at all.
 *
 *  The kinds name the BRANCH, not the shared policy's internal reason: the
 *  sentence already carries the reason, and a kind that claimed it would go
 *  quietly wrong the day `@kolu/terminal-protocol` adds a refusal. And they are
 *  named HERE rather than pushed into that package, because the caller always
 *  knows which branch it is in — a `kind` on `SendEncoding` would be a field the
 *  shared policy carries for one consumer's benefit.
 *
 *  WHAT THAT COSTS, stated rather than left to be discovered. A branch can hold
 *  more than one of the shared policy's rules, and two do:
 *
 *    - the KEYS branch refuses on an empty name list as well as on an unknown
 *      name (`sendPolicy.ts`'s `encodeSend`), and `key-refused`'s recovery
 *      ("pick a name from the accepted list") fits only the second. It is
 *      UNREACHABLE from this face, and structurally so rather than by luck: this
 *      face has ONE `key` field and passes `names: [args.key]` inside the
 *      `args.key !== undefined` branch, so the list is always length 1. The
 *      empty-list refusal exists for a face that gathers keys from a variadic
 *      argv, which this is not.
 *    - `text-and-key` names the reason, not the branch, and is the deliberate
 *      exception: it is the recovery a driver most needs to branch on. It is
 *      sound only while `sendShapeRefusal` refuses exactly the both-supplied
 *      shape. If that gate ever grows a second refusal, this kind must split
 *      before it ships. */
export type SendRefusal =
  | { readonly kind: "text-and-key" }
  | { readonly kind: "key-refused"; readonly key: string }
  | { readonly kind: "text-refused" }
  | { readonly kind: "no-input" }
  /** `submit` on a call with no `text` — a key press has nothing to submit, and
   *  a submit with nothing to type is not a call anyone meant to make. */
  | { readonly kind: "submit-without-text" }
  /** `settleMs` without `submit: true` — the knob tunes a wait this call is not
   *  going to perform. Refused rather than ignored: a caller who tuned it and
   *  saw it silently dropped would conclude the tuning did nothing, which is
   *  true and is the least useful way to learn it. */
  | { readonly kind: "settle-without-submit" }
  /** padi refused the delivery — see {@link SubmitDetail}. */
  | ({ readonly kind: "submit-refused" } & SubmitDetail);

/** The recovery half of a padi {@link SubmitRefused}, re-raised HERE as
 *  structured detail because a failure that crossed the surface hop reaches an
 *  agent message-only (`surface-mcp`'s `ToolFailure` doc says so, and names this
 *  as the fix: the MCP process is where a refusal gets tagged).
 *
 *  `typed` is the field a driver must branch on and the reason this is not just
 *  prose: `false` means NOTHING landed and a retry is free; `true` means the text
 *  is sitting in the target's input box UNSUBMITTED, so a blind retry delivers it
 *  twice.
 *
 *  A type ALIAS, not an interface: `SendRefusal` must satisfy
 *  `Record<string, unknown>` (`ToolFailure`'s detail bound), and an interface
 *  carries no implicit index signature, so intersecting one into that union
 *  quietly takes the whole union out of the bound. */
export type SubmitDetail = {
  readonly phase: "ready" | "settle";
  readonly reason: "busy" | "gone";
  readonly typed: boolean;
  readonly waitedMs: number;
};

const refuse = (
  message: string,
  detail: SendRefusal,
): ToolFailure<SendRefusal> => new ToolFailure(message, detail);

/** Resolve the tool args to the WRITE PLAN `lifecycle.sendInput` carries out —
 *  pure, so the XOR matrix and the key grammar are unit-tested apart from the
 *  wire. The plan, not the bare string, because the encoder already counted the
 *  UTF-8 bytes it wrote and the acknowledgement below reports them: recounting
 *  here is how the two faces would come to disagree about the size of the
 *  identical send the next time a paste marker moves.
 *
 *  Throws loud on: both text and key (the dropped-Enter trap), neither (nothing
 *  to send), an EMPTY text (a 0-byte write is a no-op, not a submit), and an
 *  unknown key name (never a silent no-op). All but the second are the shared
 *  policy's; this face only supplies its vocabulary.
 *
 *  Every one of those throws is a {@link ToolFailure}, so the refusal reaches
 *  the agent as an `isError` result whose `structuredContent` says which rule it
 *  broke ({@link SendRefusal}) — a driver picks its recovery from a tag instead
 *  of matching the sentence.
 *
 *  The NEITHER-field rule is the one that stays HERE: what counts as a text
 *  source is each face's own (this face has one field; `kolu send` has a
 *  positional, `--file` and piped stdin), so the sentence names this face's. */
export function resolveSendInputData(args: {
  text?: string;
  key?: string;
}): SendPlan {
  const illegal = sendShapeRefusal(
    { hasText: args.text !== undefined, hasKeys: args.key !== undefined },
    MCP_SEND_VOCABULARY,
  );
  if (illegal !== undefined) throw refuse(illegal, { kind: "text-and-key" });

  if (args.key !== undefined) {
    const encoded = encodeSend(
      { kind: "keys", names: [args.key] },
      MCP_SEND_VOCABULARY,
    );
    if (encoded.kind === "refused")
      throw refuse(encoded.message, { kind: "key-refused", key: args.key });
    return encoded.plan;
  }
  if (args.text !== undefined) {
    // Auto-paste with no override and no stream: a single-line argument types
    // literally, multiline is wrapped so the agent's input box takes it as ONE
    // block. This face has no `--paste` and no file/pipe payload, so both
    // knobs are stated as absent rather than left to a default. `sourceLabel` is
    // this face's ONE text source, named as the caller spells it, so an empty
    // payload is refused as `text is empty` rather than argv's `--file "…"`.
    const encoded = encodeSend(
      {
        kind: "text",
        text: args.text,
        sourceLabel: "text",
        paste: undefined,
        fromStream: false,
      },
      MCP_SEND_VOCABULARY,
    );
    if (encoded.kind === "refused")
      throw refuse(encoded.message, { kind: "text-refused" });
    return encoded.plan;
  }
  throw refuse(
    "nothing to send — pass text (to type) or key (to press, e.g. Enter).",
    { kind: "no-input" },
  );
}

/** What this call is: a raw WRITE, or a whole DELIVERY.
 *
 *  Kept as a discriminated union rather than a plan plus a `submit?: boolean`
 *  beside it, so "submit a key press" and "settleMs on a plain write" are not
 *  shapes the handler has to remember to reject — they are shapes it cannot
 *  receive. The refusals below are what turns a caller's raw argument bag into
 *  one of these. */
export type SendAction =
  | { readonly kind: "write"; readonly plan: SendPlan }
  | {
      readonly kind: "submit";
      readonly plan: SendPlan;
      readonly settleMs: number | undefined;
    };

/** Read the whole argument bag down to the ONE action it names — pure, so the
 *  gate matrix is unit-tested apart from the wire, and evaluated BEFORE anything
 *  dials padi.
 *
 *  The two gates this adds over {@link resolveSendInputData} are both "a field
 *  you spelled would have been ignored", which this repo refuses rather than
 *  silently honours: `submit` needs text to submit, and `settleMs` tunes a wait
 *  only a submit performs. */
export function resolveSendAction(args: {
  text?: string;
  key?: string;
  submit?: boolean;
  settleMs?: number;
}): SendAction {
  const submit = args.submit === true;
  if (submit && args.text === undefined) {
    throw refuse(
      "`submit` has nothing to submit — it delivers `text` (type it, wait for the TUI to take it, press Enter). To press a key on its own, drop `submit` and pass `key`.",
      { kind: "submit-without-text" },
    );
  }
  if (args.settleMs !== undefined && !submit) {
    throw refuse(
      "`settleMs` is the submit's quiet window and this call does not submit — add `submit: true`, or drop `settleMs`.",
      { kind: "settle-without-submit" },
    );
  }
  const plan = resolveSendInputData(args);
  return submit
    ? { kind: "submit", plan, settleMs: args.settleMs }
    : { kind: "write", plan };
}

/** Re-raise a padi {@link SubmitRefused} as a structured {@link ToolFailure}.
 *
 *  Everything else propagates untouched: this face translates the ONE failure a
 *  driver branches on, exactly as `servePadi`'s `recycleKaval` translates the one
 *  failure IT knows, and leaves the rest to the fail-fast channel. The prose is
 *  padi's own `message` — it already names the recovery, and re-writing it here
 *  is how the two would come to say different things about the same refusal. */
function asToolFailure(error: unknown): unknown {
  if (!hasTag(error, SUBMIT_REFUSED_TAG)) return error;
  const refusal = error as {
    phase: "ready" | "settle";
    reason: "busy" | "gone";
    waitedMs: number;
    message: string;
  };
  return refuse(refusal.message, {
    kind: "submit-refused",
    phase: refusal.phase,
    reason: refusal.reason,
    typed: refusal.phase === "settle",
    waitedMs: refusal.waitedMs,
  });
}

/** {@link SubmitRefused}'s tag, read OFF the class rather than re-spelled — a
 *  rename moves this with it instead of silently un-matching. Matched
 *  STRUCTURALLY (padi's own `hasTag`), never with `instanceof`: the value was
 *  decoded from a wire frame in another realm, where class identity is not ours
 *  and `instanceof` quietly answers `false`. */
const SUBMIT_REFUSED_TAG: string = new SubmitRefused({
  id: "",
  phase: "ready",
  reason: "busy",
  waitedMs: 0,
})._tag;

/** The bespoke tool. The client is the injected padiSurface client (typed by
 *  the consumer; the adapter holds it opaquely). */
export const sendInputTool: BespokeTool = {
  input: SendInputArgsSchema,
  mutates: true,
  title: "Send input to a terminal",
  description:
    'Send input to a terminal. DEFAULT for prompting an agent: { id, text, submit: true } — ONE call that waits for the target\'s prompt to be idle, types the text, waits for the TUI to take it, and presses Enter, answering {submitted: true, readyAfterMs, settledAfterMs}. It REFUSES (structuredContent: {kind: "submit-refused", phase, typed}) rather than typing into a mid-turn agent, because a TUI that ends its turn clears a typed-but-unsubmitted input box and the message is gone; phase "ready" means nothing was typed (retry freely), phase "settle" means the text IS in the box unsubmitted (send Enter, or Escape and re-send — never blindly re-send). Without `submit` this is the raw write: text (multiline auto-bracketed-pasted) OR one named key / chord (Enter, Escape, Tab, arrows, C-c, M-b, …), never both — that manual trio (text → wait_outputSettled → key: "Enter") is the ESCAPE HATCH for when you must act between the text and the Enter, not the everyday path.',
  // No `signal`: a surface procedure ref carries no cancellation handle any
  // more (D10/#18 — Effect RPC has none, and interruption is the fiber's), and
  // the handler's effect is already run under the request's signal by
  // `surface-mcp`'s ONE CallTool edge.
  handler: (args, client) => {
    const { id, ...rest } = args as SendInputArgs;
    const action = resolveSendAction(rest);
    const padi = (client as PadiSurfaceClient).surface;
    if (action.kind === "submit") {
      return Effect.map(
        Effect.mapError(
          padi.lifecycle.submitInput({
            id,
            data: action.plan.write,
            ...(action.settleMs !== undefined
              ? { settleMs: action.settleMs }
              : {}),
          }),
          asToolFailure,
        ),
        // `submitted: true` is stated rather than inferred: the whole point of
        // this frame is that a driving agent can read ONE field and know the
        // message is in the target's history. A refusal never reaches here — it
        // is an `isError` result carrying the recovery — so the field is
        // constant on this arm by construction, not by hope.
        (landed) => ({
          sent: { textBytes: landed.typedBytes },
          submitted: true,
          readyAfterMs: landed.readyAfterMs,
          settledAfterMs: landed.settledAfterMs,
        }),
      );
    }
    return Effect.as(
      padi.lifecycle.sendInput({ id, data: action.plan.write }),
      // A named acknowledgement (sendInput's procedure output is void) so the
      // driving agent sees what landed rather than an empty null. The byte count
      // is the encoder's own UTF-8 total for the write it planned — the same
      // number `kolu send` reports for the same send, paste markers included.
      // `submitted: false` is stated on this arm too, so the two frames answer
      // the same question and a reader never has to infer a missing key.
      {
        sent:
          rest.key !== undefined
            ? { key: rest.key }
            : { textBytes: action.plan.bytes },
        submitted: false,
      },
    );
  },
};
