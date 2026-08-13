/** ONE AGENT SESSION BELONGS TO AT MOST ONE TERMINAL (juspay/kolu#2057).
 *
 *  An `AgentAdapter` answers a per-terminal question — "which sessions could
 *  THIS terminal be running?" — and for a directory-keyed agent (Codex,
 *  OpenCode) the honest answer for two terminals in one repository is the SAME
 *  list. Nothing inside an adapter can break that tie: `resolveSessions` sees one
 *  terminal and cannot know that another one is already living in the answer it
 *  is about to give. So the tie is broken HERE, once, above every adapter — which
 *  is also where the fact lives: exclusivity is a property of the SET of
 *  terminals, not of any one of them.
 *
 *  Left un-arbitrated, every terminal in the directory adopts the most recently
 *  updated thread and their dock rows converge: same title, same subtitle, same
 *  agent state, and an alert on one lighting them all (#2057).
 *
 *  ## The rule
 *
 *  A terminal takes the best candidate no other terminal holds — the adapter's
 *  list arrives best-first — and reports NO agent when every candidate is
 *  somebody else's. Once it holds one it KEEPS it, with one exception: a hold it
 *  took only because nothing better existed yet gives way to a session that came
 *  into being after this terminal's harness started.
 *
 *  Three properties, and each is load-bearing.
 *
 *  **Exclusive** is what stops two rows from showing one session. A terminal
 *  whose own session has not landed on disk yet reports no agent rather than
 *  borrowing its neighbour's — the honest answer, and a self-correcting one: the
 *  terminal re-asks on its own next reconcile (a title / cwd / foreground event,
 *  or an `externalChanges` rewake where the adapter has one).
 *
 *  **Sticky** is what stops a row from being rewritten by a session it never
 *  started. A newly appeared session always sorts to the front of a directory's
 *  candidate list, so a terminal that re-picked its favourite on every reconcile
 *  would follow whichever harness in the repository most recently did something
 *  — which is the reported symptom, and also why an external `codex` run in that
 *  directory took over every kolu row at once.
 *
 *  **Episode-anchored** is what stops sticky from pinning a terminal to somebody
 *  else's leftovers. These agents write their session row only after the first
 *  exchange, so at the moment kolu first sees the harness the only candidates in
 *  the directory are EARLIER runs'. A terminal takes the best of those — there is
 *  nothing else to show — but that hold is PROVISIONAL: it predates the harness,
 *  so it cannot be the harness's own. When a session that postdates the episode
 *  appears unheld, the terminal moves onto it. Without this a terminal in any
 *  repository with prior history displayed the previous run's conversation for
 *  its whole life, one run behind, for ever.
 *
 *  A hold that POSTDATES the episode is the harness's own as far as anything on
 *  disk can say, and nothing dislodges it. A hold is released only by the
 *  terminal itself: when the agent stops being its foreground process
 *  (`resolveSessions` goes empty), when the session leaves its candidate list
 *  (archived, deleted, superseded by a pid-anchored match), when it is traded for
 *  a post-episode session as above, or when the terminal goes away.
 *
 *  ## The cost, stated plainly
 *
 *  Nothing on disk ties a Codex/OpenCode session to the process that created it
 *  — no pid, in the DB or the rollout — so once a terminal holds a post-episode
 *  session, "the harness in THIS terminal just started another one" and "some
 *  other harness in this directory just started one" are the same observation.
 *  Stickiness resolves that ambiguity towards the session the terminal already
 *  has, so a `/new` inside a running Codex leaves the row on the previous thread
 *  until that Codex exits. That is the deliberate trade: the alternative is
 *  following every new session in the directory, which is the defect this module
 *  exists to end.
 *
 *  ## Where the state lives
 *
 *  Module scope, keyed by adapter kind — the same altitude and lifetime as the
 *  `externalChanges` activation registry in `sensors.ts`, and for the same
 *  reason: one padi process orchestrates every terminal on its host, so the set
 *  of terminals competing for a session IS process-wide.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";

/** Per-adapter-kind books: who holds what, and what each terminal holds. Two
 *  maps rather than one because they are read in opposite directions — "who
 *  holds this session" gates the pick, "what does this terminal hold" answers
 *  the sticky question. */
interface Books {
  ownerOf: Map<string, TerminalId>;
  heldBy: Map<TerminalId, string>;
}

const books = new Map<string, Books>();

function booksFor(kind: string): Books {
  let entry = books.get(kind);
  if (!entry) {
    entry = { ownerOf: new Map(), heldBy: new Map() };
    books.set(kind, entry);
  }
  return entry;
}

