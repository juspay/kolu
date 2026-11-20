import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ModelReading } from "@kolu/acp/engine";

export interface Picker {
  readonly picked: string | null;
  readonly labels: ReadonlyMap<string, string>;
}

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

export const sameModel = (
  reading: ModelReading,
  labels: ReadonlyMap<string, string>,
  one: string,
  other: string,
): boolean =>
  (reading.nameIn(labels, one) ?? one) ===
  (reading.nameIn(labels, other) ?? other);

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
