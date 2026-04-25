/**
 * Process provider — publishes the foreground process name on title change.
 *
 * Event-driven: the shell preexec hook (injected in shell.ts) emits OSC 2
 * before each command. The headless xterm fires onTitleChange, which triggers
 * a .process read from node-pty (cross-platform: Linux via /proc, macOS via sysctl).
 *
 * No polling — the title change IS the event that something changed.
 */

import path from "node:path";
import { log } from "../log.ts";
import { subscribeForTerminal } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerMetadata } from "./state.ts";

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on NixOS).
 *  Always normalize to the basename. */
function processBasename(proc: string): string {
  return path.basename(proc);
}

export function startProcessProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastName: string | null = null;
  let lastTitle: string | null = null;

  plog.debug("started");

  function update(title?: string) {
    const name = processBasename(entry.handle.process);
    const newTitle = title ?? lastTitle;
    if (name === lastName && newTitle === lastTitle) return;

    plog.debug(
      { from: lastName, to: name, title: newTitle },
      "foreground process changed",
    );
    lastName = name;
    lastTitle = newTitle;
    updateServerMetadata(entry, terminalId, (m) => {
      m.foreground = { name, title: newTitle };
    });
  }

  // Read initial process immediately
  update();

  // Subscribe to title changes — fired by OSC 2 preexec hook
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, (title) =>
    update(title),
  );

  return () => {
    abort.abort();
    plog.debug("stopped");
  };
}
