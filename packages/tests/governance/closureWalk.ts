/**
 * The manifest-closure walk exists twice — once in TypeScript
 * (`declaredDependencyClosure`, `@kolu/daemon-test-gate`) and once in Nix
 * (`depClosure` inside `mkWorkspaceClosure`) — and this is what forces the two
 * to answer the same question the same way.
 *
 * Two copies of one derivation is normally a defect to delete, and here it is
 * not deletable: Nix cannot run the TypeScript and the TypeScript cannot
 * evaluate the Nix, while both genuinely need the answer. What they must not do
 * is drift, and the drift would be silent in both directions and expensive in
 * different ways:
 *
 *   - the Nix answer decides DAEMON IDENTITY (juspay/kolu#2094) — a member the
 *     walk misses contributes no bytes to the id, so a rebuilt daemon ships
 *     under an unchanged id and a supervisor adopts stale code;
 *   - the TypeScript answer decides what a VENDORING consumer pays — a member
 *     the walk misses is a directory drishti/odu/olai never copy, so the import
 *     fails in their tree and not in ours.
 *
 * So the walks are compared over the same entries the vendored set is derived
 * from ({@link VENDOR_ENTRIES}), and a disagreement fails here rather than
 * downstream.
 *
 * ONE known asymmetry, and it is deliberate: the TS walk follows
 * `dependencies` ∪ `peerDependencies` (a peer is a runtime import a hydrating
 * consumer must supply), while the Nix walk follows the `dependencies`
 * projection because it is asking the narrower identity question. No workspace
 * member is peer-depended on today, so the two coincide — and the day one is,
 * this check fails, which is exactly when someone should decide whether a
 * peer-supplied member's sources belong in the daemon id, instead of the two
 * walks quietly parting ways.
 */

import { execFileSync } from "node:child_process";
import { declaredDependencyClosure } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { VENDOR_ENTRIES } from "./effectPin";

/** Package names are spelled straight into a Nix string literal below, so they
 *  are checked against the shape a package name actually has. Nothing here is
 *  attacker-controlled — the point is that a typo becomes a loud refusal rather
 *  than a Nix parse error nobody can read. */
const PACKAGE_NAME = /^[@A-Za-z0-9][@A-Za-z0-9/._-]*$/;

/** The Nix walk's answer for `entries`, by name.
 *
 *  Evaluated, never built: `closureNamesFor` reads package.json files and
 *  nothing else, so this is a sub-second pure eval with no derivation and no
 *  network. `--impure` is for `builtins.currentSystem` alone — the answer is
 *  platform-independent, but the nixpkgs import that supplies `lib` needs a
 *  system to instantiate. */
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
    let pkgs = import "${repoRoot}/nix/nixpkgs.nix" { system = builtins.currentSystem; };
    in (import "${repoRoot}/nix/workspace.nix" { inherit pkgs; }).closureNamesFor [ ${list} ]`;
  const out = execFileSync(
    "nix",
    ["eval", "--accept-flake-config", "--impure", "--json", "--expr", expr],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return (JSON.parse(out) as string[]).slice().sort();
}

/** What the two walks disagree about, as two lists a reader can act on. */
export function closureWalkDelta(
  nixNames: readonly string[],
  tsNames: readonly string[],
): { onlyInNix: string[]; onlyInTs: string[] } {
  const inNix = new Set(nixNames);
  const inTs = new Set(tsNames);
  return {
    onlyInNix: nixNames.filter((n) => !inTs.has(n)).sort(),
    onlyInTs: tsNames.filter((n) => !inNix.has(n)).sort(),
  };
}

/** Throw unless the two walks named exactly the same closure. */
export function validateClosureWalkAgreement(
  nixNames: readonly string[],
  tsNames: readonly string[],
): void {
  const { onlyInNix, onlyInTs } = closureWalkDelta(nixNames, tsNames);
  if (onlyInNix.length === 0 && onlyInTs.length === 0) return;
  throw new Error(
    `the manifest-closure walks disagree — nix's depClosure ` +
      `(packages/surface-daemon/nix/workspace-closure.nix) and TS's ` +
      `declaredDependencyClosure (packages/daemon-test-gate) must name the same ` +
      `set over the vendored entries.\n` +
      `  only nix: ${onlyInNix.join(", ") || "(none)"}\n` +
      `  only TS:  ${onlyInTs.join(", ") || "(none)"}\n` +
      `A member only TS sees is one the daemon identity does not hash; a member ` +
      `only nix sees is one a vendoring consumer is never told to copy. Fix the ` +
      `walk that is wrong — do not widen this check.`,
  );
}

/** The whole conformance check, over the entries the vendored set is derived
 *  from — so every directory an outside repo copies is covered by one
 *  assertion. Returns the agreed closure size, for the census line. */
export function checkClosureWalksAgree(repoRoot: string): number {
  const ts = declaredDependencyClosure({
    repoRoot,
    entries: VENDOR_ENTRIES,
  }).names;
  const nix = nixClosureNames(repoRoot, VENDOR_ENTRIES);
  validateClosureWalkAgreement(nix, ts);
  return ts.length;
}
