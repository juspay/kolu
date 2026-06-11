/**
 * Per-server-instance temp root for server-generated files.
 *
 * The server writes per-terminal scratch storage (clipboard image pastes,
 * drag-and-drop file drops) under a single root keyed by the server's startup
 * UUID. The shape lives in `koluRootFor` (kolu-shared) so the server and the
 * pty-host daemon compute identical layouts; here we just bind one instance to
 * `serverProcessId`. Shell rc injection moved to the daemon (Phase B), so the
 * server no longer consumes `shellDir` — `ensure` still creates an empty
 * `shell/` under the server root, a negligible over-provision.
 */
import { koluRootFor } from "kolu-shared";
import { serverProcessId } from "./hostname.ts";

const root = koluRootFor(serverProcessId);

/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. */
export const koluRoot = root.root;

/** Per-terminal scratch directories where clipboard image pastes and
 *  drag-and-drop file drops land on disk. */
export const koluScratchDir = root.scratchDir;

/** Create the root + subdirs with owner-only mode. Called once at server
 *  startup before any terminal spawns. Idempotent. */
export const ensureKoluRoot = root.ensure;

/** Remove the whole per-instance root on shutdown. Registered on the
 *  `process.on('exit', ...)` hook so it runs synchronously from every exit
 *  path. */
export const shutdownCleanup = root.cleanup;
