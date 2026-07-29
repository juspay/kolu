/** Previous-release identity, readiness, orchestration, and process cleanup. */

import { type ChildProcess } from "node:child_process";
import { once } from "node:events";

const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

/** Store identities that prove two real daemon generations are under test. */
export interface PreviousReleaseWindow {
  ref: string;
  previousStore: string;
  currentStore: string;
}

/** True only for the release tags accepted by mixed-version windows. */
export function isPreviousReleaseTag(value: string): boolean {
  return VERSION_TAG.test(value);
}

export function assertPreviousReleaseWindow(
  window: PreviousReleaseWindow,
): void {
  if (!isPreviousReleaseTag(window.ref)) {
    throw new Error(
      `previous ref must be a version tag (vX.Y.Z), got ${window.ref}`,
    );
  }
  if (window.previousStore.length === 0 || window.currentStore.length === 0) {
    throw new Error("previous and current store paths must both be set");
  }
  if (window.previousStore === window.currentStore) {
    throw new Error(
      `mixed-version window collapsed: previous store equals current (${window.previousStore})`,
    );
  }
}

export async function waitForSocket(
  socketPath: string,
  probe: (path: string) => Promise<void>,
  ms = 60_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await probe(socketPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(
    `socket never ready at ${socketPath}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Tracks spawned test processes and bounds graceful then forced teardown. */
export interface ProcessReaper {
  track(child: ChildProcess): ChildProcess;
  dispose(): Promise<void>;
}

export function createProcessReaper(graceMs = 2000): ProcessReaper {
  const children = new Set<ChildProcess>();
  return {
    track(child) {
      children.add(child);
      child.once("exit", () => children.delete(child));
      return child;
    },
    async dispose() {
      for (const child of [...children]) {
        if (child.exitCode === null && child.signalCode === null) {
          const gracefulExit = once(child, "exit", {
            signal: AbortSignal.timeout(graceMs),
          });
          try {
            child.kill("SIGTERM");
          } catch {
            // Already gone.
          }
          try {
            await gracefulExit;
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "AbortError") {
              throw error;
            }
          }
        }
        if (child.exitCode === null && child.signalCode === null) {
          const forcedExit = once(child, "exit");
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
          await forcedExit;
        }
      }
      children.clear();
    },
  };
}

export async function runPreviousReleaseWindow<
  W extends PreviousReleaseWindow,
>(opts: {
  window: W;
  newReadsOld: (window: W) => void | Promise<void>;
  oldReadsNew: (window: W) => void | Promise<void>;
}): Promise<void> {
  assertPreviousReleaseWindow(opts.window);
  await opts.newReadsOld(opts.window);
  await opts.oldReadsNew(opts.window);
}
