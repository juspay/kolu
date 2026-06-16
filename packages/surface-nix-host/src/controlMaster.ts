/**
 * ssh connection multiplexing (`ControlMaster`) for the ssh this package
 * spawns — the P2.8 warm-path speedup. The three commands a single
 * `kaval-tui --host` dial issues over ssh (the arch probe, the provision
 * check + `nix copy`, and the agent dial) each used to pay their own ~5s
 * ssh handshake because nothing reused the connection. `ControlMaster`
 * collapses them onto ONE shared tunnel: the first ssh opens a master,
 * `ControlPersist` keeps it warm, and the rest ride it as near-instant
 * channels.
 *
 * This lives in its own module — separate from `host.ts`'s static
 * keepalive `SSH_OPT_PAIRS` — because the multiplexing opts are a
 * *different kind of thing*: the `ControlPath` is computed from the
 * environment (`$XDG_RUNTIME_DIR`) and its directory must be created (a
 * side effect), whereas the keepalive policy is a pure const. Keeping the
 * volatile, effectful concern behind one boundary leaves `host.ts`'s
 * eager-const idiom untouched, and the package stays `sideEffects: false`
 * (the dir is made lazily on first use, never at import).
 *
 * Why no `~/.ssh/config` touch: the opts ride the existing `SSH_OPT_PAIRS`
 * render path (`SSH_COMMON_OPTS` argv + `NIX_SSHOPTS` env), so every ssh
 * this package causes to be spawned — including the one `nix copy --to
 * ssh-ng://` forks internally — inherits them with no user configuration.
 *
 * Why a *kolu-private* `ControlPath` (never `~/.ssh`): the control socket
 * is an IPC rendezvous exactly like the pty-host socket, so it uses the
 * same per-user runtime-dir convention (`getRuntimeSocketPath`) and the
 * same owner-only `0700` directory boundary — anyone who can reach the
 * master can open channels on the live connection, so the dir must be
 * ours. Addressed by ssh's `%C` token (a fixed-length host+port+user hash)
 * to stay well under the ~104-char `sun_path` limit and whitespace-free.
 *
 * Lifecycle is delegated to ssh's own `ControlMaster=auto`: a stale socket
 * (a master that died uncleanly) makes the next ssh's connect to it fail,
 * and `auto` transparently falls back to a fresh direct connection —
 * correctness is never at risk, only the speedup is forfeited for that one
 * dial, which then re-masters. So this module adds NO proactive `ssh -O
 * check`/`-O exit` recovery: it would add a round-trip (the very cost we
 * remove), race ssh's atomic bind, and — for `-O exit` on teardown —
 * defeat the cross-invocation warmth `ControlPersist` exists to provide.
 */

import { lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** How long the shared master lingers idle after its last channel closes.
 *  Deliberately CROSS-INVOCATION (~10m): a second `kaval-tui` within
 *  minutes reuses the still-warm master instead of re-handshaking. The
 *  idle master is reaped by this timer; a *wedged* master is reaped by the
 *  `ServerAlive` dead-peer keepalive in `SSH_OPT_PAIRS` (~30s). ssh's time
 *  format; whitespace-free per the `SSH_OPT_PAIRS` value contract. */
const CONTROL_PERSIST = "10m";

/** The kolu-private control-socket path — the ONE source of truth both the
 *  `ControlPath=` opt and the ensure-dir derive from, so they can never
 *  spell it differently. `%C` is a LITERAL token here: ssh expands it to a
 *  host+port+user hash at connect time, so one path string serves every
 *  host while each host still gets its own socket. `getRuntimeSocketPath`
 *  gives `$XDG_RUNTIME_DIR/kolu-ssh/%C` on systemd Linux, else the
 *  `$TMPDIR`-independent `/tmp/kolu-ssh-$UID/%C` (see its doc for why
 *  `os.tmpdir()` is the wrong tool for a path two processes must agree on).
 *  Both expand to ≈60 chars — well under the ~104-char `sun_path` limit, so
 *  keep the `kolu-ssh` app name short. */
function controlSocketPath(): string {
  return getRuntimeSocketPath({ app: "kolu-ssh", file: "%C" });
}

/** Is `dir` a private, owner-only directory we own? The control socket
 *  exposes the live connection to anyone who can open channels on it, so
 *  the directory is the security boundary (cf. the same check on the
 *  pty-host socket). The canonical copy is `isPrivateOwnedDir` in
 *  `@kolu/surface/unix-socket`; re-implemented here (as `kaval`'s
 *  `socketPath.ts` does) so this stays a purely-internal speedup with no
 *  surface API delta — widening that export would compel a drishti PR for
 *  a 6-line helper. `lstatSync` (not `statSync`) so a symlink is judged as
 *  itself, never followed to a target an attacker still controls the path
 *  component of. True on platforms without uid semantics (Windows) — the
 *  ACL model there is out of scope. */
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

/** Memoized: the multiplexing concern is computed once per process (the
 *  runtime dir and its ownership don't change under us), so the mkdir +
 *  lstat run on the first ssh of the first dial and every later render is
 *  pure. */
let memo: readonly (readonly [string, string])[] | undefined;

/** The `ControlMaster` `(key, value)` pairs to add to the ssh options — or
 *  `[]` when multiplexing can't be set up SAFELY, in which case ssh
 *  connects un-multiplexed (correct, just no speedup). This is the
 *  self-hooking ensure-dir: every spawn site renders its ssh opts through
 *  here (the agent dial, the probe/realise, and the `nix copy` env), so the
 *  control dir is created lazily before the first ssh and never from a
 *  module import.
 *
 *  Degrades to `[]` — never throws — on any of: a `ControlPath` containing
 *  whitespace (would corrupt the word-split `NIX_SSHOPTS` form while the
 *  argv form stayed correct, so we drop ALL control pairs rather than emit
 *  a half-correct set), an un-creatable runtime dir (read-only FS, no
 *  `$XDG_RUNTIME_DIR` and no writable `/tmp`, …), or a dir that isn't
 *  owner-only. Graceful degradation of an additive speedup, mirroring
 *  `serveOverUnixSocket`'s no-op `refused()` outcomes — NOT a provisioning
 *  fallback (correctness never depends on multiplexing succeeding). */
export function controlOptPairs(): readonly (readonly [string, string])[] {
  if (memo !== undefined) return memo;
  try {
    const path = controlSocketPath();
    // The value contract `SSH_OPT_PAIRS` documents: nix word-splits
    // `NIX_SSHOPTS` and the argv renderer emits one `-o` per pair, so a
    // value with a space corrupts the env form silently. Drop multiplexing
    // wholesale rather than ship a corrupt opt.
    if (/\s/.test(path)) {
      memo = [];
      return memo;
    }
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdir's mode is a no-op on a pre-existing dir, so VERIFY privacy
    // rather than assume it — a stable per-user path another local user
    // could have pre-created with loose perms must not host our connection.
    if (!isPrivateOwnedDir(dir)) {
      memo = [];
      return memo;
    }
    memo = [
      ["ControlMaster", "auto"],
      ["ControlPath", path],
      ["ControlPersist", CONTROL_PERSIST],
    ];
  } catch {
    // mkdir/stat threw (EROFS, EACCES, …) — connect un-multiplexed.
    memo = [];
  }
  return memo;
}

/** Test-only: drop the memo so a test can re-drive `controlOptPairs()`
 *  after stubbing `$XDG_RUNTIME_DIR`. Not re-exported from the package
 *  index — internal. */
export function __resetControlMemo(): void {
  memo = undefined;
}
