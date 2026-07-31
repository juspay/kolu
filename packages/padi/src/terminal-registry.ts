/**
 * Terminal registry — the `Map<TerminalId, TerminalProcess>`, the pure
 * read/write accessors around it, the PARENT-EDGE queries over it
 * (`isPaintableParent`, `firstChildOf`), and the ONE parent-edge POLICY
 * (`requireFlatParentEdge`) both generative writes share. Parent-edge reads
 * live here so no caller walks `terminalEntries()` for the graph itself.
 *
 * Endpoint-agnostic: the `TerminalEndpoint` writes to the same registry
 * so consumers downstream (router, surface) iterate one place regardless
 * of which endpoint owns the terminal. Per-endpoint internal state (PTY
 * handle, provider cleanups for `LocalTerminalEndpoint`) stays inside the
 * endpoint itself, not on `TerminalProcess`.
 */

import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import type { TerminalHandle } from "./endpoint.ts";
import type {
  AuthoredActiveTerminal,
  AuthoredParkedTerminal,
  AuthoredSleepingTerminal,
  TerminalInfo,
} from "./vocab.ts";

/** An ACTIVE terminal process — a running PTY with its live control surface.
 *  `info` is the wire shape sent in the `terminalList` cell snapshot; `meta` is
 *  the active arm, mutated in place by the owning endpoint's providers and
 *  published via the `authored` collection from
 *  `terminalEndpoint/metadata.ts`; `handle` is the abstract control surface
 *  (write / resize / screen state — NO `dispose()`, the endpoint's
 *  `killTerminal` is the sole termination path). */
export interface ActiveTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredActiveTerminal;
  /** The terminal's last-seen `TerminalSnapshot` (cwd · git · pr · agent · foreground),
   *  born and dropped WITH the entry. A required field, so "a terminal exists" and
   *  "its snapshot exists" are one fact the type makes inseparable — no second
   *  Map to keep in lockstep. kolu's fold REPLACES it wholesale each frame
   *  (`entry.snapshot = next.snapshot`); there is no in-place mutator. */
  snapshot: TerminalSnapshot;
  handle: TerminalHandle;
}

/** A SLEEPING terminal process — the SAME registry entry under the SAME stable
 *  id, but with its PTY/handle and live overlay released. Its metadata is the
 *  sleeping arm (persisted base + `sleptAt`), so there is no `handle` — the live
 *  resource is **absent by type**, which is the plan's safety invariant: a
 *  sleeping terminal can sit in the one registry (and thus ride the `terminalList`
 *  cell + the `authored` collection with nothing extra), yet the compiler
 *  refuses any code that reaches for its PTY handle without first narrowing.
 *  `handle?: never` keeps the field accessible on the union so `entry.handle`
 *  truthiness narrows a `TerminalProcess` to the active arm in one idiom. */
export interface SleepingTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredSleepingTerminal;
  /** The last-seen `TerminalSnapshot` rides the sleeping entry too (sleep does NOT drop
   *  it) — the dormant tile recomposes its cwd/branch/pr off the restore-relevant
   *  projection, and wake reads the resume target (the frozen agent identity) back
   *  from here. The agent detail + foreground are dead data while sleeping (the
   *  client's join takes only the restore-relevant projection). */
  snapshot: TerminalSnapshot;
  handle?: never;
}

/** A PARKED terminal process — a reboot-killed ACTIVE record padi's boot
 *  reconcile parks: the host died, so the PTY/handle is gone (`handle?: never`,
 *  the same by-type liveness fence the sleeping arm uses), but the record
 *  survives so the restore card can bring the terminal back. Its metadata is the
 *  authored parked arm (persisted base + `parkedAt`). PRODUCED at boot from a
 *  saved active record, NEVER persisted — `snapshotSession` skips it — and
 *  CONSUMED at restore (`restoreSession` re-spawns a fresh active PTY and drops
 *  the parked entry, the parked→active flip that is the restore idempotency
 *  token). The client filters it out of the tile set, so a parked record never
 *  renders as a canvas tile; only the restore card reads it. */
export interface ParkedTerminalProcess {
  info: TerminalInfo;
  meta: AuthoredParkedTerminal;
  /** The restore-relevant `TerminalSnapshot` (cwd · git · pr) carried over from
   *  the parked active record, so the restore card recomposes its cwd / branch /
   *  pr off it — the agent detail + foreground are dead data while parked. */
  snapshot: TerminalSnapshot;
  handle?: never;
}

