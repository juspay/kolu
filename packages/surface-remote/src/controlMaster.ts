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
 * rendering — because the multiplexing opts are a
 * *different kind of thing*: the `ControlPath` is computed from the
 * environment (`$XDG_RUNTIME_DIR`) and its directory must be created (a
 * side effect), whereas the keepalive policy is pure. Keeping the
 * volatile, effectful concern behind one boundary leaves `host.ts`'s
 * eager-const idiom untouched, and the package stays `sideEffects: false`
 * (the dir is made lazily on first use, never at import).
 *
 * Why no `~/.ssh/config` touch: the opts ride the existing dial-opt
 * render path (`sshDialOpts()` argv + `nixSshOpts()` env), so every ssh
 * this package causes to be spawned — including the one the remote-store
 * Nix client forks internally — inherits them with no user configuration.
 *
 * Why a *kolu-private* `ControlPath` (never `~/.ssh`): the control socket
 * is an IPC rendezvous exactly like the pty-host socket, so it uses the
 * same per-user runtime-dir convention (`getRuntimeSocketPath`) and the
 * same owner-only `0700` directory boundary — anyone who can reach the
 * master can open channels on the live connection, so the dir must be
 * ours. Addressed by ssh's `%C` token (a fixed-length host+port+user hash)
 * to keep the leaf short and whitespace-free — but "short" is not something
 * this module gets to assert, because the DIRECTORY comes from the
 * environment: see {@link usableControlPath}, which measures it.
 *
 * Why the path is ALSO keyed by the {@link KeepalivePlan} — the correctness
 * constraint this module owes the per-dial keepalive policy: OpenSSH applies
 * `ServerAliveInterval`/`ServerAliveCountMax` from the process that OPENED the
 * master, and every later ssh that rides it inherits that connection's
 * behaviour, silently ignoring its own `-o ServerAlive*`. The mechanism is
 * structural rather than a quirk: `ServerAlive*` drives ssh's TRANSPORT-layer
 * keepalive (ssh_config(5): "sets a timeout interval … after which if no data
 * has been received from the server, ssh will send a message through the
 * encrypted channel"), and a multiplexed client has no transport of its own —
 * it speaks to the master over the local unix socket, so there is no connection
 * for its own value to govern. NB this is a claim about a program we do not
 * own, and `controlMaster.test.ts` can only pin OUR half of it (that two
 * policies render two different socket names); the inheritance itself is not
 * something a unit test here can falsify. If it ever proves version-dependent,
 * the fallback is already spelled below — `ControlPath=none` for any dial that
 * states a non-default policy. With ONE socket per
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

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  getRuntimeSocketPath,
  isPrivateOwnedDir,
} from "@kolu/surface/unix-socket";
import { type KeepalivePlan, policyTag } from "./keepalive";

/** How long the shared master lingers idle after its last channel closes.
 *  Deliberately CROSS-INVOCATION (~10m): a second `kaval-tui` within
 *  minutes reuses the still-warm master instead of re-handshaking. The
 *  idle master is reaped by this timer. NB the `ServerAlive` keepalive in
 *  `sshDialOpts` only reaps a master whose whole TRANSPORT died — it does
 *  NOT catch a healthy master with a single dead exec CHANNEL (the #1908
 *  incident: fresh channels through this same master ran instantly while one
 *  channel's remote side was gone). That failure mode is owned by the child
 *  lifetime policies in `process.ts`, not by ssh keepalive. ssh's time
 *  format; whitespace-free per the `sshDialOpts` value contract. */
const CONTROL_PERSIST = "10m";

