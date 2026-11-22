/**
 * WHETHER PADI'S ROSTER IS EVIDENCE — the one fact, held once, and now said out
 * loud on the wire.
 *
 * padi's `urgency` cell runs once at serve time — before the endpoint has booted
 * and adopted kaval's terminals — so its first frame is an information-free
 * empty registry. Every consumer downstream of that fold treats a frame as
 * evidence: `finishQuiet` spends its bootstrap on it, the settle detector takes
 * it as the baseline it diffs against, the state watch dates every hold from it.
 * Taken as real, that one frame re-announces every already-settled worker on
 * every padi restart.
 *
 * The guard used to live three times, once per consumer, which is one fact
 * remembered by discipline — and the fourth consumer forgets. It lives here now,
 * gated once at the producer, so everything downstream may trust what it is fed.
 *
 * The half that is easy to lose when the guard is inlined as a boolean: once a
 * fleet HAS been seen, an empty map is a real fact — every terminal exited — and
 * must flow through. It is not "ignore empty frames".
 *
 * ## The fourth consumer was across a wire (#2376)
 *
 * kolu-server's Conductor watch reads the roster of every host that holds a
 * member terminal and concluded `gone` for every id not in it. A redeploy
 * replaces padi; the fresh one serves that same pre-adopt frame; both of a
 * work's live terminals were recorded as having LEFT, and the work was ended as
 * abandoned. The guard could not help it: it was a boolean inside one process.
 *
 * So the gate OWNS the fact and PUBLISHES it ({@link PadiRoster} on the `roster`
 * cell, `padiSurface` 7.4). Three things open it, and one closes it:
 *
 *  - a first non-empty frame — the registry has content, so it was adopted;
 *  - {@link FleetGate.establish} — the boot finished (`bootLocalEndpoint`:
 *    endpoint up, saved session reconciled), which is what makes a GENUINELY
 *    EMPTY roster evidence rather than a daemon that has not looked yet;
 *  - the same call at the end of a kaval recycle, once the captured session has
 *    been re-parked;
 *  - {@link FleetGate.settling} closes it for the recycle's own drain window,
 *    where `killAllTerminals` clears the registry on purpose. An id missing
 *    THERE is a terminal about to be restored, not one that died.
 *
 * ## The standing carries the CENSUS, because a reader of two members loses
 *
 * An `established` standing names the ids the registry holds, and
 * {@link FleetGate.censusMoved} keeps it true as terminals come and go. The
 * alternative — standing here, ids on the `terminals` collection beside it —
 * puts the two halves of one answer on two wire members, and a PROJECTION of
 * this surface delivers them apart: kolu-server's per-host mirror marks its
 * session connected on the first folded CELL frame, so a subscriber opened
 * then is told `established` by this cell and an empty list by a collection
 * that has not folded. The Conductor's watch read exactly that pair, 11 ms
 * after its link came up, and recorded a work's member `gone` while the
 * terminal was alive under the same id, adopted half a second earlier (#2376,
 * the redeploy e2e). One member cannot be made to arrive apart from itself.
 *
 * ## A census is not an attention reading — the survivors are READ first
 *
 * A redeploy adopts kaval's surviving terminals with no agent on them: padi
 * re-reads each agent a moment later rather than trusting the saved one. The
 * first frame after adoption therefore lists every terminal and no agent, and
 * an attention consumer handed it takes it as fact — `finishQuiet` spent its
 * "already idle on the first real frame is not news" rule on that agentless
 * frame, then saw each idle agent arrive as a brand-new finish, and every
 * browser rang and marked every agent terminal unread.
 *
 * So the two readers of this gate open at different moments. The CENSUS
 * ("who is here") opens exactly as above — the Conductor's watch needs it as
 * soon as a terminal is listed. The ATTENTION FEED opens when the boot has
 * said adoption is finished ({@link FleetGate.establish}) AND every survivor
 * the boot announced has been read once ({@link FleetGate.awaitFirstRead} /
 * {@link FleetGate.firstRead}). A frame never opens it. A terminal that goes
 * away while awaited stops being awaited. While the feed waits the `urgency`
 * cell says `settled: false`.
 *
 * A frame cannot say adoption is finished, because the boot registers a saved
 * session in its saved order and only a SURVIVOR is announced before it is
 * registered. A session whose first record is asleep registers that sleeper
 * first, with nothing announced; when a frame could open the feed, that frame
 * opened it, every survivor announced after it was taken for a mid-session
 * adoption, and each idle agent came back as a fresh finish on every page.
 *
 * The last read changes no terminal record when the survivor's agent is gone
 * (a shell has nothing to publish), so nothing would re-run the fold that is
 * waiting on it. The gate therefore carries a generation the fold reads in
 * {@link FleetGate.admit} — `finishQuiet`'s dual-edge pattern — and bumps it
 * whenever its own answer moves: the last read, `establish`, `settling`.
 */

import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { source } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

