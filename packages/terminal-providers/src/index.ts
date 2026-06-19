/**
 * `@kolu/terminal-providers` — the per-terminal awareness provider DAG, as a
 * host-agnostic, composable unit.
 *
 * This is the **watcherDeps impl bundle** of the remote-terminals design
 * (P4w): the git / PR / agent / foreground watchers that derive a terminal's
 * awareness from its PTY taps, parameterized over `ProviderRecord` +
 * `ProviderChannels` + `ProviderHooks` so the *host* is the only thing that
 * varies. The DAG has zero synchronous dependency on the PTY host (it reads
 * taps, not a handle) and reaches the host only through the injected `hooks` +
 * `log`, so it composes in-process today (kolu-server's local endpoint spreads
 * it in via `startProviders` — no client, no mirror, no wire) and serves over
 * ssh unchanged tomorrow (P4d).
 *
 * What stays in the host (kolu-server) is the *fold*: the `hooks` impl that
 * projects these writes onto the `terminalMetadata` surface collection and
 * enforces the persisted-vs-live `terminals:dirty` fence. This package owns the
 * computation; the host owns where that computation becomes visible.
 */

export {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "./providers.ts";
export { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";
