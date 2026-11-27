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
  endedAt,
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
import {
  type Accessor,
  createMemo,
  createProjection,
  deep,
  mapArray,
  type Store,
} from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { foldEach, joinRows } from "../wideFold";
import { app } from "../wire";
import { workMentionOf, type WorkMention } from "./mentionCandidates";
import { sameItems } from "./sameItems";
import { type FileHolders, mergeHolders, pathsOf } from "./namedFiles";
import { mergeNotes, notesOfWork, type WorkNote } from "./quietChat";
import { type Joins, joinsOfWork, mergeJoins } from "./turnWorks";
import { createWorkRecord } from "./workRecord";

/** ONE BOUND COLLECTION, AS A MAP — the mirrors below are the same few lines
 *  over four collections: walk the keys, read each row's accessor, drop the
 *  ones that have not folded yet. Said once here, module-locally: the
 *  pattern also appears in client modules that mirror quite different things,
 *  and a shared primitive would claim a kinship those do not have.
 *
 *  A row is `undefined` twice over — no accessor for that key yet, or an
 *  accessor whose frame has not landed — and the map carries neither, so `V`
 *  is inferred as the ROW's type rather than the row-or-nothing the binding
 *  hands out.
 *
 *  ONE MEMO PER KEY, JOINED IN CHUNKS ({@link foldEach}), and not one memo
 *  reading every key: a single fold over the binding's per-key accessors is
 *  `1 + N` sources, which the development build judges past 200
 *  (`WIDE_SCOPE_DEPS`) at about 199 entries — reached by a browser that has
 *  been open for days (works are never capped while they are open) and by a
 *  fleet of member terminals. The join is two levels deep instead, so no
 *  scope here holds more than a chunk's worth of rows, and ONE entry moving
 *  re-runs its own row and its chunk rather than the whole mirror. */
