/** WHERE A MEMBER TERMINAL STANDS, against the work it is in — a fact about
 *  the terminal, said on its row, and nothing else.
 *
 *  A terminal may join a work from anywhere, and may change directory or
 *  branch a second after it does; nothing about the work is read off it. What
 *  the row can honestly say is where the terminal is — or, asleep, where it
 *  slept — compared with the work's key: in the work's own checkout,
 *  somewhere else (and where), in no repository, or not known. The work's
 *  repository is the root git said for its key (`rootOf`); a key whose root
 *  git has not said cannot place a terminal on its branch. Only `elsewhere`
 *  adds words to the row. */

import { Option } from "effect";
import { rootOf, type WorkKey } from "kolu-work";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

export type MemberPlace =
  /** On the key's host, in the root git said for it, on the key's branch. */
  | { readonly kind: "in-worktree" }
  /** Anywhere else: another branch, another repository, another host. */
  | {
      readonly kind: "elsewhere";
      readonly repo: string;
      readonly branch: string;
    }
  /** Its record says it is in no repository. */
  | { readonly kind: "no-repository" }
  /** Not here, not read yet, on the key's branch of a repository whose root
   *  git has not said, or the work is a watch (whose key IS the terminal, so
   *  there is nothing to compare it with). */
  | { readonly kind: "unknown" };

const UNKNOWN: MemberPlace = { kind: "unknown" };

/** Where the terminal on `host` stands, against the work's `key`. Total. */
export function memberPlace(
  key: WorkKey,
  host: string,
  standing: FleetTerminalStanding | undefined,
): MemberPlace {
  if (key.kind !== "branch" || standing?.kind !== "here") return UNKNOWN;
  // Both arms carry the terminal's git: a sleeping one's is where it slept.
  const git = standing.meta.git;
  switch (git.kind) {
    case "unresolved":
      return UNKNOWN;
    case "none":
      return { kind: "no-repository" };
    case "repo": {
      const info = git.info;
      const elsewhere: MemberPlace = {
        kind: "elsewhere",
        repo: info.repoName,
        branch: info.branch,
      };
      if (host !== key.host || info.branch !== key.branch) return elsewhere;
      return Option.match(rootOf(key), {
        onNone: () => UNKNOWN,
        onSome: (root) =>
          info.mainRepoRoot === root ? { kind: "in-worktree" } : elsewhere,
      });
    }
    default:
      return git satisfies never;
  }
}

/** What the row says for a place — `elsewhere · kolu · main` — or nothing. */
export function placeWords(place: MemberPlace): string | null {
  return place.kind === "elsewhere"
    ? `elsewhere · ${place.repo} · ${place.branch}`
    : null;
}
