/**
 * `@kolu/padi/branchCheckout` — the backing for `padiSurface`'s
 * `branchCheckout` stream: WHERE A BRANCH IS CHECKED OUT on this host, watched
 * for as long as somebody is subscribed.
 *
 * kolu's Conductor keys a piece of work `(host, repo, branch)`. Its folder is
 * a fact about that branch on this host — which checkout git says the branch
 * is on — never about whichever member terminal happens to be sitting
 * somewhere. This asks git by the work's own key, so no terminal has to
 * exist, and a terminal standing in another worktree lends the work nothing.
 *
 * ## What a frame is
 *
 * Snapshot-then-changes, by kolu-git's `subscribeBranchCheckout`: the first
 * frame is the answer as it stands, every later one an answer that differs.
 * `not-a-repository` and `unavailable` are git's own words, never "the branch
 * is checked out nowhere" — that is `repository` with no checkout.
 */

import {
  inMemoryChannel,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import type { Stream } from "effect";
import { type BranchCheckout, subscribeBranchCheckout } from "kolu-git";
import type { Logger } from "pino";
import { askerLabel } from "./diagnostics/askers.ts";

/** Where one branch of one repository is checked out, as a stream. */
export function branchCheckoutStream(
  at: { readonly repoPath: string; readonly branch: string },
  log: Logger,
): Stream.Stream<BranchCheckout> {
  return streamFromAbortableSource<BranchCheckout>((signal) => {
    const plog = log.child({
      provider: "checkout",
      repo: at.repoPath,
      branch: at.branch,
    });
    // SUBSCRIBED before the watch starts, so the first answer — which may
    // land before the consumer's first pull — is queued, not dropped.
    const channel = inMemoryChannel<BranchCheckout>();
    const frames = channel.subscribe(signal);
    const stop = subscribeBranchCheckout(
      at.repoPath,
      at.branch,
      askerLabel.branchCheckoutStream(at.branch),
      (answer) => {
        channel.publish(answer);
      },
      plog,
    );
    signal.addEventListener("abort", stop, { once: true });
    return frames;
  });
}
