/** WHERE A MEMBER TERMINAL STANDS, against the work it is in — a fact about
 *  the terminal, said on its row, and nothing else.
 *
 *  A terminal may join a work from anywhere, and may change directory or
 *  branch a second after it does; nothing about the work is read off it. What
 *  the row can honestly say is where the terminal is RIGHT NOW compared with
 *  the work's key: in the work's own checkout, somewhere else (and where), in
 *  no repository, or not known. Only `elsewhere` adds words to the row. */

import { activeArm } from "@kolu/padi-client/surface";
import type { WorkKey } from "kolu-work";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

export type MemberPlace =
  /** On the key's host, in the key's repository, on the key's branch. */
  | { readonly kind: "in-worktree" }
  /** Anywhere else: another branch, another repository, another host. */
  | {
      readonly kind: "elsewhere";
      readonly repo: string;
      readonly branch: string;
    }
  /** Its record says it is in no repository. */
  | { readonly kind: "no-repository" }
  /** Not here, not read yet, or the work is a watch (whose key IS the
   *  terminal, so there is nothing to compare it with). */
  | { readonly kind: "unknown" };

const UNKNOWN: MemberPlace = { kind: "unknown" };

/** Where the terminal on `host` stands, against the work's `key`. Total. */
export function memberPlace(
  key: WorkKey,
  host: string,
  standing: FleetTerminalStanding | undefined,
): MemberPlace {
  if (key.kind !== "branch" || standing?.kind !== "here") return UNKNOWN;
  const arm = activeArm(standing.meta);
  if (arm === undefined) return UNKNOWN;
  switch (arm.git.kind) {
    case "unresolved":
      return UNKNOWN;
    case "none":
      return { kind: "no-repository" };
    case "repo": {
      const info = arm.git.info;
      return host === key.host &&
        info.mainRepoRoot === key.repo &&
        info.branch === key.branch
        ? { kind: "in-worktree" }
        : { kind: "elsewhere", repo: info.repoName, branch: info.branch };
    }
    default:
      return arm.git satisfies never;
  }
}

/** What the row says for a place — `elsewhere · kolu · main` — or nothing. */
export function placeWords(place: MemberPlace): string | null {
  return place.kind === "elsewhere"
    ? `elsewhere · ${place.repo} · ${place.branch}`
    : null;
}
