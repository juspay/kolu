/** Terminal identity keys — the canonical `(group, label)` projection
 *  used to group and deduplicate terminals across every display surface
 *  (pill tree, restore card, canvas tile chrome).
 *
 *  Pure helpers: same inputs produce the same outputs on every client,
 *  so the server never has to broadcast suffixes. Any server-side code
 *  that needs to reason about "same terminal location" must import
 *  from here — divergent projections silently break collision detection.
 */

import type { GitInfo } from "kolu-git/schemas";
import type { TerminalId } from "./index";

/** Two projections of the same identity:
 *  - `group` is the repo-equivalence (git repoName, or cwd for non-git). All
 *    terminals of a given group collect under one pill/restore heading.
 *  - `label` is the branch-equivalence (git branch, or cwd for non-git).
 *    Two terminals share a pill slot when both `group` and `label` match.
 *  - `suffix` is a stable short id-prefix ("#a3f2") assigned only to ids
 *    that actually collide on `(group, label)` within the live set —
 *    unique pills leave it undefined.
 */
export type TerminalKey = {
  group: string;
  label: string;
  suffix?: string;
};

/** Minimum metadata slice needed to compute a terminal's key. */
export type TerminalIdentity = {
  id: TerminalId;
  git: GitInfo | null;
  cwd: string;
};

/** Canonical `(group, label)` projection for a terminal. Single source
 *  of truth for every surface that needs to group or deduplicate
 *  terminals (pill tree, restore card, `computeTerminalKeys`).
 *
 *  The mapping is `git → (repoName, branch)` for git-aware terminals,
 *  `no git → (cwd, cwd)` otherwise. Keep callers on this helper — a
 *  divergent projection elsewhere (e.g. `cwdBasename(cwd)`) silently
 *  breaks collision detection because `computeTerminalKeys` no longer
 *  sees the same equivalence.
 */
export function terminalKey(t: TerminalIdentity): {
  group: string;
  label: string;
} {
  if (t.git) return { group: t.git.repoName, label: t.git.branch };
  return { group: t.cwd, label: t.cwd };
}

/** Compute keys for every terminal in one pass.
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Suffixes are assigned only
 *  when two terminals collide on `(group, label)`; unique pills get
 *  `suffix: undefined`. Note: `terminalKey` is the single definition
 *  of "same place" — any server-side code making equivalent identity
 *  assumptions must move together with changes here, since there is
 *  no runtime check keeping them in sync.
 */
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

/** Delimiter that cannot appear in `group` or `label` (both derived from
 *  repo names, branches, and filesystem paths) — keeps `(group, label)`
 *  serialization unambiguous, so e.g. `("foo bar", "baz")` never collides
 *  with `("foo", "bar baz")`. */
const KEY_DELIMITER = "\0";

function join(group: string, label: string): string {
  return `${group}${KEY_DELIMITER}${label}`;
}
