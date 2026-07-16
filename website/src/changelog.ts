/** The release-note kinds, in the order used by totals and filters. */
export const CHANGE_KIND_LABELS = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  "heads-up": "Heads-up",
} as const;

export type ChangeKind = keyof typeof CHANGE_KIND_LABELS;

export const CHANGE_KINDS = Object.entries(CHANGE_KIND_LABELS).map(
  ([key, label]) => ({ key: key as ChangeKind, label }),
);

export interface ChangelogStat {
  label: string;
  key: string;
  count: number;
}

export const isChangeKind = (value: unknown): value is ChangeKind =>
  typeof value === "string" && Object.hasOwn(CHANGE_KIND_LABELS, value);

/** Validate changelog metadata emitted by the remark build plugin. */
export const readChangelogStats = (value: unknown): ChangelogStat[] => {
  if (!Array.isArray(value))
    throw new Error("Changelog rendering did not emit a stats array");

  return value.map((stat, index) => {
    if (
      typeof stat !== "object" ||
      stat === null ||
      !("label" in stat) ||
      typeof stat.label !== "string" ||
      !("key" in stat) ||
      typeof stat.key !== "string" ||
      !("count" in stat) ||
      typeof stat.count !== "number" ||
      !Number.isInteger(stat.count) ||
      stat.count < 0
    )
      throw new Error(`Changelog stat ${index} is malformed`);

    return { label: stat.label, key: stat.key, count: stat.count };
  });
};
