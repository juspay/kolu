import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Setting } from "@kolu/acp/wire";

type Choice = Setting["choices"][number];

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
      kind: isModel
        ? "model"
        : option.type === "boolean"
          ? "boolean"
          : "choice",
    };
    if (isModel) picker = row;
    else read.push(row);
  }
  return picker === null ? read : [picker, ...read];
};

export const acceptsSetting = (
  setting: Setting,
  value: string | boolean,
): boolean =>
  setting.kind === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string" &&
      setting.choices.some((choice) => choice.value === value);

const confirmedOf = (option: SessionConfigOption): string | null => {
  if (!("currentValue" in option)) return null;
  const value: unknown = option.currentValue;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};

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
