/**
 * `@kolu/terminal-workspace` — the host-side terminal WORKSPACE library, run in
 * two homes off one codebase: in-process in kolu-server (local terminals) and
 * hosted by `pulam` over ssh (remote ones). Lifted out of kolu-server so both
 * homes share ONE copy of the freshness-critical code. Its entry points
 * (the export map is the boundary — node-only code never reaches a browser
 * consumer):
 *  - `.` — the memoryless per-terminal awareness PRODUCER (git · PR · agent ·
 *    foreground) + the generic `TerminalSnapshot` schema it emits, and the pure `fold`
 *    kolu folds the observation stream with.
 *  - `./schema` — the browser-safe `TerminalSnapshot` / `AgentMemory` zod schemas alone.
 *  - `./endpoint` — `createTerminalWorkspaceEndpoint`, the host-side fs/git
 *    wrapper over `kolu-git` the Code tab reads.
 *  - `./surface` — `terminalWorkspaceSurface`, the browser-safe served surface
 *    (awareness + fs/git) pulam serves and a remote kolu mirrors in R8.
 *  - `./serveFsGit` — `fsGitSurfaceDeps`, the deps wiring the endpoint onto the
 *    surface.
 *  - `./socket` — the well-known pulam rendezvous socket path.
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