/** The one registry's value — `Terminal = active | sleeping | parked` made
 *  concrete as a process. Sleep flips an active entry to a sleeping one IN PLACE
 *  (same id, same map slot, persisted base preserved, live overlay + handle
 *  released); wake flips it back by re-spawning. `parked` is a boot-produced arm:
 *  the reboot no-survivor path parks each saved active record so the restore card
 *  can re-spawn it. Presence reads the union off the map; liveness narrows to
 *  `ActiveTerminalProcess` via `entry.handle` (or `getActiveTerminal`) — a
 *  sleeping OR parked entry has no handle by type. */
export type TerminalProcess =
  | ActiveTerminalProcess
  | SleepingTerminalProcess
  | ParkedTerminalProcess;

const terminals = new Map<TerminalId, TerminalProcess>();

/** Insert/replace a terminal entry in the registry. */
export function registerTerminal(id: TerminalId, entry: TerminalProcess): void {
  terminals.set(id, entry);
}

/** Remove a terminal by id. Returns true if the entry was present. */
export function unregisterTerminal(id: TerminalId): boolean {
  return terminals.delete(id);
}

/** Snapshot + clear. Used by `killAllTerminals` where the caller needs
 *  to dispose each handle AFTER the map is empty (so onExit callbacks
 *  can't find the entry and trigger session saves). Returning the
 *  entries keeps the clear-then-dispose ordering in the caller rather
 *  than forcing it into the registry API. */
export function drainTerminals(): TerminalProcess[] {
  const entries = [...terminals.values()];
  terminals.clear();
  return entries;
}

/** Entries in canonical `Map` insertion order — the client's display
 *  ordering for the terminal list. */
export function terminalEntries(): IterableIterator<
  [TerminalId, TerminalProcess]
> {
  return terminals.entries();
}

/** Current terminals in their canonical `Map` insertion order.
 *
 *  Insertion order is the ordering model — new terminals append to the
 *  tail. Clients render this order directly; within-group pill
 *  ordering is a separate spatial sort driven by saved canvas layouts. */
export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((entry) => entry.info);
}

/** Project the registry into a `Map<id, V>` for a surface collection's `readAll`
 *  — one loop over the entries in canonical insertion order, with `pick` choosing
 *  the half. The `authored` and `terminalWorkspace.snapshots` collections both
 *  read off the SAME registry entry (Design-S: the two halves share one backing),
 *  so this keeps the projection loop in one place instead of copied per
 *  collection. */
export function registryMap<V>(
  pick: (entry: TerminalProcess) => V,
): Map<string, V> {
  const map = new Map<string, V>();
  for (const [id, entry] of terminals) map.set(id, pick(entry));
  return map;
}

/** The ids of every PARKED registry entry, in canonical insertion order. Parked
 *  records are boot-produced restore-card rows that linger invisibly until either
 *  consumed by `session.restore` (the parked→active flip) or FORFEITED — the user
 *  creates a fresh terminal instead of restoring. The forfeit path
 *  (`discardAllParked`) enumerates them here so a plain create can't leave parked
 *  entries lingering forever. Snapshots into an array so a caller can discard while
 *  iterating without mutating the live map mid-walk. */
export function parkedTerminalIds(): TerminalId[] {
  const ids: TerminalId[] = [];
  for (const [id, entry] of terminals)
    if (entry.meta.state === "parked") ids.push(id);
  return ids;
}

/** Does the registry hold ANY parked entry — i.e. is a restore still PENDING? The
 *  autosave reads this to freeze the saved blob while parked entries stand in for
 *  it: a parked record is not persisted (`snapshotSession` skips it), so an autosave
 *  firing while parked entries linger would persist a snapshot that OMITS them and
 *  shrink the saved session on disk (the restore source of truth) — the PATH-B data
 *  loss. Cheap early-out over the map (stops at the first parked entry). */
export function hasParkedTerminals(): boolean {
  for (const entry of terminals.values())
    if (entry.meta.state === "parked") return true;
  return false;
}

