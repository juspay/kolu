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
 * Multi-instance namespacing (`instance`) carries padi's digest-keyed shape
 * (`padi-<digest>/`, `kaval-<digest>/`): the directory is
 * `<app>-<instance>/`, while gate/socket basenames keep the bare app stem
 * (`padi.pid`, not `padi-<digest>.pid`). kaval and padi are the real callers.
 *
 * `resolveDaemonHome` is the pure path algebra (no I/O) path helpers and
 * discovery consume. `daemonHome` materialises the dir `0700` and refuses
 * (throws) if it is not a private, owner-only directory we own — the same
 * security boundary `acquirePidGate` / `serveOverUnixSocket` enforce.
 */

import { lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { isPrivateOwnedDir } from "./privateOwnedDir.ts";
import type { SharedArtifact } from "./sharedArtifact.ts";

/** A single non-empty path segment — not empty, not `.`/`..`, no separators.
 *  Package-private so `app`, `instance`, and `file(name)` share one
 *  containment rule. */
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

/** Options for {@link resolveDaemonHome} / {@link daemonHome}. */
export type DaemonHomeOptions = {
  /** App stem — basename for `<app>.pid` (and default `<app>.sock`), and the
   *  directory component when `instance` is unset. Must be a single path
   *  segment: non-empty, no `/` or `\`, not `.` or `..` (those would escape
   *  the private home via `path.join`). */
  app: string;
  /** Durable state dir vs session-scoped runtime dir — see module doc. */
  placement: DaemonHomePlacement;
  /**
   * Multi-instance key (padi's state-root digest). When set, the home
   * directory is `<app>-<instance>/` instead of bare `<app>/`. Gate and
   * default socket basenames keep the bare app stem so the instance key
   * only namespaces the directory. Must be a single path segment.
   */
  instance?: string;
  /**
   * Socket basename inside the home. Defaults to `<app>.sock`. kaval's
   * historical name is `pty-host.sock` — a real caller, not a zero-use knob.
   */
  socketFile?: string;
};

/** Pure path algebra — no I/O. Path helpers and discovery use this so they
 *  never create dirs and never disagree with {@link daemonHome}. */
export type ResolvedDaemonHome = {
  /** Directory component: bare `<app>` or `<app>-<instance>`. */
  appNamespace: string;
  /** The daemon's on-disk home directory path (not created). */
  dir: string;
  /** Single-instance gate: `<dir>/<app>.pid`. */
  gatePath: string;
  /** Serving socket: `<dir>/<socketFile ?? app.sock>`. */
  socketPath: string;
  /** Path for any extra file the consumer names under the home. */
  file: (name: string) => string;
  /** Human `pathShape` root for inventory entries (same branch as `dir`). */
  pathShapeRoot: string;
  /** Gate basename (`<app>.pid`). */
  gateName: string;
  /** Socket basename. */
  sockName: string;
};

/** The home `daemonHome` materialises — paths + registry entries. */
export type DaemonHome = {
  /** The daemon's on-disk home directory (created `0700`, ownership-checked). */
  dir: string;
  /** Single-instance gate: `<dir>/<app>.pid`. */
  gatePath: string;
  /** Serving socket: `<dir>/<socketFile ?? app.sock>`. */
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

/**
 * Resolve the home directory namespace under `placement` — no I/O.
 * `appNamespace` is bare `app` or `app-instance`.
 */
function resolveDir(
  appNamespace: string,
  placement: DaemonHomePlacement,
): { dir: string; pathShapeRoot: string } {
  switch (placement) {
    case "state": {
      const xdg = process.env.XDG_STATE_HOME;
      if (xdg !== undefined && xdg !== "") {
        return {
          dir: join(xdg, appNamespace),
          pathShapeRoot: `$XDG_STATE_HOME/${appNamespace}`,
        };
      }
      const home = process.env.HOME || homedir();
      if (!home) {
        throw new Error(
          `daemonHome: cannot resolve state placement for app "${appNamespace}" — ` +
            `set $XDG_STATE_HOME or $HOME`,
        );
      }
      return {
        dir: join(home, ".local", "state", appNamespace),
        pathShapeRoot: `~/.local/state/${appNamespace}`,
      };
    }
    case "runtime": {
      // Same XDG / `/tmp/<app>-$UID` convention as getRuntimeSocketPath.
      // Derive the dir from a dummy file under the app namespace so the path
      // algebra stays single-sourced in @kolu/surface/unix-socket.
      const dir = dirname(
        getRuntimeSocketPath({ app: appNamespace, file: "x" }),
      );
      const pathShapeRoot =
        process.env.XDG_RUNTIME_DIR !== undefined &&
        process.env.XDG_RUNTIME_DIR !== ""
          ? `$XDG_RUNTIME_DIR/${appNamespace}`
          : `/tmp/${appNamespace}-$UID`;
      return { dir, pathShapeRoot };
    }
    default: {
      const _exhaustive: never = placement;
      throw new Error(
        `daemonHome: unknown placement ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Pure path algebra for a daemon home — no mkdir, no ownership check.
 * kaval/padi path helpers and discovery use this so construction and
 * discovery cannot spell different shapes than {@link daemonHome}.
 */
export function resolveDaemonHome(opts: DaemonHomeOptions): ResolvedDaemonHome {
  const { app, placement, instance, socketFile } = opts;
  assertPathSegment("daemonHome: app", app);
  if (instance !== undefined) {
    assertPathSegment("daemonHome: instance", instance);
  }
  if (socketFile !== undefined) {
    assertPathSegment("daemonHome: socketFile", socketFile);
  }

  const appNamespace = instance !== undefined ? `${app}-${instance}` : app;
  const { dir, pathShapeRoot } = resolveDir(appNamespace, placement);

  // Gate/socket basenames keep the bare app stem even when instance
  // decorates the directory — `padi-<digest>/padi.pid`, never
  // `padi-<digest>/padi-<digest>.pid`.
  const gateName = `${app}.pid`;
  const sockName = socketFile ?? `${app}.sock`;
  const gatePath = join(dir, gateName);
  const socketPath = join(dir, sockName);

  return {
    appNamespace,
    dir,
    gatePath,
    socketPath,
    pathShapeRoot,
    gateName,
    sockName,
    file: (name: string) => {
      assertPathSegment("daemonHome.file: name", name);
      return join(dir, name);
    },
  };
}

function artifactsFor(
  app: string,
  resolved: ResolvedDaemonHome,
): readonly SharedArtifact[] {
  const { pathShapeRoot, gateName, sockName } = resolved;
  return [
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
}

/**
 * Materialise a daemon's on-disk home: create the dir `0700`, verify it is
 * owner-only with owner rwx, and return the well-known paths + registry entries.
 *
 * Throws if `app` / `instance` / `socketFile` is not a single path segment, or
 * if the home directory is not private and usable by the current user.
 */
export function daemonHome(opts: DaemonHomeOptions): DaemonHome {
  const resolved = resolveDaemonHome(opts);
  const { dir, gatePath, socketPath, file } = resolved;

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

  return {
    dir,
    gatePath,
    socketPath,
    file,
    artifacts: artifactsFor(opts.app, resolved),
  };
}
