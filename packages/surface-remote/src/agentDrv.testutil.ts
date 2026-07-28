/** Filesystem fixtures for the baked-source READER (`agentDrv`), as opposed to
 *  the derivation contract's own fixture in `agentDerivation.testutil`. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_BINARY_CACHE_FILE } from "./agentBinaryCache";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

/** A real on-disk stand-in for a baked agent source: a tmp dir carrying the
 *  binary-cache sidecar `resolveAgentDrv` reads. For tests that drive the real
 *  `agentDrv` module (no fs mock). Caller owns cleanup (`rmSync`). */
export function makeTestAgentSourceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-agent-source-"));
  writeFileSync(
    join(dir, AGENT_BINARY_CACHE_FILE),
    JSON.stringify({
      substituters: TEST_BINARY_CACHE.substituters,
      trustedPublicKeys: TEST_BINARY_CACHE.trustedPublicKeys,
    }),
  );
  return dir;
}
