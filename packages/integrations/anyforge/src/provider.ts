/** The forge-adapter contract — a pure resolver, chosen per resolve.
 *
 *  Deliberately *not* subscribe-shaped: a provider is a stateless
 *  `resolve(git)`, and the generic watcher (`subscribePr`) looks the
 *  provider up on **each** resolve. One watcher lives for a terminal's
 *  whole life; a remote-URL change is just a different dispatch on the
 *  next resolve — no teardown/rebuild machinery, no `lastKey`, and the
 *  git channel's synchronous `onEvent` contract is never crossed by an
 *  awaited detection (see the anyforge Atlas note, decision D3). */

import type { Logger } from "kolu-shared";
import type { PrResult } from "./schemas.ts";

/** Which forge family a remote belongs to. Detection (`detectForge`) picks
 *  one; the host's registry maps it to an adapter. `forgejo` gains its
 *  adapter in kolu#1240 phase 1 — until then hosts fall back to github
 *  (see `detectForge` for why that's safe). */
export type ForgeKind = "github" | "forgejo";

/** The git state a resolve needs — handed through `PrWatcher.setGit` and
 *  passed verbatim to the dispatched provider. */
export type PrGitContext = {
  repoRoot: string;
  branch: string;
  /** `origin`'s URL, or null when the repo has no remote. Feeds
   *  `detectForge`; adapters that talk to a REST API derive their
   *  endpoint from it. */
  remoteUrl: string | null;
};

export interface PrProvider {
  readonly kind: ForgeKind;
  /** Resolve the PR for the given git context. Must not throw — failures
   *  are classified into the `PrResult` variants (`absent` for "no PR can
   *  exist here", `unavailable` with a typed code for everything
   *  actionable). */
  resolve(git: PrGitContext, log?: Logger): Promise<PrResult>;
}