/** Number of registry RECORDS — active + sleeping. Cheap counter; the registry
 *  size. NOT a live-process count: a sleeping record holds no PTY/sensors/xterm,
 *  so heap diagnostics that correlate a column with live-terminal memory must use
 *  `activeTerminalCount` instead (F9). */
export const terminalCount = (): number => terminals.size;

/** Number of LIVE terminal processes — entries with a PTY handle (the active
 *  arm). This is the count that tracks live-terminal heap (sensors, taps, the
 *  headless mirror); the heap diagnostic reports THIS, not `terminalCount`, so a
 *  pile of dormant records can't read as live processes (F9). */
export const activeTerminalCount = (): number => {
  let n = 0;
  for (const entry of terminals.values()) if (entry.handle) n++;
  return n;
};

/** Number of ACTIVE terminals currently hosting a Claude Code session. The
 *  `agent` field lives on the entry's `awareness` (Design-S), so this reads
 *  `entry.snapshot.agent` rather than `entry.meta`; the `state === "active"` gate
 *  stays, since a sleeping terminal's snapshot keeps its frozen-stale live half
 *  (sleep does not reset it). Exported for diagnostics. */
export function countActiveClaudeSessions(): number {
  let n = 0;
  for (const entry of terminals.values()) {
    if (
      entry.meta.state === "active" &&
      entry.snapshot.agent?.kind === "claude-code"
    )
      n++;
  }
  return n;
}

export function getTerminal(id: TerminalId): TerminalProcess | undefined {
  return terminals.get(id);
}

/** The last-seen `TerminalSnapshot` for `id`, or `undefined` if no entry exists —
 *  projected off the registry entry (snapshot is a required field, so it is born
 *  and dropped WITH the entry; there is no separate store to fall out of lockstep).
 *  kolu's fold REPLACES `entry.snapshot` wholesale each frame, so callers read it
 *  as an immutable snapshot — there is no in-place mutator (the old apply-and-read-
 *  back contract is gone with the sink). */
export function snapshotFor(id: TerminalId): TerminalSnapshot | undefined {
  return terminals.get(id)?.snapshot;
}

/** Narrow a registry lookup to its ACTIVE arm — the entry only if it is a live
 *  PTY (`handle` present). The single seam every handle-touching path (attach,
 *  resize, sendInput, kill, screen reads) uses so a sleeping terminal can never
 *  be driven as a live one: a sleeping id yields `undefined` here, exactly as an
 *  absent id does. The `entry?.handle` truthiness check narrows the union to
 *  `ActiveTerminalProcess` with no cast. */
export function getActiveTerminal(
  id: TerminalId,
): ActiveTerminalProcess | undefined {
  const entry = terminals.get(id);
  return entry?.handle ? entry : undefined;
}

/** `getActiveTerminal` or throw the typed not-found fault — for handlers where a
 *  missing terminal must surface LOUDLY (e.g. attach, screen reads, file uploads).
 *  A sleeping or absent id is "not found" to them by the same code, since neither
 *  can take the operation. NOTE: the
 *  fire-and-forget stream ops (`resize`, `sendInput`) deliberately do NOT use this —
 *  a late call landing just after a kill is an expected race, so they take the
 *  quiet `getActiveTerminal(input.id)?.handle.x()` path and drop it (#1628). */
