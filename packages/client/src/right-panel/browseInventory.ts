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

  // Rule 4 — emit each surviving overlay entry, substituting a directory that
  // has been loaded for the level that was read. Recursive because a load can
  // expose further directories that are THEMSELVES loaded (expand `blog/out/`,
  // then `blog/out/assets/`), and each of those must resolve too; the depth is
  // real directory nesting, so the stack is bounded where a spread of one
  // level's children into argument position is not (a flat cache directory
  // reaches six figures). `visited` still guards it: a self-referential cache
  // entry `{"out/": ["out/"]}` has to terminate, and a directory reached twice
  // is listed once.
  const overlay: string[] = [];
  const lazyDirs: string[] = [];
  // Loaded directories whose children REPLACED their key — the rows Pierre
  // still paints but `paths` no longer names, which `ignored` must carry so
  // they stay dimmed.
  const substituted: string[] = [];
  const visited = new Set<string>();
  const emit = (entry: string): void => {
    // Rule 2 again, for the OTHER source. A level read at click time can name a
    // path `listAll` has since claimed; admitting it duplicates the row, and
    // `pathDiffOperations` then emits two adds for one path — Pierre throws and
    // the recovery discards every hand-expanded folder.
    if (seen.has(entry)) return;
    if (!isDirectoryPath(entry)) {
      overlay.push(entry);
      return;
    }
    if (visited.has(entry)) return;
    visited.add(entry);
    // Every overlay directory is watchable, loaded or not — an unloaded one so
    // its first expand is reported, a loaded one so a reopen refetches.
    lazyDirs.push(entry);
    const children = loadedChildren?.get(entry);
    if (!children?.length) {
      // Not loaded, or loaded and genuinely EMPTY: either way there is nothing
      // to substitute, so the collapsed key stands — and it must, because
      // Pierre infers an ordinary folder from its children's path prefixes, so
      // with no children this trailing-slash key is the only thing in `paths`
      // naming the directory at all. Dropping it removes the row outright and
      // the user watches the folder they just clicked disappear. The empty case
      // is reachable with no race, because `git ls-files --others --ignored
      // --directory` lists a permanently-empty ignored directory in the overlay
      // directly.
      overlay.push(entry);
      return;
    }
    substituted.push(entry);
    for (const child of children) emit(child);
  };
  for (const entry of surviving) emit(entry);

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