export interface FleetGate {
  /** Should this frame reach the attention consumers? `false` while the roster
   *  is settling — an empty registry before anything was adopted, or the drain
   *  window of a recycle — until the boot has said adoption is finished
   *  ({@link establish}), and while an adopted survivor has not been read
   *  ({@link awaitFirstRead}). A non-empty frame ESTABLISHES the roster (and
   *  publishes that) whether or not the boot has finished or the survivors
   *  have been read — except inside a drain window, which only
   *  {@link establish} may close.
   *
   *  Reads the gate's generation, so a reactive fold calling this re-runs when
   *  the gate's answer moves without the frame moving. */
  admit(terminals: ReadonlyMap<TerminalId, PadiTerminal>): boolean;
  /** padi has finished adopting: the roster is evidence even if it is EMPTY,
   *  and the attention feed may open once every announced survivor has been
   *  read. Idempotent — a second call re-publishes nothing. The one thing that
   *  re-opens a gate {@link settling} closed. */
  establish(): void;
  /** The roster is being rebuilt (a kaval recycle's capture → drain → re-park):
   *  nothing it lists, or fails to list, is evidence until {@link establish}.
   *  LATCHES — a frame arriving mid-drain is a partial census, never the news
   *  that the rebuild finished. */
  settling(): void;
  /** THE CENSUS MOVED — a terminal was registered or dropped. Re-publishes the
   *  standing with the new ids when the roster is established; a no-op while it
   *  settles (there is no census to amend) and when the ids did not change.
   *  Called from the one pair of places that write the `terminals` collection,
   *  so the cell cannot drift from the registry it describes. */
  censusMoved(): void;
  /** A terminal ADOPTED with no agent on it, whose agent padi has not read yet.
   *  The attention feed stays closed until it has been ({@link firstRead}), or
   *  until it leaves the registry. Must be said BEFORE the terminal is
   *  registered, or a fold run by the registration admits it unread.
   *
   *  A no-op once the attention feed has opened — which is never before the
   *  boot's {@link establish}: a terminal adopted mid-session (a restart that
   *  kept its PTY, a PTY created outside kolu) joins a fleet the feed already
   *  describes, and holding every other terminal's attention for it would be
   *  the defect, not the guard. */
  awaitFirstRead(id: TerminalId): void;
  /** Every agent detector of this terminal has made its first pass over a real
   *  foreground sample — whatever it found: an agent, a plain shell, or that
   *  it cannot tell. A no-op for a terminal nobody is waiting on. */
  firstRead(id: TerminalId): void;
  /** The standing as it would be read off the wire — what the cell carries. */
  roster(): PadiRoster;
  /** Release the generation the fold tracks. */
  dispose(): void;
}

