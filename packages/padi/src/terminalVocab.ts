/**
 * padi's terminal VOCABULARY — the pure narrowings and name sets every padi
 * client speaks, with nothing above them.
 *
 * A leaf by construction: its only imports are `@kolu/terminal-vocab`'s type
 * schema and the `agentBucket` fold. That is the point. These three symbols
 * (`activeAgent`, `WAIT_STATES`, `WaitState`) used to live in `watch.ts`, and
 * `render.ts` — a module whose header and padi's README both promise "no I/O,
 * no transport, no tty" — reached them through `dial.ts`'s re-export. So a
 * consumer that wanted only the status table dragged `socketDuplexLink`,
 * `@kolu/surface-daemon-supervisor`, `@kolu/surface-remote` and `kolu-pty`
 * into a text formatter's module graph. A stated invariant an import graph
 * refutes will be relied on and will break, so the vocabulary moved BELOW both
 * of them instead of the formatter reaching sideways for it.
 *
 * `watch.ts` and `dial.ts` re-export from here, so every existing consumer's
 * import path is unchanged.
 */

import type { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal } from "./surface.ts";

/** The LIVE agent of a composed record, or `null` — only the `active` arm
 *  carries a running agent (`sleeping`/`parked` are dormant, their PTY
 *  released), so the union is narrowed here rather than at every read site. */
export function activeAgent(v: PadiTerminal): AgentInfo | null {
  return v.state === "active" ? v.agent : null;
}

/** The coarse agent buckets a wait accepts as targets — the `agentBucket`
 *  fold's vocabulary minus `other` (an `other` bucket never matches a real
 *  agent, so accepting it would only ever time out). A wait compares against
 *  the *bucket*, never the raw `AgentInfo['state']` literals, so the one fold
 *  in `@kolu/terminal-vocab/agentProjection` stays the single source of truth
 *  (see `.claude/rules/dock-fleet-mirror.md`). */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** Is `token` one of padi's wait buckets? THE whole padi-side contract for a
 *  `--until` token, and deliberately nothing more: how a CLI splits a comma
 *  list and phrases its rejection is argv grammar, which `watch.ts`'s header
 *  says belongs to the face, not here. */
export function isWaitState(token: string): token is WaitState {
  return (WAIT_STATES as readonly string[]).includes(token);
}

/** The line a client reports when padi's link dropped mid-operation and nothing
 *  upstream said anything more specific — phrased as the question the user can
 *  act on.
 *
 *  One constant because it was three near-copies — `kolu wait`, `kolu watch`,
 *  and `settledSnapshot` — two of which asked "Is `padi` still running?" and one
 *  "Is kolu still running?". A user driving all three learned two names for the
 *  same dead thing. `kolu` is the process a user starts; padi is what it runs,
 *  so the parenthetical says so once. */
export const PADI_LINK_CLOSED =
  "the padi link closed — the daemon stopped or the connection dropped. Is kolu still running? (its padi serves the terminals)";
