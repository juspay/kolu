/** A well-formed binary-cache declaration for tests that construct agent
 *  derivations: every {@link AgentDerivation} arm REQUIRES one (the cache-blind
 *  provisioning path is unspellable), so test constructors share this value.
 *  The host is reserved-invalid (RFC 2606) — no test may actually fetch. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_BINARY_CACHE_FILE } from "./agentDrv";
import type { AgentBinaryCache } from "./nixCopy";

export const TEST_BINARY_CACHE: AgentBinaryCache = {
  substituters: ["https://cache.test.invalid/oss"],
  trustedPublicKeys: ["oss:0000000000000000000000000000000000000000000="],
};

/** A real on-disk stand-in for a baked agent source: a tmp dir carrying the
 *  binary-cache sidecar `resolveAgentDrv` reads. For tests that drive the real
 *  `agentDrv` module (no fs mock). Caller owns cleanup (`rmSync`). */
export function makeTestAgentSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-agent-source-"));
  writeFileSync(
    join(dir, AGENT_BINARY_CACHE_FILE),
    JSON.stringify(TEST_BINARY_CACHE),
  );
  return dir;
}
