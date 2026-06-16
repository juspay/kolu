/**
 * `@kolu/terminal-dag` — kolu's per-terminal provider DAG, extracted so it
 * can run in TWO host processes from one source:
 *
 *   - `kolu-server` (local terminals) — the DAG runs in-process, wired to
 *     the browser surface via `LocalTerminalEndpoint`'s hooks.
 *   - `kolu-watcher` (P3, remote terminals over ssh) — the DAG runs
 *     host-side beside the remote host's kaval, feeding kolu-watcher's own
 *     served `terminalMetadata` collection.
 *
 * The DAG is transport-agnostic by construction: it reads pty-host taps off
 * `ProviderChannels` (never a sync PTY handle) and writes through
 * `ProviderHooks` (the host supplies the metadata sink and the logger), so
 * the same `startProviders` body serves both hosts. This package
 * deliberately depends on kolu app packages (anyagent/anyforge/the agent
 * detectors/kolu-git) — that coupling is exactly why the DAG lives beside
 * kaval's PTY rather than inside the kolu-agnostic kaval daemon.
 */
export {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "./providers.ts";
export { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";
export { bridgeStream } from "./bridgeStream.ts";
export { makeFsGit, unwrapGit } from "./fsGit.ts";
export { initialServerMeta } from "./metadata.ts";
