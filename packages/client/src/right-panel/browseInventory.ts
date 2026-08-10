import { hasPathUnderPrefix, isDirectoryPath } from "@kolu/solid-pierre/paths";

/** The browse tree's inventory merge — pure, so the three rules that have each
 *  already caused a bug are pinned by a table test rather than argued in a
 *  comment beside the reactive code.
 *
 *  The rules, and the defect each one closes:
 *
 *  1. **Absent is not empty.** While the tracked listing is in flight (a repo or
 *     host switch, first paint) there is no authority to subtract the overlay
 *     against. Reading that absence as "nothing is tracked" admitted the overlay
 *     unfiltered and painted the tree as nothing but dimmed `node_modules/` rows
 *     until `fs.listAll` landed. No authority ⇒ no partition, which makes rule 2
 *     true at EVERY instant rather than only at settled ones.
 *  2. **Tracked wins.** The two listings are separate `git ls-files` reads taken
 *     at different instants against a live working tree, so a file ignored
 *     between them (an agent editing `.gitignore`) can appear in BOTH — and a
 *     host-switch tick can retain a collapsed overlay dir (`.claude/`) while
 *     tracked still lists children under it. Exact-string overlap alone left
 *     that mixed inventory representable; Pierre then threw on a non-recursive
 *     remove and froze the Code tab. Drop exact overlaps **and** any
 *     trailing-slash overlay dir whose prefix still has tracked children — the
 *     tracked listing is the authority on that subtree.
 *  3. **Readiness covers both sources, but only the ones being consulted.** The
 *     overlay leg counts only while the toggle is on, because an idle
 *     `createPolledQuery` stays `pending` forever — folding an idle query's
 *     readiness in would wedge the tree permanently pending with the toggle off.
 *  4. **A loaded directory yields to its children.** The overlay's directory
 *     entries are COLLAPSED (`git ls-files --directory` reports a wholly-ignored
 *     directory as its name alone), which is what keeps `node_modules/` at one
 *     row. Pierre still renders that row with a working chevron, so expanding it
 *     opened onto nothing while the directory plainly held files (#2091). The
 *     Code tab answers an expand by reading ONE level and passing it here; the
 *     collapsed key then yields to what was read, and any child directory
 *     arrives collapsed in its own turn — so a deep ignored tree stays one cheap
 *     level per click instead of one enormous listing. Children are dropped
 *     unless their directory survived rules 1-2: a cache entry outliving its
 *     directory (a `.gitignore` edit, a deleted build output) must not resurrect
 *     rows, and a subtree tracked has since claimed belongs to tracked. A
 *     directory that reads back EMPTY keeps its own row rather than yielding to
 *     nothing — see the walk. */

export interface BrowseInventory {
  /** Everything the tree renders: tracked entries, then the overlay. */
  paths: string[];
  /** The rows to DIM — the overlay, plus every loaded directory's own key. A
   *  loaded directory has left `paths` (its children replaced it), but Pierre
   *  still paints the row from those children's prefixes and it is still
   *  ignored: omitting it here un-dims a folder at the exact moment the user
   *  opens it, with its children dimmed below. So this is a subset of the rows
   *  RENDERED, not of `paths`. */
  ignored: string[];
  /** The overlay's directory rows, whose children are NOT in `paths` until the
   *  user expands them. Handed to `<FileTree>` as `lazyDirectories` so it can
   *  report each expansion. A directory stays here after its children load, so
   *  reopening it refetches — nothing watches an ignored path, making
   *  collapse-and-reopen the only honest refresh gesture. */
  lazyDirs: string[];
  /** True while any consulted source has yet to deliver. */
  pending: boolean;
}

/** Rule 4's substitution walk — the ONE spelling, shared by both inventories.
 *
 *  Emits each entry, replacing a LOADED directory key with the level that was
 *  read for it (recursively, because a level can expose further loaded
 *  directories: expand `blog/out/`, then `blog/out/assets/`). The recursion is
 *  real directory nesting, so the stack is bounded where spreading one level's
 *  children into argument position is not (a flat cache directory reaches six
 *  figures), and `visited` bounds it further: a self-referential cache entry
 *  `{"out/": ["out/"]}` has to terminate, and a directory reached twice is
 *  listed once.
 *
 *  The four invariants, each with a bug behind it, live here and only here:
 *  a loaded key yields to its children; an ABSENT-or-EMPTY level keeps its own
 *  trailing-slash key (Pierre infers a folder row from its children's
 *  prefixes, so with no children that key is the only thing naming the
 *  directory — dropping it made the user watch the folder they just clicked
 *  disappear); every directory is reported lazy, loaded or not (unloaded so its
 *  first expand is reported, loaded so a reopen refetches); and `skip` lets a
 *  caller drop entries a higher authority has already claimed (rule 2 —
 *  admitting one duplicates the row, and `pathDiffOperations` then emits two
 *  adds for one path, which makes Pierre throw and discards every
 *  hand-expanded folder).
 *
 *  `substituted` names the loaded directories whose children REPLACED their key
 *  — rows Pierre still paints but `paths` no longer names. Only the git overlay
 *  has a use for them (they must stay dimmed); the plain-directory caller
 *  discards them, because without git there is no ignore authority to dim by. */
