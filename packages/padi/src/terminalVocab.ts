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
 * `cliClient/watch.ts` and `dial.ts` re-export from here, so every existing
 * consumer's import path is unchanged.
 *
 * It sits at the package ROOT rather than under `cliClient/` because the server
 * speaks this vocabulary too: padi's supervision-edge delivery narrows a
 * supervisor record with `activeAgent` before writing into its mailbox. A daemon
 * module reaching into a directory named `cliClient` for a narrowing would point
 * the dependency arrow backwards — location is structure — even though the leaf
 * itself is pure. Same leaf, one directory up, so both sides reach it downhill.
 */

import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal } from "./surface.ts";

/** The LIVE agent of a composed record, or `null` — only the `active` arm
 *  carries a running agent (`sleeping`/`parked` are dormant, their PTY
 *  released), so the union is narrowed here rather than at every read site. */
export function activeAgent(v: PadiTerminal): AgentInfo | null {
  return v.state === "active" ? v.agent : null;
}

/** The bucket vocabulary lives BESIDE the fold it is defined from
 *  (`@kolu/terminal-vocab/agentProjection`), not here: `WAIT_STATES` is
 *  literally `Exclude<ReturnType<typeof agentBucket>, "other">`, so its home is
 *  the module with the exhaustiveness fence — and a leaf the wire schema and the
 *  CLI's `--help` can both read without importing padi. Re-exported so every
 *  existing consumer's import path is unchanged. */
export {
  isWaitState,
  WAIT_STATES,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";

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
