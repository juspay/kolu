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
import type { SharedArtifact } from "./sharedArtifact.ts";

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

/** Is `dir` a private, owner-only directory the current user owns?
 *  Mirrors the check in `pidGate` / `@kolu/surface/unix-socket` /
 *  kaval's discovery — same boundary, read here so a non-private home
 *  fails before any gate or socket is written. `lstatSync` so a symlink
 *  is judged as itself and rejected. Returns true on platforms without
 *  uid semantics (Windows). */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** Resolve the home directory for `app` under `placement` — no I/O. */
function resolveDir(app: string, placement: DaemonHomePlacement): string {
  if (placement === "state") {
    const xdg = process.env.XDG_STATE_HOME;
    if (xdg !== undefined && xdg !== "") return join(xdg, app);
    const home = process.env.HOME || homedir();
    if (!home) {
      throw new Error(
        `daemonHome: cannot resolve state placement for app "${app}" — ` +
          `set $XDG_STATE_HOME or $HOME`,
      );
    }
    return join(home, ".local", "state", app);
  }
  // Runtime: same XDG / `/tmp/<app>-$UID` convention as getRuntimeSocketPath.
  // Derive the dir from a dummy file under the app namespace so the path
  // algebra stays single-sourced in @kolu/surface/unix-socket.
  return dirname(getRuntimeSocketPath({ app, file: "x" }));
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
  if (app === "" || app.includes("/") || app.includes("\\")) {
    throw new Error(
      `daemonHome: app must be a non-empty single path segment, got ${JSON.stringify(app)}`,
    );
  }

  const dir = resolveDir(app, placement);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!isPrivateOwnedDir(dir)) {
    throw new Error(
      `daemonHome: ${dir} is not a private owner-only directory ` +
        `(must be owned by the current user with mode 0700)`,
    );
  }

  const gateName = `${app}.pid`;
  const sockName = `${app}.sock`;
  const gatePath = join(dir, gateName);
  const socketPath = join(dir, sockName);

  // pathShape is documentation for humans / the inventory (env names are
  // literal text, not interpolated). Match the style of existing inventory
  // entries (`$XDG_RUNTIME_DIR/…`, `$XDG_STATE_HOME|~/.local/state/…`).
  const pathRoot =
    placement === "state"
      ? `$XDG_STATE_HOME|~/.local/state/${app}`
      : `$XDG_RUNTIME_DIR/${app} | /tmp/${app}-$UID`;

  const artifacts: readonly SharedArtifact[] = [
    {
      id: `${app}-gate`,
      pathShape: `${pathRoot}/${gateName}`,
      role: "gate",
      coveredByTest: null,
      versionField: null,
      diskBasenames: [gateName],
      diskBasenamePatterns: [],
      why: `Single-instance pid gate for ${app}; co-located with the socket by daemonHome.`,
    },
    {
      id: `${app}-socket`,
      pathShape: `${pathRoot}/${sockName}`,
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
      if (name === "" || name.includes("/") || name.includes("\\")) {
        throw new Error(
          `daemonHome.file: name must be a non-empty single path segment, got ${JSON.stringify(name)}`,
        );
      }
      return join(dir, name);
    },
    artifacts,
  };
}
