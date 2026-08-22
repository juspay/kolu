/** Terminal identity keys — the canonical `(group, label)` projection
 *  used to group, deduplicate, AND display terminals across every
 *  surface (workspace switcher, restore card, canvas tile chrome, and
 *  the caption on a screenshot).
 *
 *  Pure: same inputs produce the same outputs on every client, so the
 *  server never has to broadcast suffixes. Single function: identity
 *  and presentation are deliberately fused — the only way to keep them
 *  in sync is to make them the same projection.
 *
 *  Lives HERE, in the browser-safe terminal vocabulary, rather than in
 *  `kolu-common` where it was born. The projection is a fact about what
 *  a terminal IS, and its second reader is `@kolu/padi` — the per-host
 *  daemon, which must not grow an edge to kolu's domain-contract
 *  package. While it sat in `kolu-common`, padi could not reach it and
 *  hand-rolled its own basename for the screenshot caption instead: the
 *  exact divergent projection the note below warns about, shipped
 *  because the shared home was in the wrong package. Moving it down to
 *  the leaf both sides already depend on is what makes "one projection"
 *  true by construction rather than by prose.
 *
 *  `shortenCwd`/`cwdBasename` live in this file, not beside it: keeping
 *  the projection self-contained means there is no separate
 *  "presentation" function that drifts from identity.
 */

import type { GitInfo } from "kolu-git/schemas";
import type { TerminalId } from "./schema.ts";

/** Replace home directory prefix with `~` for compact display. */
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
}

/** Last segment of a path, with `~` for home directory and the same `~`
 *  as a fallback for empty input — never returns the empty string.
 *
 *  A trailing slash is trimmed before the last segment is taken: `/x/y/`
 *  names the same directory as `/x/y`, and without the trim the split
 *  pops the empty string after it and the whole path collapses to the
 *  `~` fallback — a terminal in `~/scratch/` captioned "~", which reads
 *  as the home directory it is not. */
export function cwdBasename(cwd: string): string {
  // Split-and-drop-empties rather than a trailing-slash regex. `/\/+$/` reads
  // as the obvious spelling and is a polynomial ReDoS (`js/polynomial-redos`):
  // on a long run of slashes that does NOT end the string, the engine retries
  // `\/+$` from every position. A cwd is not obviously attacker-controlled,
  // but it arrives from a PTY's OSC 7 and is captioned on a picture served to
  // an agent, so it is not obviously not, either — and the regex bought
  // nothing a filter doesn't. This also handles the interior doubles (`/x//y`)
  // the trim never did.
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
 *  git-aware terminals, `no git → (basename, shortenCwd)` otherwise.
 *
 *  Why basename + shortened-cwd for non-git: `group` is the compact
 *  heading (a basename so paths like `/home/alice/projects/foo` show as
 *  `foo`); `label` is the disambiguating sub-line (`~/projects/foo`) so
 *  two terminals at different paths with the same basename are visually
 *  distinct AND don't collide on identity. Identity, grouping, and
 *  rendering all read from this single projection — a divergent
 *  projection elsewhere silently breaks `computeTerminalKeys` collision
 *  detection or visually contradicts the live workspace switcher. */
export function terminalKey(t: TerminalLocation): {
  group: string;
  label: string;
} {
  if (t.git) return { group: t.git.repoName, label: t.git.branch };
  return { group: cwdBasename(t.cwd), label: shortenCwd(t.cwd) };
}

/** The one-line CAPTION for a terminal — `"repo (branch)"` inside a git
 *  worktree, the bare directory name outside one.
 *
 *  THE caption, not a caption: the PNG the browser copies to the clipboard,
 *  the PNG padi renders for an agent, and the PDF the scrollback export prints
 *  all title a terminal from here. Three sites composed this string by hand
 *  before, and all three had already parted — two disagreed on the absent-
 *  metadata fallback ("Terminal" vs "terminal"), and padi's re-derived the
 *  basename. The exported PDF and the copied screenshot of ONE terminal were
 *  captioned differently.
 *
 *  Composition kept: the git arm parenthesises `label`, the non-git arm does
 *  not. Always parenthesising was rejected — outside a repo `label` is the
 *  shortened cwd, so the caption would read "scratch (~/scratch)": the same
 *  fact twice. Inside a repo the halves are genuinely different facts (which
 *  repo, which branch), which is where the parentheses earn their place.
 *
 *  Takes a location, never an absence. "There is no terminal" is the CALLER's
 *  state to name — the client's screenshot has one, padi has no such state —
 *  and folding a UI default in here would put a placeholder string in the
 *  vocabulary. */
export function terminalCaption(t: TerminalLocation): string {
  const { group, label } = terminalKey(t);
  return t.git ? `${group} (${label})` : group;
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
