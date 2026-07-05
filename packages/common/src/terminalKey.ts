/** Terminal identity keys — the canonical `(group, label)` projection
 *  used to group and deduplicate terminals.
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Presentation surfaces may
 *  derive their own display labels from this identity key, but collision
 *  suffixes still use the same deterministic algorithm below.
 */

import type { GitInfo } from "kolu-git/schemas";
import { cwdBasename, shortenCwd } from "./path";
import type { TerminalId } from "./surface";

/** `(group, label)` plus an optional `suffix` for ids that collide on the
 *  pair within a display set.
 *  - `group` is the repo-equivalence (git repoName, or cwd basename for
 *    non-git).
 *  - `label` is the branch-equivalence (git branch, or cwd basename for
 *    non-git).
 *  - `suffix` is a stable short id-prefix ("#a3f2") assigned only when
 *    two terminals collide on `(group, label)` — unique pills leave it
 *    `undefined`.
 */
export type TerminalKey = {
  group: string;
  label: string;
  suffix?: string;
};

/** What `terminalKey` needs from a terminal — just the location. The wider
 *  `TerminalIdentity` (with `id`) is only required by `computeTerminalKeys`
 *  because it returns a Map keyed by id. Splitting these lets `terminalKey`
 *  be called from places (e.g. `buildTerminalDisplayInfos`) that don't yet
 *  know the id, without forcing them to fabricate one. */
export type TerminalLocation = {
  git: GitInfo | null;
  cwd: string;
};

export type TerminalIdentity = TerminalLocation & {
  id: TerminalId;
};

/** Already-projected key material for callers that need the same deterministic
 *  suffixing algorithm in a non-identity presentation domain. */
export type TerminalKeyBase = {
  id: TerminalId;
  group: string;
  label: string;
};

/** Canonical identity projection. The mapping is `git → (repoName, branch)` for
 *  git-aware terminals, `no git → (basename, shortenCwd)` otherwise.
 *
 *  Why basename + shortened-cwd for non-git: `group` is the compact
 *  heading (a basename so paths like `/home/alice/projects/foo` show as
 *  `foo`); `label` is the disambiguating sub-line (`~/projects/foo`) so
 *  two terminals at different paths with the same basename don't collide
 *  on identity. */
export function terminalKey(t: TerminalLocation): {
  group: string;
  label: string;
} {
  if (t.git) return { group: t.git.repoName, label: t.git.branch };
  return { group: cwdBasename(t.cwd), label: shortenCwd(t.cwd) };
}

/** Compute keys for every terminal in one pass.
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Suffixes are assigned only
 *  when two terminals collide on `(group, label)`; unique pills get
 *  `suffix: undefined`.
 */
export function computeTerminalKeys(
  terminals: readonly TerminalIdentity[],
): Map<TerminalId, TerminalKey> {
  const projected = terminals.map((t) => ({
    id: t.id,
    ...terminalKey(t),
  }));
  return suffixTerminalKeys(projected);
}

/** Add deterministic short-id suffixes for colliding `(group, label)` pairs. */
export function suffixTerminalKeys(
  projected: readonly TerminalKeyBase[],
): Map<TerminalId, TerminalKey> {
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

/** Delimiter that cannot appear in `group` or `label` (both derived from
 *  repo names, branches, and filesystem paths) — keeps `(group, label)`
 *  serialization unambiguous, so e.g. `("foo bar", "baz")` never collides
 *  with `("foo", "bar baz")`. */
const KEY_DELIMITER = "\0";

function join(group: string, label: string): string {
  return `${group}${KEY_DELIMITER}${label}`;
}
