/**
 * A content-addressed closure index — where a consumer learns which store path
 * to put on a host, without evaluating anything.
 *
 * A publisher (this repo's `.github/actions/publish-closure`, agent-distro's
 * CI) builds each installable per system, rewrites it content-addressed, pushes
 * both forms to its binary cache, and writes small JSON files on a git branch
 * served raw over HTTPS:
 *
 *     <rawBase>/<rev>/<system>/<attr>.json    → { rev, ia, ca? }
 *     <rawBase>/latest/<system>/<attr>.json   → { rev, ia, ca? }
 *
 * — the revision that built it, its input-addressed output (`ia`, signed by the
 * cache) and its content-addressed rewrite (`ca`), absent for a darwin entry
 * (a rewritten Mach-O cannot run). `<rev>` is the key the publisher was given —
 * for a `mkProvenAgentSource` binder, the agent flake's `commit-hash` file, so
 * a binder looks up exactly its own build; `latest/` moves only on a push to
 * the publisher's main branch. Which form a host pulls is `closureRoute`'s
 * call (`./closureRoute.ts`).
 *
 * The declaration a binder carries ({@link ClosureIndex}) is written by
 * `mkProvenAgentSource` into the baked `binary-cache.json` beside the caches
 * (`readBakedBinaryCache`) — nothing in TypeScript spells an index URL.
 */

import { Schema } from "effect";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

/** Where a binder's closures are published: the GitHub `repo` and `branch` the
 *  index lives on, and the `rawBase` URL its files are read from (derived from
 *  the two by `binary-cache.nix`, never spelled in TypeScript). */
export const ClosureIndexSchema = Schema.Struct({
  repo: NonEmpty,
  branch: NonEmpty,
  rawBase: Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/)),
});

export type ClosureIndex = typeof ClosureIndexSchema.Type;

const StorePath = Schema.String.check(
  Schema.isPattern(/^\/nix\/store\/[0-9a-z]{32}-[^/]+$/),
);

const PublishedClosureSchema = Schema.Struct({
  rev: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  ia: StorePath,
  ca: Schema.optionalKey(StorePath),
});

/** One index entry: the full revision that built it, its signed
 *  input-addressed output, and — off darwin — its content-addressed rewrite. */
export type PublishedClosure = typeof PublishedClosureSchema.Type;

/** Which entry to read: one revision's own (`{ rev }`, the publisher's key —
 *  a short or full commit), or the newest a main-branch push published. */
export type ClosureKey = { readonly rev: string } | "latest";

/** What a {@link readPublishedClosure} read answered. `not-published` is the
 *  index's own 404 — a dev build, a revision CI never published, a system it
 *  does not build — a fact, not a fault. */
export type ClosureLookup =
  | {
      readonly kind: "published";
      readonly url: string;
      readonly entry: PublishedClosure;
    }
  | { readonly kind: "not-published"; readonly url: string };

/** One HTTP GET's answer, as {@link readPublishedClosure} reads it. */
export type FetchText = (
  url: string,
) => Promise<{ readonly status: number; readonly text: string }>;

/** A read that produced no answer about the publication: `unreadable` — the
 *  request never got one, or got a status other than 200/404 (the index's
 *  host, not the publication, is the fact); `malformed` — the body is not an
 *  entry, or names another revision (a broken publisher, and loud). The
 *  message names the URL either way. */
export class ClosureIndexError extends Error {
  constructor(
    readonly kind: "unreadable" | "malformed",
    readonly url: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClosureIndexError";
  }
}

/** How long one index read may take — a small JSON file off a CDN. */
const INDEX_TIMEOUT_MS = 30_000;

/** The real {@link FetchText}: `fetch`, bounded by a 30 s timeout. */
export const fetchClosureIndex: FetchText = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
};

/** A path segment the index names a directory or file by. Anything that could
 *  climb out of it is refused — the publisher refuses the same. */
function segment(what: string, value: string): string {
  if (value === "" || value.includes("/") || value.startsWith("."))
    throw new Error(
      `closure index: ${what} ${JSON.stringify(value)} cannot name an index path`,
    );
  return encodeURIComponent(value);
}

/** The URL of `attr`'s entry for `system` under `key`. */
export function closureIndexUrl(
  index: Pick<ClosureIndex, "rawBase">,
  key: ClosureKey,
  system: string,
  attr: string,
): string {
  // Trailing slashes stripped by one scan, not a `/\/+$/` regex (which
  // backtracks polynomially on a long run of slashes).
  let end = index.rawBase.length;
  while (end > 0 && index.rawBase[end - 1] === "/") end--;
  const dir = key === "latest" ? "latest" : segment("rev", key.rev);
  return `${index.rawBase.slice(0, end)}/${dir}/${segment("system", system)}/${segment("attr", attr)}.json`;
}

/** Read `attr`'s entry for `system` under `key` off `index`. A 404 is
 *  `not-published`. Everything else that is not an entry THROWS, naming the
 *  URL: a request that never got an answer (DNS, no egress, TLS, the timeout),
 *  any other status, a body that is not `{ rev, ia, ca? }`, or a rev-keyed
 *  entry whose `rev` is not the revision asked for — a format change or a
 *  broken publisher must be loud, never a path guessed. */
export async function readPublishedClosure(
  fetchText: FetchText,
  index: Pick<ClosureIndex, "rawBase">,
  key: ClosureKey,
  system: string,
  attr: string,
): Promise<ClosureLookup> {
  const url = closureIndexUrl(index, key, system, attr);
  let answer: { readonly status: number; readonly text: string };
  try {
    answer = await fetchText(url);
  } catch (err) {
    // `fetch` rejects with a bare "fetch failed" and the real reason on its
    // `cause`.
    const cause =
      err instanceof Error && err.cause !== undefined ? err.cause : err;
    throw new ClosureIndexError(
      "unreadable",
      url,
      `the closure index at ${url} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: err },
    );
  }
  const { status, text } = answer;
  if (status === 404) return { kind: "not-published", url };
  if (status !== 200)
    throw new ClosureIndexError(
      "unreadable",
      url,
      `the closure index answered HTTP ${status} for ${url}: ${text.slice(0, 200)}`,
    );
  let entry: PublishedClosure;
  try {
    entry = Schema.decodeUnknownSync(PublishedClosureSchema)(JSON.parse(text));
  } catch (err) {
    throw new ClosureIndexError(
      "malformed",
      url,
      `the closure index entry at ${url} is not { rev, ia, ca? }: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (key !== "latest" && !entry.rev.startsWith(key.rev))
    throw new ClosureIndexError(
      "malformed",
      url,
      `the closure index entry at ${url} names revision ${entry.rev}, not ${key.rev}`,
    );
  return { kind: "published", url, entry };
}
