import { execFileSync } from "node:child_process";

export function nixpkgsPreamble(repoRoot: string): string {
  const nixpkgsFile = `${JSON.stringify(repoRoot)} + "/nix/nixpkgs.nix"`;
  return `let nixpkgsFile = ${nixpkgsFile}; in import nixpkgsFile { system = builtins.currentSystem; }`;
}

export function nixEvalJson<T>(repoRoot: string, expr: string): T {
  const out = execFileSync(
    "nix",
    ["eval", "--accept-flake-config", "--impure", "--json", "--expr", expr],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out) as T;
}
