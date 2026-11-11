/**
 * WHAT THE CLAUDE CODE ADAPTER CALLS ITS OWN MODELS — this engine's whole
 * `ModelReading` (`@kolu/acp/engine`), and nothing else's.
 *
 * The MACHINERY of the model picker is the protocol's and is the harness's
 * (`@kolu/acp-harness`): find the `configOptions` entry, read its labels, ask
 * for a value back. What is here is the two things that are only true of this
 * adapter:
 *
 *   - **which entry is the model.** ACP's `SessionConfigId` is a free-form
 *     string and its one reserved hint (`category: "model"`) is documented as
 *     UX-only, so `"model"` is a bet. It is the bet this adapter pays off, and
 *     an agent that spells its picker differently loses the model name in the
 *     header and nothing else.
 *   - **the alias tiers in {@link modelNameIn}.** `sonnet` naming
 *     `claude-sonnet-5` is one CLI's vocabulary. It costs nothing anywhere else
 *     — an agent whose picker values are the ids it reports matches at tier 1
 *     and never reaches them — and it lives in this integration rather than in
 *     the harness because this table moves when the CLI moves, and nothing else
 *     in kolu should have to move with it.
 */

import { type ModelReading, namedExactly } from "@kolu/acp/engine";

/**
 * The context lane a model string carries, as the adapter spells it.
 *
 * Two spellings for one thing — `opus[1m]` in a picker value, `-1m` glued to an
 * id — and the adapter treats them as the same string (its own
 * `canonicalizeModelId`). A live id carries NEITHER: the CLI reports the
 * concrete API id with the hint dropped, which is the whole reason
 * {@link modelNameIn} has to do any work at all.
 */
const CONTEXT_HINT = /(?:\[(\d+m)\]|-(\d+m))$/i;

/** A model id with its context lane taken off, lowercased — the spelling in
 *  which two of the adapter's names for one model are comparable. */
const withoutLane = (id: string): string =>
  id.trim().toLowerCase().replace(CONTEXT_HINT, "");

/** The context lane a model string states, in ONE spelling whichever way it was
 *  written, or `null` for a string that states none. A live id is always the
 *  latter — which is exactly why a row that states one may not answer for it. */
const laneOf = (id: string): string | null => {
  const found = CONTEXT_HINT.exec(id.trim().toLowerCase());
  return found?.[1] ?? found?.[2] ?? null;
};

/**
 * What the agent calls the model with this id, out of its own picker — or
 * `null` when the picker does not name it and the caller should say the id raw.
 *
 * THE TWO VOCABULARIES. The picker's values are the adapter's *aliases* —
 * `default`, `opus[1m]`, `sonnet`, `haiku` — and the live id the CLI reports is
 * the concrete API id: `claude-sonnet-5`. So the obvious lookup, `labels.get`
 * on a live id ({@link namedExactly}, which is every other engine's whole
 * reading), misses on every alias row the default install ships, and a header
 * that followed the running model could only ever say `claude-sonnet-5` where
 * the picker beside it said "Sonnet". Captured off the real adapter — the
 * picker offered `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`
 * while `system`/`init` reported `claude-fable-5`, then `claude-sonnet-5`. Not
 * one of the five ever matched.
 *
 * Three tiers, and every one of them is an EXACT comparison. This is not the
 * fuzzy match the picker's own note refuses, and the difference is worth
 * naming: the adapter resolves in exactly this direction itself
 * (`resolveModelPreference`, `matchResumedModel`) and resolves it to decide
 * BEHAVIOUR — which context window, which capabilities. What is decided here is
 * a word on a screen, and it is decided more strictly than the adapter does it:
 * no scoring, no version fuzz, no nearest row.
 *
 *   1. the id IS a picker value. The picked value always lands here;
 *   2. the same model in the adapter's two spellings of a context lane —
 *      `claude-fable-5` is the `claude-fable-5[1m]` row;
 *   3. an ALIAS row: a value that is one bare word naming a FAMILY, against an
 *      id that is that family and a version and nothing else.
 *      `claude-sonnet-5` is the `sonnet` row because "sonnet" is literally
 *      what that id says it is.
 *
 * Tier 3 answers for a family and a version — `claude-sonnet-5`,
 * `claude-haiku-4-5` — and for nothing more decorated than that. A dated or
 * otherwise pinned id (`claude-opus-4-5-20260101`) names something more
 * specific than any alias claims to cover, and gets the raw id: an alias row
 * that answered for it would be saying the picker offers a model it does not.
 *
 * And every tier that could answer twice answers `null` instead. Tier 3 in
 * particular takes a UNIQUE hit or none: two alias rows for one family — a
 * `sonnet` and a `sonnet[1m]` — are a question this cannot answer, and the raw
 * id is the truthful thing to say about a question nobody answered.
 *
 * `default` is never a match. It is the adapter's word for "whichever model the
 * CLI recommends today", so it names no model at all — and it is a bare word
 * that would otherwise sit in tier 3 matching nothing on purpose.
 *
 * AND A FAMILY ALIAS MAY NOT LEND A CONTEXT LANE. A live id states no lane —
 * the CLI drops it — so `claude-opus-5` against a lone `opus[1m]` row was
 * answered "Opus (1M context)", and a session actually running Opus at 200k
 * said so in the header for the rest of its life. That is a lie about the one
 * number a person reads this header to decide `/compact` by, and it is worse
 * than the raw id it replaced, which claimed nothing. So tier 3 requires the
 * LANES TO AGREE: laneless id, laneless row. `sonnet` and `haiku` still answer
 * because they state no lane either; a lane-pinned row does not answer for an
 * id that never mentioned one, and the header says `claude-opus-5`.
 *
 * TIER 2 IS NOT THAT, and the difference is identity. `claude-fable-5` against
 * the `claude-fable-5[1m]` row is one id in the adapter's own two spellings of
 * it (`canonicalizeModelId` is the adapter's equality, not a rule invented
 * here) — the SAME model, so the row's name for it is its name. A family alias
 * is not an identity: `opus` is whichever Opus, and a row that has pinned
 * itself to a lane is not the one a laneless id belongs to.
 */
export const modelNameIn = (
  labels: ReadonlyMap<string, string>,
  id: string,
): string | null => {
  const exact = namedExactly(labels, id);
  if (exact !== null) return exact;

  const wanted = withoutLane(id);
  if (wanted === "") return null;

  const named = (only: (value: string) => boolean): string | null => {
    const hits = [...labels].filter(
      ([value]) => value !== "default" && only(value),
    );
    return hits.length === 1 ? (hits[0]?.[1] ?? null) : null;
  };

  const lane = named((value) => withoutLane(value) === wanted);
  if (lane !== null) return lane;

  // `claude-` is the vendor and says nothing about which model this is; what
  // follows is a family and, optionally, the version of it. Anything else in
  // there — a date, a build — is a pin no family alias covers.
  const words = wanted.split("-");
  const [family, ...version] = words[0] === "claude" ? words.slice(1) : words;
  if (family === undefined || !version.every((part) => /^\d{1,2}$/.test(part)))
    return null;
  // ... and the lanes have to agree, which for a live id means both are absent:
  // a family alias names a family, and may not throw in a context window the
  // thing it is naming never claimed.
  const lanes = laneOf(id);
  return named(
    (value) => withoutLane(value) === family && laneOf(value) === lanes,
  );
};

/** THIS ENGINE'S WHOLE READING, as the leg hands it over: the picker's id, and
 *  the arithmetic above. */
export const MODELS: ModelReading = { config: "model", nameIn: modelNameIn };
