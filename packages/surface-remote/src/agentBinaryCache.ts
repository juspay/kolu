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
 *  unspellable, so it never becomes a value. */
export function agentBinaryCache(raw: {
  substituters?: unknown;
  trustedPublicKeys?: unknown;
}): AgentBinaryCache {
  // TRIM as part of validating: the value that passes the gate is the value nix
  // receives. Keeping the untrimmed string would let " https://cache…" satisfy
  // "non-blank" and then fail at `nix copy` in a way that reads as a cache miss.
  const list = (v: unknown): readonly string[] | null =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((s) => typeof s === "string" && s.trim().length > 0)
      ? (v as readonly string[]).map((s) => s.trim())
      : null;
  const substituters = list(raw.substituters);
  const trustedPublicKeys = list(raw.trustedPublicKeys);
  if (substituters === null || trustedPublicKeys === null) {
    throw new Error(
      "agent binary cache must name at least one substituter and one trusted public key — an empty declaration would leave provisioning cache-blind",
    );
  }
  return {
    substituters,
    trustedPublicKeys,
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
  const file = `${local}/${AGENT_BINARY_CACHE_FILE}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    return err(
      new AgentBinaryCacheUnbakedError(
        flakeRef,
        cause instanceof Error ? cause.message : String(cause),
      ),
    );
  }
  try {
    return ok(
      agentBinaryCache(
        parsed as { substituters?: unknown; trustedPublicKeys?: unknown },
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
