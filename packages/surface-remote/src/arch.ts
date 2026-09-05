/**
 * Detect a host's nix-system identifier by asking the host's own Nix.
 *
 * The companion piece to source-based agent resolution. `resolveSystem(host,
 * opts)` is the canonical target-system probe — it returns the
 * nix-system string (`x86_64-linux`, `aarch64-darwin`, …) that
 * `resolveAgentDrv` uses to select one package from the baked source flake.
 *
 * Why ask Nix rather than parse `uname -ms`: the host's own Nix is the
 * authoritative answer to "what system will this machine build for",
 * which is exactly the question that decides which agent `.drv` to
 * realise here. It needs no hand-maintained `uname → nix-system` table
 * (which silently drifts as platforms are added — Intel Mac, RISC-V, …)
 * and it stays correct under emulation / cross setups where `uname`
 * and Nix's `system` disagree.
 *
 * Why this is safe to depend on: `provisionAgent` already runs
 * `nix build` (and a GC-root pin) on the host over the same non-interactive
 * ssh (see `nixCopy.ts`), so the host's Nix is already a hard requirement
 * reachable on that PATH — `nix-instantiate` ships in the same
 * package. The probe adds no dependency the build step didn't.
 *
 * Typical low-level use. `resolveAgentDrv` is the higher-level source-flake
 * composition used by Kolu:
 *
 *   const session = makeSession({
 *     connectOnce: sshConnector({
 *       host,
 *       binary,
 *       localEnv,  // the composed env a `localhost` dial spawns with (never ambient process.env)
 *       resolveDrvPath: async (ctx) => {
 *         const sys = await resolveSystem(host, ctx);
 *         return resolveDrvForSystem(sys);
 *       },
 *     }),
 *   });
 */

import {
  assertSshKeepalive,
  buildSshProbeCommand,
  isLocalHost,
  ResolveDrvError,
  type SshKeepalive,
  type SshRefusal,
  sshRefusalOf,
} from "./host";
import { probePolicy } from "./nixCopy";
import { describeExit, runCapture } from "./process";

/** Sanity-guard shape for a nix-system identifier: `<cpu>-<os>`, e.g.
 *  `x86_64-linux`, `aarch64-darwin`. Deliberately NOT a closed
 *  allow-list — a host reporting a system this library has never seen
 *  (`riscv64-linux`, …) passes the probe; resolution succeeds only when the
 *  baked agent flake exposes `packages.<system>.<package>`. The guard only
 *  rejects output that clearly isn't a system string (empty, a warning line,
 *  multi-token noise). */
const NIX_SYSTEM_RE = /^[a-z0-9_]+-[a-z0-9_]+$/;

export interface ResolveSystemOptions {
  signal: AbortSignal;
  onProgress: (line: string) => void;
  /** The owning dial's ssh dead-peer policy. Defaults to
   *  `DEFAULT_SSH_KEEPALIVE`, and is satisfied structurally by the
   *  `ResolveDrvPathContext` a `sshConnector` dial hands the resolver — so the
   *  documented `resolveSystem(host, ctx)` idiom threads the dial's policy with
   *  no extra wiring. It MUST match the rest of the dial: this probe is usually
   *  the ssh that OPENS the host's shared `ControlMaster`, and the master's
   *  opener fixes `ServerAlive*` for every command that later rides it. */
  keepalive?: SshKeepalive;
}

/** Ask `host`'s Nix for its `builtins.currentSystem`. Runs locally for
 * `isLocalHost`, over `ssh` otherwise. The fact belongs to this dial: an SSH
 * alias can be retargeted or a machine reimaged while Kolu remains open, so
 * caching it beyond the dial would select packages for a stale host identity. */
