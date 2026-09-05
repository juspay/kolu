/**
 * ssh connection multiplexing (`ControlMaster`) for the ssh this package
 * spawns — the P2.8 warm-path speedup. The three commands a single
 * `kaval-tui --host` dial issues over ssh (the arch probe, provision/root
 * commands, and the agent dial) each used to pay their own ~5s
 * ssh handshake because nothing reused the connection. `ControlMaster`
 * collapses them onto ONE shared tunnel: the first ssh opens a master,
 * `ControlPersist` keeps it warm, and the rest ride it as near-instant
 * channels.
 *
 * This lives in its own module — separate from `host.ts`'s keepalive
 * `sshOptPairs` — because the multiplexing opts are a
 * *different kind of thing*: the `ControlPath` is computed from the
 * environment (`$XDG_RUNTIME_DIR`) and its directory must be created (a
 * side effect), whereas the keepalive policy is pure. Keeping the
 * volatile, effectful concern behind one boundary leaves `host.ts`'s
 * eager-const idiom untouched, and the package stays `sideEffects: false`
 * (the dir is made lazily on first use, never at import).
 *
 * Why no `~/.ssh/config` touch: the opts ride the existing `sshOptPairs`
 * render path (`sshCommonOpts()` argv + `nixSshOpts()` env), so every ssh
 * this package causes to be spawned — including the one the remote-store
 * Nix client forks internally — inherits them with no user configuration.
 *
 * Why a *kolu-private* `ControlPath` (never `~/.ssh`): the control socket
 * is an IPC rendezvous exactly like the pty-host socket, so it uses the
 * same per-user runtime-dir convention (`getRuntimeSocketPath`) and the
 * same owner-only `0700` directory boundary — anyone who can reach the
 * master can open channels on the live connection, so the dir must be
 * ours. Addressed by ssh's `%C` token (a fixed-length host+port+user hash)
 * to stay well under the ~104-char `sun_path` limit and whitespace-free.
 *
 * Why the path is ALSO keyed by the {@link SshKeepalive} — the correctness
 * constraint this module owes the per-dial keepalive policy: OpenSSH applies
 * `ServerAliveInterval`/`ServerAliveCountMax` from the process that OPENED the
 * master, and every later ssh that rides it inherits that connection's
 * behaviour, silently ignoring its own `-o ServerAlive*`. With ONE socket per
 * host, a CI coordinator asking for a five-minute tolerance would get whichever
 * policy happened to open the master first — a kolu dial's 30s, possibly from
 * another process minutes ago (`ControlPersist` is cross-invocation). The
 * failure is invisible: the argv is right and the behaviour is wrong. So the
 * socket name carries the policy, and two policies simply never share a master.
 * The cost is one extra warm connection per (host, policy) actually in use;
 * the benefit is that the policy a caller states is the policy it gets.
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
// TYPE-only: `host.ts` imports this module for `controlOptPairs`, so a value
// import here would close a runtime cycle. `controlOptPairs` takes the policy as
// a REQUIRED argument for the same reason — there is no default to import.
import type { SshKeepalive } from "./host";

/** How long the shared master lingers idle after its last channel closes.
 *  Deliberately CROSS-INVOCATION (~10m): a second `kaval-tui` within
 *  minutes reuses the still-warm master instead of re-handshaking. The
 *  idle master is reaped by this timer. NB the `ServerAlive` keepalive in
 *  `sshOptPairs` only reaps a master whose whole TRANSPORT died — it does
 *  NOT catch a healthy master with a single dead exec CHANNEL (the #1908
 *  incident: fresh channels through this same master ran instantly while one
 *  channel's remote side was gone). That failure mode is owned by the child
 *  lifetime policies in `process.ts`, not by ssh keepalive. ssh's time
 *  format; whitespace-free per the `sshOptPairs` value contract. */
const CONTROL_PERSIST = "10m";

/** The one whitespace-free spelling of a keepalive policy, used as both the
 *  memo key and the `ControlPath` suffix — so "which master is this?" and "which
 *  entry is memoized?" can never disagree. `assertSshKeepalive` (run on every
 *  render path in `host.ts`) guarantees two positive integers, so this is always
 *  short and free of whitespace and path separators. */
function policyTag(keepalive: SshKeepalive): string {
  return `${keepalive.intervalS}x${keepalive.countMax}`;
}

