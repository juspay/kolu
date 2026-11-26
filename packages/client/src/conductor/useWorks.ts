/** THE WORKS MIRROR — ONE subscription to kolu-server's `works` collection,
 *  one to the `workMembers` map beside it, and the one place every surface
 *  reads a piece of work from.
 *
 *  Their own members rather than a field of `conductor` because a work
 *  OUTLIVES the conversation that opened it: "New session" clears the chat and
 *  leaves every waterfall in flight exactly where it was. The mark on a dock
 *  row, the column beside the chat, the tab's number and the phone's sheet are
 *  four readers of this one frame — a second subscription would only be a
 *  second frame to disagree with.
 *
 *  A WORK IS ITS KEY. The collection is keyed by the work's id (the canonical
 *  encoding of host/repo/branch, or of the terminal a watch is about), so one
 *  branch has one card BY CONSTRUCTION: there is no way for a second
 *  `work_open` to arrive as a second entry. The record itself carries no id —
 *  the key is the id — which is why every reader here passes the two together.
 *
 *  MEMBERSHIP IS ITS OWN MAP, keyed by terminal ref: a terminal is in at most
 *  one piece of work because there is one slot for it. A member of a work that
 *  has ENDED cannot be written down at all — ending removes its members in the
 *  same step — so a finished card has nothing to draw terminals from.
 *
 *  `memberReadings` carries the one thing a browser cannot read for itself: how
 *  each member terminal stands by kolu's own watch, which reads hosts no
 *  browser has opened. `workPrs` carries each work's own pull request, as that
 *  watch read it for the work's branch (`./workPr.ts`). Everything else a card
 *  draws about a terminal — the agent in it, its screen — is read live from
 *  that host's own mirror, never from here. */

import type { PrResult } from "kolu-common/surface";
import type { MemberReading } from "kolu-common/works";
import { Option } from "effect";
import {
  finished,
  inProgress,
  membershipOf,
  type Membership,
  type NeedsYou,
  needsYouOf,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRow,
} from "kolu-work";
import { type Accessor, createMemo, mapArray } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** ONE BOUND COLLECTION, AS A MAP — the three mirrors below are the same eight
 *  lines over three collections: walk the keys, read each row's accessor, drop
 *  the ones that have not folded yet. Said once here, module-locally: the
 *  pattern also appears in client modules that mirror quite different things,
 *  and a shared primitive would claim a kinship those do not have.
 *
 *  A row is `undefined` twice over — no accessor for that key yet, or an
 *  accessor whose frame has not landed — and the map carries neither, so `V`
 *  is inferred as the ROW's type rather than the row-or-nothing the binding
 *  hands out. */
const mapOf = <K extends string, V>(
  bound: {
    keys: () => Iterable<K>;
    byKey: (key: K) => Accessor<V | undefined> | undefined;
  },
  /** The fold's name in dev diagnostics — one `mapOf` serves every mirror, so
   *  the collection it folds is the caller's to say. */
  name: string,
): Accessor<ReadonlyMap<K, V>> =>
  createMemo(
    () => {
      const by = new Map<K, V>();
      for (const key of bound.keys()) {
        const one = bound.byKey(key)?.();
        if (one !== undefined) by.set(key, one);
      }
      return by;
    },
    { name },
  );

/** THE WORKS BY ID, mirrored once for the whole app — the shape membership is
 *  folded from, and what a reader looking for ONE work (the reader window, a
 *  chat row's question) asks. */
export const useWorkMap = createSharedRoot<Accessor<ReadonlyMap<WorkId, Work>>>(
  () =>
    // Bare `.use()`: the collection DECLARES its own `onError` policy (a toast
    // labelled `Works`) on the spec, so the use-site carries none, and its
    // default keys stream is the server's own — every work, no narrowing.
    mapOf(app.collections.works.use(), "workMap"),
);

/** TWO READINGS SEEN AS ONE LIST — the same ids in the same order, from the
 *  same records. Every mirror below hands out a FRESH container per publish,
 *  so a fold over one mints a new array each run even when no work moved;
 *  this gate holds the previous array instead, and nothing downstream re-runs
 *  for a list that did not change. Holding it keeps nothing stale: a record's
 *  own leaves are read THROUGH the kept row, and a row whose record was
 *  replaced compares unequal. */
const sameWorkRows = (
  a: ReadonlyArray<WorkRow>,
  b: ReadonlyArray<WorkRow>,
): boolean =>
  a.length === b.length &&
  a.every((row, at) => {
    const other = b[at];
    return other !== undefined && other[0] === row[0] && other[1] === row[1];
  });

/** THE SAME THINGS IN THE SAME ORDER — the gate for a derived list whose
 *  entries are already held by something else (an id off a row, a row memo's
 *  own answer), so identity is the whole question. */
const sameOrder = <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean =>
  a.length === b.length && a.every((one, at) => b[at] === one);

/** THE WORKS, in the order every reader draws them: in progress oldest first
 *  (a card keeps its place), then the finished ones most recently ended first.
 *
 *  The keys arrive as a SET — arrival order is not a fact about the works — so
 *  the records are sorted by when they started before `inProgress` filters
 *  them, which is what makes "oldest first" true of a browser that joined
 *  mid-run as well as of one that was there from the start. */
