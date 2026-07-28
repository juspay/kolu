/**
 * Where a daemon's files live — directory, gate, socket, and any extra names
 * the consumer invents under that home — decided once.
 *
 * This is a **framework primitive the spine speaks**, not an upstreamed helper.
 * `daemonMain`'s {@link DaemonSpec} and the supervisor's `createEndpoint` accept
 * a {@link DaemonHomePaths} and derive gate/socket from it; loose path strings
 * do not appear at those call sites. Overrides (CLI `--socket`, env) are absorbed
 * into home construction ({@link resolveDaemonHome}'s `socketOverride`), never
 * sprinkled past the home.
 *
 * Placement is the one decision that actually matters:
 *
 *   - `"state"`  → `~/.local/state/<app>/` ($HOME / passwd home — **not**
 *     `$XDG_STATE_HOME`, which splits identity across launch contexts).
 *     Durable across reboots. A daemon that must outlive user sessions —
 *     anything supervised over ssh — takes this: logind deletes the runtime
 *     dir with the user's last session, leaving an orphan daemon whose
 *     socket and gate vanished while the process kept running. A held gate
 *     whose co-located socket is dead is reclaimed ({@link confirmHeldGate})
 *     so a reboot PID reuse cannot strand a start as already-running.
 *   - `"runtime"` → `$XDG_RUNTIME_DIR/<app>/`, falling back to
 *     `/tmp/<app>-$UID/` (via `@kolu/surface/unix-socket`'s
 *     `getRuntimeSocketPath`). Boot-wiped; fine for a single-machine daemon
 *     that dies with the session.
 *
 * Multi-instance namespacing (`instance`) is the **only** spelling for a
 * decorated home: dir is `<app>-<instance>/`, while gate/socket basenames
 * keep the bare app stem (`padi.pid`, not `padi-<digest>.pid`).
 *
 * `resolveDaemonHome` is pure path algebra (no I/O, never mutates env).
 * `daemonHome` materialises the dir `0700` and refuses if it is not private.
 */

import { lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { isPrivateOwnedDir } from "./privateOwnedDir.ts";
import type { SharedArtifact } from "./sharedArtifact.ts";

/** A single non-empty path segment — not empty, not `.`/`..`, no separators. */
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

/**
 * Runtime-placement root, for pure multi-regime discovery without mutating
 * `process.env`:
 *   - omitted — read live `$XDG_RUNTIME_DIR` (binder default)
 *   - `null` — force the `/tmp/<ns>-$UID` branch
 *   - non-empty string — use this value as `$XDG_RUNTIME_DIR`
 *
 * Only accepted by {@link resolveDaemonHome} (discovery). Ignored for
 * `"state"` placement. An explicit empty string throws (use `null` to force
 * `/tmp`).
 */
export type DaemonHomeRuntimeRoot = string | null;

/**
 * The face the spine speaks — gate and socket co-located under `dir`.
 * Both {@link resolveDaemonHome} and {@link daemonHome} produce it;
 * `daemonMain` and `createEndpoint` accept it and derive paths only from it.
 */
export type DaemonHomePaths = {
  /** The daemon's on-disk home directory. */
  readonly dir: string;
  /** Single-instance gate: `<dir>/<app>.pid` (or beside a socket override). */
  readonly gatePath: string;
  /** Serving socket. */
  readonly socketPath: string;
};

/** Options for pure path resolution ({@link resolveDaemonHome}). */
export type ResolveDaemonHomeOptions = {
  /** App stem — basename for `<app>.pid` (and default `<app>.sock`). */
  app: string;
  /** Durable state dir vs session-scoped runtime dir — see module doc. */
  placement: DaemonHomePlacement;
  /**
   * Multi-instance key (padi's state-root digest, or a legacy port string).
   * When set, the home directory is `<app>-<instance>/`. Gate/socket basenames
   * keep the bare app stem.
   */
  instance?: string;
  /**
   * Socket basename inside the home. Defaults to `<app>.sock`. kaval's
   * historical name is `pty-host.sock`.
   */
  socketFile?: string;
  /**
   * Explicit socket path (CLI `--socket` / env). Absorbs the override into
   * home construction: gate and `file()` sit beside this path; placement /
   * instance algebra is skipped. Empty string is absent.
   */
  socketOverride?: string;
  /**
   * Which runtime drawer to evaluate under (discovery only — see
   * {@link DaemonHomeRuntimeRoot}). Pure; never writes `process.env`.
   */
  runtimeRoot?: DaemonHomeRuntimeRoot;
};

/** Options for materialising a home ({@link daemonHome}) — no discovery-only
 *  `runtimeRoot` (construction always uses live placement). */
export type DaemonHomeOptions = Omit<ResolveDaemonHomeOptions, "runtimeRoot">;

/** Pure path algebra result — {@link DaemonHomePaths} plus helpers. */
export type ResolvedDaemonHome = DaemonHomePaths & {
  /** Directory component: bare `<app>` or `<app>-<instance>`. */
  readonly appNamespace: string;
  /** Path for any extra file the consumer names under the home. */
  readonly file: (name: string) => string;
  /** Human `pathShape` root for inventory entries. */
  readonly pathShapeRoot: string;
  /** Gate basename. */
  readonly gateName: string;
  /** Socket basename. */
  readonly sockName: string;
};

/** Materialised home — paths + registry entries after `0700` create/verify. */
export type DaemonHome = DaemonHomePaths & {
  /** Path for any extra file the consumer names under the home. */
  readonly file: (name: string) => string;
  /**
   * `SharedArtifact` registry entries for gate + socket by construction.
   * Feed them into a UW2 inventory.
   */
  readonly artifacts: readonly SharedArtifact[];
};

function resolveDir(
  appNamespace: string,
  placement: DaemonHomePlacement,
  runtimeRoot: DaemonHomeRuntimeRoot | undefined,
): { dir: string; pathShapeRoot: string } {
  switch (placement) {
    case "state": {
      // HOME-only — deliberately ignore $XDG_STATE_HOME. That env varies by
      // launch context (login shell vs bare ssh vs systemd unit); two contexts
      // computing two "state" homes would split one daemon's identity. Same
      // lesson as productionPadiStateRoot. $HOME (or passwd home) is stable.
      const home = process.env.HOME || homedir();
      if (!home) {
        throw new Error(
          `daemonHome: cannot resolve state placement for app "${appNamespace}" — ` +
            `set $HOME`,
        );
      }
      return {
        dir: join(home, ".local", "state", appNamespace),
        pathShapeRoot: `~/.local/state/${appNamespace}`,
      };
    }
    case "runtime": {
      // Single-source the XDG / `/tmp/<ns>-$UID` formula through
      // getRuntimeSocketPath (including pure multi-regime via xdgRuntimeDir).
      if (runtimeRoot === "") {
        throw new Error(
          `daemonHome: runtimeRoot must be a non-empty path or null (force /tmp), got ""`,
        );
      }
      const dir = dirname(
        getRuntimeSocketPath({
          app: appNamespace,
          file: "x",
          xdgRuntimeDir: runtimeRoot,
        }),
      );
      const pathShapeRoot =
        runtimeRoot === null
          ? `/tmp/${appNamespace}-$UID`
          : runtimeRoot !== undefined
            ? `$XDG_RUNTIME_DIR/${appNamespace}`
            : process.env.XDG_RUNTIME_DIR !== undefined &&
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
 * Pure path algebra for a daemon home — no mkdir, no ownership check, no
 * env mutation. Path helpers, discovery, and the spine consume this so
 * construction and discovery cannot spell different shapes than
 * {@link daemonHome}.
 */
export function resolveDaemonHome(
  opts: ResolveDaemonHomeOptions,
): ResolvedDaemonHome {
  const { app, placement, instance, socketFile, socketOverride, runtimeRoot } =
    opts;
  assertPathSegment("daemonHome: app", app);
  if (instance !== undefined) {
    assertPathSegment("daemonHome: instance", instance);
  }
  if (socketFile !== undefined) {
    assertPathSegment("daemonHome: socketFile", socketFile);
  }

  const gateName = `${app}.pid`;
  const defaultSockName = socketFile ?? `${app}.sock`;

  // Override absorbed here — not at call sites past the home.
  if (socketOverride !== undefined && socketOverride !== "") {
    const dir = dirname(socketOverride);
    const sockName = basename(socketOverride);
    const appNamespace = instance !== undefined ? `${app}-${instance}` : app;
    const gatePath = join(dir, gateName);
    return {
      appNamespace,
      dir,
      gatePath,
      socketPath: socketOverride,
      pathShapeRoot: dir,
      gateName,
      sockName,
      file: (name: string) => {
        assertPathSegment("daemonHome.file: name", name);
        return join(dir, name);
      },
    };
  }

  const appNamespace = instance !== undefined ? `${app}-${instance}` : app;
  const { dir, pathShapeRoot } = resolveDir(
    appNamespace,
    placement,
    runtimeRoot,
  );
  const sockName = defaultSockName;
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
 */
export function daemonHome(opts: DaemonHomeOptions): DaemonHome {
  const resolved = resolveDaemonHome(opts);
  const { dir, gatePath, socketPath, file } = resolved;

  mkdirSync(dir, { recursive: true, mode: 0o700 });
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
