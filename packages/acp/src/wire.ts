/**
 * ACP's vocabulary, as kolu spells it on its own wire.
 *
 * Every shape here is the Agent Client Protocol's — an elicitation's fields
 * and choices, an answer going back, how a question stopped waiting, a tool
 * call's file diff — projected once into the flat, drawable form the rest of
 * kolu carries around. The package that speaks the foreign thing owns its
 * words, so these are declared HERE rather than inside a wire spec, and the
 * surface declaration that carries an orchestrator's transcript imports them.
 *
 * This module is the half of the package a SURFACE may re-export — schemas
 * only, no protocol payload in sight — and it sits on its own `./wire`
 * subpath. The other half
 * ({@link ./asks.ts}, {@link ./diffs.ts}) reads the protocol's own payloads
 * into these shapes, and only `@kolu/acp-harness` — the one package that runs
 * an ACP subprocess — has any business importing it.
 */

import { Schema } from "effect";

/**
 * One option of a question the agent asked.
 *
 * `value` is what travels BACK — an enum's `const`, a permission option's id —
 * and `label` is what a person reads. They are usually the same string and are
 * two fields anyway, because the one case where they part company (a permission
 * option named "Yes, and use \"auto\" mode" whose id is `auto`) is the case this
 * whole member exists for.
 */
export const AskChoice = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  /** The option's own second line, when it has one. */
  hint: Schema.NullOr(Schema.String),
});
export type AskChoice = typeof AskChoice.Type;

/**
 * One field of the form the agent asked to be filled.
 *
 * `kind` is what a renderer switches on, and it is the whole of what this layer
 * knows about the JSON Schema it came from — the projection happens server-side
 * ({@link ./asks.ts}), so no browser ever reads a `oneOf`.
 */
export const AskField = Schema.Struct({
  /** The schema property this field answers. The answer travels back under it. */
  key: Schema.String,
  /** What to call it. `null` when the payload named nothing — a single question
   *  carries its text as the ask's own message, and a label invented from the
   *  field key would be `question_0`. */
  label: Schema.NullOr(Schema.String),
  hint: Schema.NullOr(Schema.String),
  kind: Schema.Literals([
    "choice",
    "choices",
    "text",
    "number",
    "integer",
    "boolean",
  ]),
  /** `choice` / `choices` only. */
  choices: Schema.Array(AskChoice),
  required: Schema.Boolean,
  /** The field this one is the free-text "other" for, by key, when the agent
   *  paired them — the CLI's per-question "Other" box. Drawn inside that
   *  field's block rather than as a field of its own. */
  attachedTo: Schema.NullOr(Schema.String),
});
export type AskField = typeof AskField.Type;

/**
 * A place an agent sent a person INSTEAD of asking them to fill something in.
 *
 * ACP's other elicitation mode: `mode: "url"` carries a URL and nothing to
 * type, and the agent completes it on its own — a device-code sign-in is told
 * when the person finished at the vendor's page (`elicitation/complete`), and a
 * server's OAuth is told the same way. So the panel's job is to SAY where to
 * go and to get out of the way, which is the whole of what this card is.
 *
 * `host` is here rather than computed where it is drawn, and for the reason
 * that makes it worth a field rather than a call to `new URL`: what the panel
 * is showing is WHICH MACHINE a person is about to hand credentials to, and
 * that question has to be answerable from the value the agent sent without a
 * browser's parser deciding whether it parses. A URL this end cannot parse is
 * carried through whole ({@link ./asks.ts}'s `hostOf`), so the line says where
 * it really goes instead of going blank about it.
 */
export const AskLink = Schema.Struct({
  url: Schema.String,
  host: Schema.String,
});
export type AskLink = typeof AskLink.Type;

/**
 * What was picked or typed for one field.
 *
 * Always TEXT, however the field is typed: a number field's answer is the
 * characters somebody entered, and turning those into a number belongs where
 * the schema that asked for one is understood ({@link ./asks.ts}'s
 * `contentOf`). One entry for a select or a box, several for a multi-select,
 * and a field left alone has no entry at all.
 */
export const AskAnswer = Schema.Struct({
  key: Schema.String,
  values: Schema.Array(Schema.String),
});
export type AskAnswer = typeof AskAnswer.Type;

