/**
 * `@kolu/terminal-workspace` — the host-side terminal WORKSPACE library, run in
 * two homes off one codebase: in-process in kolu-server (local terminals) and
 * hosted by `pulam` over ssh (remote ones). Lifted out of kolu-server so both
 * homes share ONE copy of the freshness-critical code. Its entry points
 * (the export map is the boundary — node-only code never reaches a browser
 * consumer):
 *  - `.` — the per-terminal awareness assembly primitives: the sensor set
 *    (`startAwareness`), the sink (`makeAwarenessSink`), the live-output tracker
 *    (`createActivityTracker`), the kaval-tap bridge (`bridgeKavalTaps`) + the
 *    generic `AwarenessValue` schema they produce.
 *  - `./createPulam` — the ONE assembly that turns a dialed kaval into a live,
 *    served `terminalWorkspace` surface, wiring those primitives together. The
 *    `pulam` daemon and (R9.0) kolu-server both rest on it.
 *  - `./serveTerminalWorkspace` — `serveTerminalWorkspace`, the surface-skeleton
 *    factory `createPulam` returns (awareness + activity backing injection).
 *  - `./schema` — the browser-safe `AwarenessValue` zod schema alone.
 *  - `./endpoint` — `createTerminalWorkspaceEndpoint`, the host-side fs/git
 *    wrapper over `kolu-git` the Code tab reads.
 *  - `./surface` — `terminalWorkspaceSurface`, the browser-safe served surface
 *    (awareness + fs/git) pulam serves and a remote kolu mirrors in R8.
 *  - `./serveFsGit` — `fsGitSurfaceDeps`, the deps wiring the endpoint onto the
 *    surface.
 *  - `./socket` — the well-known pulam rendezvous socket path.
 *
 * The package names no kolu-app package: its lone host coupling — a logger —
 * is injected as a `startAwareness` parameter. Consumers that only need the
 * schemas (no sensors, no node/kaval runtime) import `./schema` directly.
 */

export * from "./sensors.ts";
export * from "./schema.ts";
// The kaval-dial bridge — taps → `AwarenessSignals`. Only the standalone
// `pulam` daemon needs it (kolu-server builds its channels in-process); it
// lives here so there is one copy of the transport adapter, not a fork.
export * from "./kavalChannels.ts";
// The per-terminal sink and the live-output activity tracker — the two assembly
// pieces `createPulam` wires (formerly stranded in the pulam daemon package).
export * from "./awarenessSink.ts";
export * from "./activity.ts";
