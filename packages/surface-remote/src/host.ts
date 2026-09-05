/** Helpers for `host`-string handling shared between target-store provisioning
 *  and the ssh agent subprocess. Keeps the
 *  "are we talking to ourselves?" check and the per-line stderr fanout
 *  in one place so they evolve together. */

import { shellQuoteArg } from "@kolu/shell-quote";
import { controlOptPairs } from "./controlMaster";
import {
  assertRenderableKeepalive,
  DEFAULT_SSH_KEEPALIVE,
  type SshKeepalive,
} from "./keepalive";

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** The closed resolver-failure verdicts a connector can act on. Plain errors remain
 *  retryable network failures; typed resolver failures must choose one of these
 *  valid cause/terminal combinations. */
export type ResolveDrvFailure =
  | {
      kind: "source-unbaked";
      failureCause: "remote";
      terminal: false;
    }
  // The source ref IS baked, but the tree it names carries no usable
  // binary-cache declaration — a binder built before that contract, or a
  // hand-assembled tree. A DISTINCT kind from `source-unbaked` because the
  // remedy is different (rebuild/update the binder, vs. run through the Nix
  // wrapper at all) and consumers render the remedy verbatim: sharing a kind
  // would make a host-down card assert a fact ("the source ref is unset")
  // that is false for this fault.
  | {
      kind: "binary-cache-unbaked";
      failureCause: "remote";
      terminal: false;
    }
  | {
      kind: "unavailable";
      failureCause: "remote";
      terminal: false;
    }
  | {
      kind: "network-exhausted";
      failureCause: "network";
      terminal: true;
    }
  // The two ssh REFUSALS ({@link SshRefusal}): the host answered and ssh
  // stopped at a gate only an interactive answer could pass — a credential
  // (auth-refused) or a trust decision (host-key-unverified). This package is
  // non-interactive by contract (`BatchMode=yes`, no TTY), so no retry can ever
  // supply that answer: terminal, and the honest transport cause is `"remote"`
  // (the peer was reached; it refused us — never a network fault to keep
  // redialing).
  | {
      kind: "auth-refused";
      failureCause: "remote";
      terminal: true;
    }
  | {
      kind: "host-key-unverified";
      failureCause: "remote";
      terminal: true;
    }
  // The host answered, ssh ran our command, and the SHELL could not find
  // `nix-instantiate` (POSIX exit 127). Provisioning is done with the host's
  // OWN Nix, so there is nothing to fall back to — and re-running the identical
  // command cannot make an absent binary appear. Terminal, cause `"remote"`
  // (reached and unable to serve us), on the same footing as an ssh refusal.
  | {
      kind: "nix-unavailable";
      failureCause: "remote";
      terminal: true;
    };

/** A `resolveDrvPath` rejection with an explicit connector verdict.
 *
 *  Why it exists: `sshConnector` runs the caller's `resolveDrvPath` thunk
 *  at the top of every dial and, by default, treats a rejection as `"network"`
 *  — the right call for the common case (the resolver's arch probe is an ssh
 *  round-trip, so a rejection usually means the host is unreachable, which must
 *  retry forever). But a resolver can also fail for a NON-transport reason that
 *  retrying can never fix, or exhaust its connector-owned retry budget. Throwing
 *  this error lets the resolver state the one cause/terminal verdict explicitly.
 *  The discriminated union above prevents meaningless combinations such as a
 *  non-terminal exhausted budget or a terminal source-configuration fault.
 *
 *  The discriminant is its OWN field (`failureCause`), NOT the standard
 *  `Error.cause` (the ES2022 options bag). Redeclaring `cause` as a class member
 *  overloads a JS error property with unrelated meaning and trips
 *  `noImplicitOverride` in any consumer that typechecks this source under that
 *  flag (drishti does) — the same reason `@kolu/surface`'s `SinkError` keeps the
 *  chained error on `Error.cause` and never redeclares it. Leave `Error.cause`
 *  free for exception chaining if a future caller wants it. */
export class ResolveDrvError extends Error {
  constructor(
    message: string,
    readonly resolution: ResolveDrvFailure,
  ) {
    super(message);
    this.name = "ResolveDrvError";
  }
}

