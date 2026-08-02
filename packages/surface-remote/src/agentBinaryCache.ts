/**
 * The agent's binary-cache declaration — ONE concept, one module.
 *
 * Everything that makes the declaration what it is lives here: the sidecar's
 * wire NAME (shared with Nix through `agent-env.json`, the repo's existing
 * cross-language registry), the validated VALUE, the ONE predicate that decides
 * whether a declaration could act, the typed FAULT a source without one raises,
 * and the READER that lifts the baked sidecar into the value. Its two consumers
 * — `agentDerivation.ts` (carries it) and `agentDrv.ts` (resolves through it) —
 * both import from here, so neither has to own a concept it merely uses.
 */

import { readFileSync } from "node:fs";
import { Result as EffectResult, Schema } from "effect";
import { ResolveDrvError } from "./host";
import agentEnv from "../agent-env.json" with { type: "json" };
import { err, ok, type Result } from "neverthrow";

/** The binary-cache declaration `mkProvenAgentSource` writes next to the baked
 * flake's `commit-hash` — derived from the agent flake's own `nixConfig`, so
 * the caches provisioning prefetches from are the same ones a manual
 * `nix build --accept-flake-config <flakeSrc>#…` would honor.
 *
 * The NAME is sourced from `agent-env.json`, the same registry `flakeRef` rides:
 * Nix writes the sidecar, TypeScript reads it, and neither spells the literal.
 * A rename is then one edit that both languages follow, instead of a drift that
 * only surfaces at dial time on a user's machine. */
export const AGENT_BINARY_CACHE_FILE = agentEnv.binaryCacheFile;

const agentBinaryCacheBrand = Symbol("AgentBinaryCache");

/** The binary caches an agent derivation is provisioned against.
 *
 * Provisioning PREFETCHES the agent's output closure from these caches into
 * the binder's LOCAL store (`nix copy --from`), then SHIPS it to the target
 * store (`nix copy --to ssh-ng://…`) before realising there. Both copies are
 * needed: the local store is the only seat where a declared cache can act (a
 * remote-store realisation substitutes with the REMOTE daemon's own nix.conf
 * — client-side substituter settings never participate), and the cold build
 * ships only the .drv closure, never locally-valid outputs (both facts
 * verified live). Cross-arch included: fetching and copying execute nothing.
 * The ship lands only when the target trusts it (trusted ssh user, or NAR
 * signatures the host trusts) — otherwise a narrated fallback realises on
 * the host, where the quickstart's remote nix.conf advice applies.
 *
 * The declaration is REQUIRED on every `AgentDerivation` arm so no consumer of
 * this package can assemble a cache-blind provisioning path. Flake-arm callers
 * inherit it from the baked source's sidecar (written by `mkProvenAgentSource`);
 * direct-drv callers state their own.
 *
 * NOMINAL, like the `AgentDerivation` sum it rides on: the private symbol means
 * only {@link agentBinaryCache} can produce one, so "validated" is a fact the
 * type carries rather than an assertion each constructor repeats. */
export interface AgentBinaryCache {
  readonly substituters: readonly string[];
  readonly trustedPublicKeys: readonly string[];
  readonly [agentBinaryCacheBrand]: "agent-binary-cache";
}

/** The ONE gate on "a cache declaration that could act", whatever its
 *  provenance — a baked sidecar, or a direct-drv caller's own literal. A
 *  declaration with no substituter, no trusted key, or a blank entry is exactly
 *  the cache-blind provisioning path {@link AgentBinaryCache} exists to make
 *  unspellable, so it never becomes a value.
 *
 *  Declared as a schema rather than hand-rolled predicates: Effect Schema is
 *  this package's validation vocabulary (see `connection.ts`), the TRIM decode
 *  makes the value that PASSES the gate the value nix receives (an untrimmed
 *  " https://cache…" would otherwise satisfy "non-blank" and then fail at
 *  `nix copy` looking like a cache miss), and a field added later is one line
 *  here instead of another hand-written check.
 *
 *  `zod`'s `.trim()` was a *decode-time transform* (it rewrote the value, then
 *  applied `.min(1)` to the trimmed result), so it is `Schema.Trim` here — NOT a
 *  `.check(isNonEmpty)` on the raw string, which would accept `"  "`. The
 *  non-empty check therefore runs on the DECODED (trimmed) side, exactly as it
 *  did in zod. */