/**
 * How a `boolean` field's answer is spelled.
 *
 * It used to be "a value neither owns", agreed by comment between the panel
 * that writes it and the chat package that reads it back — a spelling that
 * eventually stops agreeing, silently, since a changed word would simply stop
 * matching and every press would register as nothing. It is owned now: the
 * vocabulary the two ends share is this package's, both import the one value,
 * and the reader ({@link ./asks.ts}'s `valueOf`) lives beside it.
 */
export const YES_NO = { yes: "true", no: "false" } as const;

/** How a question stopped waiting.
 *
 *   - `answered` — a person filled it in and submitted.
 *   - `declined` — a person dismissed it. The agent is TOLD that, which is the
 *     point: a dismissal is a refusal to answer, never a fabricated answer.
 *   - `withdrawn` — the agent took the question back (the turn was cancelled,
 *     the session was replaced, the subprocess died). Nobody answered, and the
 *     row says so rather than sitting on screen waiting forever. */
export const AskOutcome = Schema.Struct({
  how: Schema.Literals(["answered", "declined", "withdrawn"]),
  answers: Schema.Array(AskAnswer),
});
export type AskOutcome = typeof AskOutcome.Type;

/**
 * A file the agent rewrote, as the protocol reports it.
 *
 * STRUCTURED, and that is the whole point: ACP sends a tool call's diff as a
 * path and two texts, and the transcript used to flatten every content block a
 * call carried into one progress STRING — so what reached a browser about a
 * file being rewritten was the sentence `— /some/path`, and the change itself
 * was gone before the wire. A panel cannot draw what a wire has already turned
 * into prose, and re-parsing prose back into a diff is not a thing this
 * codebase will do.
 *
 * Two texts rather than a unified diff, because that is what the protocol
 * carries and because the LINE diff is a view-time computation: the client
 * derives it ({@link ../../web/src/client/chat/diff.ts}) the same way it
 * derives everything else it draws.
 *
 * `oldText` is `null` for a file that did not exist — the protocol's own way of
 * saying "this is new", and a distinction the panel draws rather than flattening
 * into an empty file.
 *
 * `path` is ROOT-RELATIVE when the file is under the served directory and
 * absolute otherwise, which is the spelling every `file:line` in kolu already
 * uses. The relativising happens where the payload is read ({@link ./diffs.ts}),
 * against the directory its caller knows the session was started in.
 */
export const FileDiff = Schema.Struct({
  path: Schema.String,
  oldText: Schema.NullOr(Schema.String),
  newText: Schema.String,
});
export type FileDiff = typeof FileDiff.Type;

/**
 * How full the conversation's context is: tokens in it, and how many fit.
 *
 * The protocol's own `usage_update`, projected to the two numbers a reader
 * acts on. It is the other half of the sentence the header's model is there
 * for — a turn's cost and character depend on which model it runs, and its
 * ROOM depends on this — and the question it answers is the one nothing on
 * screen used to: whether it is time to `/compact`.
 *
 * BOTH numbers travel, rather than the percentage they imply. A window is not
 * a constant — 200k and 1M are both ordinary, and a session moves between them
 * when the model does — so "80%" would be the one figure that reads the same
 * either way while meaning quite different amounts of work left. The reader
 * wants the denominator, and the wire is where it is known.
 *
 * `size` is the AGENT'S current best knowledge and is allowed to move under a
 * conversation. The Claude Code adapter seeds it from what it last learned for
 * the model and corrects it authoritatively when a turn ends, so the first turn
 * after a `/model` can report the previous model's window mid-stream and the
 * true one by the end. That is the agent revising a number it told us, not this
 * panel guessing, and it is drawn as it arrives for exactly that reason.
 *
 * `cost` is deliberately NOT here. The protocol carries it on the turn-final
 * frame and the header does not draw it: what a session has spent is a
 * different question from whether it is about to run out of room, asked at a
 * different moment, and a second number in that line buys nothing for the one
 * this exists to answer.
 */
export const Usage = Schema.Struct({
  /** Tokens currently in the context window. */
  used: Schema.Int,
  /** How many fit. Always positive — a report that said otherwise is dropped
   *  where the payload is read ({@link ./usage.ts}), because a denominator of
   *  zero is not a fact about a conversation. */
  size: Schema.Int,
});
export type Usage = typeof Usage.Type;
