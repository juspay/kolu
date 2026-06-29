/**
 * `@kolu/pulam-library` — the host-side terminal WORKSPACE library, run in
 * two homes off one codebase: in-process in kolu-server (local terminals) and
 * hosted by `pulam` over ssh (remote ones). Lifted out of kolu-server so both
 * homes share ONE copy of the freshness-critical code. Its entry points
 * (the export map is the boundary — node-only code never reaches a browser
 * consumer):
 *  - `.` — the awareness primitives with external consumers: the sensor set
 *    (`startAwareness`) + the generic `AwarenessValue` schema and its
 *    `seedAwarenessValue` seed. (`createPulam`'s other assembly pieces — the
 *    sink, the activity tracker, the kaval-tap bridge — stay internal to the
 *    package; it imports them by relative path, and each is re-exported in the
 *    R9.0 commit that introduces its real consumer.)
 *  - `./createPulam` — the ONE assembly that turns a dialed kaval into a live,
 *    served `terminalWorkspace` surface, wiring those primitives together. Today
 *    the `pulam` daemon rests on it (its one consumer); kolu-server converges on
 *    it in R9.0.
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
