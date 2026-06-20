/**
 * The well-known unix-socket path where kolu-server serves the in-process
 * pty-host and `kaval-tui` connects to it. Single source of truth so the
 * server and the CLI — two separate packages, two separate processes —
 * compute it identically.
 *
 * The rendezvous mechanics (why a stable path; why the off-systemd fallback
 * is a fixed `/tmp/<app>-$UID/`, NOT `os.tmpdir()` whose `$TMPDIR` form
 * diverged between a launchd server and a `nix run` CLI on macOS — the
 * "no pty-host socket at /tmp/kolu/..." bug) live with
 * `getRuntimeSocketPath` in `@kolu/surface/unix-socket`; this module just
 * pins kolu's names.
 *
 * kolu-server namespaces its daemon PER INSTANCE by listen port
 * (`kaval-<port>/`), so two servers on one box never collide on a single gate
 * (the prod incident where a second server recycled the first's daemon). The
 * consequence: there is no one fixed path a flag-less `kaval-tui` can assume, so
 * it `discoverPtyHostSockets()` the running daemon instead.
 */
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** The socket filename inside every kaval rendezvous dir. */
export const PTY_HOST_SOCK_FILE = "pty-host.sock";

/** The app-namespace prefix kaval owns. A standalone daemon serves under it
 *  bare (`kaval/`); each kolu-server serves under a per-port decoration of it
 *  (`kavalNamespace(port)` → `kaval-<port>/`). The prefix is the one literal
 *  that ties construction and discovery together. */
export const KAVAL_NS_PREFIX = "kaval";

/** The app namespace for a kolu-server's per-instance daemon, keyed by listen
 *  port so two servers on one box never collide on a single gate. */