/** The kolu-private control-socket path — the ONE source of truth both the
 *  `ControlPath=` opt and the ensure-dir derive from, so they can never
 *  spell it differently. `%C` is a LITERAL token here: ssh expands it to a
 *  host+port+user hash at connect time, so one path string serves every
 *  host while each host still gets its own socket. `getRuntimeSocketPath`
 *  gives `$XDG_RUNTIME_DIR/kolu-ssh/%C-<policy>` on systemd Linux, else the
 *  `$TMPDIR`-independent `/tmp/kolu-ssh-$UID/%C-<policy>` (see its doc for why
 *  `os.tmpdir()` is the wrong tool for a path two processes must agree on).
 *  Both expand to ≈65 chars — well under the ~104-char `sun_path` limit, so
 *  keep the `kolu-ssh` app name short.
 *
 *  The `-<policy>` suffix is what keeps two {@link SshKeepalive} policies off
 *  one master (see the module header): the master's OPENER decides `ServerAlive*`
 *  for its whole lifetime, so the policy has to be part of the socket's
 *  identity. */
function controlSocketPath(keepalive: SshKeepalive): string {
  return getRuntimeSocketPath({
    app: "kolu-ssh",
    file: `%C-${policyTag(keepalive)}`,
  });
}

/** Is `dir` a private, owner-only directory we own? The control socket
 *  exposes the live connection to anyone who can open channels on it, so
 *  the directory is the security boundary (cf. the same check on the
 *  pty-host socket). The public original is `isPrivateOwnedDir` in
 *  `@kolu/surface/unix-socket`; this copy stays local because a failed
 *  `lstat` is refuse-not-throw here (the outer `controlOptPairs` catch is
 *  the additive-speedup degrade), matching `surface-daemon`'s copy rather
 *  than the transport layer's throw. `lstatSync` (not `statSync`) so a
 *  symlink is judged as itself, never followed to a target an attacker
 *  still controls the path component of. True on platforms without uid
 *  semantics (Windows) — the ACL model there is out of scope. */
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

/** Memoized PER POLICY: the multiplexing concern is computed once per process
 *  per {@link SshKeepalive} (the runtime dir and its ownership don't change
 *  under us), so the mkdir + lstat run on the first ssh of the first dial at
 *  each policy and every later render is pure. Keyed rather than single-slot
 *  because the `ControlPath` now varies with the policy — one slot would hand a
 *  second policy the first one's socket, which is the exact mix-up the keying
 *  exists to prevent. In practice the map holds one or two entries. */
const memo = new Map<string, readonly (readonly [string, string])[]>();

/** The `ControlMaster` `(key, value)` pairs to add to the ssh options — or
 *  `[]` when multiplexing can't be set up SAFELY, in which case ssh
 *  connects un-multiplexed (correct, just no speedup). This is the
 *  self-hooking ensure-dir: every spawn site renders its ssh opts through
 *  here (the agent dial, the probe/root commands, and the remote-store Nix env), so the
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
export function controlOptPairs(
  keepalive: SshKeepalive,
): readonly (readonly [string, string])[] {
  const key = policyTag(keepalive);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const remember = (
    pairs: readonly (readonly [string, string])[],
  ): readonly (readonly [string, string])[] => {
    memo.set(key, pairs);
    return pairs;
  };
  try {
    const path = controlSocketPath(keepalive);
    // The value contract `sshOptPairs` documents: nix word-splits
    // `NIX_SSHOPTS` and the argv renderer emits one `-o` per pair, so a
    // value with a space corrupts the env form silently. Drop multiplexing
    // wholesale rather than ship a corrupt opt.
    if (/\s/.test(path)) return remember([]);
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdir's mode is a no-op on a pre-existing dir, so VERIFY privacy
    // rather than assume it — a stable per-user path another local user
    // could have pre-created with loose perms must not host our connection.
    if (!isPrivateOwnedDir(dir)) return remember([]);
    return remember([
      ["ControlMaster", "auto"],
      ["ControlPath", path],
      ["ControlPersist", CONTROL_PERSIST],
    ]);
  } catch {
    // mkdir/stat threw (EROFS, EACCES, …) — connect un-multiplexed.
    return remember([]);
  }
}

/** Test-only: drop the memo so a test can re-drive `controlOptPairs()`
 *  after stubbing `$XDG_RUNTIME_DIR`. Not re-exported from the package
 *  index — internal. */
export function __resetControlMemo(): void {
  memo.clear();
}
