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
import type { Foreground } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";

/** node-pty may return a full path (e.g. `/nix/store/.../bin/opencode` on NixOS).
 *  Always normalize to the basename. */
function processBasename(proc: string): string {
  return path.basename(proc);
}

/** Build a Foreground value from a process name.
 *  For now, all processes are plain "process" kind.
 *  Agent-specific enrichment (claude-code, opencode) will be added in a follow-up PR. */
function buildForeground(name: string): Foreground {
  return { kind: "process", name };
}

export function startProcessProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "process", terminal: terminalId });
  let lastName: string | null = null;

  plog.info("started");

  function update() {
    const name = processBasename(entry.handle.process);
    if (name === lastName) return;

    plog.info({ from: lastName, to: name }, "foreground process changed");
    lastName = name;

    // Don't overwrite enriched agent foreground (e.g. claude-code with state)
    // — the agent provider owns that. Only write plain process foreground.
    const current = entry.info.meta.foreground;
    if (current && current.kind !== "process" && current.name === name) return;

    updateMetadata(entry, terminalId, (m) => {
      m.foreground = buildForeground(name);
    });
  }

  // Read initial process immediately
  update();

  // Subscribe to title changes — fired by OSC 2 preexec hook
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () => update());

  return () => {
    abort.abort();
    plog.info("stopped");
  };
}
