import type { TerminalId } from "@kolu/terminal-vocab/schema";

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

function provablyPredatesEpisode(
  candidate: SessionCandidate<unknown>,
  since: number | null,
): boolean {
  if (since === null || candidate.createdAt === null) return false;
  return candidate.createdAt < since;
}

function provablyBornThisEpisode(
  candidate: SessionCandidate<unknown>,
  since: number | null,
): boolean {
  if (since === null || candidate.createdAt === null) return false;
  return candidate.createdAt >= since;
}

/** The session `terminalId` may run, or null when every candidate belongs to
 *  another terminal. `candidates` are the adapter's, best first. `since` is
 *  epoch-ms this terminal's current agent episode began, or null when it has no
 *  episode clock. Idempotent. MUST NOT be called when the candidate list could
 *  not be read: an empty list releases the hold. */
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
  if (heldCandidate !== undefined)
    return keepHoldUnlessProvenLeftover(
      b,
      terminalId,
      heldCandidate,
      candidates,
      since,
    );
  releaseTerminal(kind, terminalId);
  return takeBestUnheld(b, terminalId, candidates);
}

function keepHoldUnlessProvenLeftover<T>(
  b: Books,
  terminalId: TerminalId,
  heldCandidate: SessionCandidate<T>,
  candidates: readonly SessionCandidate<T>[],
  since: number | null,
): T {
  if (!provablyPredatesEpisode(heldCandidate, since))
    return heldCandidate.value;
  const bornThisEpisode = candidates.find(
    (c) => !b.ownerOf.has(c.key) && provablyBornThisEpisode(c, since),
  );
  return bornThisEpisode === undefined
    ? heldCandidate.value
    : take(b, terminalId, bornThisEpisode);
}

function takeBestUnheld<T>(
  b: Books,
  terminalId: TerminalId,
  candidates: readonly SessionCandidate<T>[],
): T | null {
  for (const candidate of candidates) {
    if (b.ownerOf.has(candidate.key)) continue;
    return take(b, terminalId, candidate);
  }
  return null;
}

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

export function releaseTerminal(kind: string, terminalId: TerminalId): void {
  const b = books.get(kind);
  if (!b) return;
  const held = b.heldBy.get(terminalId);
  if (held === undefined) return;
  b.ownerOf.delete(held);
  b.heldBy.delete(terminalId);
}

export function resetSessionOwnership(): void {
  books.clear();
}