const mapFrom = <K extends string, V>(
  /** The fold's name in dev diagnostics — one shape serves every mirror, so
   *  the collection it folds is the caller's to say. */
  name: string,
  keys: Accessor<ReadonlyArray<K>>,
  read: (key: K) => V | undefined,
): Accessor<ReadonlyMap<K, V>> => {
  const entries = foldEach<K, readonly [K, V]>(
    `${name}.entries`,
    keys,
    (key) => {
      const one = read(key);
      return one === undefined ? undefined : ([key, one] as const);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return createMemo(() => new Map(entries()), { name });
};

/** The same, for a binding this module holds nothing else of: its key list
 *  and its per-key accessors, folded as above.
 *
 *  EACH VALUE IS A SNAPSHOT (`deep`): these three mirrors are small records
 *  whose readers FOLD them — the membership index walks every member's work
 *  and role, a card reads a reading's level and its stamp — and a field read
 *  off a subscription's store proxy is a source on the READER'S scope, so a
 *  fold over the map is as wide as the collection however narrow the map
 *  itself is. `deep` costs the row two sources and hands back the same
 *  object while the record has not moved, so a reader's identity gate still
 *  holds. */
const mapOf = <K extends string, V extends object>(
  bound: {
    keys: Accessor<ReadonlyArray<K>>;
    byKey: (key: K) => Accessor<V | undefined> | undefined;
  },
  name: string,
): Accessor<ReadonlyMap<K, V>> =>
  mapFrom(name, keyListOf(bound.keys, `${name}.keys`), (key) => {
    const one = bound.byKey(key)?.();
    return one === undefined ? undefined : deep(one);
  });

/** A BINDING'S KEYS AS A PLAIN LIST. The binding hands out the keys STREAM'S
 *  own store array (`surface/src/solid/surfaceClient.ts` opens it as a
 *  subscription, `createSubscription.ts:686,713`), and iterating a store
 *  array in user code costs its `length` leaf plus one index leaf per entry
 *  — the whole collection, on whatever scope walks it. `mapArray` reads the
 *  container instead and iterates its backing untracked, which is TWO
 *  sources however many keys there are, so every reading below walks a
 *  plain array and nothing pays per key for merely knowing the membership. */
const keyListOf = <K>(
  keys: Accessor<ReadonlyArray<K>>,
  name: string,
): Accessor<ReadonlyArray<K>> => mapArray(keys, (key) => key, { name });

/** THE WORKS COLLECTION ITSELF, bound once for the app — the seam the three
 *  readings below take their own shape from.
 *
 *  Bare `.use()`: the collection DECLARES its own `onError` policy (a toast
 *  labelled `Works`) on the spec, so the use-site carries none, and its
 *  default keys stream is the server's own — every work, no narrowing. */
const useWorkCollection = createSharedRoot(() => app.collections.works.use());

/** WHICH WORKS THERE ARE, and nothing about them — the membership every
 *  ordering and every per-work fold is keyed by, as a PLAIN list
 *  ({@link keyListOf}): TWO sources for any number of works, and no record
 *  read at all. */
export const useWorkKeys = createSharedRoot<Accessor<ReadonlyArray<WorkId>>>(
  () => keyListOf(useWorkCollection().keys, "workKeys"),
);

/** ONE WORK, BY THE ID IT IS FILED UNDER — a READ, taken in whatever scope
 *  asks: the binding's own per-key memo plus that subscription's stored
 *  value (`surface/src/solid/useCollection.ts:178`,
 *  `createSubscription.ts:713`), so TWO sources for one work and none for
 *  any other. A face drawing one work stops waking for every other work's
 *  frame as well as stopping being part of a fold as wide as the collection.
 *
 *  CAVEAT, WRITTEN DOWN BECAUSE IT IS REAL: the binding's `lookups` cache
 *  never evicts (`useCollection.ts:129,180-183`). One per-key memo survives
 *  per id ever looked up — its upstream subscription does die with the key
 *  (`:131-140`), so what is retained is the memo, not a stream. Bounded by
 *  the distinct work ids one session sees, and strictly cheaper than a
 *  mirror-wide re-fold per publish. */
export const useWorkAt = (id: WorkId): Work | undefined =>
  useWorkCollection().byKey(id)?.();

/** THE WORKS BY ID, mirrored once for the whole app — what the two readings
 *  that genuinely need every record at once take (the chat's turns, and the
 *  transcript's reason to put the scroller back). A reader after ONE work
 *  asks {@link useWorkAt} instead. */
export const useWorkMap = createSharedRoot<Accessor<ReadonlyMap<WorkId, Work>>>(
  () => mapFrom("workMap", useWorkKeys(), useWorkAt),
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

/** THE ORDER THE WORKS ARE KEPT IN — the ids alone, oldest first by when
 *  each one STARTED. The membership every per-work reading below is keyed
 *  by, and ONE source for any number of works.
 *
 *  The keys arrive as a SET — arrival order is not a fact about the works —
 *  so they are sorted by when each work started, which is what makes "oldest
 *  first" true of a browser that joined mid-run as well as of one that was
 *  there from the start.
 *
 *  WHEN A WORK STARTED IS READ IN THAT WORK'S OWN ROW, one stamp per row and
 *  the stamps joined in chunks, so this memo sorts a PLAIN list and holds
 *  one source whatever the fleet's size. Reading the stamps here instead is
 *  what put three store leaves per work on one scope, and 205 of them past
 *  the development build's 200-source judge in a real session.
 *
 *  A row's stamp is TRACKED, not read untracked behind the key list: a key
 *  arrives before the record under it does (the keys stream and the per-key
 *  streams are separate subscriptions), so an ordering that only woke for
 *  membership would file every newly arrived work under no stamp at all and
 *  never correct itself. `startedAt` never changes once it is there
 *  (`packages/work/src/record.ts:250`; a re-key makes a NEW id), so a row
 *  re-runs when its work's record first lands and then not again. */
const useWorkStarts = createSharedRoot<
  Accessor<ReadonlyArray<readonly [WorkId, string]>>
>(() =>
  foldEach<WorkId, readonly [WorkId, string]>(
    "workStarts",
    useWorkKeys(),
    (id) => {
      const one = useWorkAt(id);
      return one === undefined ? undefined : ([id, one.startedAt] as const);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  ),
);

const useWorkOrder = createSharedRoot<Accessor<ReadonlyArray<WorkId>>>(() => {
  const starts = useWorkStarts();
  return createMemo(
    () =>
      starts()
        .toSorted((a, b) => (a[1] < b[1] ? -1 : 1))
        .map(([id]) => id),
    { name: "workOrder", equals: sameItems },
  );
});

/** THE WORKS, in the order every reader draws them: in progress oldest first
 *  (a card keeps its place), then the finished ones most recently ended
 *  first.
 *
 *  THE JOIN OF THE BOARD'S TWO HALVES ({@link useWorkSplit}), which is where
 *  the split and the ending-stamp sort live: whether a work is open and when
 *  it ended are read off that work's own SNAPSHOT, so this list carries two
 *  sources however many works there are. */
export const useWorks = createSharedRoot<Accessor<ReadonlyArray<WorkRow>>>(
  () => {
    const { live, done } = useWorkSplit();
    return createMemo(() => [...live(), ...done()], {
      name: "works",
      equals: sameWorkRows,
    });
  },
);

/** ONE SNAPSHOT PER WORK, read once for the whole app — the shared record
 *  ({@link createWorkRecord}) every whole-collection reading folds.
 *
 *  A fold over a work read off the STORE subscribes every leaf it touches:
 *  about five nodes an event, so a work with a hundred events puts one
 *  reading's row over five hundred sources on its own — the `WIDE_SCOPE_DEPS`
 *  the per-work split exists to remove, moved rather than removed. The
 *  snapshot is one node per event and per decision, read ONCE here and
 *  handed to all six readings, so a reading's row carries ONE dependency and
 *  the record is subscribed once for the app rather than once per reading.
 *
 *  The map is minted per id-list change only — its entries are the row
 *  accessors `mapArray` keeps, not their values — so a work whose timeline
 *  moves does not re-publish this map and so does not touch another work's
 *  rows. Its ids are the MEMBERSHIP order ({@link useWorkOrder}), not the
 *  published list: the published list is folded from these rows, and taking
 *  them from it would be a cycle. */
export const useWorkRecords = createSharedRoot<
  Accessor<ReadonlyMap<WorkId, Accessor<Work | undefined>>>
>(() => {
  const rows = mapArray(
    useWorkOrder(),
    (id) => {
      const held = createMemo(() => useWorkAt(id), {
        name: "workRecords.record",
      });
      return [id, createWorkRecord(held)] as const;
    },
    { name: "workRecordsByWork" },
  );
  return createMemo(() => new Map(rows()), { name: "workRecords" });
});

/** EVERY WORK'S SNAPSHOT AT ONCE, joined in chunks — for the one reading
 *  that genuinely needs every record together ({@link useMembershipIndex}:
 *  a terminal's membership is a fact about its work, found by work id).
 *  Folded off the per-work snapshots, so no scope here reads a leaf of a
 *  record and nothing grows with the length of a timeline. */
const useWorkSnapshots = createSharedRoot<Accessor<ReadonlyMap<WorkId, Work>>>(
  () => {
    const records = useWorkRecords();
    return mapFrom("workSnapshots", useWorkOrder(), (id) =>
      records().get(id)?.(),
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
  /** The reading's name in dev diagnostics: the `mapArray`'s, with its row
   *  memos under it. One name per site — no work id is baked into any of
   *  them, or one reading would become N fold keys carrying repo paths and
   *  branch names. */
  name: string,
  /** ONE WORK'S READING. `record` is the shared SNAPSHOT
   *  ({@link useWorkRecords}): fold that, and the row carries one dependency
   *  it is what puts a row over the wide-scope threshold. */
  of: (id: WorkId, record: Work, held: Work) => T,
  /** When two readings of ONE work are the same thing. A work that has left
   *  the mirror reads `undefined`, which is equal only to itself. */
  equals?: (a: T, b: T) => boolean,
): Accessor<ReadonlyArray<Accessor<T | undefined>>> => {
  const records = useWorkRecords();
  const same =
    equals === undefined
      ? undefined
      : (a: T | undefined, b: T | undefined): boolean =>
          a === undefined || b === undefined ? a === b : equals(a, b);
  return mapArray(
    useWorkOrder(),
    (id) => {
      const held = createMemo(() => useWorkAt(id), {
        name: `${name}.record`,
      });
      const record = createMemo(() => records().get(id)?.(), {
        name: `${name}.snapshot`,
      });
      return createMemo(
        () => {
          const one = record();
          const live = held();
          return one === undefined || live === undefined
            ? undefined
            : of(id, one, live);
        },
        { name: `${name}.row`, equals: same },
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
 *  title, the column, the lock. One derivation in one shared root, so a dock
 *  of twenty rows does not walk the works twenty times a frame, and the mark,
 *  the banner and the keystroke gate are the same answer by construction.
 *
 *  A PROJECTION, not a `Map` memo, and that is the difference between twenty
 *  rows waking and one: `membershipOf` folds the whole collection again on any
 *  change to any work or any member and mints a fresh `Membership` per
 *  terminal, so a `Map` of them hands every reader a new object for an
 *  unchanged membership. The reconcile channel commits the fold per key
 *  instead — a terminal whose membership did not move keeps the very object
 *  its readers hold, one whose role or driver moved wakes only its own
 *  readers, and a terminal that left the works reads `undefined`.
 *
 *  FOLDED OFF THE SNAPSHOTS ({@link useWorkSnapshots}), never the store's own
 *  records: `driverOf` walks a member's work BACKWARDS to the event it
 *  joined at, reading about four leaves per event it crosses, so one work
 *  with a member and fifty events put this one scope past the development
 *  build's 200-source judge. Over the snapshots it is TWO sources — the
 *  joined records and the members — however long any timeline grows. */
const useMembershipIndex = createSharedRoot<Store<Record<string, Membership>>>(
  () => {
    const works = useWorkSnapshots();
    const members = useWorkMembers();
    return createProjection<Record<string, Membership>>(
      () => Object.fromEntries(membershipOf(works(), members())),
      null,
      { name: "membership" },
    );
  },
);

/** IS THIS ONE TERMINAL IN A PIECE OF WORK, and whose is it — the reading a
 *  mark, a lock or any other per-terminal face takes. Reads ONE key of the
 *  index, so the other nineteen rows of a dock are not its dependency.
 *
 *  The ref is an ACCESSOR because a face is handed it as a prop and a tile
 *  can be pointed at another terminal without remounting. */
export const useMembershipAt = (
  terminal: Accessor<string>,
): Accessor<Membership | undefined> => {
  const index = useMembershipIndex();
  return () => index[terminal()];
};

/** THE WHOLE INDEX AS A MAP — for the folds that genuinely need every
 *  membership at once (the composer's mention candidates, the attention
 *  index, the names of a work's terminals). Re-publishes when a terminal
 *  joins or leaves; a membership that only MOVES is read through the kept
 *  entry, so this fold does not re-run for it.
 *
 *  ONE ROW MEMO PER TERMINAL, JOINED IN CHUNKS, and each row hands out a
 *  SNAPSHOT (`deep`) of its entry rather than the projection's proxy. Both
 *  halves of that matter: a single fold over every key is `1 + N` sources,
 *  and a reader that then walks the entries (`./memberNames.ts`' names,
 *  through `memberDetail`) adds two or three leaf reads per terminal to ITS
 *  own scope, which crosses 200 at about seventy members. A row that has
 *  not moved is handed back the same object, so the identity a reader
 *  compares memberships by is kept. */
export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const index = useMembershipIndex();
  const refs = createMemo(() => Object.keys(index), {
    name: "membershipRefs",
    equals: sameItems,
  });
  return mapFrom("membershipMap", refs, (ref) => {
    const one = index[ref];
    return one === undefined ? undefined : deep(one);
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
  () =>
    joinRows(
      "needsYou",
      perWork("needsYouByWork", (id, record) =>
        Option.getOrUndefined(needsYouOf(id, record)),
      ),
    ),
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
    "setupAnswersByWork",
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
  const joined = joinRows("setupAnswers.rows", rows);
  return createMemo(() => joined().flat(), {
    name: "setupAnswers",
    equals: sameItems,
  });
});

/** WHICH TERMINAL JOINED WHICH WORK, for the whole collection — the index a
 *  chat turn's terminals become works through, read work by work so a
 *  timeline that moves re-reads one work's events and not every work's. */
export const useJoins = createSharedRoot<Accessor<Joins>>(() => {
  const rows = perWork(
    "workJoinsByWork",
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
  const joined = joinRows("joins.rows", rows);
  return createMemo(() => mergeJoins(joined()), { name: "joins" });
});

/** EVERY NOTE THE CONDUCTOR WROTE ON ANY WORK, oldest first — what the
 *  transcript's folded turns say instead of a reply. Read work by work: a
 *  streamed chunk of the chat moves no work, and a work that moves re-reads
 *  only its own timeline. */
export const useAgentNotes = createSharedRoot<
  Accessor<ReadonlyArray<WorkNote>>
>(() => {
  const rows = perWork(
    "agentNotesByWork",
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
  const joined = joinRows("agentNotes.rows", rows);
  return createMemo(() => mergeNotes(joined()), {
    name: "agentNotes",
    equals: sameItems,
  });
});

/** WHICH WORK HOLDS WHICH FILE — what makes a path named in the prose a
 *  link. One work's paths are its own reading, so a work writing a file
 *  rebuilds the index without re-reading every other work's. */
export const useFileHolders = createSharedRoot<Accessor<FileHolders>>(() => {
  const rows = perWork(
    "fileHoldersByWork",
    (id, record) => [id, pathsOf(record)] as const,
    ([id, paths], [otherId, otherPaths]) =>
      id === otherId &&
      paths.size === otherPaths.size &&
      [...paths].every((path) => otherPaths.has(path)),
  );
  const joined = joinRows("fileHolders.rows", rows);
  const order = useWorks();
  return createMemo(
    () => {
      // IN THE PUBLISHED ORDER: the works holding one path are the `choose`
      // offer a person picks from (`./namedFiles.ts`), so they are emitted
      // the way the board draws them and not in the membership order the
      // rows are folded in.
      const paths = new Map(joined());
      return mergeHolders(
        order().flatMap(([id]) => {
          const one = paths.get(id);
          return one === undefined ? [] : [[id, one] as const];
        }),
      );
    },
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
    "workMentionsByWork",
    workMentionOf,
    (a, b) =>
      a.work === b.work &&
      a.record === b.record &&
      a.title === b.title &&
      a.standing === b.standing,
  );
  const joined = joinRows("workMentions.rows", rows);
  const order = useWorks();
  return createMemo(
    () => {
      // IN THE WORKS' OWN ORDER: the menu keeps the order it is given
      // (`./mentionCandidates.ts` only moves what needs the human to the
      // front), so the rows are emitted the way the board draws them.
      const byWork = new Map(joined().map((one) => [one.work, one]));
      return order().flatMap(([id]) => {
        const one = byWork.get(id);
        return one === undefined ? [] : [one];
      });
    },
    { name: "workMentions", equals: sameItems },
  );
});

/** THE BOARD'S TWO HALVES — what is running and what has finished, and the
 *  open works that are only WATCHES. Whether a work is still open, when it
 *  ended and what kind of key it has are that work's own reading off its
 *  SNAPSHOT, so a timeline tick moves no list and no leaf of a record is
 *  read on a scope as wide as the collection.
 *
 *  THE ORDER LIVES HERE: the rows arrive in the membership order (oldest
 *  start first), the running half keeps it, and the finished half is sorted
 *  by its ending stamp, most recently ended first. {@link useWorks} is the
 *  two halves joined, which is the one order every reader draws. */
export const useWorkSplit = createSharedRoot<{
  readonly live: Accessor<ReadonlyArray<WorkRow>>;
  readonly done: Accessor<ReadonlyArray<WorkRow>>;
  /** The open works that are watches — the column's third group, carried
   *  here because the kind of a work's key is a leaf of its record and a
   *  column reading it per row would be as wide as the board. */
  readonly watching: Accessor<ReadonlySet<WorkId>>;
}>(() => {
  const rows = perWork(
    "workOpenByWork",
    (id, record, held) => ({
      row: [id, held] as WorkRow,
      open: record.state.kind === "open",
      watch: record.key.kind === "watch",
      ended: Option.getOrElse(endedAt(record), () => record.startedAt),
    }),
    (a, b) =>
      a.open === b.open &&
      a.watch === b.watch &&
      a.ended === b.ended &&
      a.row[0] === b.row[0] &&
      a.row[1] === b.row[1],
  );
  const joined = joinRows("workSplit.rows", rows);
  const live = createMemo(
    () => joined().flatMap((one) => (one.open ? [one.row] : [])),
    { name: "liveWorks", equals: sameWorkRows },
  );
  const done = createMemo(
    () =>
      joined()
        .filter((one) => !one.open)
        .toSorted((a, b) => (a.ended < b.ended ? 1 : -1))
        .map((one) => one.row),
    { name: "finishedWorks", equals: sameWorkRows },
  );
  const watching = createMemo(
    () =>
      new Set(
        joined().flatMap((one) => (one.open && one.watch ? [one.row[0]] : [])),
      ),
    {
      name: "watchingWorks",
      equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
    },
  );
  return { live, done, watching };
});
