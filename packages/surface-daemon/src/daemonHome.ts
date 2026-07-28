/**
 * Where a daemon's files live — directory, gate, socket, and any extra names
 * the consumer invents under that home — decided once.
 *
 * Placement is the one decision that actually matters:
 *
 *   - `"state"`  → `${XDG_STATE_HOME:-~/.local/state}/<app>/`
 *     Durable across reboots. A daemon that must outlive user sessions —
 *     anything supervised over ssh — takes this: logind deletes the runtime
 *     dir with the user's last session, leaving an orphan daemon whose
 *     socket and gate vanished while the process kept running.
 *   - `"runtime"` → `$XDG_RUNTIME_DIR/<app>/`, falling back to
 *     `/tmp/<app>-$UID/` (the same convention as
 *     `@kolu/surface/unix-socket`'s `getRuntimeSocketPath`). Boot-wiped;
 *     fine for a single-machine daemon that dies with the session.
 *
 * Creates the home `0700` and refuses (throws) if it is not a private,
 * owner-only directory we own — the same security boundary
 * `acquirePidGate` / `serveOverUnixSocket` enforce. Multi-instance
 * namespacing (padi's digest-keyed dirs) is deliberately not built: its
 * only would-be consumers keep their hand-rolled paths, and we don't ship
 * knobs with zero callers.
 */

import { lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { isPrivateOwnedDir } from "./privateOwnedDir.ts";
import type { SharedArtifact } from "./sharedArtifact.ts";

/** A single non-empty path segment — not empty, not `.`/`..`, no separators.
 *  Package-private so `app` and `file(name)` share one containment rule. */
function assertPathSegment(kind: string, name: string): void {
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(
      `${kind} must be a non-empty single path segment, got ${JSON.stringify(name)}`,
    );
  }
}

/** Where the daemon home sits on disk. See the module doc for the rule. */
export type DaemonHomePlacement = "state" | "runtime";

/** The home `daemonHome` materialises — paths + registry entries. */
export type DaemonHome = {
  /** The daemon's on-disk home directory (created `0700`, ownership-checked). */
  dir: string;
  /** Single-instance gate: `<dir>/<app>.pid`. */
  gatePath: string;
  /** Serving socket: `<dir>/<app>.sock`. */
  socketPath: string;
  /** Path for any extra file the consumer names under the home. */
  file: (name: string) => string;
  /**
   * `SharedArtifact` registry entries for every file this call names by
   * construction (gate + socket). Feed them into a UW2 inventory so the
   * shared-file list is complete without a second hand-written entry.
   */
  artifacts: readonly SharedArtifact[];
};

/** Options for {@link daemonHome}. */
export type DaemonHomeOptions = {
  /** App namespace — the directory component under state/runtime, and the
   *  basename stem for `<app>.pid` / `<app>.sock`. Must be a single path
   *  segment (no `/`, no empty). */
  app: string;
  /** Durable state dir vs session-scoped runtime dir — see module doc. */
  placement: DaemonHomePlacement;
};

/**
 * Resolve the home directory for `app` under `placement` — no I/O.
 * Also returns the human `pathShape` root for inventory entries, derived
 * from the SAME branch as `dir` so the two cannot drift.
 */
function resolveDir(
  app: string,
  placement: DaemonHomePlacement,
): { dir: string; pathShapeRoot: string } {
  if (placement === "state") {
    const xdg = process.env.XDG_STATE_HOME;
    if (xdg !== undefined && xdg !== "") {
      return {
        dir: join(xdg, app),
        pathShapeRoot: `$XDG_STATE_HOME/${app}`,
      };
    }
    const home = process.env.HOME || homedir();
    if (!home) {
      throw new Error(
        `daemonHome: cannot resolve state placement for app "${app}" — ` +
          `set $XDG_STATE_HOME or $HOME`,
      );
    }
    return {
      dir: join(home, ".local", "state", app),
      pathShapeRoot: `~/.local/state/${app}`,
    };
  }
  // Runtime: same XDG / `/tmp/<app>-$UID` convention as getRuntimeSocketPath.
  // Derive the dir from a dummy file under the app namespace so the path
  // algebra stays single-sourced in @kolu/surface/unix-socket.
  const dir = dirname(getRuntimeSocketPath({ app, file: "x" }));
  const pathShapeRoot =
    process.env.XDG_RUNTIME_DIR !== undefined &&
    process.env.XDG_RUNTIME_DIR !== ""
      ? `$XDG_RUNTIME_DIR/${app}`
      : `/tmp/${app}-$UID`;
  return { dir, pathShapeRoot };
}

/**
 * Materialise a daemon's on-disk home: create the dir `0700`, verify it is
 * owner-only, and return the well-known paths + registry entries.
 *
 * Throws if `app` is empty or contains a path separator, or if the home
 * directory exists but is not private and owned by the current user.
 */
export function daemonHome(opts: DaemonHomeOptions): DaemonHome {
  const { app, placement } = opts;
  assertPathSegment("daemonHome: app", app);

  const { dir, pathShapeRoot } = resolveDir(app, placement);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Owner-only (no group/other) AND usable owner rwx — the API promises 0700.
  // `isPrivateOwnedDir` only forbids group/other bits; a pre-existing 000 or
  // 0500 dir would pass it and fail later on gate/socket create.
  if (!isPrivateOwnedDir(dir) || (lstatSync(dir).mode & 0o700) !== 0o700) {
    throw new Error(
      `daemonHome: ${dir} is not a private owner-only directory ` +
        `(must be owned by the current user with mode 0700)`,
    );
  }

  const gateName = `${app}.pid`;
  const sockName = `${app}.sock`;
  const gatePath = join(dir, gateName);
  const socketPath = join(dir, sockName);

  const artifacts: readonly SharedArtifact[] = [
    {
      id: `${app}-gate`,
      pathShape: `${pathShapeRoot}/${gateName}`,
      role: "gate",
      coveredByTest: null,
      versionField: null,
      diskBasenames: [gateName],
      diskBasenamePatterns: [],
      why: `Single-instance pid gate for ${app}; co-located with the socket by daemonHome.`,
    },
    {
      id: `${app}-socket`,
      pathShape: `${pathShapeRoot}/${sockName}`,
      role: "socket",
      coveredByTest: null,
      versionField: null,
      diskBasenames: [sockName],
      diskBasenamePatterns: [],
      why: `Serving socket for ${app}; co-located with the gate by daemonHome.`,
    },
  ];

  return {
    dir,
    gatePath,
    socketPath,
    file: (name: string) => {
      assertPathSegment("daemonHome.file: name", name);
      return join(dir, name);
    },
    artifacts,
  };
}
