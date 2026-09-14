/**
 * **Asking Nix a question, once.**
 *
 * Three gates in this directory need a fact that only Nix can answer — the
 * closure walk's `closureNamesFor`, the consumer closure's `pinnedProvenance`,
 * and the consumer recipe's evaluation — and each spelled the same
 * `execFileSync("nix", ["eval", …])` and the same nixpkgs preamble itself.
 *
 * That was fine as two and became a defect as three, in the way this repo
 * usually names: `consumerClosure.ts` already argued the case ("`closureWalk.ts`
 * already asks Nix for the sibling `closureNamesFor` this way; there is no
 * reason for two mechanisms in one directory") — and then a third file added a
 * third mechanism under it.
 *
 * It cost something real rather than tidiness. The preamble was spelled two
 * ways, and one of them was WRONG: `import "${root}"/nix/nixpkgs.nix { … }`
 * parses as `import("${root}")` applied to the absolute path
 * `/nix/nixpkgs.nix`, which survived only because nothing in that gate forced
 * `pkgs`. One shared preamble makes that unspellable, which is the standard this
 * repo holds `HASHED_NAMING`/`chunkPattern` to one package over.
 */

import { execFileSync } from "node:child_process";

/** The pinned nixpkgs, as an expression prefix every gate here evaluates
 *  against. Parenthesised deliberately — see the header. */
export function nixpkgsPreamble(repoRoot: string): string {
  return `import (${JSON.stringify(repoRoot)} + "/nix/nixpkgs.nix") { system = builtins.currentSystem; }`;
}

/** Evaluate a Nix expression in `repoRoot` and parse its JSON.
 *
 *  `--impure` because every caller here reads `builtins.currentSystem`, and
 *  `--accept-flake-config` because this repo's flake carries substituters a
 *  fresh checkout has not agreed to yet. stderr is left on the pipe so a caller
 *  can put Nix's own error in its message — which is the whole value of the
 *  error for a reader, and what a summarised "nix failed" throws away. */
export function nixEvalJson<T>(repoRoot: string, expr: string): T {
  const out = execFileSync(
    "nix",
    ["eval", "--accept-flake-config", "--impure", "--json", "--expr", expr],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out) as T;
}
