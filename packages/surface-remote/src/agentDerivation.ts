/**
 * What a caller hands provisioning: the nominal `AgentDerivation` sum and its
 * two constructors.
 *
 * Its own module rather than a section of `nixCopy.ts`, which is named after an
 * operation (`nix copy`) and not after an axis of change: the derivation
 * CONTRACT changes when the ways of naming an agent change, while the
 * provisioning STEPS change when the ways of moving a closure change. Two
 * volatilities, two homes — and the package's `agentDerivation.testutil` now
 * sits next to the module it is named for.
 */

import type { AgentBinaryCache } from "./agentBinaryCache";

const agentDerivationBrand = Symbol("AgentDerivation");

/** A derivation source whose variants make the GC ownership contract explicit.
 *
 * A direct `.drv` caller already owns keeping that store path valid. A flake
 * caller carries both the evaluated path (needed for the warm probe) and the
 * installable that one `nix build` can evaluate and provision as an owned unit.
 * The private symbol makes the sum nominal: callers cannot hand-assemble a
 * mismatched path/installable pair. Both arms carry the binary-cache
 * declaration the prefetch acts on ({@link AgentBinaryCache}) — itself nominal,
 * so an unvalidated declaration cannot reach an arm either. */
export type AgentDerivation =
  | {
      kind: "drv-path";
      drvPath: string;
      binaryCache: AgentBinaryCache;
      readonly [agentDerivationBrand]: "drv-path";
    }
  | {
      kind: "flake-installable";
      drvPath: string;
      installable: string;
      binaryCache: AgentBinaryCache;
      readonly [agentDerivationBrand]: "flake-installable";
    };

/** Construct the public direct-path arm. The caller owns keeping this path
 * valid, and — like every arm — must state where its binaries may be
 * prefetched from. The parameter is deliberately REQUIRED: downstream
 * binders (drishti's baked drv map, odu's runner flake) inherit the
 * cache-aware provisioning path at compile time, not by opting in. Obtain the
 * declaration with `readBakedBinaryCache` where the deployment bakes one;
 * `agentBinaryCache({…})` states one inline. */
export function directAgentDerivation(
  drvPath: string,
  binaryCache: AgentBinaryCache,
): AgentDerivation {
  if (!drvPath.endsWith(".drv")) {
    throw new Error(
      `agent derivation must be a .drv store path, got ${JSON.stringify(drvPath)}`,
    );
  }
  return {
    kind: "drv-path",
    drvPath,
    binaryCache,
    [agentDerivationBrand]: "drv-path",
  };
}

/** Package-internal constructor for the flake arm. Deliberately not re-exported
 * from `@kolu/surface-remote`: only `resolveAgentDrv` may pair these values
 * (it reads `binaryCache` from the baked source's sidecar). */
export function flakeAgentDerivation(
  drvPath: string,
  installable: string,
  binaryCache: AgentBinaryCache,
): AgentDerivation {
  if (!drvPath.endsWith(".drv") || installable.trim().length === 0) {
    throw new Error(
      `invalid flake agent derivation: drvPath=${JSON.stringify(drvPath)}, installable=${JSON.stringify(installable)}`,
    );
  }
  return {
    kind: "flake-installable",
    drvPath,
    installable,
    binaryCache,
    [agentDerivationBrand]: "flake-installable",
  };
}
