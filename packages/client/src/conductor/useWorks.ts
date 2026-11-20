import type { MemberReading } from "kolu-common/works";
import {
  finished,
  inProgress,
  membershipOf,
  type Membership,
  type NeedsYou,
  needsYou,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRow,
} from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

const mapOf = <K extends string, V>(bound: {
  keys: () => Iterable<K>;
  byKey: (key: K) => Accessor<V | undefined> | undefined;
}): Accessor<ReadonlyMap<K, V>> =>
  createMemo(() => {
    const by = new Map<K, V>();
    for (const key of bound.keys()) {
      const one = bound.byKey(key)?.();
      if (one !== undefined) by.set(key, one);
    }
    return by;
  });

export const useWorkMap = createSharedRoot<Accessor<ReadonlyMap<WorkId, Work>>>(
  () => mapOf(app.collections.works.use()),
);

export const useWorks = createSharedRoot<Accessor<ReadonlyArray<WorkRow>>>(
  () => {
    const map = useWorkMap();
    return createMemo(() => {
      const pairs = [...map()].sort(([, a], [, b]) =>
        a.startedAt < b.startedAt ? -1 : 1,
      );
      return [...inProgress(pairs), ...finished(pairs)];
    });
  },
);

/** EVERY TERMINAL THAT IS IN A PIECE OF WORK, by its `<host>/<id>` ref — the
 *  one map, mirrored once. A ref that is not a key here is in no work; a ref
 *  that is names exactly one. */
export const useWorkMembers = createSharedRoot<
  Accessor<ReadonlyMap<string, WorkMember>>
>(() => mapOf(app.collections.workMembers.use()));

export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const works = useWorkMap();
  const members = useWorkMembers();
  return createMemo(() => membershipOf(works(), members()));
});

/** HOW A MEMBER TERMINAL STANDS, by kolu's watch — ref to the level it was
 *  last read at and when it entered it. A terminal that is absent has not been
 *  read in this process, which is a different thing from "0s ago". */
export const useSeen = createSharedRoot<
  Accessor<ReadonlyMap<string, MemberReading>>
>(() => mapOf(app.collections.memberReadings.use()));

export const useNeedsYou = createSharedRoot<Accessor<ReadonlyArray<NeedsYou>>>(
  () => {
    const works = useWorks();
    return createMemo(() => needsYou(works()));
  },
);
