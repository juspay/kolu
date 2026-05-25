/**
 * Process provider — publishes the foreground process name on title change.
 *
 * Event-driven: the shell preexec hook (injected in shell.ts) emits OSC 2
 * before each command. The headless xterm fires onTitleChange, which triggers
 * a .localProcess read from node-pty (cross-platform: Linux via /proc, macOS
 * via sysctl).
 *
 * No polling — the title change IS the event that something changed.
 *
 * Local-only: `entry.handle.localProcess` describes the local subprocess.
 * For SSH-wrapped PTYs the provider short-circuits with a no-op cleanup —
 * sampling the remote shell's foreground process is Phase 2b's job (RPC
 * to the remote agent's `ps`).
 */

import path from "node:path";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerLiveMetadata } from "./state.ts";

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

  // `entry.handle.localProcess` describes the local subprocess only — for
  // an SSH-wrapped PTY that's the `ssh` client, not the remote shell.
  // Publishing it as the terminal's foreground would render every remote
  // tile permanently as "ssh". Skip until Phase 2b's remote agent can
  // sample the remote `ps`.
  if (entry.meta.location.kind !== "local") {
    plog.debug({ location: entry.meta.location }, "skipping non-local");
    return () => {};
  }

  let lastName: string | null = null;
  let lastTitle: string | null = null;

  plog.debug("started");

  function update(title?: string) {
    const name = processBasename(entry.handle.localProcess);
    const newTitle = title ?? lastTitle;
    if (name === lastName && newTitle === lastTitle) return;

    plog.debug(
      { from: lastName, to: name, title: newTitle },
      "foreground process changed",
    );
    lastName = name;
    lastTitle = newTitle;
    updateServerLiveMetadata(entry, terminalId, (m) => {
      m.foreground = { name, title: newTitle };
    });
  }

  // Read initial process immediately
  update();

  // Subscribe to title changes — fired by OSC 2 preexec hook
  const cleanup = terminalChannels.title(terminalId).consume({
    onEvent: (title) => update(title),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    plog.debug("stopped");
  };
}