function substituteLoadedLevels(
  entries: readonly string[],
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  skip?: (entry: string) => boolean,
): { paths: string[]; lazyDirs: string[]; substituted: string[] } {
  const paths: string[] = [];
  const lazyDirs: string[] = [];
  const substituted: string[] = [];
  const visited = new Set<string>();
  const emit = (entry: string): void => {
    if (skip?.(entry)) return;
    if (!isDirectoryPath(entry)) {
      paths.push(entry);
      return;
    }
    if (visited.has(entry)) return;
    visited.add(entry);
    lazyDirs.push(entry);
    const children = loadedChildren?.get(entry);
    if (!children?.length) {
      paths.push(entry);
      return;
    }
    substituted.push(entry);
    for (const child of children) emit(child);
  };
  for (const entry of entries) emit(entry);
  return { paths, lazyDirs, substituted };
}

export function mergeBrowseInventory(
  tracked: readonly string[] | undefined,
  ignored: readonly string[] | undefined,
  /** One level of contents per expanded overlay directory, keyed by its
   *  trailing-slash folder key (rule 4). Absent until the user expands one. */
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  readiness: {
    trackedPending: boolean;
    ignoredPending: boolean;
    showIgnored: boolean;
  },
): BrowseInventory {
  const pending =
    readiness.trackedPending ||
    (readiness.showIgnored && readiness.ignoredPending);
  // Rule 1 — no tracked authority, no partition, so no overlay either.
  if (!tracked) return { paths: [], ignored: [], lazyDirs: [], pending };
  // Nothing to subtract against: skip building the membership set, which would
  // otherwise cost ~10x the rest of this function over a whole repo's file list
  // — paid on every inventory tick by every user with the toggle OFF, which is
  // the default. The spread stays: callers depend on a fresh reference (see
  // `treeInventory`'s note on the reconciled store's in-place mutation).
  if (!ignored?.length)
    return { paths: [...tracked], ignored: [], lazyDirs: [], pending };
  // Rule 2 — exact overlap and tracked-under-dir both belong to tracked.
  const seen = new Set(tracked);
  const surviving = ignored.filter((p) => {
    if (seen.has(p)) return false;
    if (isDirectoryPath(p) && hasPathUnderPrefix(p, tracked)) return false;
    return true;
  });

  // Rule 4 — the shared substitution walk, with rule 2 re-applied to the OTHER
  // source through `skip`: a level read at click time can name a path `listAll`
  // has since claimed. (The empty-level case is reachable with no race here,
  // because `git ls-files --others --ignored --directory` lists a
  // permanently-empty ignored directory in the overlay directly.)
  const {
    paths: overlay,
    lazyDirs,
    substituted,
  } = substituteLoadedLevels(surviving, loadedChildren, (e) => seen.has(e));

  return {
    paths: [...tracked, ...overlay],
    ignored: [...overlay, ...substituted],
    lazyDirs,
    pending,
  };
}

/** The ONE constructor for an inventory with no overlay — the diff views list
 *  CHANGED files, where a gitignored path can't appear, so there is no overlay
 *  and no collapsed directory to expand. Here rather than at the call site so a
 *  new `BrowseInventory` field can't be forgotten at a second builder. */
export function diffInventory(
  paths: string[],
  pending: boolean,
): BrowseInventory {
  return { paths, ignored: [], lazyDirs: [], pending };
}

/** Inventory for a PLAIN-DIRECTORY browse root (no git): the root's one-level
 *  listing plus one loaded level per expanded directory. EVERY directory entry
 *  is lazy — children are absent until the user expands it — and nothing is
 *  dimmed, because without git there is no ignore authority to dim by. The walk
 *  is `substituteLoadedLevels` — literally rule 4's, shared with the overlay
 *  merge rather than re-spelled here, so a fix to any of its four invariants
 *  lands once for both surfaces. */
export function directoryInventory(
  listing: readonly string[] | undefined,
  loadedChildren: ReadonlyMap<string, readonly string[]> | undefined,
  pending: boolean,
): BrowseInventory {
  // Absent is not empty (rule 1): no listing yet ⇒ nothing to paint.
  if (!listing) return { paths: [], ignored: [], lazyDirs: [], pending };
  // The SAME walk the overlay uses, minus the partition: no `skip` (there is no
  // second authority to yield to) and `substituted` discarded (nothing to dim
  // without git).
  const { paths, lazyDirs } = substituteLoadedLevels(listing, loadedChildren);
  return { paths, ignored: [], lazyDirs, pending };
}
