/**
 * WHY A WORK IS STILL UNDER ITS OLD KEY — the card's line, as a reading.
 *
 * A work opened before kolu keyed a branch by the root git names is re-keyed
 * to that root when git first answers for it. When the root's key already
 * belongs to another work, nothing is removed: this one keeps its old key,
 * `held`, and the card says which work holds the branch now — by its title,
 * or "another work" when that one has dropped off the finished list. A work
 * whose key is not held reads none.
 */

import { Option } from "effect";
import { type Work, type WorkId, workIdOf } from "kolu-work";
import { repoName } from "./workReadings";

export const heldWords = (
  work: Work,
  works: ReadonlyMap<WorkId, Work>,
): Option.Option<string> => {
  const key = work.key;
  if (key.kind !== "branch" || key.repoBy.kind !== "held") return Option.none();
  const root = key.repoBy.root;
  const holder = works.get(workIdOf({ ...key, repo: root }));
  const who = holder === undefined ? "another work" : `«${holder.title}»`;
  return Option.some(
    `Kept under its old key: ${who} holds ${key.branch} in ${repoName(root)}`,
  );
};
