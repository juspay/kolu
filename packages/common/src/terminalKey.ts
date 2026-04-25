/** Terminal identity keys — the canonical `(group, label)` projection
 *  used to group, deduplicate, AND display terminals across every
 *  surface (pill tree, restore card, canvas tile chrome).
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Single function: identity
 *  and presentation are deliberately fused — the only way to keep them
 *  in sync is to make them the same projection.
 */

import { cwdBasename } from "./path";
import type { GitInfo, TerminalId } from "./index";

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

/** Canonical projection. The mapping is `git → (repoName, branch)` for
 *  git-aware terminals, `no git → (basename, basename)` otherwise.
 *
 *  Identity, grouping, and rendering all read from this same projection,
 *  so a future tweak (different fallback for non-git, different suffix
 *  format) lands in one place. Any divergent projection elsewhere
 *  silently breaks `computeTerminalKeys` collision detection AND/OR
 *  visually contradicts the live pill tree. */
export function terminalKey(t: TerminalLocation): {
  group: string;
  label: string;
} {
  if (t.git) return { group: t.git.repoName, label: t.git.branch };
  const base = cwdBasename(t.cwd) || "terminal";
  return { group: base, label: base };
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