const TrimmedNonEmpty = Schema.Trim.pipe(
  Schema.decodeTo(Schema.String.check(Schema.isMinLength(1))),
);
const NonEmptyList = Schema.Array(TrimmedNonEmpty).check(Schema.isMinLength(1));
const AgentBinaryCacheSchema = Schema.Struct({
  substituters: NonEmptyList,
  trustedPublicKeys: NonEmptyList,
});

export function agentBinaryCache(raw: {
  substituters?: unknown;
  trustedPublicKeys?: unknown;
}): AgentBinaryCache {
  const parsed = Schema.decodeUnknownResult(AgentBinaryCacheSchema)(raw);
  if (EffectResult.isFailure(parsed)) {
    // `SchemaError.message` renders the whole issue tree — the Effect Schema
    // counterpart of zod's `prettifyError`. Collapsed onto one line so the loud
    // throw stays one readable sentence, exactly as before.
    throw new Error(
      `agent binary cache must name at least one substituter and one trusted public key — an empty declaration would leave provisioning cache-blind (${parsed.failure.message.replace(/\s+/g, " ").trim()})`,
    );
  }
  return {
    ...parsed.success,
    [agentBinaryCacheBrand]: "agent-binary-cache",
  };
}

/** The baked source predates (or violates) the binary-cache contract. Same
 * family as `AgentSourceUnbakedError`: a source-configuration fault of the
 * wrapper, not a transport fact — provisioning refuses to run cache-blind
 * rather than silently compiling on the target. */
export class AgentBinaryCacheUnbakedError extends ResolveDrvError {
  /** `remedy` travels with the fault because the two ways to reach it have
   * DIFFERENT fixes: a sidecar that is missing or malformed means the binder is
   * stale (rebuild it), while a ref that is not a readable directory means the
   * caller handed over the wrong KIND of ref (bake/point at a local source).
   * Defaulting one remedy onto both is how a true error grows a false fix. */
  constructor(
    flakeRef: string,
    detail: string,
    remedy = "rebuild the binder with a current @kolu/surface-daemon mkProvenAgentSource",
  ) {
    super(
      `agent source ${flakeRef} has no usable ${AGENT_BINARY_CACHE_FILE} (${detail}) — ${remedy}; provisioning refuses a cache-blind agent source`,
      {
        kind: "binary-cache-unbaked",
        failureCause: "remote",
        terminal: false,
      },
    );
    this.name = "AgentBinaryCacheUnbakedError";
  }
}

/** Read and validate the baked source's {@link AGENT_BINARY_CACHE_FILE}.
 * Unreadable or malformed both yield the typed error above: absence means the
 * wrapper was built by a pre-contract `mkProvenAgentSource`, and a shape
 * violation means someone hand-assembled the tree — either way the fix is
 * rebuilding the binder, and the message says so. Synchronous on purpose: a
 * few hundred bytes from the local store, read once per uncached resolve —
 * and the typed failure lands deterministically before any spawn.
 *
 * A `Result`, like its sibling `readBakedAgentSource` — two readers of two
 * files baked by the same `mkProvenAgentSource` answer on one channel, and the
 * single `throw` sits at the caller's existing classification boundary. */
export function readBakedBinaryCache(
  flakeRef: string,
): Result<AgentBinaryCache, AgentBinaryCacheUnbakedError> {
  // Baked refs are bare local paths (a store path, or a consumer's own baked
  // directory); tolerate the equivalent explicit `path:` spelling since both
  // evaluate identically. Any OTHER flake-ref scheme (`github:`, `git+https:`,
  // `tarball:`…) is not a directory this can read, and letting it reach
  // `readFileSync` would report a fetchable ref as a wrapper that "predates the
  // contract" — a true error with a false remedy. Name the real fault instead.
  const local = flakeRef.replace(/^path:/, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(local);
  if (scheme) {
    return err(
      new AgentBinaryCacheUnbakedError(
        flakeRef,
        `'${scheme[1]}:' refs are not readable as a directory`,
        "pass the baked LOCAL source (the store path the Nix wrapper bakes), not a fetchable flake ref",
      ),
    );
  }
  // One try/catch for read + parse + validate: the three throw for different
  // reasons but produce the SAME fault, and `cause.message` already carries
  // which one it was ("ENOENT…" vs "Unexpected token…" vs "must name at least
  // one substituter…"). Splitting them only duplicated the wrapper.
  try {
    return ok(
      agentBinaryCache(
        JSON.parse(readFileSync(`${local}/${AGENT_BINARY_CACHE_FILE}`, "utf8")),
      ),
    );
  } catch (cause) {
    return err(
      new AgentBinaryCacheUnbakedError(
        flakeRef,
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
  }
}
