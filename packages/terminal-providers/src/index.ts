/**
 * `@kolu/terminal-providers` — kolu's per-terminal awareness providers (git /
 * PR / agent detection, the foreground/process observer, the agent-command
 * tracker), plus `buildWatcherServer`, which serves the host-side providers as
 * the `watcherSurface` so kolu-server consumes their output over a link
 * (`directLink` in-process today, an ssh `stdioLink` later — local vs remote is
 * only the link).
 *
 * The providers carry no dependency on kolu-server: the host is injected
 * (`ProviderHooks` + `ProviderChannels`). kolu-server runs the in-server
 * foreground/process provider (`startProcessProvider`) directly and consumes the
 * host-side providers through `buildWatcherServer`.
 */
export {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProcessProvider,
  startWatcherProviders,
} from "./providers.ts";
export {
  type BuildWatcherServerOptions,
  buildWatcherServer,
  type WatcherServer,
} from "./server.ts";
export {
  type LiveAwareness,
  LiveAwarenessSchema,
  type PersistedAwareness,
  PersistedAwarenessSchema,
  type WatcherContract,
  type WatcherSurface,
  watcherSurface,
} from "./watcherSurface.ts";
