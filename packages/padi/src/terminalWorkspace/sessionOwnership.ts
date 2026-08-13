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
 *  ## The rule, in two lines
 *
 *  A terminal KEEPS the session it holds for as long as that session is still
 *  one of its candidates. Otherwise it takes the best candidate no other
 *  terminal holds — the adapter's list arrives best-first — and reports NO agent
 *  when every candidate is somebody else's.
 *
 *  Both halves matter.
 *
 *  **Sticky** is what stops a row from being rewritten by a session it never
 *  started. A newly appeared thread always sorts to the front of a directory's
 *  candidate list, so a terminal that re-picked its favourite on every reconcile
 *  would follow whichever harness in the repository most recently did something
 *  — which is the reported symptom, and also why an external `codex` run in that
 *  directory took over every kolu row at once. A held session is released only
 *  by the terminal itself: when the agent stops being its foreground process
 *  (`resolveSessions` goes empty), when the session leaves its candidate list
 *  (archived, deleted, superseded by a pid-anchored match), or when the terminal
 *  goes away.
 *
 *  **Exclusive** is what stops two rows from showing one session. A terminal
 *  whose own session has not landed on disk yet reports no agent rather than
 *  borrowing its neighbour's — the honest answer, and a self-correcting one: the
 *  adapter's `externalChanges` rewake re-asks the moment its session appears.
 *
 *  ## The cost, stated plainly
 *
 *  Nothing on disk ties a Codex/OpenCode session to the process that created it
 *  — no pid, in the DB or the rollout — so "the harness in THIS terminal just
 *  started a new session" and "some other harness in this directory just started
 *  one" are the same observation. Sticky resolves that ambiguity towards the
 *  terminal's existing session, so a `/new` inside a running Codex leaves the row
 *  on the previous thread until that Codex exits. That is the deliberate trade:
 *  the alternative is following every new thread in the directory, which is the
 *  defect this module exists to end.
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

/** The session `terminalId` may run, or null when every candidate belongs to
 *  another terminal. `candidateKeys` are the adapter's `sessionKey`s in its own
 *  preference order, best first. Idempotent — re-asking with the same candidates
 *  returns the same answer and moves nothing. */
export function claimSession(
  kind: string,
  terminalId: TerminalId,
  candidateKeys: readonly string[],
): string | null {
  const b = booksFor(kind);
  const held = b.heldBy.get(terminalId);
  if (held !== undefined && candidateKeys.includes(held)) return held;
  // Either this terminal held nothing, or what it held is no longer on offer.
  releaseTerminal(kind, terminalId);
  for (const key of candidateKeys) {
    if (b.ownerOf.has(key)) continue;
    b.ownerOf.set(key, terminalId);
    b.heldBy.set(terminalId, key);
    return key;
  }
  return null;
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
