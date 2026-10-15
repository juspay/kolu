/**
 * What kolu delivers to a host, and what it says when that lands. A host gets
 * ONE set: agent-distro's package (its harnesses, on PATH) and the profiles of
 * the Agents setting, each BUILT by kolu-server (agent-distro's
 * `lib.mkProfile`, locked to the revision it was fetched at) into a store path
 * a terminal names in `AI_PROFILE`. Harnesses and profiles are disjoint:
 * either can change without the other.
 *
 * padi keeps the set that landed in a file of kolu's own (the host state's
 * `landed`, `./bake.ts`) beside upstream's `current`, so a restarted padi
 * still knows which profiles serve; and it words what changed in the history
 * log in upstream's idiom (`@juspay/agent-distro/update/versions`' `changes`),
 * extended for profiles: `Claude Code 2.0.1 → 2.0.3, juspay a1b2c3d → d4e5f6a,
 * ekala added 9f8e7d6`.
 */

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

/** The references a delivered stack names, in order. */
export function referencesOf(profiles: readonly DeliveredProfile[]): string[] {
  return profiles.map((p) => p.reference);
}

/** How a history line names one profile's build: its locked revision,
 *  shortened as git does, else its store hash. */
export function profileBuildLabel(profile: DeliveredProfile): string {
  return profile.rev?.slice(0, 7) ?? agentBundleShortHash(profile.path);
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
      // The same revision can build anew (a plugin it names by a flake
      // reference is locked only when it builds): then the store hashes are
      // what tell the two builds apart.
      const [was, now] =
        profileBuildLabel(old) === profileBuildLabel(p)
          ? [agentBundleShortHash(old.path), agentBundleShortHash(p.path)]
          : [profileBuildLabel(old), profileBuildLabel(p)];
      words.push(`${p.name} ${was} → ${now}`);
    }
  }
  const after = new Set(referencesOf(next.set.profiles));
  for (const p of previous?.set.profiles ?? [])
    if (!after.has(p.reference)) words.push(`${p.name} removed`);
  // The same profiles in another order are another stack (a later one wins
  // where they overlap), so the reorder is said when nothing else is.
  if (
    words.length === 0 &&
    previous !== undefined &&
    !sameStack(
      referencesOf(previous.set.profiles),
      referencesOf(next.set.profiles),
    )
  )
    words.push(
      `profiles reordered: ${next.set.profiles.map((p) => p.name).join(" + ")}`,
    );
  return words.join(", ");
}
