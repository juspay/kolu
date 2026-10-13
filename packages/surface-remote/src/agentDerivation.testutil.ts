/** A well-formed binary-cache declaration for tests that construct agent
 *  derivations: every `AgentDerivation` arm REQUIRES one (the cache-blind
 *  provisioning path is unspellable), so test constructors share this value.
 *  The host is reserved-invalid (RFC 2606) — no test may actually fetch.
 *
 *  Reachable across the workspace through the package's
 *  `./agentDerivation.testutil` export, so a consumer's suite (e.g.
 *  `@kolu/server`'s ssh e2e) uses this value instead of re-spelling it. */
import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { type AgentBinaryCache, agentBinaryCache } from "./agentBinaryCache";
import type { CaptureResult } from "./process";

export const TEST_BINARY_CACHE: AgentBinaryCache = agentBinaryCache({
  substituters: ["https://cache.test.invalid/oss"],
  trustedPublicKeys: ["oss:0000000000000000000000000000000000000000000="],
});

/** A minimal real surface for tests that must NAME one but never speak it.
 *  `sshConnector` / `dialAgentOnce` take the served surface as a VALUE now (the
 *  wire link is built from its `RpcGroup`), so a suite whose subject is the
 *  session loop — provisioning, backoff, give-up, spawn env — still has to supply
 *  one. Shared here so twelve suites don't each invent a throwaway. */
export const TEST_AGENT_SURFACE = defineSurface({
  cells: { status: { schema: Schema.String, default: "" } },
});

/** `nix derivation show`'s answer for a mocked `runCapture`: a `.drv` built
 *  for `system`, when `args` asks that, else `undefined`. Provisioning reads
 *  the target's system off the `.drv` (it decides the form delivery ships), so
 *  every suite that mocks provisioning's Nix answers it. */
export function derivationShowAnswer(
  args: readonly string[],
  system = "x86_64-linux",
): CaptureResult | undefined {
  if (!(args.includes("derivation") && args.includes("show"))) return undefined;
  return {
    ok: true,
    kind: "exit",
    code: 0,
    stdout: JSON.stringify({ derivations: { "agent.drv": { system } } }),
  };
}
