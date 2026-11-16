/**
 * `@kolu/padi/branchPr` — the backing for `padiSurface`'s `pullRequest` stream:
 * THE PULL REQUEST OF A BRANCH, watched for as long as somebody is subscribed.
 *
 * ## One implementation, two callers
 *
 * The per-terminal PR sensor (`terminalWorkspace/sensors.ts`'s `startPrSensor`)
 * already resolves a pull request from A DIRECTORY AND A BRANCH: anyforge's
 * `subscribePr` over the host's forge dispatch (`dispatchingForgeAdapter`), on
 * its 30 s poll. This module is the SECOND CALLER of that same watcher, not a
 * second watcher: it feeds it a git context built from the subscription's
 * `{repoPath, branch}` instead of from a terminal's live `GitInfo`, and hands
 * every `PrResult` it emits straight out as a frame.
 *
 * ## Why a branch needs its own door
 *
 * A pull request belongs to a branch, not to whoever is sitting in it. kolu's
 * Conductor watches a piece of work keyed `(host, repo, branch)`, and reading
 * the PR off a member terminal's record meant the one fact that ENDS a work —
 * the merge — lost its only observer the moment the terminals were closed,
 * which is the ordinary ending of a Conductor-run waterfall (#2376). Here no
 * terminal has to exist.
 *
 * ## What a frame is
 *
 * Snapshot-then-changes: `subscribePr` emits a resolved reading and then only
 * READINGS THAT CHANGED (it dedups with `prResultEqual`), so a subscriber's
 * first frame is the pull request as it stands and each later one is news.
 * Every arm of `PrResult` is honest about what the host knows — `unsupported`
 * for a remote no adapter serves, `unavailable` with the forge's own reason —
 * and none of them means "there is no pull request" except `absent`.
 */

import { subscribePr } from "anyforge";
import { resolveGitInfo, subscribeRepoChange } from "kolu-git";
import {
  inMemoryChannel,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import type { Stream } from "effect";
import type { Logger } from "pino";
import type {
  PrResult,
  PrUnavailableSource,
} from "@kolu/terminal-vocab/schema";
import { askerLabel } from "./diagnostics/askers.ts";
import { dispatchingForgeAdapter } from "./terminalWorkspace/sensors.ts";

/** The pull request of one branch in one repository, as a stream of readings.
 *
 *  The REMOTE is resolved once per subscription, from the repository itself
 *  (`resolveGitInfo`) — it is what the forge dispatch routes on, and it is a
 *  fact about the checkout rather than about this call. A directory that is no
 *  repository (or a git that would not answer) resolves to NO remote, which is
 *  exactly the `unsupported` arm the dispatcher already answers for a remote it
 *  cannot serve: nothing is invented, and the reading says kolu does not know
 *  rather than that there is no pull request. */
export function branchPrStream(
  at: { readonly repoPath: string; readonly branch: string },
  log: Logger,
): Stream.Stream<PrResult> {
  return streamFromAbortableSource<PrResult>((signal) => {
    const plog = log.child({
      provider: "pr",
      repo: at.repoPath,
      branch: at.branch,
    });
    // The channel is SUBSCRIBED before the watcher is started, so a reading
    // that resolves before the consumer's first pull is queued rather than
    // dropped — the first frame is the snapshot by construction.
    const channel = inMemoryChannel<PrResult>();
    const frames = channel.subscribe(signal);
    const watcher = subscribePr<PrUnavailableSource>(
      dispatchingForgeAdapter,
      (pr) => {
        channel.publish(pr);
      },
      plog,
    );
    // THE REPOSITORY CHANGED, so ASK AGAIN — the same watcher kolu-git's own
    // pulse streams ride (refcounted, @parcel/watcher-backed). A branch's
    // pull request moves when somebody pushes, opens or merges, and every one
    // of those touches the repository; waiting out the thirty-second poll for
    // news that is already on disk is half a minute of a card saying the old
    // thing. A re-resolve that finds the same answer emits nothing.
    const unwatch = subscribeRepoChange(
      at.repoPath,
      askerLabel.pullRequestStream(at.branch),
      () => {
        watcher.refresh();
      },
      plog,
    );
    signal.addEventListener(
      "abort",
      () => {
        unwatch();
        watcher.stop();
      },
      { once: true },
    );
    void resolveGitInfo(at.repoPath, plog)
      .then((git) => {
        if (signal.aborted) return;
        watcher.setGit({
          repoRoot: at.repoPath,
          branch: at.branch,
          remoteUrl: git.ok ? git.value.remoteUrl : null,
        });
      })
      .catch((err: unknown) => {
        plog.warn({ err }, "padi: could not read a branch's remote");
        if (!signal.aborted)
          watcher.setGit({
            repoRoot: at.repoPath,
            branch: at.branch,
            remoteUrl: null,
          });
      });
    return frames;
  });
}
