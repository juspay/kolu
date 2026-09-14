/**
 * Terminal registry — the `Map<TerminalId, TerminalProcess>` and the
 * pure read/write accessors around it.
 *
 * Endpoint-agnostic: the `TerminalEndpoint` writes to the same registry
 * so consumers downstream (router, surface) iterate one place regardless
 * of which endpoint owns the terminal. Per-endpoint internal state (PTY
 * handle, provider cleanups for `LocalTerminalEndpoint`) stays inside the
 * endpoint itself, not on `TerminalProcess`.
 */

import type {
  AuthoredActiveTerminal,
  AuthoredParkedTerminal,
  AuthoredSleepingTerminal,
  TerminalInfo,
} from "@kolu/padi-client/surface";
import { TerminalNotFound } from "@kolu/padi-client/surface";
import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import type { TerminalHandle } from "./endpoint.ts";

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

/** Insert/replace a terminal entry in the registry.
 *
 *  **CALL ORDER IS THE CLIENT'S ROW ORDER.** The registry is a `Map`, so a new
 *  id appends to the tail and clients render that sequence directly
 *  ({@link listTerminals}). Since juspay/kolu#2141 the dock takes it verbatim —
 *  no re-sorting — so this is what decides where every dock row sits and which
 *  terminal each `Cmd+1..9` reaches.
 *
 *  So any path that REBUILDS the registry from a saved session must walk that
 *  session in saved order: `adoptSurvivingSession` dispatches `reconcile`'s
 *  ordered plan, `restoreSession` walks its saved list. Rebuilding in two
 *  passes — every active, then every sleeper — is what used to move each ☾ tile
 *  to the tail of its repo section on a padi restart, silently renumbering the
 *  shortcuts. Re-registering an EXISTING id keeps its slot (`Map.set` on a
 *  present key does not move it), which is why sleep/wake is position-safe.
 *
 *  Stated here, on the write side, because this is the function a new rebuild
 *  path calls; the read side only reports the consequence. */
export function registerTerminal(id: TerminalId, entry: TerminalProcess): void {
  terminals.set(id, entry);
}

/** Remove a terminal by id. Returns true if the entry was present. */
export function unregisterTerminal(id: TerminalId): boolean {
  return terminals.delete(id);
}

/** CLAIM a terminal for termination — remove it from the registry and hand the
 *  removed ACTIVE entry back, in ONE step. Returns `undefined` when `id` is not
 *  an active terminal, which now covers three cases with one answer: absent,
 *  DORMANT (sleeping/parked — those exit via `discardSleeping`/`discardParked`,
 *  never through a dead-PTY kill), and ALREADY CLAIMED by an overlapping caller.
 *
 *  This is THE door to termination, and it is remove-and-return precisely so a
 *  terminator has no separate read to go stale. `killTerminal` used to read the
 *  entry, log, tear the sensors down, and only then remove it — so two kills
 *  overlapping inside the pty-host round-trip both passed the read, both logged
 *  `killing`, both tore down, and both aimed a signal at a pid the other was
 *  already retiring (production, 124ms apart, on one split close). With the
 *  claim AS the guard the loser has nothing to observe and returns before it can
 *  act on anything; a future teardown that yields cannot re-express the defect,
 *  because there is no read to go stale between the guard and the mutation.
 *
 *  The single-entry dual of {@link drainTerminals}'s snapshot-and-clear. Removal
 *  is confined to this file's three doors (this, `unregisterTerminal`,
 *  `drainTerminals`), pinned by `terminalEndpoint/registryMutationConfinement.test.ts`. */
export function claimActiveTerminal(
  id: TerminalId,
): ActiveTerminalProcess | undefined {
  const entry = terminals.get(id);
  if (!entry?.handle) return undefined;
  terminals.delete(id);
  return entry;
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

/** The terminal-not-found fault as the surface's DECLARED tagged error. One
 *  definition shared by every per-terminal handler so the wire shape can't
 *  drift between call sites, and TAGGED (not a bare Error) because an
 *  undeclared throw is a DEFECT — it crosses opaquely, where this one crosses
 *  with its `_tag` and its `id` intact and a caller narrows on it. */
export function terminalNotFound(id: string): TerminalNotFound {
  return new TerminalNotFound({ id });
}
