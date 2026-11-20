import type { GitFact } from "@kolu/terminal-vocab/schema";

export type CodeLister = "git" | "disk";

export function codeLister(git: GitFact | undefined): CodeLister | null {
  if (git?.kind !== "repo") return null;
  return git.info.isBare ? "disk" : "git";
}
