/** The node-side plugin contract — an agent package's full contribution to the
 *  daemon. `AgentVocab` (browser-safe) is the half the client bundle can
 *  import; this adds the pieces only a host runs: the detection adapter, the
 *  transcript fetcher, and the env keys that point detection at fixtures.
 *
 *  `Fetch` is a TYPE PARAMETER so anyagent does NOT depend on
 *  `kolu-transcript-core`. Every agent package binds `Fetch = Fetcher`
 *  (`kolu-transcript-core`'s loader contract). */

import type { AgentAdapter, AgentInfoShape } from "./agent-adapter.ts";
import type { AgentVocab } from "./vocab.ts";

export interface AgentPlugin<Session, Info extends AgentInfoShape, Fetch> {
  /** The browser-safe facts (kind · display name · mark · CLI · resume · schema). */
  readonly vocab: AgentVocab<Info>;
  /** Detection + per-session state watching. */
  readonly adapter: AgentAdapter<Session, Info>;
  /** The transcript loader, already typed as a `Fetcher` by the agent package. */
  readonly fetcher: Fetch;
  /** Env keys padi's sensors read to locate this agent's session state
   *  (e.g. `KOLU_XYNE_DIR`). Forwarded server→padi by `padiBinding`. */
  readonly envKeys: readonly string[];
  /** Optional subsystem counters this agent contributes to the server's heap
   *  diagnostics (e.g. Claude's in-flight summary fetches). Lets the server log
   *  a per-agent diagnostic without depending on that agent's package — the
   *  registry folds them. */
  readonly diagnostics?: () => Record<string, number>;
}
