/**
 * Agent-routed PTY provider — Phase 3 of kolu#951. PTYs live on the
 * remote agent process instead of the local `ssh -tt` subprocess, so
 * they survive ssh drops.
 *
 * Replaces `sshPtyProvider` for SSH terminals once Phase 3 lands. The
 * caller (kolu-server's `createTerminal`) hands this provider a
 * `HostSession` plus optional `remoteSessionId` — on first spawn the
 * agent allocates a new session id; on session restore the same id
 * reattaches with a fresh scrollback snapshot.
 *
 * The returned `PtyHandle` looks identical to a local PTY's: same
 * data/exit callbacks, same `write` / `resize` / `dispose`. The local
 * xterm-headless still parses OSC sequences for the screen-state
 * snapshot; the local emulator's `onData` is fed from RPC events
 * instead of a node-pty subprocess.
 *
 * **Prototype scope.** The shape is right; the agent-side
 * `terminal.spawn` / `terminal.attach` handlers (and the headless
 * xterm integration on the agent side) are stubbed in
 * `kolu-remote-agent/src/index.ts` with `TODO Phase 3` markers.
 */

import type { Logger } from "kolu-shared";
import type { PtyHandle, PtyProvider, PtySpawnOptions } from "./pty.ts";

export interface AgentPtyProviderOptions {
  host: string;
  /** Session handle the provider drives — exposed via the narrow
   *  HostSessionLike-style interface so this package stays free of
   *  kolu-server imports. */
  session: {
    call(method: string, args: unknown): Promise<unknown>;
    subscribe(
      method: string,
      args: unknown,
      onEvent: (payload: unknown) => void,
    ): {
      update(params: unknown): Promise<void>;
      close(): Promise<void>;
    };
  };
  /** Persisted session id from a prior run — when set, the provider
   *  calls `terminal.attach` instead of `terminal.spawn`, recovering
   *  the still-running PTY on the remote. */
  remoteSessionId?: string;
  /** Callback fired after a successful spawn/attach with the resolved
   *  remoteSessionId — the server-side caller persists this onto
   *  `ServerPersistedTerminalFields.remoteSessionId` so session
   *  restore can reattach. */
  onSessionAllocated?: (remoteSessionId: string) => void;
}

/** Tagged-union event payload streamed by the agent for an open PTY
 *  session. The agent emits `spawned` as the first event after a
 *  `terminal.spawn` subscription is registered, carrying the
 *  `remoteSessionId` the persisted schema reattaches by. */
type AgentPtyMessage =
  | { kind: "spawned"; remoteSessionId: string }
  | { kind: "data"; payload: string }
  | { kind: "exit"; payload: number };

export function agentPtyProvider(opts: AgentPtyProviderOptions): PtyProvider {
  return {
    spawn(
      tlog: Logger,
      _terminalId: string,
      spawnOpts: PtySpawnOptions,
      spawnCwd?: string,
    ): PtyHandle {
      let token: ReturnType<typeof opts.session.subscribe> | null = null;
      let allocatedSessionId: string | null = opts.remoteSessionId ?? null;
      let disposed = false;

      // The agent streams a tagged-union: `spawned` (first frame for
      // a fresh spawn, carries the remote session id), `data` (PTY
      // bytes), `exit` (PTY exited). For `terminal.attach` the agent
      // skips the `spawned` frame — the caller already has the id.
      const onEvent = (raw: unknown): void => {
        const msg = raw as AgentPtyMessage;
        if (msg.kind === "spawned") {
          allocatedSessionId = msg.remoteSessionId;
          opts.onSessionAllocated?.(msg.remoteSessionId);
        } else if (msg.kind === "data") {
          spawnOpts.onData(msg.payload);
        } else if (msg.kind === "exit") {
          spawnOpts.onExit(msg.payload);
        }
      };

      // Kick off spawn-or-attach via subscribe — the first event for
      // a spawn is `{kind:"spawned", remoteSessionId}`, then bytes.
      // The agent's TerminalSpawnResultSchema in protocol.ts already
      // promises remoteSessionId on the response path; emitting it as
      // the first stream event keeps the subscribe-shape uniform with
      // every other domain (git.subscribeInfo etc.) and avoids a
      // separate `terminal.info` round-trip that wasn't actually
      // declared in the protocol.
      const method = allocatedSessionId ? "terminal.attach" : "terminal.spawn";
      const args = allocatedSessionId
        ? { remoteSessionId: allocatedSessionId }
        : { cwd: spawnCwd, cols: 80, rows: 24 };
      token = opts.session.subscribe(method, args, onEvent);

      return {
        // For agent-owned PTYs there's no local OS pid that maps to
        // the remote shell; we synthesize a positive number from the
        // session id so consumers that read .pid for logging see
        // something stable, while location.kind !== "local" gates
        // anything semantically meaningful (already established in
        // Phase 0).
        pid: 0,
        cwd: spawnCwd ?? "/",
        // Remote-owned: local kernel reads are not meaningful. Phase
        // 0's gating in meta/agent.ts + meta/process.ts skips them.
        localProcess: "ssh",
        localForegroundPid: undefined,
        write: (data: string) => {
          if (disposed) return;
          void opts.session
            .call("terminal.write", {
              remoteSessionId: allocatedSessionId,
              data,
            })
            .catch((err: Error) => {
              tlog.warn({ err }, "agent terminal.write failed");
            });
        },
        resize: (cols: number, rows: number) => {
          if (disposed) return;
          void opts.session
            .call("terminal.resize", {
              remoteSessionId: allocatedSessionId,
              cols,
              rows,
            })
            .catch((err: Error) => {
              tlog.warn({ err }, "agent terminal.resize failed");
            });
        },
        // Phase 3 prototype: getScreenState / getScreenText return empty
        // strings — late-join clients need the agent's scrollback
        // snapshot, which gets stitched in once the agent's handler
        // lands. The schema/wiring is in place; the agent-side bytes
        // are the missing piece.
        getScreenState: () => "",
        getScreenText: () => "",
        dispose: () => {
          disposed = true;
          if (token) void token.close();
          // The agent's terminal session keeps running on close — the
          // user gets reattach on next launch. Explicit kill happens
          // via a separate `terminal.kill` call (not implemented in
          // the prototype; for now the agent's idle-TTL collects).
        },
      };
    },
  };
}