/** One session a terminal could be running, with whatever the caller needs back
 *  when it wins. `createdAt` is epoch-ms the session came into being, or null
 *  when the adapter cannot say. */
export interface SessionCandidate<T> {
  key: string;
  createdAt: number | null;
  value: T;
}

/** Can we PROVE this session predates the terminal's current agent episode —
 *  that it is a leftover of an earlier run in the same directory?
 *
 *  Only a dated candidate against a dated episode can answer. Everything else is
 *  ignorance, and the two questions the arbiter asks resolve ignorance in
 *  OPPOSITE directions, which is why this is one predicate and not a shared
 *  "born this episode":
 *
 *    - "should I let go of what I hold?" — only on proof it is a leftover;
 *    - "is this one worth trading up to?" — only on proof it is not.
 *
 *  A single is-it-mine predicate answering "yes" for both would dislodge a hold
 *  onto a candidate of entirely unknown age, which is the guess the episode
 *  anchor exists to avoid. */
function provablyPredatesEpisode(
  candidate: SessionCandidate<unknown>,
  since: number | null,
): boolean {
  if (since === null || candidate.createdAt === null) return false;
  return candidate.createdAt < since;
}

/** Can we PROVE this session came into being during the episode? */
function provablyBornThisEpisode(
  candidate: SessionCandidate<unknown>,
  since: number | null,
): boolean {
  if (since === null || candidate.createdAt === null) return false;
  return candidate.createdAt >= since;
}

/** The session `terminalId` may run, or null when every candidate belongs to
 *  another terminal. `candidates` are the adapter's, in its own preference
 *  order, best first. `since` is epoch-ms this terminal's current agent episode
 *  began, or null when it has no episode clock.
 *
 *  Idempotent — re-asking with the same candidates returns the same answer and
 *  moves nothing. Pure over its arguments apart from the books it maintains: no
 *  clock, no I/O. The caller must NOT call this when it could not read the
 *  candidate list at all; ignorance is not an empty list, and an empty list here
 *  releases the hold (see the module header). */
export function claimSession<T>(
  kind: string,
  terminalId: TerminalId,
  candidates: readonly SessionCandidate<T>[],
  since: number | null,
): T | null {
  const b = booksFor(kind);
  const held = b.heldBy.get(terminalId);
  const heldCandidate =
    held === undefined ? undefined : candidates.find((c) => c.key === held);
  if (heldCandidate !== undefined) {
    // A hold we cannot prove is a leftover stays — including one we simply
    // cannot date. Only a hold PROVABLY older than the episode is provisional,
    // and it gives way only to a candidate PROVABLY born during it: trading a
    // leftover for a session of unknown age is the guess this anchor avoids.
    if (!provablyPredatesEpisode(heldCandidate, since))
      return heldCandidate.value;
    const better = candidates.find(
      (c) => !b.ownerOf.has(c.key) && provablyBornThisEpisode(c, since),
    );
    if (better === undefined) return heldCandidate.value;
    return take(b, terminalId, better);
  }
  // Either this terminal held nothing, or what it held is no longer on offer.
  releaseTerminal(kind, terminalId);
  for (const candidate of candidates) {
    if (b.ownerOf.has(candidate.key)) continue;
    return take(b, terminalId, candidate);
  }
  return null;
}

/** Record `terminalId` as the holder of `candidate`, dropping whatever it held
 *  before. The drop is INSIDE this function, not a discipline every call site
 *  has to remember: the two maps are one relation in two directions, and the
 *  only way they can disagree is a `set` without the matching release. */
function take<T>(
  b: Books,
  terminalId: TerminalId,
  candidate: SessionCandidate<T>,
): T {
  const previous = b.heldBy.get(terminalId);
  if (previous !== undefined) b.ownerOf.delete(previous);
  b.ownerOf.set(candidate.key, terminalId);
  b.heldBy.set(terminalId, candidate.key);
  return candidate.value;
}

/** Drop this terminal's claim — called when it stops running an agent and when
 *  its sensor tears down, so the session it held is free for whoever runs it
 *  next. */
export function releaseTerminal(kind: string, terminalId: TerminalId): void {
  const b = books.get(kind);
  if (!b) return;
  const held = b.heldBy.get(terminalId);
  if (held === undefined) return;
  b.ownerOf.delete(held);
  b.heldBy.delete(terminalId);
}

/** Forget every claim for every adapter — test-only, so one suite's terminals
 *  cannot be another's neighbours. */
export function resetSessionOwnership(): void {
  books.clear();
}
