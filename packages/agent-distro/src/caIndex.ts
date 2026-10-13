/**
 * agent-distro's content-addressed index — where kolu learns which store path
 * to put on a host for a profile, without Nix.
 *
 * Upstream's CI rewrites each profile's bundle content-addressed per system,
 * pushes that closure to its binary cache, and writes the index on the
 * `ca-index` branch of `juspay/agent-distro`. kolu reads ONE file of it:
 *
 *     <index>/latest/<system>/<profile>.json → { rev, ia, ca }
 *
 * — the newest bundle a main-branch push published for that system: the
 * revision that built it, its input-addressed output (`ia`) and its
 * content-addressed rewrite (`ca`, the path a host pulls). kolu reads only
 * `rev` (logged) and `ca`; `ia` is upstream's and left unchecked. The rev-keyed files beside `latest/`
 * are upstream's own updater's, never read here.
 *
 * Pure: the fetch stays where it runs (kolu-server's `agentDelivery`).
 */

import { Schema } from "effect";

const StorePath = Schema.String.check(
  Schema.isPattern(/^\/nix\/store\/[0-9a-z]{32}-[^/]+$/),
);

const CaIndexEntrySchema = Schema.Struct({
  rev: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  ca: StorePath,
});

export type CaIndexEntry = typeof CaIndexEntrySchema.Type;

/** The URL of `profile`'s newest published bundle for `system`. */
export function caIndexUrl(
  index: string,
  system: string,
  profile: string,
): string {
  // Trailing slashes stripped by one scan, not a `/\/+$/` regex (which
  // backtracks polynomially on a long run of slashes).
  let end = index.length;
  while (end > 0 && index[end - 1] === "/") end--;
  return `${index.slice(0, end)}/latest/${encodeURIComponent(system)}/${encodeURIComponent(profile)}.json`;
}

/** Parse one `latest/` entry (`rev` and `ca`; other fields are ignored).
 *  Throws on a missing or malformed one — a format change
 *  upstream must be loud, never a path guessed. */
export function parseCaIndexEntry(text: string): CaIndexEntry {
  return Schema.decodeUnknownSync(CaIndexEntrySchema)(JSON.parse(text));
}
