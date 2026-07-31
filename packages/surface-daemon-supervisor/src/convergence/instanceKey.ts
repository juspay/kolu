/**
 * Instance key for the drain budget — the fragment's `startedAt` when present.
 *
 * Absent `startedAt` is NOT a coalesced null (overloaded nulls are a defect): a
 * survivor predating the field is, by definition, an older build than this
 * supervisor. Named as {@link PreInstanceKey} so the budget can treat it
 * explicitly (cross-supervisor / match rules) instead of collapsing identity.
 */

/** A live daemon that reports a concrete instance key (typically hello.startedAt). */
export type NamedInstanceKey = {
  readonly kind: "instance";
  readonly key: string | number;
};

/**
 * A survivor whose handshake has no instance key (predates the field). Absent
 * means older — the same #1671 rule as an absent build id.
 */
export type PreInstanceKey = {
  readonly kind: "pre-instance";
};

export type InstanceKey = NamedInstanceKey | PreInstanceKey;

/** Build an instance key from a hello `startedAt` (or undefined when absent). */
export function instanceKeyFromStartedAt(
  startedAt: string | number | null | undefined,
): InstanceKey {
  if (startedAt === null || startedAt === undefined) {
    return { kind: "pre-instance" };
  }
  return { kind: "instance", key: startedAt };
}

/** Structural string key for Maps/Sets — never display-string concat of raw values. */
export function instanceKeyTag(k: InstanceKey): string {
  switch (k.kind) {
    case "instance":
      return typeof k.key === "number" ? `n:${k.key}` : `s:${k.key}`;
    case "pre-instance":
      return "pre-instance";
    default: {
      const _exhaustive: never = k;
      throw new Error(
        `unreachable InstanceKey: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
