/**
 * AgentProvider — the shared contract every agent-detection integration
 * implements. A provider encapsulates four axes of volatility that vary
 * per agent CLI:
 *
 *  1. How a terminal maps to a session         → `resolveSession`
 *  2. Session-identity derivation               → `sessionKey`
 *  3. Per-session state watching + derivation   → `createWatcher`
 *  4. External signals that may change the match → `subscribeExternalChanges`
 *     (optional — only agents whose session-match answer can change without
 *     a title event need this; see the field's JSDoc.)
 *
 * Info equality is deliberately NOT part of this interface — it's a property
 * of the AgentInfo union shape, exposed as the free function `agentInfoEqual`
 * below. All concrete AgentInfo variants share the same 5-field shape today
 * (state, sessionId, model, summary, taskProgress), so one equality function
 * suffices for every provider.
 */

import type { Logger } from "./index.ts";
import type { TaskProgress } from "./index.ts";

/** Snapshot of a terminal's observable state, passed to `resolveSession`.
 *  Fields are the inputs every agent's session-matching logic can draw from;
 *  the provider picks the ones it needs (claude-code uses `foregroundPid`,
 *  opencode uses `foregroundBasename` + `cwd`). */
export interface AgentTerminalState {
  /** Foreground process PID, or undefined if unknown. */
  foregroundPid: number | undefined;
  /** Terminal's current working directory. */
  cwd: string;
  /** Foreground process basename (e.g. "opencode", "claude", "vim"), or null
   *  if the PTY process is unknown. Lazy: reading involves a kernel syscall
   *  on darwin (sysctl), so providers that match by PID alone (e.g.
   *  claude-code) avoid invoking it. Idempotent within one snapshot — the
   *  second call returns the cached value without a second syscall. */
  readForegroundBasename: () => string | null;
  /** Agent name parsed from the most recent OSC 633;E preexec hint (e.g.
   *  "codex", "opencode"), or null. Populated by the shell's preexec hook
   *  before the command runs, so it reflects the user's typed command even
   *  when the kernel-level process is an interpreter shim (npm-installed
   *  `codex` shows up as `node` to the kernel). Only set while a command
   *  is actively running — clears to null once the shell is idle at the
   *  prompt again, so stale hints don't outlive the process they name. */
  lastAgentCommandName: string | null;
}

/** Handle returned by `createWatcher`. Callers invoke `destroy()` when the
 *  matched session changes or the provider is torn down. */
export interface AgentWatcher {
  destroy(): void;
}

/** Minimal shape every concrete AgentInfo variant satisfies. Used only to
 *  constrain `agentInfoEqual` — NOT to be extended by integrations directly.
 *  Each integration defines its own full schema (ClaudeCodeInfo, OpenCodeInfo)
 *  which happens to match this shape. */
export interface AgentInfoShape {
  kind: string;
  state: string;
  sessionId: string;
  model: string | null;
  summary: string | null;
  taskProgress: TaskProgress | null;
  /** Running context-window token count for the current session, or null
   *  if the agent doesn't expose telemetry (or hasn't yet produced an
   *  assistant turn). Derivation is per-integration — Claude Code sums
   *  input+cache_creation+cache_read from the latest assistant entry's
   *  `message.usage`; OpenCode reads `tokens.total` from the latest
   *  assistant message. Both collapse to the same scalar meaning. */
  contextTokens: number | null;
}

/** Agent-detection contract. Type parameters: `Session` is the provider's
 *  opaque match result (its lifetime == one matched session); `Info` is the
 *  wire-shape yielded by the watcher. */
export interface AgentProvider<Session, Info extends AgentInfoShape> {
  /** Discriminator matching `Info["kind"]` (e.g. "claude-code", "opencode"). */
  readonly kind: Info["kind"];

  /** Given a snapshot of terminal state, return the currently-matching
   *  session for this agent kind, or null if no session applies. Pure and
   *  cheap — may be called repeatedly on title events and external changes. */
  resolveSession(state: AgentTerminalState, log: Logger): Session | null;

  /** Stable dedup key for a resolved session. The orchestrator compares
   *  successive `sessionKey(resolveSession(...))` values to decide whether
   *  to replace the running watcher. Must be deterministic and agent-specific
   *  (two sessions from different agents don't need to differ — the kind
   *  field already distinguishes providers). */
  sessionKey(session: Session): string;

  /** Start a watcher for a matched session. `onChange` fires whenever the
   *  derived `Info` changes. The returned handle's `destroy()` must tear
   *  down every resource the watcher owns (fs.watch handles, DB connections,
   *  debounce timers, in-flight async work). */
  createWatcher(
    session: Session,
    onChange: (info: Info) => void,
    log: Logger,
  ): AgentWatcher;

  /** Optional subscription to external signals that may cause `resolveSession`
   *  to change its answer without a title event — e.g. a new session file
   *  appearing for an agent the terminal was already running. If an agent's
   *  match depends only on title-event-triggered state (foreground process,
   *  cwd), omit this method; the orchestrator just skips the wiring.
   *
   *  Must NOT be used for per-session state changes — those are the
   *  responsibility of the watcher returned by `createWatcher`. */
  subscribeExternalChanges?: (
    onChange: () => void,
    onError: (err: unknown) => void,
    log: Logger,
  ) => () => void;
}

/** Structural equality over the shared 5-field AgentInfo shape, plus `kind`.
 *  One implementation serves every provider — if a new integration wants a
 *  different equality contract, its Info shape is out of bounds anyway and
 *  needs to be addressed schema-side, not by forking the comparator. */
export function agentInfoEqual<A extends AgentInfoShape>(
  a: A | null,
  b: A | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.state !== b.state) return false;
  if (a.sessionId !== b.sessionId) return false;
  if (a.model !== b.model) return false;
  if (a.summary !== b.summary) return false;
  if (a.contextTokens !== b.contextTokens) return false;
  return taskProgressEqual(a.taskProgress, b.taskProgress);
}

function taskProgressEqual(
  a: TaskProgress | null,
  b: TaskProgress | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.total === b.total && a.completed === b.completed;
}
