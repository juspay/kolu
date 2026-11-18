/**
 * WHICH MODEL a conversation is on, out of the protocol's own picker.
 *
 * ACP carries a session's settings as `configOptions` — a list of selects the
 * client may read and set — and every agent olai talks to puts the model in one
 * of them. So the MACHINERY is the protocol's and is here: find the entry, read
 * what it offers, translate between what the picker calls a model and what a
 * turn reports it is running on, and hand a request the value the picker would
 * accept.
 *
 * ## THE TWO BETS THAT USED TO BE HERE ARE NOT ANY MORE
 *
 * This file carried them under a paragraph naming them as one adapter's
 * spelling and arguing that keeping them here was "the smaller lie", because a
 * per-leg copy would be one rule written twice. That was true while the legs
 * were three files in the next directory. It stopped being true when each
 * became a plugin with its own release clock, and what the lie cost was
 * concrete: one CLI's alias table sat in the path every OTHER agent's model
 * name was read through.
 *
 * They are `ModelReading` now (`@kolu/acp/engine`), answered by the LEG:
 *
 *   - **which entry is the model** — `id === "model"` is a bet, paid off by
 *     every agent olai ships, and an agent that spells its picker differently
 *     says so in its own file;
 *   - **what the picker's rows are called** — the alias tiers, which are the
 *     Claude Code CLI's vocabulary and live in `olai-plugin-claude`. An agent
 *     whose picker values ARE the ids it reports takes `namedExactly` and never
 *     needed them.
 *
 * Everything below takes the reading as its first argument, so the leg that
 * answers it is visible at every call and an agent with NO picker at all
 * (`leg.models === null`) never reaches this module.
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ModelReading } from "@kolu/acp/engine";

/** The model picker, as read: what is PICKED in it, and what the agent calls
 *  each of the values it offers. */
export interface Picker {
  readonly picked: string | null;
  readonly labels: ReadonlyMap<string, string>;
}

/**
 * The model picker out of a session's `configOptions`, or `null` when there is
 * none to read.
 *
 * WHICH ENTRY is the leg's answer and not the protocol's: ACP's
 * `SessionConfigId` is a free-form string, and its one reserved hint —
 * `category: "model"` — is documented as UX-only, optional, and never required
 * for correctness. So the id is a bet, and it is the engine's own to make.
 */
export const modelPickerIn = (
  reading: ModelReading,
  configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
): Picker | null => {
  const entry = (configOptions ?? []).find(
    (option) => option.id === reading.config,
  );
  if (entry === undefined || entry.type !== "select") return null;
  return { picked: entry.currentValue ?? null, labels: labelsOf(entry) };
};

/**
 * Whether two model strings name the model, as far as anything here can tell.
 *
 * Asked by the one caller that has to decide whether to say anything at all:
 * the panel puts a restored conversation back on the model it was running
 * ({@link ../agent.ts}'s `restore`), and a session that already came up on it
 * needs no such request. The two strings reach that question in DIFFERENT
 * vocabularies — the picker's own value (`sonnet`) against whatever the panel
 * last knew it was running, which is a live API id (`claude-sonnet-5`) as often
 * as not — so string equality answers only the easy half.
 *
 * Resolved through the leg's own `nameIn`, which is the bridge between those two
 * vocabularies and already the header's: two strings the picker gives ONE name
 * are one model, because a picker never names two rows alike. A string the
 * picker cannot name answers for itself, so two unnameable ones agree only when
 * they are the same string — which is the truthful answer for a model nobody
 * here has a vocabulary for, and the reason the equal-strings case needs no
 * line of its own.
 */
export const sameModel = (
  reading: ModelReading,
  labels: ReadonlyMap<string, string>,
  one: string,
  other: string,
): boolean =>
  (reading.nameIn(labels, one) ?? one) ===
  (reading.nameIn(labels, other) ?? other);

/**
 * The picker's OWN word for a model, when it has one.
 *
 * The other direction of the same bridge, and the one a request has to cross.
 * What the panel remembers a conversation running is, in practice, always the
 * live API id the agent reported — that is the only source a `/model` ever
 * reaches olai through — while a picker may offer aliases. A
 * `session/set_config_option` carries a picker VALUE, so asking in the
 * remembered spelling is asking with a word the picker never offered: an
 * adapter that resolves aliases would take it, and an agent that simply checked
 * its own list would refuse — leaving the conversation on the pin, which is the
 * whole bug.
 *
 * So the id is translated back through the labels first: the row this model is
 * NAMED by is the row to ask for. `null` when no row answers, or when two do —
 * the caller then asks in the words it has, which is what it would have done
 * anyway, and an agent that can resolve them still does.
 */
export const pickerValueFor = (
  reading: ModelReading,
  labels: ReadonlyMap<string, string>,
  model: string,
): string | null => {
  if (labels.has(model)) return model;
  const name = reading.nameIn(labels, model);
  if (name === null) return null;
  const rows = [...labels].filter(([, label]) => label === name);
  return rows.length === 1 ? (rows[0]?.[0] ?? null) : null;
};

/** The picker as value → label ("sonnet" → "Sonnet"), which is what the agent
 *  calls its own models. Exactly what the picker said and nothing more — the
 *  vocabulary gap between a picker VALUE and a live API id is the leg's
 *  `nameIn` to bridge, and only it may answer `null`.
 *
 *  The picker is a flat list of options or a list of GROUPS of them, and the
 *  protocol tells the two apart by shape rather than by a tag. */
const labelsOf = (
  entry: Extract<SessionConfigOption, { type: "select" }>,
): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const item of entry.options) {
    if ("value" in item) {
      labels.set(item.value, item.name);
      continue;
    }
    for (const option of item.options) labels.set(option.value, option.name);
  }
  return labels;
};
