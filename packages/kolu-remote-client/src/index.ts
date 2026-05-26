/**
 * kolu-remote-client — RemoteXxxProvider implementations that satisfy
 * the same interfaces the local providers do, but route through a
 * `HostSession` instead of touching the local filesystem.
 *
 * Phase 2b of kolu#951. The local server's `meta/git.ts`, `meta/agent.ts`,
 * `meta/github.ts`, and `surface.ts` fs streams pick a provider per
 * terminal based on `entry.meta.location.kind` — local for local tiles,
 * the remote variant from this package for SSH tiles.
 *
 * Each provider is a thin RPC stub: domain methods translate to one
 * `HostSession.call(...)` or `HostSession.subscribe(...)` each. The
 * agent on the other side runs the LOCAL provider against its own
 * filesystem — Zed's symmetry, expressed through TypeScript.
 */

export type { HostSessionLike } from "./host-session.ts";
export { remoteFsProvider } from "./remote-fs-provider.ts";
export { remoteGitInfoProvider } from "./remote-git-info-provider.ts";
