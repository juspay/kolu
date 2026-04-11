/**
 * OpenCode metadata provider — thin adapter that wires the
 * `kolu-opencode` integration library into the server's metadata system.
 *
 * All per-session lifecycle (DB watching, state derivation, equality
 * dedup) lives in `OpenCodeWatcher` from the integration library. This
 * file owns only session matching (correlating foreground process to a
 * directory-matched OpenCode session) and event wiring.
 *
 * Mirrors the post-#437 shape of `server/src/meta/claude.ts`.
 */

import path from "node:path";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

import {
  findSessionByDirectory,
  createOpenCodeWatcher,
  type OpenCodeWatcher,
} from "kolu-opencode";

/**
 * Start the OpenCode metadata provider for a terminal entry.
 * Wakes on title events to detect when `opencode` becomes the foreground
 * process. Delegates all per-session lifecycle to OpenCodeWatcher.
 */
export function startOpenCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "opencode", terminal: terminalId });

  let current: OpenCodeWatcher | null = null;

  plog.debug("started");

  /**
   * Read the foreground process basename directly from node-pty.
   * Don't use entry.info.meta.foreground — it's set by the process provider,
   * which may not have run yet on the initial check or may not run before
   * us on a title event (subscriber order is not deterministic).
   */
  function currentForegroundName(): string | null {
    try {
      const proc = entry.handle.process;
      return proc ? path.basename(proc) : null;
    } catch (err) {
      plog.debug({ err }, "failed to read entry.handle.process");
      return null;
    }
  }

  function onForegroundMaybeChanged() {
    const name = currentForegroundName();
    const isOpenCode = name === "opencode";

    if (!isOpenCode) {
      if (current) {
        plog.debug(
          { from: current.session.id, to: name },
          "opencode no longer foreground",
        );
        current.destroy();
        current = null;
        if (entry.info.meta.agent?.kind === "opencode") {
          updateMetadata(entry, terminalId, (m) => {
            m.agent = null;
          });
        }
      }
      return;
    }

    const cwd = entry.info.meta.cwd;
    const session = findSessionByDirectory(cwd, plog);

    if (!session) {
      plog.debug({ cwd }, "no opencode session for this directory");
      return;
    }

    // Already watching this session — nothing to do.
    if (current?.session.id === session.id) return;

    // New or different session — replace the watcher.
    current?.destroy();
    plog.debug(
      { session: session.id, title: session.title, cwd },
      "opencode session matched",
    );
    current = createOpenCodeWatcher(
      session,
      (info) => {
        updateMetadata(entry, terminalId, (m) => {
          m.agent = info;
        });
      },
      plog,
    );
  }

  // Subscribe to title events — fires on shell OSC 2 / preexec.
  const titleAbort = new AbortController();
  subscribeForTerminal("title", terminalId, titleAbort.signal, () =>
    onForegroundMaybeChanged(),
  );

  // Initial check — covers terminals that already host opencode at startup.
  onForegroundMaybeChanged();

  return () => {
    titleAbort.abort();
    current?.destroy();
    plog.debug("stopped");
  };
}