export async function resolveSystem(
  host: string,
  opts: ResolveSystemOptions,
): Promise<string> {
  // Validate a supplied policy BEFORE any work, and on BOTH arms. Two reasons
  // this cannot be left to the argv renderer: the localhost arm renders no opts
  // at all (so the check would silently not happen), and a throw from here lands
  // inside the caller's `resolveDrvPath`, which `sshConnector` classifies as
  // `"network"` / non-terminal — so a nonsense literal would be re-thrown on
  // every redial forever instead of failing once, loudly, at the top.
  if (opts.keepalive !== undefined) assertSshKeepalive(opts.keepalive);
  // Which arm we are on decides how a missing executable surfaces, and which
  // executable a spawn fault is even ABOUT — see the failure classification below.
  const local = isLocalHost(host);
  const { command, args } = buildSshProbeCommand(
    { host, keepalive: opts.keepalive },
    "nix-instantiate",
    "--eval",
    "--expr",
    "builtins.currentSystem",
  );
  // Watch the probe's stderr for an ssh REFUSAL as the lines stream past — the
  // probe is every dial's FIRST ssh contact, so classifying here covers all of
  // them: any refusal a LATER step hits (nix's own ssh fork, the agent dial)
  // kills that dial, and the redial's probe meets the same refusal
  // un-multiplexed and lands in this one classifier within a single retry.
  let refusal: { kind: SshRefusal; line: string } | null = null;
  const res = await runCapture(command, args, {
    // The arch probe (#1908 D1b) is a quick `nix-instantiate --eval` round-trip — never a
    // build — so it rides the shared QUICK-step deadline `probePolicy()` (as does the
    // warm check). The "how long a quick nix/ssh round-trip may run" policy shape lives
    // in ONE place, not re-spelled here.
    policy: probePolicy(),
    signal: opts.signal,
    onProgress: (line) => {
      if (refusal === null) {
        const kind = sshRefusalOf(line);
        if (kind !== null) refusal = { kind, line };
      }
      opts.onProgress(line);
    },
  });
  if (!res.ok) {
    // A refusal line alone is not proof — the remote COMMAND's stderr also rides
    // ssh's stderr. ssh exits 255 for its OWN failures, so require both: the
    // refusal text AND the ssh-255 exit. (A localhost probe never sshs, so its
    // stderr can't match; a refusal that slips this guard merely stays an
    // untyped, retried error — the safe default, never a wrong terminal verdict.
    // NB 255 is ssh's CONVENTION for its own failures, not a guarantee — a remote
    // command may legitimately exit 255 too. The text match is what carries the
    // classification; the code is the corroborating guard.)
    if (refusal !== null && res.kind === "exit" && res.code === 255) {
      const { kind, line } = refusal;
      throw new ResolveDrvError(
        kind === "auth-refused"
          ? `${host}: ssh refused our credentials — this client connects non-interactively and can never answer a password or passphrase prompt. Set up key-based ssh (e.g. \`ssh-copy-id ${host}\`) so plain \`ssh ${host}\` connects without prompting: ${line}`
          : `${host}: ssh does not trust this host's identity key — this client connects non-interactively and can never answer the trust prompt. Run \`ssh ${host}\` once in a terminal to verify and accept the host key (or resolve a changed-key warning): ${line}`,
        { kind, failureCause: "remote", terminal: true },
      );
    }
    // A missing Nix reaches us in two DIFFERENT shapes, because the two arms run
    // the probe two different ways — and the exit-code shape alone would miss the
    // local one entirely (it reported "host unreachable" and retried forever):
    //
    //   remote    → we spawn `ssh`, which exists; the REMOTE shell can't find
    //               `nix-instantiate` and exits 127.
    //   localhost → we spawn `nix-instantiate` DIRECTLY (no shell). An absent
    //               executable never runs, so there is no exit code at all: Node
    //               raises ENOENT as a spawn `error` event.
    //
    // Exit 127 is POSIX for "the shell could not find the command" — every shell
    // honours the code even though each words its message differently (bash
    // "command not found", dash "not found", fish "Unknown command"), so the CODE
    // is the reliable signal and matching prose would only add ways to miss.
    // Unlike the ssh refusals above this needs no 255 companion: 127 IS the remote
    // command's own exit status, not text that could have come from elsewhere.
    // ENOENT is the same fact for the direct arm, and equally structural — hence
    // `spawn-error.code`, never a scrape of the message text.
    const absentExecutable =
      (res.kind === "exit" && res.code === 127) ||
      (res.kind === "spawn-error" && res.code === "ENOENT");
    if (absentExecutable) {
      // WHICH executable was absent depends on the arm: the direct arm was trying
      // to run Nix itself, so ENOENT there IS the missing Nix. On the ssh arm the
      // binary we spawned is `ssh`, so an ENOENT means THIS machine has no ssh —
      // a local setup fault, not a statement about the far end.
      if (res.kind === "spawn-error" && !local) {
        // Bounded rather than terminal, matching how the sibling resolver treats a
        // spawn fault (`agentDrv`'s `evaluationError`): it ends instead of
        // retrying forever, without claiming a verdict about the remote host.
        throw new ResolveDrvError(
          `${host}: could not run \`ssh\` on THIS machine (${res.message}) — a remote host is reached by spawning ssh locally, so it cannot be dialled until ssh is installed and on kolu's PATH.`,
          { kind: "unavailable", failureCause: "remote", terminal: false },
        );
      }
      throw new ResolveDrvError(
        `${host}: could not run \`nix-instantiate\` — ${
          local
            ? "Nix is not installed, or not on this process's PATH"
            : "Nix is either not installed there, or not on the PATH of a NON-INTERACTIVE ssh session (a common single-user Nix install, whose profile only gets sourced by a login shell)"
        }. This agent is provisioned using the host's own Nix, so it cannot proceed without it — check with \`${
          local
            ? "nix-instantiate --version"
            : `ssh ${host} nix-instantiate --version`
        }\`, and install Nix from https://nixos.asia/en/install if it is missing.`,
        { kind: "nix-unavailable", failureCause: "remote", terminal: true },
      );
    }
    throw new Error(
      `${host}: \`nix-instantiate --eval builtins.currentSystem\` ${describeExit(res)}`,
    );
  }
  // nix-instantiate prints the Nix string repr — `"x86_64-linux"\n` —
  // which is valid JSON for a plain string, so JSON.parse strips the
  // surrounding quotes.
  let sys: unknown;
  try {
    sys = JSON.parse(res.stdout.trim());
  } catch {
    throw new Error(
      `${host}: could not parse nix-system from probe output ${JSON.stringify(res.stdout.trim())}`,
    );
  }
  if (typeof sys !== "string" || !NIX_SYSTEM_RE.test(sys)) {
    throw new Error(
      `${host}: probe returned ${JSON.stringify(sys)}, not a nix-system string`,
    );
  }
  return sys;
}
