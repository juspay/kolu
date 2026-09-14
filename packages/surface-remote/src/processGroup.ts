/**
 * A child whose descendants are part of the same owned activity.
 *
 * `ssh` may fork a `ProxyCommand`, and that command may itself fork another
 * ssh. Killing only the direct child leaves those descendants reparented to
 * init. Spawn the activity as a process-group leader and expose one idempotent
 * teardown that signals the exact group, escalating after a short grace.
 */

import {
  type ChildProcess,
  spawn,
  type SpawnOptions,
} from "node:child_process";

const TERM_GRACE_MS = 2_000;

export interface OwnedProcessGroup {
  child: ChildProcess;
  terminate(): void;
}

export function spawnOwnedProcessGroup(
  command: string,
  args: readonly string[],
  options: Omit<SpawnOptions, "detached">,
): OwnedProcessGroup {
  const child = spawn(command, [...args], { ...options, detached: true });
  const pgid = child.pid;
  let terminating = false;
  let escalation: ReturnType<typeof setTimeout> | null = null;

  const groupAlive = (): boolean => {
    if (pgid === undefined || process.platform === "win32") return false;
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (error) {
      if (isErrno(error, "ESRCH")) return false;
      if (isErrno(error, "EPERM")) return true;
      throw error;
    }
  };

  // The leader closing does not prove its ProxyCommand descendants are gone.
  // Cancel escalation only when the exact process group is empty.
  child.once("close", () => {
    if (escalation !== null && !groupAlive()) {
      clearTimeout(escalation);
      escalation = null;
    }
  });

  return {
    child,
    terminate: () => {
      if (terminating) return;
      terminating = true;

      if (pgid === undefined || process.platform === "win32") {
        child.kill("SIGTERM");
        return;
      }

      try {
        process.kill(-pgid, "SIGTERM");
      } catch (error) {
        // macOS can answer EPERM when the externally-killed group leader has
        // already gone but the process-group identity has not disappeared
        // yet. Teardown is best-effort: there is no process we are permitted
        // to signal in either case, and surfacing the cleanup race would crash
        // the owner after its real work has already settled.
        if (isUnsignalable(error)) return;
        throw error;
      }

      // Keep this timer referenced: teardown must finish even when the process
      // group is the last activity holding the caller open.
      escalation = setTimeout(() => {
        escalation = null;
        try {
          process.kill(-pgid, "SIGKILL");
        } catch (error) {
          if (!isUnsignalable(error)) throw error;
        }
      }, TERM_GRACE_MS);
    },
  };
}

function isUnsignalable(error: unknown): boolean {
  return isErrno(error, "ESRCH") || isErrno(error, "EPERM");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