/** What we emit when we cannot set OUR master up safely — an explicit REFUSAL
 *  to multiplex, never an empty opt set.
 *
 *  The distinction is load-bearing and was a real hole. Emitting nothing does
 *  not mean "no multiplexing"; it means we stop naming a `ControlPath`, and ssh
 *  then falls back to the user's `~/.ssh/config` — where an entirely ordinary
 *  `Host *` block carrying `ControlMaster auto` + `ControlPath ~/.ssh/cm-%r@%h:%p`
 *  supplies a master keyed by host+user+port and NOT by policy. Two dials at two
 *  {@link KeepalivePlan} policies would then share one socket again and the second
 *  would silently inherit the first's `ServerAlive*` — the exact invisible
 *  failure (right argv, wrong behaviour) the per-policy keying exists to abolish,
 *  reintroduced by the fallback. It reaches Nix's forked ssh too, which reads the
 *  same `ssh_config`.
 *
 *  `ControlPath=none` says "multiplex with nobody", so every command carries its
 *  own policy by construction and the guarantee holds UNCONDITIONALLY rather than
 *  only while our runtime dir happens to be usable. Same idiom, same reason, as
 *  `@kolu/port-forward`'s `sshForward.ts`. Both values are plain literal text, so
 *  the `NIX_SSHOPTS` split contract still holds. The cost of this arm is the one
 *  the speedup was buying: every command re-handshakes. */
const NO_MULTIPLEXING: readonly (readonly [string, string])[] = [
  ["ControlMaster", "no"],
  ["ControlPath", "none"],
];

/** The kolu-private control DIRECTORY — the one thing here that is an EFFECT
 *  and the one thing that does NOT vary with the policy. `getRuntimeSocketPath`
 *  gives `$XDG_RUNTIME_DIR/kolu-ssh/<file>` on systemd Linux, else the
 *  `$TMPDIR`-independent `/tmp/kolu-ssh-$UID/<file>` (see its doc for why
 *  `os.tmpdir()` is the wrong tool for a path two processes must agree on); the
 *  `dirname` of either is what every policy's socket sits in.
 *
 *  `null` when we cannot own one safely — see {@link ensureControlDir}. */
function controlDirPath(): string {
  return dirname(getRuntimeSocketPath({ app: "kolu-ssh", file: "socket" }));
}

/** How many bytes `%C` becomes. It is a FIXED-WIDTH token — OpenSSH expands it
 *  to the hex digest of (local host, remote host, port, user), 40 characters,
 *  whatever the host is. Verified against the ssh on PATH rather than assumed:
 *
 *      $ ssh -G -o 'ControlPath=/x/%C' -p 22 example.invalid | grep controlpath
 *      controlpath /x/401d5feaf63a23c7fb60492d0d559be7a3fb2804
 *
 *  That fixed width is the whole reason a length check here is meaningful: the
 *  expanded path's length does not vary with the host we happen to dial. */
const CONTROL_HASH_BYTES = 40;

/** The `sun_path` budget we hold ourselves to, in bytes INCLUDING the trailing
 *  NUL. Deliberately the SMALLER of the platforms we support — macOS's 104, not
 *  Linux's 108 — because the same runtime dir, and the same reasoning, has to
 *  hold on both, and being 4 bytes conservative costs a path nobody wants. */
const SUN_PATH_BYTES = 104;

/** The bytes OpenSSH adds to `ControlPath` before it binds anything. A master is
 *  NOT created at the path we name: `muxserver_listen` (mux.c) fills
 *  `char rbuf[16+1]` with 16 random alphanumerics, binds
 *  `xasprintf("%s.%s", control_path, rbuf)`, and links THAT into place — and it
 *  is that longer name the `strlcpy` into `sun_path` fatals on
 *  (`ControlPath too long ('%s' >= %u bytes)`). So a check of only the final
 *  socket name would still let the master die. A dot plus sixteen bytes. */
const MASTER_TEMP_SUFFIX_BYTES = 17;

/** The ONE rule a control DIRECTORY has to pass: every character is an ordinary
 *  literal path character. An ALLOWLIST, not a list of banned shapes — the
 *  directory comes from `$XDG_RUNTIME_DIR`, an environment string, and the
 *  question we actually need answered is "does this render into a `ControlPath`
 *  that means exactly what it says?", which only a positive rule can answer.
 *
 *  Three separate refusals used to try, and between them they still let a real
 *  break through. Nix does not word-split `NIX_SSHOPTS`, it SHELL-splits it, so
 *  a single quote character is enough (verified against Nix 2.34.8):
 *
 *      $ NIX_SSHOPTS="-o Foo='bar" nix store info --store ssh://nonexistent.invalid
 *      error: … while splitting NIX_SSHOPTS '-o Foo='bar' / unterminated single quote
 *
 *  — which breaks EVERY remote-store Nix command in the dial, while passing a
 *  whitespace test, an expansion-syntax test and a length test alike. One
 *  allowlist subsumes all of them: whitespace, `%` tokens, `${ENV}` and quotes
 *  are refused by the same rule, and so is whatever the next environment string
 *  turns out to carry.
 *
 *  Escaping is the alternative and it is the wrong trade: it would make this
 *  module responsible for two foreign quoting dialects (ssh's and the shell
 *  Nix splits with) to buy back a speedup on a runtime dir nobody has. Being
 *  over-strict costs only the speedup — an unusable dir degrades to
 *  {@link NO_MULTIPLEXING}, exactly as an un-creatable one does — so the rule is
 *  strictly no-worse than the blocklists it replaces. Real runtime dirs
 *  (`/run/user/1000`, `/tmp/kolu-ssh-501`) pass it. */
