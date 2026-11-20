import { declaredDependencyClosure } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { nixEvalJson, nixpkgsPreamble } from "./nixEval";
import { vendorEntries } from "./vendorEntries";

const IDENTITY_ENTRIES = ["kaval", "@kolu/padi"] as const;

const PACKAGE_NAME = /^[@A-Za-z0-9][@A-Za-z0-9/._-]*$/;

export function nixClosureNames(
  repoRoot: string,
  entries: readonly string[],
): string[] {
  const bad = entries.filter((e) => !PACKAGE_NAME.test(e));
  if (bad.length > 0) {
    throw new Error(`closureWalk: not package names: ${bad.join(", ")}`);
  }
  const list = entries.map((e) => `"${e}"`).join(" ");
  const expr = `
    let pkgs = ${nixpkgsPreamble(repoRoot)};
    in (import "${repoRoot}/nix/workspace.nix" { inherit pkgs; }).closureNamesFor [ ${list} ]`;
  return nixEvalJson<string[]>(repoRoot, expr).sort();
}

export function validateClosureWalkAgreement(
  nixNames: readonly string[],
  tsNames: readonly string[],
): void {
  const inNix = new Set(nixNames);
  const inTs = new Set(tsNames);
  const onlyInNix = nixNames.filter((n) => !inTs.has(n)).sort();
  const onlyInTs = tsNames.filter((n) => !inNix.has(n)).sort();
  if (onlyInNix.length === 0 && onlyInTs.length === 0) return;
  throw new Error(
    `the manifest-closure walks disagree — nix's depClosure ` +
      `(packages/surface-daemon/nix/workspace-closure.nix) and TS's ` +
      `declaredDependencyClosure (packages/daemon-test-gate) must name the same ` +
      `set over the vendored and daemon-identity entries.\n` +
      `  only nix: ${onlyInNix.join(", ") || "(none)"}\n` +
      `  only TS:  ${onlyInTs.join(", ") || "(none)"}\n` +
      `A member only TS sees is one the daemon identity does not hash; a member ` +
      `only nix sees is one a vendoring consumer is never told to copy. Fix the ` +
      `walk that is wrong — do not widen this check.`,
  );
}

export function checkClosureWalksAgree(repoRoot: string): number {
  const entries = [...vendorEntries(repoRoot), ...IDENTITY_ENTRIES];
  const ts = declaredDependencyClosure({ repoRoot, entries }).names;
  const nix = nixClosureNames(repoRoot, entries);
  validateClosureWalkAgreement(nix, ts);
  return ts.length;
}
