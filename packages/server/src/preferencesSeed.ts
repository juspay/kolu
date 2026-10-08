/**
 * `--preferences-seed` — the seed FILE's reader, and the two checks that make a
 * bad seed crash the boot instead of quietly degrading to defaults.
 *
 * The seed is a **preferences patch**: exactly the shape Settings writes
 * (`PreferencesPatchSchema`), so there is no second allowlist to keep in step —
 * every key the wire accepts is a key a seed may carry, `seenTips` and
 * `rightPanel` included. Two things are checked beyond the schema itself:
 *
 *  - the file parses as JSON and decodes as a patch. Decoding runs with
 *    `onExcessProperty: "error"` (the decoder default is `"ignore"`, which would
 *    SILENTLY DROP an unknown key — a typo'd key in a Nix config would then seed
 *    nothing and look like it worked), so an unknown key, a wrong value type, or
 *    an explicit `undefined` each fail here, naming the file; and
 *  - a seeded `agentDistro.profile` is one this build actually SHIPS. A name from
 *    a hand-written config that no kolu build knows is a typo, and a typo that
 *    silently turned the agents off is precisely the failure a boot crash
 *    prevents (the same stance `readAgentDistroListing` takes for a baked
 *    picker).
 *
 * Applying the patch to the store is `state.ts`'s job (`applyPreferencesSeed`) —
 * it owns the store, and "only while the store has never been written to" is a
 * fact about that store's file. This module only reads and checks, so it stays a
 * leaf `state.ts` need not import.
 */

import { readFileSync } from "node:fs";
import type { AgentDistroListing } from "@kolu/agent-distro/listing";
import { Schema } from "effect";
import {
  type PreferencesPatch,
  PreferencesPatchSchema,
} from "kolu-common/surface";

/** The patch decode, compiled once. `decodeUnknownSync` is the fail-fast
 *  `.parse`: it THROWS a `ParseError` whose `String` is the path-annotated error
 *  tree, and a boot runs this at most once. */
const decodePreferencesPatch = Schema.decodeUnknownSync(
  PreferencesPatchSchema,
  {
    onExcessProperty: "error",
  },
);

/** The refusal prefix — ONE spelling, so every message names the flag and the
 *  path the operator wrote. */
const at = (path: string): string => `--preferences-seed ${path}`;

/** Read + decode the seed file at `path` into a preferences patch. Throws —
 *  naming the file — for a missing/unreadable file, invalid JSON, or a value the
 *  patch schema rejects. Never a fall back to defaults. */
export function loadPreferencesSeed(path: string): PreferencesPatch {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${at(path)}: cannot read the file (${reason})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${at(path)}: not valid JSON (${reason})`);
  }
  try {
    return decodePreferencesPatch(parsed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${at(path)}: ${reason}`);
  }
}

/** Refuse a seeded `agentDistro.profile` this build does not ship.
 *
 *  A build with no baked listing (a from-source `just dev`, a unit test) has no
 *  set of names to check against — `unavailable` is an honest absence, not a
 *  listing — so the check is skipped there: there is nothing to be wrong about,
 *  and a seed must not crash a dev build merely for naming a profile. */
export function assertSeededAgentProfile(
  path: string,
  patch: PreferencesPatch,
  listing: AgentDistroListing,
): void {
  const chosen = patch.agentDistro;
  if (chosen === undefined || listing.kind !== "available") return;
  const shipped = listing.profiles.map((profile) => profile.name);
  if (shipped.includes(chosen.profile)) return;
  throw new Error(
    `${at(path)}: agentDistro.profile "${chosen.profile}" is not a profile ` +
      `this kolu ships (${shipped.join(", ")}).`,
  );
}
