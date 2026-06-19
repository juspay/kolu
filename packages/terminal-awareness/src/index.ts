/**
 * `@kolu/terminal-awareness` — the per-terminal awareness sensor set (git ·
 * PR · agent · foreground) plus the generic `AwarenessValue` schema it
 * produces, lifted out of kolu-server so a standalone daemon (`arivu`) and
 * kolu-server share ONE copy of the freshness-critical sensor code.
 *
 * The package names no kolu-app package: its lone host coupling — a logger —
 * is injected as a `startAwareness` parameter. Consumers that only need the
 * schemas (no sensors, no node/kaval runtime) import `./schema` directly.
 */

export * from "./sensors.ts";
export * from "./schema.ts";
// The kaval-dial bridge — taps → `AwarenessSignals`. Only the standalone
// `arivu` daemon needs it (kolu-server builds its channels in-process); it
// lives here so there is one copy of the transport adapter, not a fork.
export * from "./kavalChannels.ts";