const LITERAL_CONTROL_DIR = /^[A-Za-z0-9_./-]+$/;

/** The `ControlPath` to name for `plan` inside `dir` — or `null` if the
 *  expanded path would not fit `sun_path`. `dir`'s LITERALNESS is not re-checked
 *  here: it is this function's sole caller's job, and its only caller is
 *  `ensureControlDir()`, which already refused ({@link LITERAL_CONTROL_DIR}) and
 *  returned before ever producing the `dir` this function is invoked with — so a
 *  second check here could never observe a non-literal `dir` and would be dead
 *  on arrival. What the allowlist buys THIS function is narrower and still real:
 *  no `%` can hide in the directory half, so the byte arithmetic below can
 *  assume exactly one `%C` token (the leaf composed on the next line) without
 *  re-deriving that fact from `dir`.
 *
 *  Length is a real regression guard, not a theoretical one: keying the socket
 *  by policy grew the leaf from `/%C` to `/%C-10x3`, and a runtime dir just 49
 *  bytes longer than `/tmp/` took the DEFAULT policy from 104 expanded bytes
 *  (which OpenSSH accepts on Linux) to 109 (`ControlPath too long (… >= 108
 *  bytes)`, and ssh dies before it connects). `getRuntimeSocketPath` hands us
 *  whatever `$XDG_RUNTIME_DIR` says, so the directory's length is an input, not
 *  a constant we may assert about. Bytes rather than characters for the same
 *  locality: `sun_path` is a byte buffer, and the measurement should be about
 *  the buffer even though the allowlist happens to confine us to ASCII. */
function usableControlPath(dir: string, plan: KeepalivePlan): string | null {
  const path = `${dir}/%C-${policyTag(plan)}`;
  const expandedBytes =
    Buffer.byteLength(path, "utf8") -
    "%C".length +
    CONTROL_HASH_BYTES +
    MASTER_TEMP_SUFFIX_BYTES;
  if (expandedBytes + 1 > SUN_PATH_BYTES) return null; // +1: the terminating NUL
  return path;
}

/** The memoized EFFECT — one slot, because it is policy-INDEPENDENT. The
 *  directory is `$XDG_RUNTIME_DIR/kolu-ssh` whatever the dial's policy, so the
 *  mkdir + lstat run once per process (the runtime dir and its ownership do not
 *  change under us) rather than once per policy. `undefined` = not yet computed;
 *  `null` = computed, and we cannot own one. */
let controlDir: string | null | undefined;

/** Create (or adopt) the private control dir, once. `null` on any of: a
 *  directory that is not literal path text ({@link LITERAL_CONTROL_DIR} — which
 *  covers whitespace, ssh's `%`/`${}` expansion syntax, and the quote characters
 *  Nix's SHELL-split of `NIX_SSHOPTS` chokes on), an un-creatable runtime dir
 *  (read-only FS, no `$XDG_RUNTIME_DIR` and no writable `/tmp`, …), or a dir
 *  that isn't owner-only.
 *
 *  The string refusal comes BEFORE the `mkdir`: a directory we will not name in
 *  a `ControlPath` is not one to create either. It is also what keeps the
 *  privacy check meaningful — ssh expands the WHOLE `ControlPath`, so a
 *  directory carrying expansion syntax would put the socket somewhere other than
 *  the `0700` dir we just verified, and a privacy check on a path that is not
 *  the socket's real location means nothing. */
