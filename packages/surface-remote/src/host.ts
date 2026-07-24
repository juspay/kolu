/** Helpers for `host`-string handling shared between target-store provisioning
 *  and the ssh agent subprocess. Keeps the
 *  "are we talking to ourselves?" check and the per-line stderr fanout
 *  in one place so they evolve together. */

import { shellQuoteArg } from "@kolu/shell-quote";
import { controlOptPairs } from "./controlMaster";

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** The closed resolver-failure verdicts a connector can act on. Plain errors remain
 *  retryable network failures; typed resolver failures must choose one of these
 *  valid cause/terminal combinations. */
export type ResolveDrvFailure =
  | {
      kind: "source-unbaked" | "unavailable";
      failureCause: "remote";
      terminal: false;
    }
  | {
      kind: "network-exhausted";
      failureCause: "network";
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

  get failureCause(): ResolveDrvFailure["failureCause"] {
    return this.resolution.failureCause;
  }

  get terminal(): ResolveDrvFailure["terminal"] {
    return this.resolution.terminal;
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
 *  bounded ~Interval×CountMax (≈30s) failure the reconnect loop can retry.
 *
 *  Crucially this does NOT cap a healthy-but-slow build: ssh keepalives
 *  ride the protocol layer independently of channel data, so a
 *  responsive sshd answers them no matter how long the build's stdout
 *  stays quiet. Only an actually-unresponsive peer trips the limit.
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
 *  argv (`SSH_COMMON_OPTS`) for the ssh commands we spawn directly, and
 *  a whitespace-joined `NIX_SSHOPTS` string for the remote-store ssh fork
 *  out of reach of our argv. Values MUST stay whitespace-free: the argv
 *  renderer emits one option per pair and nix word-splits `NIX_SSHOPTS`,
 *  so a value with a space would silently corrupt the env form while the
 *  argv form stayed correct. */
const SSH_OPT_PAIRS = [
  ["BatchMode", "yes"],
  ["ServerAliveInterval", "10"],
  ["ServerAliveCountMax", "3"],
  ["ConnectTimeout", "10"],
] as const;

/** Render `(key, value)` opt pairs into an ssh `-o Key=Value` argv. The one
 *  wire-format definition for the argv shape — `SSH_COMMON_OPTS` and
 *  `controlArgv()` both go through here, so re-tuning the form (say ssh ever
 *  wants `-o k v` instead of `-o k=v`) touches one place. */
const toArgv = (pairs: readonly (readonly [string, string])[]): string[] =>
  pairs.flatMap(([key, value]) => ["-o", `${key}=${value}`]);

/** Render `(key, value)` opt pairs into the whitespace-joined `-o Key=Value`
 *  env string Nix word-splits out of `NIX_SSHOPTS`.
 *  The one wire-format definition for the env shape — both `NIX_SSHOPTS` and
 *  `nixSshOpts()` go through here. */
const toEnv = (pairs: readonly (readonly [string, string])[]): string =>
  pairs.map(([key, value]) => `-o ${key}=${value}`).join(" ");

/** The policy as an ssh `-o Key=Value` argv, for the ssh commands this
 *  package spawns directly (agent session, probe/realise/pin). Exported so
 *  consumers that build their *own* ssh command — e.g. the `mini-ci`
 *  surface example, which ships source over ssh with `git archive` instead
 *  of a nix closure — reuse the same dead-peer policy rather than copying
 *  it. (`buildAgentCommand`/`buildSshProbeCommand` already bake it in for
 *  the argv shapes this package spawns itself.) */
export const SSH_COMMON_OPTS: readonly string[] = toArgv(SSH_OPT_PAIRS);

/** The same policy as the `NIX_SSHOPTS` env string that a remote-store Nix
 *  command reads. Nix spawns its *own* ssh which never sees our argv, so this
 *  env var is the only handle on its dead-peer behaviour — without it the
 *  remote-store step is exposed to the exact hang `SSH_COMMON_OPTS`
 *  closes for the commands we spawn directly. */
export const NIX_SSHOPTS: string = toEnv(SSH_OPT_PAIRS);

/** The `NIX_SSHOPTS` env string for remote-store Nix commands, as a
 *  function (not the const above) so it can additionally carry the
 *  runtime-computed `ControlMaster` pairs (see `controlOptPairs`). The
 *  const stays for external direct importers and is the static keepalive
 *  policy alone; THIS is what `nixCopy` passes, so Nix's internal ssh
 *  internally rides the SAME shared master the arch probe opened — not a
 *  fresh ~5s handshake. When multiplexing is unavailable `controlOptPairs()`
 *  returns `[]`, so this degrades back to exactly the const's value. */
export function nixSshOpts(): string {
  return toEnv([...SSH_OPT_PAIRS, ...controlOptPairs()]);
}

/** The `ControlMaster` opts as ssh `-o` argv — empty when multiplexing is
 *  unavailable (see `controlOptPairs`). Appended after `SSH_COMMON_OPTS` by
 *  the spawned-ssh builders so the agent dial, the arch probe, and the
 *  realise all ride the one shared master. */
function controlArgv(): string[] {
  return toArgv(controlOptPairs());
}

/** Argv to spawn the agent on `host` against the realised `agentPath`.
 *  Localhost runs the binary directly (no ssh round-trip); a real
 *  remote wraps in `ssh` with `SSH_COMMON_OPTS`.
 *
 *  `binary` is the executable name *inside* the realised closure (e.g.
 *  `process-monitor-agent` for the demo, `kolu-terminal-agent` for the
 *  planned R-2 consumer). The full path is `${agentPath}/bin/${binary}`. */
export function buildAgentCommand(opts: {
  host: string;
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
}): {
  command: string;
  args: string[];
  /** `localEnv` on the localhost arm; `undefined` on the ssh arm (spawn inherits, so
   *  the local ssh client keeps its `SSH_AUTH_SOCK` / `~/.ssh`). ONE place decides
   *  env per arm, so the two arms cannot drift. */
  env: Record<string, string> | undefined;
} {
  const exe = `${opts.agentPath}/bin/${opts.binary}`;
  const extra = opts.extraArgs ?? [];
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
      ...SSH_COMMON_OPTS,
      ...controlArgv(),
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

/** Argv to run a one-shot command against `host`. Localhost runs the
 *  command directly; remote wraps in `ssh` with `SSH_COMMON_OPTS` — same
 *  dead-peer fast-fail as the agent session (see `SSH_COMMON_OPTS` for
 *  why a "one-shot" realise needs it just as much as a long-lived link).
 *
 *  Used for `nix-instantiate --eval` arch probes, `nix-store --realise` /
 *  `nix build` invocations that need to round-trip and return.
 *
 *  **Remote arm quotes every token** via {@link shellQuoteArg}: OpenSSH joins
 *  everything after the host into ONE string the remote login shell re-parses,
 *  so a metacharacter-bearing arg (the `^*` installable suffix for
 *  `nix build --print-out-paths`, spaces, globs, …) MUST be POSIX-quoted or
 *  zsh/bash expand it (`zsh:1: no matches found: …drv^*` — #1964 macOS).
 *  Localhost is direct `spawn` — args pass through verbatim, no shell. */
export function buildSshProbeCommand(
  host: string,
  ...remoteArgv: readonly [string, ...string[]]
): { command: string; args: string[] } {
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
      ...SSH_COMMON_OPTS,
      ...controlArgv(),
      "--",
      host,
      ...remoteArgv.map(shellQuoteArg),
    ],
  };
}
