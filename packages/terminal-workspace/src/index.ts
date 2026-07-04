/**
 * `@kolu/terminal-workspace` — the host-side terminal WORKSPACE library: the
 * memoryless per-terminal awareness sensors, the pure fold kolu folds their
 * observation stream with, and the host-side fs/git wrapper the Code tab reads.
 * Lifted out of kolu-server so its one home — padi (which owns the per-host
 * terminal domain) — and kolu-server share ONE copy of the freshness-critical
 * code. Its entry points (the export map is the boundary — node-only code never
 * reaches a browser consumer):
 *  - `.` — the memoryless per-terminal awareness PRODUCER (git · PR · agent ·
 *    foreground) + the generic `TerminalSnapshot` schema it emits, and the pure `fold`
 *    kolu folds the observation stream with.
 *  - `./schema` — the browser-safe terminal vocabulary alone: the
 *    `TerminalSnapshot` / `AgentMemory` / `TerminalId` zod schemas plus the
 *    `RepoChangePulse` / `FsFileInput` / `FsReadFileTextOutput` fs/git wire
 *    schemas `@kolu/padi/surface` composes.
 *  - `./agentProjection` — the pure agent-status projection.
 *  - `./endpoint` — `createTerminalWorkspaceEndpoint`, the host-side fs/git
 *    wrapper over `kolu-git` the Code tab reads.
 *
 * The frozen `terminalWorkspaceSurface` (and its `serveFsGit` /
 * `serveTerminalWorkspace` assemblers + the pulam rendezvous `socket`) were
 * BURIED with pulam / pulam-tui (W2.3): the per-host terminal surface is
 * `padiSurface` now, and padi absorbed the fs/git watcher-stream backings.
 *
 * The package names no kolu-app package: its lone host coupling — a logger —
 * is injected as a `startSensors` parameter. Consumers that only need the
 * schemas (no sensors, no node/kaval runtime) import `./schema` directly.
 */

export * from "./sensors.ts";
export * from "./schema.ts";
export * from "./fold.ts";
// The kaval-dial bridge — taps → `SensorSignals`. Only the standalone
// `pulam` daemon needs it (kolu-server builds its channels in-process); it
// lives here so there is one copy of the transport adapter, not a fork.
export * from "./kavalChannels.ts";