function ensureControlDir(): string | null {
  if (controlDir !== undefined) return controlDir;
  controlDir = ((): string | null => {
    try {
      const dir = controlDirPath();
      if (!LITERAL_CONTROL_DIR.test(dir)) return null;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // The canonical check, from the module that owns this convention: the
      // control socket exposes the live connection to anyone who can open
      // channels on it, so the directory is the security boundary — the same
      // one `serveOverUnixSocket` applies to the pty-host socket. It THROWS on
      // a failed `lstat` where a local copy used to return false; identical
      // behaviour here, because this whole block's catch reads either as
      // "cannot own one" → `null`.
      //
      // mkdir's mode is a no-op on a pre-existing dir, so VERIFY privacy
      // rather than assume it — a stable per-user path another local user
      // could have pre-created with loose perms must not host our connection.
      if (!isPrivateOwnedDir(dir)) return null;
      return dir;
    } catch {
      // mkdir/stat threw (EROFS, EACCES, …) — connect un-multiplexed.
      return null;
    }
  })();
  return controlDir;
}

/** The `ControlMaster` `(key, value)` pairs to add to the ssh options — or an
 *  explicit refusal to multiplex when we cannot set OUR master up safely, in
 *  which case ssh connects un-multiplexed (correct, just no speedup). This is
 *  the self-hooking ensure-dir: every spawn site renders its ssh opts through
 *  here (the agent dial, the probe/root commands, and the remote-store Nix env),
 *  so the control dir is created lazily before the first ssh and never from a
 *  module import.
 *
 *  PURE given that directory. The `%C` in the path is a LITERAL token: ssh
 *  expands it to a host+port+user hash at connect time, so one path string
 *  serves every host while each host still gets its own socket. The `-<policy>`
 *  suffix is what keeps two {@link KeepalivePlan} policies off one master (see
 *  the module header): the master's OPENER decides `ServerAlive*` for its whole
 *  lifetime, so the policy has to be part of the socket's identity.
 *
 *  Takes the CAPTURED plan, never a caller's `SshKeepalive`. That is not a
 *  formality: the caller's object may expose accessors, and this socket name has
 *  to be spelled from the very same two numbers `host.ts` rendered the
 *  `ServerAlive*` options from. `sshDialOpts`/`nixSshOpts` capture once and pass
 *  that one snapshot to both, so a master named `%C-10x3` is a master carrying
 *  `ServerAliveInterval=10`, always.
 *
 *  That suffix costs `sun_path` budget, and the budget is not ours to assume —
 *  the directory comes from `$XDG_RUNTIME_DIR`. So the expanded length is
 *  MEASURED ({@link usableControlPath}) rather than asserted in a comment, and a
 *  path that will not fit degrades like every other unusable setup.
 *
 *  Degrades to {@link NO_MULTIPLEXING} — never throws. Graceful degradation of
 *  an additive speedup, mirroring `serveOverUnixSocket`'s no-op `refused()`
 *  outcomes — NOT a provisioning fallback (correctness never depends on
 *  multiplexing succeeding). Note the degrade is an explicit `ControlPath=none`
 *  and NOT an empty set: see {@link NO_MULTIPLEXING} for why silence would hand
 *  the connection to the user's own `ssh_config` master and break the
 *  per-policy guarantee. */
export function controlOptPairs(
  plan: KeepalivePlan,
): readonly (readonly [string, string])[] {
  const dir = ensureControlDir();
  if (dir === null) return NO_MULTIPLEXING;
  // A path ssh cannot bind — or one that would not mean what it says — is worse
  // than no multiplexing: ssh fails the command outright rather than merely
  // re-handshaking. Refuse instead.
  const path = usableControlPath(dir, plan);
  if (path === null) return NO_MULTIPLEXING;
  return [
    ["ControlMaster", "auto"],
    ["ControlPath", path],
    ["ControlPersist", CONTROL_PERSIST],
  ];
}

/** Test-only: drop the memoized control dir so a test can re-drive
 *  `controlOptPairs()` after stubbing `$XDG_RUNTIME_DIR`. Not re-exported from
 *  the package index — internal. */
export function __resetControlMemo(): void {
  controlDir = undefined;
}
