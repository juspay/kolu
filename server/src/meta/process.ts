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
import type { TerminalProcess } from "../terminals.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";

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

  plog.info("started");

  function update(title?: string) {
    const name = processBasename(entry.handle.process);
    const newTitle = title ?? lastTitle;
    if (name === lastName && newTitle === lastTitle) return;

    plog.info(
      { from: lastName, to: name, title: newTitle },
      "foreground process changed",
    );
    lastName = name;
    lastTitle = newTitle;
    updateMetadata(entry, terminalId, (m) => {
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
    plog.info("stopped");
  };
}
