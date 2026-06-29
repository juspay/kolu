/**
 * `@kolu/pulam-library` — the host-side terminal WORKSPACE library, run in
 * two homes off one codebase: in-process in kolu-server (local terminals) and
 * hosted by `pulam` over ssh (remote ones). Lifted out of kolu-server so both
 * homes share ONE copy of the freshness-critical code. Its entry points
 * (the export map is the boundary — node-only code never reaches a browser
 * consumer):
 *  - `.` — the SHARED per-terminal sensing LEAF, `watchTerminalAwareness`, plus
 *    the pieces each home assembles its own loop from: the `AwarenessRecord` /
 *    `AwarenessSink` types it consumes, the home-owned `createActivityTracker`,
 *    the plain `makeAwarenessSink`, and the generic `AwarenessValue` schema + its
 *    `seedAwarenessValue` seed. The leaf's own SENSING internals — the sensor set
 *    (`startAwareness`) and the kaval-tap bridge (`bridgeKavalTaps`) — are NOT
 *    exported: the leaf is the one way to drive them, so a second hand-rolled
 *    assembler is unspellable (and `sharedLeaf.assembler.test.ts` proves it).
 *  - `./serveTerminalWorkspace` — `serveTerminalWorkspace`, the surface-skeleton
 *    factory both homes call, plus the `activity` backings they inject
 *    (`quietActivity` / `liveActivity(tracker)`).
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
 * is injected as a `watchTerminalAwareness` / `startAwareness` parameter.
 * Consumers that only need the schemas (no sensors, no node/kaval runtime) import
 * `./schema` directly.
 */

// The home-owned activity tracker the leaf's raw-output tap feeds.
export { type ActivityTracker, createActivityTracker } from "./activity.ts";
// The plain per-terminal sink a tap-less home (the `pulam` daemon) injects — it
// publishes the whole value to its served collection, with no persisted/live fold
// (that fold is kolu-server's, baked into its own sink, never here).
export { makeAwarenessSink } from "./awarenessSink.ts";
export * from "./schema.ts";
// The record + sink TYPES a home builds/injects (the leaf's sensing internals —
// `startAwareness`, `bridgeKavalTaps`, the signal channels — are deliberately NOT
// exported; the leaf is the only way to drive them).
export type { AwarenessRecord, AwarenessSink } from "./sensors.ts";
// The shared per-terminal sensing LEAF — the one seam both homes drive.
export {
  type TerminalActivityTap,
  type WatchTerminalDeps,
  watchTerminalAwareness,
} from "./watchTerminalAwareness.ts";
