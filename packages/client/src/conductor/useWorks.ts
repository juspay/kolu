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
  type SetupAnswer,
  setupAnswersOf,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRow,
} from "kolu-work";
import { type Accessor, createMemo, mapArray } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";
import { workMentionOf, type WorkMention } from "./mentionCandidates";
import { type FileHolders, mergeHolders, pathsOf } from "./namedFiles";
import { mergeNotes, notesOfWork, type WorkNote } from "./quietChat";
import { type Joins, joinsOfWork, mergeJoins } from "./turnWorks";

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
 *  record leaving and the id list being folded again.
 *
 *  `equals` is what a reading that mints a CONTAINER per run (a work's notes,
 *  its joins, its setup answers) says to hold the previous one by: without
 *  it every publish that re-runs a row hands the fold a new-but-equal array
 *  and the fold re-publishes too, which is the whole saving undone. */
export const perWork = <T>(
  /** The reading's name in dev diagnostics; each row memo wears it with the
   *  id of the work it is about. */
  name: string,
  of: (id: WorkId, record: Work) => T,
  /** When two readings of ONE work are the same thing. A work that has left
   *  the mirror reads `undefined`, which is equal only to itself. */
  equals?: (a: T, b: T) => boolean,
): Accessor<ReadonlyArray<Accessor<T | undefined>>> => {
  const map = useWorkMap();
  const works = useWorks();
  const ids = createMemo(() => works().map(([id]) => id), {
    name: `${name}.ids`,
    equals: sameOrder,
  });
  const same =
    equals === undefined
      ? undefined
      : (a: T | undefined, b: T | undefined): boolean =>
          a === undefined || b === undefined ? a === b : equals(a, b);
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
        { name: `${name}[${id}]`, equals: same },
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

/** WHAT ONE PERSON CHOSE BEFORE, over the whole collection — the answers of
 *  every work, read one work at a time and joined. The memory a form opens
 *  on is `setupMemoryOf(useSetupAnswers()(), host)`: the host is the FORM's
 *  (a work's own), while the answers are the app's, so four faces of one ask
 *  share the fold instead of each walking every decision of every work. */
export const useSetupAnswers = createSharedRoot<
  Accessor<ReadonlyArray<SetupAnswer>>
>(() => {
  const rows = perWork(
    "setupAnswers",
    (_, record) => setupAnswersOf(record),
    (a, b) =>
      a.length === b.length &&
      a.every((one, at) => {
        const other = b[at];
        return (
          other !== undefined &&
          other.host === one.host &&
          other.key === one.key &&
          other.at === one.at &&
          other.value === one.value &&
          other.chosen === one.chosen &&
          other.model === one.model &&
          Option.getOrUndefined(other.harness) ===
            Option.getOrUndefined(one.harness)
        );
      }),
  );
  return createMemo(() => rows().flatMap((row) => row() ?? []), {
    name: "setupAnswers",
    equals: sameOrder,
  });
});

/** WHICH TERMINAL JOINED WHICH WORK, for the whole collection — the index a
 *  chat turn's terminals become works through, read work by work so a
 *  timeline that moves re-reads one work's events and not every work's. */
export const useJoins = createSharedRoot<Accessor<Joins>>(() => {
  const rows = perWork(
    "workJoins",
    joinsOfWork,
    (a, b) =>
      a.length === b.length &&
      a.every((one, at) => {
        const other = b[at];
        return (
          other !== undefined &&
          other.terminal === one.terminal &&
          other.work === one.work &&
          other.at === one.at
        );
      }),
  );
  return createMemo(() => mergeJoins(rows().map((row) => row() ?? [])), {
    name: "joins",
  });
});

/** EVERY NOTE THE CONDUCTOR WROTE ON ANY WORK, oldest first — what the
 *  transcript's folded turns say instead of a reply. Read work by work: a
 *  streamed chunk of the chat moves no work, and a work that moves re-reads
 *  only its own timeline. */
export const useAgentNotes = createSharedRoot<
  Accessor<ReadonlyArray<WorkNote>>
>(() => {
  const rows = perWork(
    "workNotes",
    (_, record) => notesOfWork(record),
    (a, b) =>
      a.length === b.length &&
      a.every((one, at) => {
        const other = b[at];
        return (
          other !== undefined && other.at === one.at && other.text === one.text
        );
      }),
  );
  return createMemo(() => mergeNotes(rows().map((row) => row() ?? [])), {
    name: "agentNotes",
    equals: sameOrder,
  });
});

/** WHICH WORK HOLDS WHICH FILE — what makes a path named in the prose a
 *  link. One work's paths are its own reading, so a work writing a file
 *  rebuilds the index without re-reading every other work's. */
export const useFileHolders = createSharedRoot<Accessor<FileHolders>>(() => {
  const rows = perWork(
    "workPaths",
    (id, record) => [id, pathsOf(record)] as const,
    ([id, paths], [otherId, otherPaths]) =>
      id === otherId &&
      paths.size === otherPaths.size &&
      [...paths].every((path) => otherPaths.has(path)),
  );
  return createMemo(
    () =>
      mergeHolders(
        rows().flatMap((row) => {
          const one = row();
          return one === undefined ? [] : [one];
        }),
      ),
    { name: "fileHolders" },
  );
});

/** EVERY WORK AS THE `@` MENU READS IT, in the works' own order — the title
 *  it is named by and where it stands, per work. The menu's own list adds
 *  what needs the human first and the words that tell two works apart, which
 *  are the composer's (its terminals' names are half of that question). */
export const useWorkMentions = createSharedRoot<
  Accessor<ReadonlyArray<WorkMention>>
>(() => {
  const rows = perWork(
    "workMention",
    workMentionOf,
    (a, b) =>
      a.work === b.work &&
      a.record === b.record &&
      a.title === b.title &&
      a.standing === b.standing,
  );
  return createMemo(
    () =>
      rows().flatMap((row) => {
        const one = row();
        return one === undefined ? [] : [one];
      }),
    { name: "workMentions", equals: sameOrder },
  );
});

/** THE BOARD'S TWO HALVES — what is running and what has finished, in the
 *  one order {@link useWorks} puts them in. Whether a work is still open is
 *  that work's own reading, so a timeline tick moves neither list and the
 *  column does not re-group for it. */
export const useWorkSplit = createSharedRoot<{
  readonly live: Accessor<ReadonlyArray<WorkRow>>;
  readonly done: Accessor<ReadonlyArray<WorkRow>>;
}>(() => {
  const rows = perWork(
    "workOpen",
    (id, record) => ({
      row: [id, record] as WorkRow,
      open: record.state.kind === "open",
    }),
    (a, b) =>
      a.open === b.open && a.row[0] === b.row[0] && a.row[1] === b.row[1],
  );
  const half = (
    open: boolean,
    name: string,
  ): Accessor<ReadonlyArray<WorkRow>> =>
    createMemo(
      () =>
        rows().flatMap((row) => {
          const one = row();
          return one === undefined || one.open !== open ? [] : [one.row];
        }),
      { name, equals: sameWorkRows },
    );
  return { live: half(true, "liveWorks"), done: half(false, "finishedWorks") };
});
