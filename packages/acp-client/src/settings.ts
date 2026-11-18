/**
 * EVERY SETTING THE AGENT OFFERS, and which of them is the model.
 *
 * The agent's ordering and vocabulary are kept; only the control shape is
 * decided here, once, so no panel has to work it out again.
 *
 * The model row is BOTH THINGS AT ONCE: it is the reading a header draws its
 * name and context size from, AND it is the agent's own model picker. Pulled
 * out of the list, it left a header that said "Opus 5.5" over a popover with no
 * MODEL section in it — every setting the agent advertised except the one a
 * person opens that popover to change. So it stays in the list, marked `model`
 * and first, because the model is what people come to that list to change.
 *
 * No option is dropped: a select whose rows could not be read is still a row,
 * with no choices, rather than a setting that silently is not there.
 */
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Setting } from "@kolu/acp/wire";

type Choice = Setting["choices"][number];

/** The settings `options` advertises, the model row (`modelConfig`'s id)
 *  first. `modelConfig` is the leg's — `null` for an agent with no picker. */
export const settingsIn = (
  options: ReadonlyArray<SessionConfigOption> | null | undefined,
  modelConfig: string | null,
): ReadonlyArray<Setting> => {
  const read: Array<Setting> = [];
  let picker: Setting | null = null;
  for (const option of options ?? []) {
    const choices = choicesOf(option);
    const isModel = option.id === modelConfig;
    const row: Setting = {
      id: option.id,
      name: option.name,
      description: option.description ?? null,
      value: confirmedOf(option),
      choices,
      kind: isModel ? "model" : kindOf(option, choices),
    };
    if (isModel) picker = row;
    else read.push(row);
  }
  return picker === null ? read : [picker, ...read];
};

/** Whether `value` is one this setting can be set to: a boolean for a switch,
 *  and one of its own choices for everything else. */
export const acceptsSetting = (
  setting: Setting,
  value: string | boolean,
): boolean =>
  setting.kind === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string" &&
      setting.choices.some((choice) => choice.value === value);

/** The confirmed value, as the string a `Setting` carries — a boolean as
 *  `"true"` / `"false"`, and `null` for a value of no shape this reads. */
const confirmedOf = (option: SessionConfigOption): string | null => {
  if (!("currentValue" in option)) return null;
  const value: unknown = option.currentValue;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};

/**
 * A SELECT'S ROWS, which the protocol lets an agent send as groups of rows
 * rather than as rows. A group has no id of its own and is not a value anybody
 * can pick, so only the leaves are offered: a picker drawn with a group in it
 * would be one whose heading is selectable.
 */
const choicesOf = (option: SessionConfigOption): ReadonlyArray<Choice> => {
  if (!("options" in option) || !Array.isArray(option.options)) return [];
  const rows: Array<Choice> = [];
  for (const entry of option.options as ReadonlyArray<unknown>) {
    if (typeof entry !== "object" || entry === null) continue;
    if ("options" in entry && Array.isArray(entry.options)) {
      for (const leaf of entry.options as ReadonlyArray<unknown>) {
        const row = choiceOf(leaf);
        if (row !== null) rows.push(row);
      }
      continue;
    }
    const row = choiceOf(entry);
    if (row !== null) rows.push(row);
  }
  return rows;
};

/** One leaf of {@link choicesOf} — `null` for anything that names no value,
 *  because a choice a person could pick and this end could not send back is
 *  worse than one that is not offered. `value` is the protocol's own word for
 *  what a row SENDS BACK; the setting around it says `id`. */
const choiceOf = (entry: unknown): Choice | null => {
  if (typeof entry !== "object" || entry === null) return null;
  const value = "value" in entry ? entry.value : undefined;
  if (typeof value !== "string" || value === "") return null;
  const name = "name" in entry ? entry.name : undefined;
  const description = "description" in entry ? entry.description : undefined;
  return {
    value,
    label: typeof name === "string" ? name : value,
    hint: typeof description === "string" ? description : null,
  };
};

/**
 * WHICH CONTROL THIS SETTING IS, for a panel that has to draw it.
 *
 * A boolean is the one setting with no rows to offer — ACP's own
 * `type: "boolean"`, which the pinned Claude adapter sends for FAST MODE — and
 * a panel that guessed from "offers no choices" would draw the same empty
 * heading for a select whose rows this end could not read. So the VALUE
 * decides it: a boolean `currentValue` and nothing to pick is a switch, and
 * everything else is a list of rows.
 */
const kindOf = (
  option: SessionConfigOption,
  choices: ReadonlyArray<Choice>,
): "choice" | "boolean" =>
  choices.length === 0 &&
  "currentValue" in option &&
  typeof option.currentValue === "boolean"
    ? "boolean"
    : "choice";