/** Heuristic: does an ssh / remote-store Nix stderr line look like a *transport*
 *  failure (host unreachable) rather than a remote rejection? Used to
 *  upgrade a provisioning failure's cause to `"network"` — Nix forks its
 *  own ssh and reports connection errors on stderr while exiting
 *  with nix's own code (not ssh's 255), so the exit code alone can't tell
 *  "host asleep" from "daemon refused the closure". Matched against the
 *  text ssh/nix actually emit; a miss only means we fall back to the safe
 *  default (`"remote"`, which is bounded), never a wrong terminal verdict. */
export function looksLikeNetworkError(line: string): boolean {
  return /connection (refused|timed out|closed|reset)|operation timed out|timeout was reached|no route to host|network is unreachable|could not resolve host(?:name)?|couldn't connect to server|failed to connect|download .* interrupted|http error (?:408|429|5\d\d)|kex_exchange_identification|ssh: connect to host|not responding|broken pipe|port 22:/i.test(
    line,
  );
}

/** The two ways a NON-INTERACTIVE ssh is refused at a gate only an interactive
 *  answer could pass: `auth-refused` (the host rejected our credentials — with
 *  `BatchMode=yes` a password/keyboard-interactive prompt is declined, not
 *  asked) and `host-key-unverified` (ssh refused the HOST's identity — an
 *  unknown or changed host key whose trust prompt we can never answer). The
 *  vocabulary doubles as the matching {@link ResolveDrvFailure} kinds, so the
 *  classifier and the typed failure can never spell the same fact twice. */
export type SshRefusal = "auth-refused" | "host-key-unverified";

