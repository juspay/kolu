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
    const channel = inMemoryChannel<PrResult>();
    const frames = channel.subscribe(signal);
    const watcher = subscribePr<PrUnavailableSource>(
      dispatchingForgeAdapter,
      (pr) => {
        channel.publish(pr);
      },
      plog,
    );
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
