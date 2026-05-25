/** Terminal identity keys — the canonical `(group, label)` projection
 *  used to group, deduplicate, AND display terminals across every
 *  surface (workspace switcher, restore card, canvas tile chrome).
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Single function: identity
 *  and presentation are deliberately fused — the only way to keep them
 *  in sync is to make them the same projection.
 */

import type { GitInfo } from "kolu-git/schemas";
import { cwdBasename, shortenCwd } from "./path";
import type { TerminalId, TerminalLocation } from "./surface";

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

/** What `terminalKey` needs from a terminal — git + cwd + location. The
 *  wider `TerminalIdentity` (with `id`) is only required by
 *  `computeTerminalKeys` because it returns a Map keyed by id. Splitting
 *  these lets `terminalKey` be called from places (e.g.
 *  `buildTerminalDisplayInfos`) that don't yet know the id, without
 *  forcing them to fabricate one.
 *
 *  `location` carries the host axis: two terminals with the same
 *  repo/branch on different hosts must produce distinct keys so the
 *  workspace switcher doesn't collide them. For `kind === "local"` the
 *  host prefix is empty — the common case stays visually clean. */
export type TerminalKeyInputs = {
  git: GitInfo | null;
  cwd: string;
  location: TerminalLocation;
};

export type TerminalIdentity = TerminalKeyInputs & {
  id: TerminalId;
};

/** Canonical projection. The mapping is `git → (repoName, branch)` for
 *  git-aware terminals, `no git → (basename, shortenCwd)` otherwise. The
 *  host (when `location.kind === "ssh"`) prefixes `group` so two terminals
 *  on different hosts with the same repo+branch don't collide.
 *
 *  Why basename + shortened-cwd for non-git: `group` is the compact
 *  heading (a basename so paths like `/home/alice/projects/foo` show as
 *  `foo`); `label` is the disambiguating sub-line (`~/projects/foo`) so
 *  two terminals at different paths with the same basename are visually
 *  distinct AND don't collide on identity. Identity, grouping, and
 *  rendering all read from this single projection — a divergent
 *  projection elsewhere silently breaks `computeTerminalKeys` collision
 *  detection or visually contradicts the live workspace switcher. */
export function terminalKey(t: TerminalKeyInputs): {
  group: string;
  label: string;
} {
  const hostPrefix = t.location.kind === "ssh" ? `${t.location.host}:` : "";
  if (t.git) return { group: hostPrefix + t.git.repoName, label: t.git.branch };
  return {
    group: hostPrefix + cwdBasename(t.cwd),
    label: shortenCwd(t.cwd),
  };
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