export function requireActiveTerminal(id: TerminalId): ActiveTerminalProcess {
  const entry = getActiveTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

/** Get a terminal (active, sleeping, or parked) or throw the typed not-found
 *  fault — padi's own presence guard over the full 3-arm registry union, shared
 *  by the chrome setters. The exact sibling of `requireActiveTerminal`: same
 *  `terminalNotFound`, but it accepts a dormant record (a chrome edit — theme /
 *  intent / layout — is valid on a sleeping or parked terminal), so it narrows to
 *  the presence union (`TerminalProcess`), not the active arm. */
export function requireTerminal(id: TerminalId): TerminalProcess {
  const entry = getTerminal(id);
  if (!entry) throw terminalNotFound(id);
  return entry;
}

/** Get a terminal that is MUTABLE — present AND not PARKED — or throw the typed
 *  not-found fault. A PARKED record is an IMMUTABLE restore-card placeholder: it
 *  stands in for a saved active terminal until `session.restore` consumes it (the
 *  parked→active flip). A client chrome mutation targeting one — `setParent`,
 *  `setSubPanel`, `setCanvasLayout`, `setTheme`, `setIntent`, `setRightPanel` — is
 *  a STALE write from a supervised restart's drain window (the client's list-driven
 *  reconcile promoting a split's sub the drain just removed), and it MUST reject:
 *  silently un-parenting a parked sub would make the split restore as an orphaned
 *  top-level. This closes that hole at the RECORD level — timing-independent, not a
 *  restart-in-flight gate that would also reject legitimate racing user actions.
 *
 *  The exact sibling of `requireTerminal`, minus the parked arm: it still ACCEPTS
 *  the ACTIVE and SLEEPING arms (a chrome edit — theme / intent / layout — on a
 *  sleeping tile is valid), and rejects PARKED and absent alike with the same
 *  `terminalNotFound` the active-only guard uses for a wrong arm. READ / QUERY
 *  paths keep using `requireTerminal` (parked included) — only mutation handlers
 *  take this. */
export function requireMutableTerminal(id: TerminalId): TerminalProcess {
  const entry = requireTerminal(id); // present (any arm) — or throw not-found
  if (entry.meta.state === "parked") throw terminalNotFound(id);
  return entry;
}

/** The terminal-not-found fault as a typed oRPC error. One definition of
 *  the code + message shared by every per-terminal handler (router,
 *  surface) so the wire shape can't drift between call sites. Typed
 *  (not a bare Error) because oRPC scrubs bare errors to an opaque
 *  "Internal server error". */
export function terminalNotFound(
  id: string,
): ORPCError<"NOT_FOUND", undefined> {
  return new ORPCError("NOT_FOUND", { message: `Terminal ${id} not found` });
}

/** The rejected-parent-edge fault as a typed oRPC error — the sibling of
 *  {@link terminalNotFound}, so the create door and the setParent door can't
 *  drift on the wire shape. Typed (not a bare Error) because oRPC scrubs bare
 *  errors to an opaque "Internal server error". */
export function invalidParentEdge(
  childId: string,
  parentId: string,
  reason: string,
): ORPCError<"BAD_REQUEST", undefined> {
  return new ORPCError("BAD_REQUEST", {
    message: `Cannot parent ${childId} under ${parentId}: ${reason}`,
  });
}

/** Can `id` carry a split RIGHT NOW — i.e. would the canvas actually PAINT a
 *  child hung off it? Only a LIVE, TOP-LEVEL tile does. Two client facts, both
 *  load-bearing:
 *  - `useTerminalMetadata` keeps top-level ids in `terminalIds` and hangs exactly
 *    ONE hop of `childrenByParent` off each, so a record that is itself a split
 *    never paints children of its own (#2059);
 *  - `TerminalContent` renders the whole split `Resizable` inside
 *    `<Show when={isLive()}>` — a SLEEPING (or parked) tile swaps its entire body
 *    for `DormantTileBody`, so its splits are not painted at all.
 *
 *  Hence the ACTIVE-arm narrow (`getActiveTerminal`, the same live-PTY seam every
 *  handle-touching path uses) rather than a hand-listed state check. If the canvas
 *  ever paints deeper — or paints a dormant tile's splits — that rendering and THIS
 *  predicate move together.
 *
 *  This is "paintable NOW", which is what the REJECT door wants: refusing an edge
 *  the caller would not see. The RESTORE door wants "paintable EVER" — see
 *  {@link isPermanentlyUnpaintableParent}. */
export function isPaintableParent(id: string): boolean {
  const parent = getActiveTerminal(id);
  return parent !== undefined && parent.meta.parentId === undefined;
}

/** Will `id` EVER paint a child hung off it? The repair counterpart of
 *  {@link isPaintableParent}: a DORMANT top-level tile is only *temporarily*
 *  unpaintable — waking it re-mounts its split panel with the child still there —
 *  so a restore/adopt sweep must leave that edge alone rather than destroy the
 *  user's split arrangement. Every other way an edge is unpaintable is permanent:
 *  the parent is absent, it is a parked restore-card placeholder that will never
 *  become this parent again, or it is itself a split child (which no wake can fix,
 *  since the canvas paints one hop and no more). */
export function isPermanentlyUnpaintableParent(id: string): boolean {
  const parent = getTerminal(id);
  if (parent === undefined) return true; // absent
  if (parent.meta.parentId !== undefined) return true; // itself a split — wake won't help
  if (parent.meta.state === "sleeping") return false; // dormant: wake repaints it
  return !isPaintableParent(id); // parked, or otherwise not a live tile
}

/** The id of the first registry entry whose parent is `id`, or `undefined` — the
 *  "is this tile a leaf?" query, a cheap early-out over the map (same shape as
 *  {@link hasParkedTerminals}). The one parent-edge CHILD query: callers never walk
 *  `terminalEntries()` for it themselves. */
export function firstChildOf(id: string): string | undefined {
  for (const [childId, entry] of terminals)
    if (entry.meta.parentId === id) return childId;
  return undefined;
}

/** Walk `id` → its parent → … to the TOP-LEVEL id. Module-private: its one
 *  consumer is {@link requireFlatParentEdge}'s fault message, which names the tile
 *  the caller should parent against instead.
 *
 *  A cycle is CORRUPT state — reachable only through the deliberately-unfenced
 *  restore door or a hand-edited session blob — so it THROWS rather than handing
 *  back a nested id dressed up as a root. The old "return the first revisited id"
 *  made the fault advise parenting against the very id it had just rejected, which
 *  is unfollowable advice; a bad state must crash loudly, not degrade into a
 *  plausible-looking value. */
function rootAncestorId(id: string): string {
  const seen = new Set<string>([id]);
  let cur = id;
  for (;;) {
    const parent = getTerminal(cur)?.meta.parentId;
    if (parent === undefined) return cur;
    if (seen.has(parent))
      throw new Error(
        `terminal parent cycle through ${parent} (corrupt session graph)`,
      );
    seen.add(parent);
    cur = parent;
  }
}

/** The ONE rule both generative parent writes share (#2059): the edge
 *  `childId → parentId` must leave the tile graph at depth ≤ 1 AND land somewhere
 *  the canvas paints. TOTAL — it names every way an edge breaks that (self-edge;
 *  an absent, parked, dormant, or itself-nested parent; a child that still carries
 *  splits of its own), so no door can enforce a subset. Such an edge is accepted by
 *  the create / setParent wire shape but never painted, and the silent-invisible
 *  middle is the worst outcome.
 *
 *  Session restore does NOT call this — it rehydrates saved graphs and reconciles
 *  permanently unpaintable edges through `promoteUnpaintableRestoreChildren`
 *  instead. That door tolerates a DORMANT parent (wake repaints its splits) where
 *  this one refuses it: a caller asking for a pane it would not see right now gets
 *  told to wake the tile first, rather than a live PTY it cannot find. */
export function requireFlatParentEdge(childId: string, parentId: string): void {
  if (parentId === childId)
    throw invalidParentEdge(
      childId,
      parentId,
      "a terminal cannot be its own parent",
    );
  if (!isPaintableParent(parentId)) {
    // The predicate above is the FACT; this only names WHICH of its clauses
    // failed — and, for the two arms a client cannot see, which FAULT CODE says so.
    const parent = getTerminal(parentId);
    // Absent and PARKED are one answer, deliberately: a parked record is an
    // invisible restore-card placeholder, and `requireMutableTerminal` already
    // makes every client mutation read it as `terminalNotFound`. Naming it in a
    // BAD_REQUEST here would leak a record the same client is told does not
    // exist — and would reclassify a fault the create door has always answered
    // NOT_FOUND.
    if (!parent || parent.meta.state === "parked")
      throw terminalNotFound(parentId);
    if (parent.meta.parentId !== undefined)
      throw invalidParentEdge(
        childId,
        parentId,
        `it is itself a split child — parent against the root tile ${rootAncestorId(parentId)} instead`,
      );
    // The remaining arm is a tile the client CAN see but that paints no splits:
    // dormant, or an active record whose PTY is gone (a half-unwound spawn).
    throw invalidParentEdge(
      childId,
      parentId,
      "it is dormant, and a dormant tile paints no splits — wake it first",
    );
  }
  const orphan = firstChildOf(childId);
  if (orphan !== undefined)
    throw invalidParentEdge(
      childId,
      parentId,
      `it still has split children (e.g. ${orphan}), which the move would push to depth 2`,
    );
}