// Compiled once, not per line: `sshRefusalOf` runs on every stderr line of
// every probe/dial, so a fresh RegExp literal per call would re-compile on
// each of those invocations.
const HOST_KEY_UNVERIFIED_RE = /host key verification failed/i;
const AUTH_REFUSED_RE =
  /permission denied \(|too many authentication failures/i;

/** Heuristic sibling of {@link looksLikeNetworkError}: does an ssh stderr line
 *  prove a {@link SshRefusal}? Matched against the exact text OpenSSH emits —
 *  `Permission denied (publickey,…)` (the parenthesised auth-method list keeps
 *  a remote command's generic "Permission denied" from misclassifying),
 *  `Too many authentication failures`, and `Host key verification failed.`
 *  (the stable final line for both an unknown and a CHANGED host key). A miss
 *  only means the failure stays an untyped transport error (retried) — never a
 *  wrong terminal verdict. */
export function sshRefusalOf(line: string): SshRefusal | null {
  if (HOST_KEY_UNVERIFIED_RE.test(line)) return "host-key-unverified";
  if (AUTH_REFUSED_RE.test(line)) return "auth-refused";
  return null;
}

/** Forward every non-blank `\n`-terminated line in `chunk` to `onLine`.
 *  Used by Nix progress and ssh-child stderr forwarding. */
export function forEachLine(
  chunk: string,
  onLine: (line: string) => void,
): void {
  for (const line of chunk.split("\n")) {
    if (line.trim()) onLine(line);
  }
}

/** ssh options shared by *every* non-interactive ssh this package causes
 *  to be spawned — the long-lived agent session, the one-shot
 *  probe/root commands, AND the ssh that `nix build --store ssh-ng://…`
 *  forks internally. They split into two jobs:
 *
 *   - `BatchMode=yes` — never block on a password/passphrase prompt.
 *   - `ServerAliveInterval` / `ServerAliveCountMax` + `ConnectTimeout` —
 *     make ssh detect a *dead peer* and exit non-zero instead of
 *     blocking forever on a half-open connection.
 *
 *  That second job is load-bearing for the one-shot commands too, which
 *  is why these opts are no longer agent-only. A remote-store `nix build`
 *  is a *remote build/transfer*, not a quick round-trip: the channel can sit idle
 *  for minutes while the far end compiles or fetches. If the host
 *  degrades mid-flight (network drop, sshd wedge, box overload), an ssh
 *  with no keepalive parks on the half-open socket until the OS TCP
 *  stack gives up — effectively forever — and wedges the caller's spawn
 *  cycle in `provisioning`/`connecting` with no recovery. For a dead TRANSPORT
 *  (the whole connection gone) the keepalive turns that eternity into a
 *  bounded `intervalS × countMax` failure the reconnect loop can retry — the
 *  {@link SshKeepalive} the dial chose, ≈30s by default.
 *
 *  Crucially this does NOT cap a healthy-but-slow build: ssh keepalives
 *  ride the protocol layer independently of channel data, so a
 *  responsive sshd answers them no matter how long the build's stdout
 *  stays quiet. Only an actually-unresponsive peer trips the limit. Raising the
 *  policy therefore buys tolerance of an unresponsive *network*, and costs only
 *  how long a genuinely dead host keeps a dial parked.
 *
 *  The blind spot this keepalive CANNOT close (#1908): a healthy transport
 *  with a single dead exec CHANNEL. The sshd answered keepalives fine while
 *  one channel's remote side was gone, so the local child parked in `poll()`
 *  forever with no keepalive to trip. That is why keepalive is necessary but
 *  NOT sufficient — the child lifetime policies in `process.ts` (a hard
 *  deadline or progress-liveness kill of the exact child) are what actually
 *  bound this case.
 *
 *  Declared once as `(key, value)` pairs — the single source of truth —
 *  then rendered into the two shapes its consumers need: an ssh `-o`
 *  argv ({@link sshCommonOpts}) for the ssh commands we spawn directly, and
 *  a whitespace-joined `NIX_SSHOPTS` string ({@link nixSshOpts}) for the
 *  remote-store ssh fork out of reach of our argv. Values MUST stay
 *  whitespace-free: the argv renderer emits one option per pair and nix
 *  word-splits `NIX_SSHOPTS`, so a value with a space would silently corrupt the
 *  env form while the argv form stayed correct. (`sshKeepalive`'s integers-only
 *  rule is what keeps the two rendered numbers whitespace-free.)
 *
 *  A FUNCTION of the policy rather than a const, so the policy is a value a dial
 *  carries rather than a module-global no consumer can state. */
export function sshOptPairs(
  keepalive: SshKeepalive,
): readonly (readonly [string, string])[] {
  return [...SSH_FIXED_OPTS, ...keepaliveOpts(keepalive)];
}

/** The non-interactive ssh CONTRACT — invariant, and independent of any policy.
 *
 *  `ConnectTimeout` sits HERE and not in {@link keepaliveOpts} because it is
 *  deliberately not tunable: it bounds the INITIAL handshake to a host that is
 *  not answering at all, which no consumer has a reason to stretch — a dial that
 *  cannot connect is retried by the session loop, not waited on. Two straight
 *  lists rather than one braided one, so which half varies with the argument is
 *  visible in the code instead of only in prose. */
const SSH_FIXED_OPTS: readonly (readonly [string, string])[] = [
  ["BatchMode", "yes"],
  ["ConnectTimeout", "10"],
];

/** The dial's TUNABLE dead-peer policy, rendered — and the ONE choke point
 *  where a policy's numbers become ssh's behaviour, which is why the runtime
 *  re-check lives here.
 *
 *  `SshKeepalive`'s brand is a compile-time fact, not a runtime one: object
 *  spread copies the private symbol while replacing the numbers, so
 *  `{ ...sshKeepalive(10, 3), intervalS: 0 }` typechecks and would render
 *  `ServerAliveInterval=0` — dead-peer detection OFF, the eternal half-open
 *  hang this option exists to bound. Every `ServerAlive*` this package emits is
 *  emitted HERE, so one assertion at this line covers all nine seams that carry
 *  a policy without any of them repeating a check. */
const keepaliveOpts = (
  keepalive: SshKeepalive,
): readonly (readonly [string, string])[] => {
  assertRenderableKeepalive(keepalive);
  return [
    ["ServerAliveInterval", String(keepalive.intervalS)],
    ["ServerAliveCountMax", String(keepalive.countMax)],
  ];
};

/** Where a dial's ssh goes AND under what dead-peer policy — the pair every
 *  spawn site in this package needs to know. The `keepalive` is optional and
 *  defaults to {@link DEFAULT_SSH_KEEPALIVE}, so a plain host string remains a
 *  complete answer (which is why {@link buildSshProbeCommand} still accepts
 *  one). */
export interface SshDestination {
  readonly host: string;
  readonly keepalive?: SshKeepalive;
}

/** Normalise the "host, or host + policy" argument the argv builders take: the
 *  string arm and an omitted `keepalive` both mean {@link DEFAULT_SSH_KEEPALIVE}.
 *  No validation HERE: a policy is checked once at the literal (`sshKeepalive()`)
 *  and once where it is rendered (`keepaliveOpts`, which catches a spread-forged
 *  one). A carrying seam like this repeats neither. */
function targetOf(target: string | SshDestination): {
  host: string;
  keepalive: SshKeepalive;
} {
  if (typeof target === "string") {
    return { host: target, keepalive: DEFAULT_SSH_KEEPALIVE };
  }
  return {
    host: target.host,
    keepalive: target.keepalive ?? DEFAULT_SSH_KEEPALIVE,
  };
}

/** Render `(key, value)` opt pairs into an ssh `-o Key=Value` argv. The one
 *  wire-format definition for the argv shape — `sshCommonOpts()` and
 *  `sshDialOpts()` both go through here, so re-tuning the form (say ssh ever
 *  wants `-o k v` instead of `-o k=v`) touches one place. */
const toArgv = (pairs: readonly (readonly [string, string])[]): string[] =>
  pairs.flatMap(([key, value]) => ["-o", `${key}=${value}`]);

/** Render `(key, value)` opt pairs into the whitespace-joined `-o Key=Value`
 *  env string Nix word-splits out of `NIX_SSHOPTS`.
 *  The one wire-format definition for the env shape. */
const toEnv = (pairs: readonly (readonly [string, string])[]): string =>
  pairs.map(([key, value]) => `-o ${key}=${value}`).join(" ");

/** The dead-peer policy ALONE as an ssh `-o Key=Value` argv — the keepalive
 *  primitive, for a consumer that wants to state this package's policy and owns
 *  its own multiplexing decision.
 *
 *  An out-of-package consumer building its own ssh command almost always wants
 *  {@link sshDialOpts} instead: this function names no `ControlPath`, and
 *  emitting nothing is NOT "no multiplexing" — ssh falls through to the user's
 *  `~/.ssh/config`, where an ordinary `Host *` block with `ControlMaster auto`
 *  supplies a master keyed by host+user+port and NOT by policy, so the very
 *  `ServerAlive*` this call rendered is silently replaced by whatever opened
 *  that master. */
export function sshCommonOpts(
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): readonly string[] {
  return toArgv(sshOptPairs(keepalive));
}

/** The COMPLETE argv a dial's ssh needs at `keepalive`: the dead-peer policy AND
 *  this package's `ControlMaster` decision — which is either our own per-policy
 *  socket or an explicit `ControlPath=none` refusal, never silence.
 *
 *  THIS is what a consumer that builds its own ssh command wants — e.g. the
 *  `mini-ci` surface example, which ships source over ssh with `git archive`
 *  instead of a nix closure. It is exactly what {@link buildAgentCommand} and
 *  {@link buildSshProbeCommand} emit for their remote arm, composed in ONE
 *  place, so the seam this package hands outward cannot render a different
 *  policy from the one it spawns with — which is how {@link sshCommonOpts}
 *  alone reopened, at the outward seam, the master-inheritance failure the
 *  per-policy socket keying exists to abolish. */
export function sshDialOpts(
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): readonly string[] {
  return toArgv([...sshOptPairs(keepalive), ...controlOptPairs(keepalive)]);
}

/** {@link sshCommonOpts} at the default policy, as a const — the pre-existing
 *  public spelling, kept so this change breaks no out-of-tree importer.
 *
 *  @deprecated Kept only for source compatibility, and it is the WRONG default
 *  reach: it is the shortest, most discoverable spelling while being the shape
 *  that omits this package's `ControlMaster` decision. A consumer building its
 *  own ssh command wants {@link sshDialOpts}; a consumer stating its own policy
 *  wants `sshCommonOpts(keepalive)`. This const is neither. */
export const SSH_COMMON_OPTS: readonly string[] = sshCommonOpts();

/** The `NIX_SSHOPTS` env string for remote-store Nix commands, carrying a
 *  caller's own {@link SshKeepalive} AND the runtime-computed `ControlMaster`
 *  pairs (see `controlOptPairs`) — the env-form twin of {@link sshDialOpts}.
 *
 *  Nix spawns its *own* ssh which never sees our argv, so this env var is the
 *  only handle on its dead-peer behaviour. Every `nixCopy` site passes it, so
 *  Nix's internal ssh rides the SAME shared master the arch probe opened — not
 *  a fresh ~5s handshake. When multiplexing is unavailable `controlOptPairs()`
 *  returns an explicit `ControlPath=none`, so this degrades to the plain
 *  rendered policy plus a refusal to multiplex — never to silence, which would
 *  hand the connection to whatever master the user's own `ssh_config` names. */
export function nixSshOpts(
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): string {
  return toEnv([...sshOptPairs(keepalive), ...controlOptPairs(keepalive)]);
}

/** Argv to spawn the agent on `host` against the realised `agentPath`.
 *  Localhost runs the binary directly (no ssh round-trip); a real
 *  remote wraps in `ssh` with the dial's keepalive opts.
 *
 *  `binary` is the executable name *inside* the realised closure (e.g.
 *  `process-monitor-agent` for the demo, `kolu-terminal-agent` for the
 *  planned R-2 consumer). The full path is `${agentPath}/bin/${binary}`. */
export function buildAgentCommand(
  opts: SshDestination & {
    agentPath: string;
    binary: string;
    /** Extra args appended after `--stdio` on the agent command line — a generic
     *  spawn-arg carrier; what the args mean is the caller's concern. Empty by
     *  default. For a real remote these are POSIX-quoted (ssh re-splits the command
     *  through the remote login shell); localhost runs the binary directly via
     *  `spawn`, so they pass through verbatim. */
    extraArgs?: readonly string[];
    /** The COMPLETE env for the localhost arm's direct `spawn` — REQUIRED, never
     *  optional. A localhost agent runs with EXACTLY this env, never the caller's
     *  ambient `process.env`, so identity vars (`CLAUDE_CODE_CHILD_SESSION`, …) cannot
     *  ride an ambient inherit into a locally-hosted agent (#1872 / PR1.5 — the
     *  future-forgotten localhost path #1880 left). surface-remote is POLICY-FREE: it
     *  neither composes nor scrubs; the caller hands over a clean env (kolu via
     *  kolu-pty's `composeSpawnEnv`/`SPAWN_ENV_ALLOWLIST`). Making it required is the
     *  type-level guard — omitting it is a COMPILE error, so ambient full-inherit is
     *  unspellable, never a review catch. IGNORED on the ssh arm (the returned `env`
     *  is `undefined` there): that child is the LOCAL ssh client, which legitimately
     *  inherits the caller's env for `SSH_AUTH_SOCK` / `~/.ssh`. */
    localEnv: Record<string, string>;
  },
): {
  command: string;
  args: string[];
  /** `localEnv` on the localhost arm; `undefined` on the ssh arm (spawn inherits, so
   *  the local ssh client keeps its `SSH_AUTH_SOCK` / `~/.ssh`). ONE place decides
   *  env per arm, so the two arms cannot drift. */
  env: Record<string, string> | undefined;
} {
  const exe = `${opts.agentPath}/bin/${opts.binary}`;
  const extra = opts.extraArgs ?? [];
  const { keepalive } = targetOf(opts);
  if (isLocalHost(opts.host)) {
    // Runtime backstop for the type-level guarantee. `localEnv` is a REQUIRED field, but
    // TS types erase at runtime — an untyped caller, an `as any`, a spread that drops the
    // key, or a `.d.ts`/build skew between this package and a consumer could still hand us
    // `undefined`. And `spawn(…, { env: undefined })` INHERITS the caller's full ambient
    // env — silently reopening the exact #1872 identity-leak seam this arm exists to close,
    // with no throw and no log. So fail LOUD rather than degrade to ambient inherit (the
    // no-fallbacks doctrine): a localhost spawn without a composed env is a hard error.
    if (opts.localEnv == null) {
      throw new Error(
        "buildAgentCommand: localEnv is required for a localhost dial — refusing to fall back to the caller's ambient process.env (#1872)",
      );
    }
    // Direct `spawn`, no shell — args pass through verbatim, no quoting. The child
    // runs with EXACTLY `localEnv`; nothing ambient leaks in (#1872 / PR1.5).
    return { command: exe, args: ["--stdio", ...extra], env: opts.localEnv };
  }
  return {
    command: "ssh",
    // `--` ends ssh's option parsing so the host is ALWAYS read as a
    // destination, never as an option. Without it a host like
    // `-oProxyCommand=<cmd>` is parsed by ssh as an option and runs `<cmd>`
    // via /bin/sh "to establish the connection" — remote code execution from
    // a hostile host string. The separator closes that structurally for every
    // caller of this builder, independent of any host-validity check upstream;
    // a real ssh destination never starts with `-`, so it rejects no
    // legitimate host. (`opts.host` is a bare positional here, the sink.)
    args: [
      ...sshDialOpts(keepalive),
      "--",
      opts.host,
      exe,
      "--stdio",
      // ssh joins everything after the host into ONE string run by the remote
      // login shell, so a caller-supplied value (a `--kaval` socket path with a
      // space, say) must be POSIX-quoted or it would re-split / inject. The
      // canonical `@kolu/shell-quote` owns that quoting axis repo-wide (zero
      // runtime deps, so it adds no weight to this drishti-shared closure). The
      // fixed tokens above are metacharacter-free store paths, so they don't.
      ...extra.map(shellQuoteArg),
    ],
    // The ssh child is the LOCAL ssh client, not the agent — it needs the caller's
    // env (`SSH_AUTH_SOCK`, `HOME` for `~/.ssh`), so `spawn` inherits it (`env`
    // undefined). The agent runs on the REMOTE host; its env is owned there, never
    // by this local spawn — so `localEnv` is deliberately unused on this arm.
    env: undefined,
  };
}

/** Argv to run a one-shot command against a host. Localhost runs the
 *  command directly; remote wraps in `ssh` with the dial's keepalive opts —
 *  same dead-peer fast-fail as the agent session (see {@link sshOptPairs} for
 *  why a "one-shot" realise needs it just as much as a long-lived link).
 *
 *  Used for `nix-instantiate --eval` arch probes, `nix-store --realise` /
 *  `nix build` invocations that need to round-trip and return.
 *
 *  `target` is a bare host string (the {@link DEFAULT_SSH_KEEPALIVE} policy) or
 *  an {@link SshDestination} naming the dial's own policy. Every ssh a single dial
 *  spawns must pass the SAME policy: they share one `ControlMaster` keyed by it,
 *  and mixing policies within a dial would open two masters to one host.
 *
 *  **Remote arm quotes every token** via {@link shellQuoteArg}: OpenSSH joins
 *  everything after the host into ONE string the remote login shell re-parses,
 *  so a metacharacter-bearing arg (the `^*` installable suffix for
 *  `nix build --print-out-paths`, spaces, globs, …) MUST be POSIX-quoted or
 *  zsh/bash expand it (`zsh:1: no matches found: …drv^*` — #1964 macOS).
 *  Localhost is direct `spawn` — args pass through verbatim, no shell. */
export function buildSshProbeCommand(
  target: string | SshDestination,
  ...remoteArgv: readonly [string, ...string[]]
): { command: string; args: string[] } {
  const { host, keepalive } = targetOf(target);
  if (isLocalHost(host)) {
    const [cmd, ...rest] = remoteArgv;
    return { command: cmd, args: rest };
  }
  return {
    command: "ssh",
    // `--` ends ssh's option parsing so `host` can never be read as an option
    // (`-oProxyCommand=<cmd>` → RCE). See `buildAgentCommand` for the full
    // rationale; `host` is the bare-positional sink here too.
    // Quote remote tokens the same way `buildAgentCommand` quotes `extraArgs`
    // — the remote login shell re-parses this argv as one string.
    args: [
      ...sshDialOpts(keepalive),
      "--",
      host,
      ...remoteArgv.map(shellQuoteArg),
    ],
  };
}
