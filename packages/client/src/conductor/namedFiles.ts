import { Option } from "effect";
import { filesSeen, keptOf, type Work, type WorkId } from "kolu-work";
import { type NonEmpty, nonEmpty } from "nonempty";

const pathsOf = (work: Work): ReadonlySet<string> =>
  Option.match(keptOf(work), {
    onNone: () => filesSeen(work),
    onSome: (kept) => new Set(kept.map((one) => one.path)),
  });

export const holdsPath = (work: Work, path: string): boolean =>
  pathsOf(work).has(path);

export type FileHolders = ReadonlyMap<string, ReadonlyArray<WorkId>>;

export function fileHolders(works: ReadonlyMap<WorkId, Work>): FileHolders {
  const index = new Map<string, WorkId[]>();
  for (const [id, work] of works)
    for (const path of pathsOf(work)) {
      const list = index.get(path) ?? [];
      list.push(id);
      index.set(path, list);
    }
  return index;
}

export type FileTarget =
  | { readonly kind: "plain" }
  | { readonly kind: "open"; readonly work: WorkId }
  | { readonly kind: "missing"; readonly works: NonEmpty<WorkId> }
  | { readonly kind: "choose"; readonly works: NonEmpty<WorkId> };

const opening = (holders: NonEmpty<WorkId>): FileTarget =>
  holders.length === 1
    ? { kind: "open", work: holders[0] }
    : { kind: "choose", works: holders };

export function fileTarget(
  holders: FileHolders,
  turn: ReadonlyArray<WorkId>,
  path: string,
): FileTarget {
  const anywhere = nonEmpty(holders.get(path) ?? []);
  if (anywhere === null) return { kind: "plain" };
  const asked = nonEmpty(turn);
  if (asked === null) return opening(anywhere);
  const holding = nonEmpty(asked.filter((id) => anywhere.includes(id)));
  return holding === null
    ? { kind: "missing", works: asked }
    : opening(holding);
}
