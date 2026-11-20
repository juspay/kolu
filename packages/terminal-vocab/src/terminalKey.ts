import type { GitFact, TerminalId } from "./schema.ts";

/** Replace home directory prefix with `~` for compact display. */
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
}

/** Last segment of a path, with `~` for home directory and the same `~`
 *  as a fallback for empty input — never returns the empty string. */
export function cwdBasename(cwd: string): string {
  const segments = shortenCwd(cwd).split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "~";
}

/** `(group, label)` plus an optional `suffix` for ids that collide on
 *  `(group, label)` within the live set.
 *  - `group` is the repo-equivalence (git repoName, or cwd basename for
 *    non-git). Renders as the pill/restore heading.
 *  - `label` is the branch-equivalence (git branch, or cwd basename for
 *    non-git). Renders as the pill/restore secondary line.
 *  - `suffix` is a stable short id-prefix ("#a3f2") assigned only when
 *    two terminals collide on `(group, label)` — unique pills leave it
 *    `undefined`.
 */
export type TerminalKey = {
  group: string;
  label: string;
  suffix?: string;
};

/** What `terminalKey` needs from a terminal — just the location. */
export type TerminalLocation = {
  git: GitFact;
  cwd: string;
};

export type TerminalIdentity = TerminalLocation & {
  id: TerminalId;
};

/** Canonical projection. The mapping is `git → (repoName, branch)` for
 *  git-aware terminals, `no git → (basename, shortenCwd)` otherwise — and a
 *  terminal whose git context has not resolved yet keys by its cwd too: until
 *  the sensor answers, the cwd is all that is known about where it is. */
export function terminalKey(t: TerminalLocation): {
  group: string;
  label: string;
} {
  switch (t.git.kind) {
    case "repo":
      return { group: t.git.info.repoName, label: t.git.info.branch };
    case "none":
    case "unresolved":
      return { group: cwdBasename(t.cwd), label: shortenCwd(t.cwd) };
    default:
      return t.git satisfies never;
  }
}

/** The one-line CAPTION for a terminal — `"repo (branch)"` inside a git
 *  worktree, the bare directory name outside one. */
export function terminalCaption(t: TerminalLocation): string {
  const { group, label } = terminalKey(t);
  return t.git.kind === "repo" ? `${group} (${label})` : group;
}

/** Compute keys for every terminal in one pass. Suffixes are assigned only
 *  when two terminals collide on `(group, label)`; unique pills get
 *  `suffix: undefined`. */
export function computeTerminalKeys(
  terminals: readonly TerminalIdentity[],
): Map<TerminalId, TerminalKey> {
  const projected = terminals.map((t) => ({
    id: t.id,
    ...terminalKey(t),
  }));
  const counts = new Map<string, number>();
  for (const p of projected) {
    const k = join(p.group, p.label);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const result = new Map<TerminalId, TerminalKey>();
  for (const p of projected) {
    const suffix =
      (counts.get(join(p.group, p.label)) ?? 0) > 1
        ? `#${p.id.slice(0, 4)}`
        : undefined;
    result.set(p.id, { group: p.group, label: p.label, suffix });
  }
  return result;
}

const KEY_DELIMITER = "\0";

function join(group: string, label: string): string {
  return `${group}${KEY_DELIMITER}${label}`;
}
