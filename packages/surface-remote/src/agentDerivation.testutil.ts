/** A well-formed binary-cache declaration for tests that construct agent
 *  derivations: every `AgentDerivation` arm REQUIRES one (the cache-blind
 *  provisioning path is unspellable), so test constructors share this value.
 *  The host is reserved-invalid (RFC 2606) — no test may actually fetch.
 *
 *  Reachable across the workspace through the package's
 *  `./agentDerivation.testutil` export, so a consumer's suite (e.g.
 *  `@kolu/server`'s ssh e2e) uses this value instead of re-spelling it. */
import { type AgentBinaryCache, agentBinaryCache } from "./agentBinaryCache";

export const TEST_BINARY_CACHE: AgentBinaryCache = agentBinaryCache({
  substituters: ["https://cache.test.invalid/oss"],
  trustedPublicKeys: ["oss:0000000000000000000000000000000000000000000="],
});