export function createFleetGate(
  opts: {
    /** Publish a CHANGED standing (the `roster` cell). Omitted in tests of the
     *  gate itself and in a serve with no ctx wired yet. */
    readonly publish?: (roster: PadiRoster) => void;
    /** The clock the `established` stamp is read from — injected so a test can
     *  state the epoch it expects. */
    readonly now?: () => number;
    /** THE REGISTRY'S OWN IDS, read at publish time. Injected because the gate
     *  is a fact-holder in `attention/` and the registry is padi's: a census
     *  read through this port is always the live one, never a copy that aged
     *  between the move and the publish. Omitted in gate-only tests and in a
     *  serve with no registry wired: the census is then whatever the admitted
     *  frame carried. */
    readonly census?: () => readonly TerminalId[];
  } = {},
): FleetGate {
  const now = opts.now ?? Date.now;
  let roster: PadiRoster = { kind: "settling" };
  /** SAID, not merely not-yet-seen: {@link FleetGate.settling} closed the gate
   *  for a recycle's drain, and no frame may re-open it — only
   *  {@link FleetGate.establish} may. The drain clears the registry and then
   *  drops the snapshots one at a time, each its own unbatched write, so the
   *  urgency fold re-runs mid-drain on a frame of the terminals not yet
   *  dropped: non-empty, and therefore evidence of a roster under the old
   *  rule, while the census port already answers `[]`. That published an
   *  ESTABLISHED EMPTY roster for the whole recycle — exactly the absence the
   *  Conductor's watch reads as `gone` (#2376). A partial census is not a
   *  census. */
  let closed = false;
  const move = (next: PadiRoster): void => {
    if (next.kind === roster.kind) {
      // Same ARM, so only a census can have moved — and an unchanged census is
      // not news for a cell every host mirrors.
      if (next.kind !== "established" || roster.kind !== "established") return;
      const was = roster.ids;
      if (
        next.ids.length === was.length &&
        next.ids.every((id, at) => id === was[at])
      )
        return;
    }
    roster = next;
    opts.publish?.(next);
  };
  /** The ids to publish: the REGISTRY's when a census port is wired (always, in
   *  a real serve); else the frame's, when a frame is what moved; else whatever
   *  is already standing — a gate with no port and no frame has learned nothing
   *  new about who is here, and must not overwrite what it was told. */
  const ids = (
    frame?: ReadonlyMap<TerminalId, PadiTerminal>,
  ): readonly TerminalId[] => {
    if (opts.census) return [...opts.census()];
    if (frame) return [...frame.keys()];
    return roster.kind === "established" ? roster.ids : [];
  };
  /** HAS THE BOOT SAID ADOPTION IS FINISHED? The attention feed's first
   *  condition ({@link FleetGate.establish}); a frame never sets it. */
  let adopted = false;
  /** HAS THE ATTENTION FEED OPENED? Once it has, an adoption is mid-session
   *  and is not waited on ({@link FleetGate.awaitFirstRead}). Never closes
   *  again: a recycle's drain closes the feed through `closed`, and re-parks
   *  rather than adopting. */
  let attentionOpen = false;
  /** Adopted survivors whose agent has not been read yet. */
  const unread = new Set<TerminalId>();
  // The generation the fold reads in `admit`, bumped when the gate's own
  // answer moves with no frame moving (`finishQuiet`'s dual-edge source).
  let generation = 0;
  let emitGeneration: ((n: number) => void) | undefined;
  const generationSource = source<number>((emit) => {
    emitGeneration = emit;
    return () => {
      emitGeneration = undefined;
    };
  }, 0);
  const keepAlive = generationSource.subscribe(() => {});
  const moved = (): void => {
    generation += 1;
    emitGeneration?.(generation);
  };
  return {
    admit(terminals) {
      // Dual-edge: depend on the gate's generation before reading the frame.
      generationSource.value.value;
      if (roster.kind === "established") {
        // A frame IS a census: fold it in, so the cell tracks the registry even
        // where the collection's own writers are not the mover (a drain, a
        // bulk kill).
        move({ kind: "established", at: roster.at, ids: ids(terminals) });
      } else if (closed || terminals.size === 0) {
        return false;
      } else {
        move({ kind: "established", at: now(), ids: ids(terminals) });
      }
      // The census is evidence; the attention feed waits for the boot to say
      // adoption is finished, and for the survivors it announced.
      for (const id of unread) if (!terminals.has(id)) unread.delete(id);
      if (!adopted || unread.size > 0) return false;
      attentionOpen = true;
      return true;
    },
    establish() {
      closed = false;
      adopted = true;
      move({ kind: "established", at: now(), ids: ids() });
      moved();
    },
    settling() {
      closed = true;
      move({ kind: "settling" });
      moved();
    },
    censusMoved() {
      if (roster.kind !== "established") return;
      move({ kind: "established", at: roster.at, ids: ids() });
    },
    awaitFirstRead(id) {
      if (!attentionOpen) unread.add(id);
    },
    firstRead(id) {
      if (unread.delete(id) && unread.size === 0) moved();
    },
    roster: () => roster,
    dispose() {
      keepAlive();
      generationSource.dispose();
    },
  };
}

/** THE SERVING padi's gate — the one a BOOT PHASE reaches.
 *
 *  The gate is per-serve (a `servePadi` rebuild in tests must start unseeded
 *  exactly as a fresh daemon does), but the two moments that establish a roster
 *  for real — the boot's `ensureLocalEndpoint`, and the recycle routine — are
 *  modules away from the surface deps and have no handle to pass one through.
 *  Registered here, exactly like padi's other process-wide injections
 *  (`setPadiSessionStore`, `setPadiServeSocketPath`), and cleared with the
 *  serve it belongs to so a stale gate can never be published through. */
let serving: FleetGate | null = null;

export function setServingFleetGate(gate: FleetGate | null): void {
  serving = gate;
}

/** padi finished adopting — see {@link FleetGate.establish}. A no-op before the
 *  surface is served (nothing is subscribed to tell). */
export function markRosterEstablished(): void {
  serving?.establish();
}

/** padi is rebuilding its roster — see {@link FleetGate.settling}. */
export function markRosterSettling(): void {
  serving?.settling();
}

/** A terminal was registered or dropped — see {@link FleetGate.censusMoved}.
 *  Called by the pair that writes the `terminals` collection
 *  (`terminalEndpoint/metadata.ts`), which is where the registry's membership
 *  actually moves, so the published census and the collection cannot disagree
 *  about who is here. */
export function markCensusMoved(): void {
  serving?.censusMoved();
}

/** An adopted survivor padi has not read yet — see
 *  {@link FleetGate.awaitFirstRead}. Said by the adopt path, before it
 *  registers the terminal. */
export function markAwaitingFirstRead(id: TerminalId): void {
  serving?.awaitFirstRead(id);
}

/** A terminal's agent detectors have each made their first pass — see
 *  {@link FleetGate.firstRead}. Said by the terminal's sensor set. */
export function markFirstRead(id: TerminalId): void {
  serving?.firstRead(id);
}