export function kavalNamespace(port: number): string {
  return `${KAVAL_NS_PREFIX}-${port}`;
}

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/<app>/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/<app>-$UID/pty-host.sock`. `app` is parameterized (default
 *  `"kolu"`) so a standalone daemon can own its own rendezvous namespace
 *  without the host name being hardcoded into the path. */
export function getPtyHostSocketPath(override?: string, app = "kolu"): string {
  return getRuntimeSocketPath({
    app,
    file: PTY_HOST_SOCK_FILE,
    override,
  });
}

/** Is `dir` a private, owner-only directory the current user owns? The SAME
 *  boundary `serveOverUnixSocket` / `acquirePidGate` enforce before serving (cf.
 *  `isPrivateOwnedDir` in `@kolu/surface/unix-socket`). It is re-checked HERE, on
 *  the connecting side, because a stable shared path (`/tmp/<app>-$UID`) is one
 *  any local user can pre-create: the `-$UID` in the NAME is not an ownership
 *  proof, so without this a flag-less `kaval-tui` would happily dial another
 *  user's planted socket and hand them its session. `lstatSync` (NOT `statSync`)
 *  so a symlink is judged as itself and rejected, never followed to a target the
 *  attacker still controls the `/tmp` component of. Returns true on platforms
 *  without uid semantics (Windows: `process.getuid` is undefined) — the ACL model
 *  there is out of scope. */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
  } catch {
    // Couldn't stat at all — treat as not-private (skip) rather than assume safe.
    return false;
  }
}

/** Discover the rendezvous sockets of running pty-host daemons under the per-user
 *  runtime root, EACH LABELED by the branch that matched — every kolu-server's
 *  per-port namespace (`kaval-<port>/` → "kolu-server on port <port>") plus a bare
 *  standalone `kaval/` (→ "standalone kaval"). Lets a flag-less `kaval-tui` dial
 *  the daemon without knowing the server's port, and a `many`-candidate error name
 *  each one correctly.
 *
 *  The runtime root and the env's namespace decoration are NOT re-derived here:
 *  they are READ BACK from `getRuntimeSocketPath` itself, so discovery can never
 *  spell the path shape differently than construction. Build the bare daemon's
 *  socket path, then walk back up — its grandparent is the root to scan, its
 *  parent's basename is the (possibly `-$UID`-decorated) bare namespace dir. The
 *  per-port pattern is the same decoration with a `(\d+)` capture substituted for
 *  the port, learnt from a probe build with port `0`.
 *
 *  Labeling is the INVERSE of `kavalNamespace`, derived from THIS match — not a
 *  later re-parse of the basename. That distinction matters: a re-parse of a bare
 *  `kaval-7692` basename alone can't tell a port from an off-XDG `-$UID` suffix
 *  and would have to hedge ("port 7692, or a standalone kaval"). Here, a name that
 *  equals `bareName` IS the standalone daemon and a name that matches the ported
 *  pattern IS a kolu-server — the ambiguity never arises because the matching
 *  branch already decided, against this user's actual `bareName`/`portedRe`.
 *
 *  A name match is necessary but NOT sufficient: every candidate's namespace dir
 *  must also pass the same owner-only privacy check the serving side enforces, so
 *  a sibling another local user planted under the shared `/tmp` root (whose name
 *  they can spell freely, `-$UID` and all) is never dialed. The socket inode must
 *  itself be a socket — not any file a name-squatter dropped in. Returns every
 *  surviving `<ns>/pty-host.sock`; never throws (an unreadable root → []). */
export function discoverKavalCandidates(): KavalSocketCandidate[] {
  // The bare daemon's socket: `<root>/<bareDir>/pty-host.sock`. Whatever shape
  // surface gives it (XDG `kaval/`, or `/tmp` `kaval-$UID/`) the decoration is
  // baked into `bareDir`, never re-decided here.
  const bareDir = dirname(
    getRuntimeSocketPath({ app: KAVAL_NS_PREFIX, file: PTY_HOST_SOCK_FILE }),
  );
  const root = dirname(bareDir);
  const bareName = basename(bareDir);

  // Learn the env's port decoration from the builder too: a probe build with
  // port `0` yields the decorated per-port name; turn its literal `0` back into
  // a `(\d+)` capture group to both match any port AND read it back for the
  // label. (Escape the rest so a `/tmp` path can't inject regex metacharacters.)
  const portedName = basename(
    dirname(
      getRuntimeSocketPath({
        app: kavalNamespace(0),
        file: PTY_HOST_SOCK_FILE,
      }),
    ),
  );
  const portedRe = new RegExp(
    `^${portedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "(\\d+)")}$`,
  );

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: KavalSocketCandidate[] = [];
  for (const name of entries) {
    // Classify by the branch that matches — this IS the label, decided here
    // against this user's real bareName/portedRe, so the later "many" error
    // never has to hedge between a port and an off-XDG `-$UID`.
    let label: string;
    if (name === bareName) {
      label = "standalone kaval";
    } else {
      const m = portedRe.exec(name);
      if (m === null) continue;
      label = `kolu-server on port ${m[1]}`;
    }
    // Name match alone is not ownership: require the namespace dir to be ours
    // and owner-only (the serving-side boundary), and the inode to be an actual
    // socket — so a name-squatter's planted dir/file under a shared root is
    // never dialed.
    const dir = join(root, name);
    if (!isPrivateOwnedDir(dir)) continue;
    const sock = join(dir, PTY_HOST_SOCK_FILE);
    if (isSocketInode(sock)) found.push({ socket: sock, label });
  }
  return found;
}

/** The discovered sockets as bare paths — the back-compat shape for callers that
 *  only need the paths (not the labels). `discoverKavalCandidates` is the source
 *  of truth; this drops the labels. */
export function discoverPtyHostSockets(): string[] {
  return discoverKavalCandidates().map((c) => c.socket);
}

/** Is `path` an actual socket inode? `lstatSync` (NOT `statSync`) so a symlink
 *  is judged as itself, never followed — a name-squatter must not be able to
 *  point us elsewhere with a link. A missing path or any non-socket inode → no. */
function isSocketInode(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

/** A labeled candidate kaval socket — the pasteable path plus a human label that
 *  tells a kolu-server (port-namespaced) apart from a standalone daemon. The label
 *  is decided by `discoverKavalCandidates` at the matching branch (`bareName` →
 *  standalone, the ported pattern → a specific port), so it is never the hedged
 *  "port N, or a standalone" a basename re-parse would have to fall back to. */
export interface KavalSocketCandidate {
  socket: string;
  label: string;
}

/** The outcome of resolving which running kaval to dial — the selection policy
 *  ("explicit wins; else discover; one→use it; many→ambiguous; none→default")
 *  lives here, beside the namespace construction it inverts, so a consumer only
 *  renders the `many`/`none` cases in its own error surface. */
export type KavalSocketResolution =
  | { kind: "explicit" | "one" | "none"; socket: string }
  | { kind: "many"; candidates: KavalSocketCandidate[] };

/** Resolve which running kaval to dial. An explicit path wins (verbatim — it's a
 *  user-supplied `--socket`/`--kaval` flag). Otherwise discover the running
 *  daemon: kolu-server namespaces its daemon by listen port (`kaval-<port>/`), so
 *  there is no single fixed path to assume. Exactly one found → `one`. More than
 *  one → `many`, with each candidate LABELED (the caller renders a pick-one
 *  error). None → `none` with the bare `kaval` default, so a connect error names
 *  a sensible path. */
export function resolveRunningKavalSocket(
  explicit?: string,
): KavalSocketResolution {
  if (explicit !== undefined && explicit !== "") {
    return { kind: "explicit", socket: explicit };
  }
  const found = discoverKavalCandidates();
  const [first, ...rest] = found;
  if (first !== undefined && rest.length === 0) {
    return { kind: "one", socket: first.socket };
  }
  if (rest.length > 0) {
    // Each candidate already carries the label `discoverKavalCandidates` decided
    // at its matching branch — no re-parse, no hedge.
    return { kind: "many", candidates: found };
  }
  return {
    kind: "none",
    socket: getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX),
  };
}