export const useWorks = createSharedRoot<Accessor<ReadonlyArray<WorkRow>>>(
  () => {
    const map = useWorkMap();
    return createMemo(
      () => {
        const pairs = [...map()].sort(([, a], [, b]) =>
          a.startedAt < b.startedAt ? -1 : 1,
        );
        return [...inProgress(pairs), ...finished(pairs)];
      },
      { name: "works", equals: sameWorkRows },
    );
  },
);

/** ONE MEMO PER WORK — the seam every whole-collection reading of the works
 *  is folded from, so a reading's scope is N row memos and not N × every leaf
 *  of every record. A fold that walks the records itself subscribes to all of
 *  them, and then ONE work's answer changing re-runs the reading for all.
 *
 *  `mapArray` over the IDS, which are strings and so keyed by value: a work
 *  keeps its memo, its owner and its last answer across every publish that
 *  does not add or remove one. The record is read through a memo of its own,
 *  so the mirror's fresh `Map` per publish re-runs that one `get` and stops
 *  there — `of` runs again only when the record it was handed is replaced, or
 *  a leaf IT read moved.
 *
 *  A row reads `undefined` while its work is no longer in the mirror, which a
 *  reading drops: a row memo outlives its work by the moment between the
 *  record leaving and the id list being folded again. */
export const perWork = <T>(
  /** The reading's name in dev diagnostics; each row memo wears it with the
   *  id of the work it is about. */
  name: string,
  of: (id: WorkId, record: Work) => T,
): Accessor<ReadonlyArray<Accessor<T | undefined>>> => {
  const map = useWorkMap();
  const works = useWorks();
  const ids = createMemo(() => works().map(([id]) => id), {
    name: `${name}.ids`,
    equals: sameOrder,
  });
  return mapArray(
    ids,
    (id) => {
      const record = createMemo(() => map().get(id), {
        name: `${name}.record[${id}]`,
      });
      return createMemo(
        () => {
          const one = record();
          return one === undefined ? undefined : of(id, one);
        },
        { name: `${name}[${id}]` },
      );
    },
    { name },
  );
};

/** EVERY TERMINAL THAT IS IN A PIECE OF WORK, by its `<host>/<id>` ref — the
 *  one map, mirrored once. A ref that is not a key here is in no work; a ref
 *  that is names exactly one. */
export const useWorkMembers = createSharedRoot<
  Accessor<ReadonlyMap<string, WorkMember>>
>(() => mapOf(app.collections.workMembers.use(), "workMembers"));

/** THE MEMBERSHIP INDEX, derived once — terminal (`host/id`) to the work it is
 *  a member of, and WHO DRIVES it.
 *
 *  Every mark and every person-input site reads this: the dock row, the tile
 *  title, the column, the lock. One memo in one shared root, so a dock of
 *  twenty rows does not walk the works twenty times a frame, and the mark, the
 *  banner and the keystroke gate are the same answer by construction. */
export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const works = useWorkMap();
  const members = useWorkMembers();
  return createMemo(() => membershipOf(works(), members()), {
    name: "membership",
  });
});

/** HOW A MEMBER TERMINAL STANDS, by kolu's watch — ref to the level it was
 *  last read at and when it entered it. A terminal that is absent has not been
 *  read in this process, which is a different thing from "0s ago". */
export const useSeen = createSharedRoot<
  Accessor<ReadonlyMap<string, MemberReading>>
>(() => mapOf(app.collections.memberReadings.use(), "memberReadings"));

/** EACH WORK'S OWN PULL REQUEST, by work id — the forge's last answer for the
 *  work's branch, as kolu's watch read it. Absent while the work is not an
 *  open branch work, or its branch has not been read in this process. Read
 *  through `./workPr.ts` only. */
export const useWorkPrs = createSharedRoot<
  Accessor<ReadonlyMap<WorkId, PrResult>>
>(() => mapOf(app.collections.workPrs.use(), "workPrs"));

/** WHAT NEEDS THE HUMAN, read once for the whole app — `kolu-work`'s one
 *  reading over the works mirror. The "Needs you" group, the bell, the tab's
 *  and the OS badge's count, the phone's handle and the palette's rows all
 *  read THIS, so none of them can count a different thing. In the works'
 *  own order: oldest first.
 *
 *  ONE WORK AT A TIME ({@link perWork}): the reading each work is waiting on
 *  the human for is that work's own memo, and this list joins the answers. So
 *  a timeline that moves wakes its own work's reading and nothing else, and
 *  the list itself re-publishes only when an item joins, leaves or changes —
 *  the list every count in the app is taken from. */
export const useNeedsYou = createSharedRoot<Accessor<ReadonlyArray<NeedsYou>>>(
  () => {
    const rows = perWork("needsYou", (id, record) =>
      Option.getOrUndefined(needsYouOf(id, record)),
    );
    return createMemo(
      () => {
        const out: NeedsYou[] = [];
        for (const row of rows()) {
          const one = row();
          if (one !== undefined) out.push(one);
        }
        return out;
      },
      { name: "needsYou", equals: sameOrder },
    );
  },
);
