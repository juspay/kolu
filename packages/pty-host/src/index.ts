/** `@kolu/pty-host` — the multi-client PTY-owner primitive.
 *
 *  A `node-pty` child + an `@xterm/headless` screen mirror + the
 *  VT-derived event taps (cwd via OSC 7, title via OSC 0/2, command-run
 *  via OSC 633, exit, foregroundPid), each fanned out through a bounded
 *  per-PTY channel. Owns ONLY the PTY — no git, PRs, agents, file tree, or
 *  wire protocol. Env/shell-init prep is the caller's job (see `kolu-pty`).
 */

export {
  createPtyHost,
  type ForegroundSample,
  type PtyAttachment,
  type PtyHandle,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
} from "./ptyHost.ts";

// The daemon's wire contract — the `kolu --stdio` PTY-host surface, its
// version, and the compatibility check. `ptyHostSurface` is a VALUE export
// (not type-only): consumers do `typeof ptyHostSurface.contract` to type their
// client, which collapses to `unknown` under a type-only re-export.
export {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
  ptyHostSurface,
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostListEntry,
  type PtyHostSurface,
  type PtyHostSystemVersion,
} from "./ptyHostSurface.ts";

// Build identity — the staleness key (`KOLU_PTY_HOST_BUILD_ID` source hash) and
// the GitHub-navigable git commit. Shared verbatim by the daemon (reports it)
// and the supervisor (compares it).
export {
  currentBuildId,
  currentCommitHash,
  deriveBuildId,
  resolveBuildId,
} from "./buildId.ts";

// Daemon-startup primitives — the single-instance pid-gate and the exec-arg
// filter, used by both the daemon entrypoint and the supervisor's spawn.
export { daemonExecArgv, tryAcquirePidFile } from "./daemonUtils.ts";
