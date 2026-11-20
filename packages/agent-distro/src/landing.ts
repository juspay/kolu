import { changes, type Version } from "@juspay/agent-distro/update/versions";
import { Schema } from "effect";
import { agentBundleShortHash } from "./bundle.ts";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

/** One profile, as delivered: the reference the setting names, the name its
 *  build gives itself, the revision it was locked to (absent for a path, used
 *  as it is), and its store path on the host. */
export const DeliveredProfileSchema = Schema.Struct({
  reference: NonEmpty,
  name: NonEmpty,
  rev: Schema.optionalKey(NonEmpty),
  path: NonEmpty,
});

export type DeliveredProfile = typeof DeliveredProfileSchema.Type;

/** The set a host serves: the package and its profiles, in stack order. */
export const DeliveredSetSchema = Schema.Struct({
  bundle: NonEmpty,
  profiles: Schema.Array(DeliveredProfileSchema),
});

export type DeliveredSet = typeof DeliveredSetSchema.Type;

const decodeSet = Schema.decodeUnknownSync(DeliveredSetSchema);

/** Parse padi's record of the landed set. Throws on anything else: padi wrote
 *  it, so another shape is a broken file, never one to read around. */
export function parseDeliveredSet(text: string): DeliveredSet {
  return decodeSet(JSON.parse(text));
}

/** Do two stacks name the same references, in the same order? */
export function sameStack(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref === b[i]);
}

/** A set as one string — the package and every profile's build, in order:
 *  two sets are the same set exactly when their keys are equal. */
export function setKey(set: DeliveredSet): string {
  return JSON.stringify([set.bundle, ...set.profiles.map((p) => p.path)]);
}

/** Are two sets the same — the same package and the same builds, in order? */
export function sameSet(a: DeliveredSet, b: DeliveredSet): boolean {
  return setKey(a) === setKey(b);
}

/** How a stack is named: each profile by the name its build gives itself, in
 *  stack order — `juspay + ekala`, as agent-distro names a stack. Empty for no
 *  profiles. */
export function stackTitle(
  profiles: readonly Pick<DeliveredProfile, "name">[],
): string {
  return profiles.map((p) => p.name).join(" + ");
}

/** The references a delivered stack names, in order. */
export function referencesOf(profiles: readonly DeliveredProfile[]): string[] {
  return profiles.map((p) => p.reference);
}

/** How a history line names one profile's build: its locked revision,
 *  shortened as git does, else its store hash. */
export function profileBuildLabel(profile: DeliveredProfile): string {
  return profile.rev?.slice(0, 7) ?? agentBundleShortHash(profile.path);
}

function rebuildLabels(
  old: DeliveredProfile,
  next: DeliveredProfile,
): readonly [string, string] {
  return profileBuildLabel(old) === profileBuildLabel(next)
    ? [agentBundleShortHash(old.path), agentBundleShortHash(next.path)]
    : [profileBuildLabel(old), profileBuildLabel(next)];
}

function reorderWords(
  previous: DeliveredSet | undefined,
  next: DeliveredSet,
): string | undefined {
  if (previous === undefined) return undefined;
  return sameStack(referencesOf(previous.profiles), referencesOf(next.profiles))
    ? undefined
    : `profiles reordered: ${stackTitle(next.profiles)}`;
}

/** What changed between two delivered sets, in the history log's words —
 *  upstream's `changes` for the package's harnesses when the package moved,
 *  then each profile added, rebuilt or removed (or, when only their order
 *  moved, the new order). Empty when nothing changed. `previous` is `undefined`
 *  before the first landing (every harness and profile is named). The
 *  versions are each package's own (`undefined` when it records none). */
export function deliveryChanges(
  previous:
    | { readonly set: DeliveredSet; readonly versions: Version[] | undefined }
    | undefined,
  next: {
    readonly set: DeliveredSet;
    readonly versions: Version[] | undefined;
  },
): string {
  const words: string[] = [];
  if (previous === undefined || previous.set.bundle !== next.set.bundle)
    words.push(changes(previous?.versions ?? null, next.versions ?? null));
  const before = new Map(
    previous?.set.profiles.map((p) => [p.reference, p]) ?? [],
  );
  for (const p of next.set.profiles) {
    const old = before.get(p.reference);
    if (old === undefined)
      words.push(
        previous === undefined
          ? `${p.name} ${profileBuildLabel(p)}`
          : `${p.name} added ${profileBuildLabel(p)}`,
      );
    else if (old.path !== p.path) {
      const [was, now] = rebuildLabels(old, p);
      words.push(`${p.name} ${was} → ${now}`);
    }
  }
  const after = new Set(referencesOf(next.set.profiles));
  for (const p of previous?.set.profiles ?? [])
    if (!after.has(p.reference)) words.push(`${p.name} removed`);
  const reordered =
    words.length === 0 ? reorderWords(previous?.set, next.set) : undefined;
  if (reordered !== undefined) words.push(reordered);
  return words.join(", ");
}
