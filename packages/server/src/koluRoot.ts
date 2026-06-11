/**
 * Per-server-instance temp root for server-generated files.
 *
 * Kolu writes shell rc files and per-terminal scratch storage (clipboard
 * image pastes, drag-and-drop file drops) under a single root keyed by the
 * server's startup UUID. The shape lives in `koluRootFor` (kolu-shared) so the
 * server and the pty-host daemon compute identical layouts; here we just bind
 * one instance to `serverProcessId`.
 */
import { koluRootFor } from "kolu-shared";
import { serverProcessId } from "./hostname.ts";

const root = koluRootFor(serverProcessId);

/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. */
export const koluRoot = root.root;

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal. */
export const koluShellDir = root.shellDir;

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
