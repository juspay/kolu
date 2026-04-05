/**
 * Server-side reactive state via @solidjs/signals.
 *
 * Signals are the single source of truth for all state that streams to clients:
 * - Terminal list (membership changes)
 * - Per-terminal metadata (CWD, git, PR, claude, theme, sort order)
 * - Server state (preferences, session, recent repos)
 *
 * toAsyncIterable() bridges these signals to AsyncIterable for oRPC streaming.
 * Mutations call the setter + flush() to synchronously propagate changes.
 */

import {
  createSignal,
  createRoot,
  createEffect,
  flush,
  type Accessor,
  type Setter,
} from "@solidjs/signals";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ServerState,
} from "kolu-common";

// ---------------------------------------------------------------------------
// Terminal list signal
// ---------------------------------------------------------------------------

const [terminalList, setTerminalList] = createSignal<TerminalInfo[]>([]);

/** Reactive accessor for the sorted terminal list. */
export const terminalListSignal: Accessor<TerminalInfo[]> = terminalList;

/** Update the terminal list signal and flush. Call after any list membership change. */
export function emitTerminalList(list: TerminalInfo[]): void {
  setTerminalList(list);
  flush();
}

// ---------------------------------------------------------------------------
// Per-terminal metadata signals
// ---------------------------------------------------------------------------

const metadataSignals = new Map<
  TerminalId,
  [Accessor<TerminalMetadata>, Setter<TerminalMetadata>]
>();

/** Register a metadata signal for a new terminal. */
export function createMetadataSignal(
  id: TerminalId,
  initial: TerminalMetadata,
): void {
  metadataSignals.set(id, createSignal<TerminalMetadata>(initial));
}

/** Remove a terminal's metadata signal. */
export function removeMetadataSignal(id: TerminalId): void {
  metadataSignals.delete(id);
}

/** Get the reactive metadata accessor for a terminal. */
export function getMetadataSignal(
  id: TerminalId,
): Accessor<TerminalMetadata> | undefined {
  return metadataSignals.get(id)?.[0];
}

/** Update a terminal's metadata signal and flush. */
export function setMetadataSignal(
  id: TerminalId,
  meta: TerminalMetadata,
): void {
  const pair = metadataSignals.get(id);
  if (pair) {
    pair[1](meta);
    flush();
  }
}

// ---------------------------------------------------------------------------
// Per-terminal CWD signals (internal — drives git provider)
// ---------------------------------------------------------------------------

const cwdSignals = new Map<TerminalId, [Accessor<string>, Setter<string>]>();

/** Register a CWD signal for a new terminal. */
export function createCwdSignal(id: TerminalId, initial: string): void {
  cwdSignals.set(id, createSignal<string>(initial));
}

/** Remove a terminal's CWD signal. */
export function removeCwdSignal(id: TerminalId): void {
  cwdSignals.delete(id);
}

/** Get the reactive CWD accessor for a terminal. */
export function getCwdSignal(id: TerminalId): Accessor<string> | undefined {
  return cwdSignals.get(id)?.[0];
}

/** Update a terminal's CWD signal and flush. */
export function setCwdSignal(id: TerminalId, cwd: string): void {
  const pair = cwdSignals.get(id);
  if (pair) {
    pair[1](cwd);
    flush();
  }
}

// ---------------------------------------------------------------------------
// Per-terminal git signals (internal — drives github provider)
// ---------------------------------------------------------------------------

import type { GitInfo } from "kolu-common";

const gitSignals = new Map<
  TerminalId,
  [Accessor<GitInfo | null>, Setter<GitInfo | null>]
>();

/** Register a git signal for a new terminal. */
export function createGitSignal(id: TerminalId): void {
  gitSignals.set(id, createSignal<GitInfo | null>(null));
}

/** Remove a terminal's git signal. */
export function removeGitSignal(id: TerminalId): void {
  gitSignals.delete(id);
}

/** Get the reactive git accessor for a terminal. */
export function getGitSignal(
  id: TerminalId,
): Accessor<GitInfo | null> | undefined {
  return gitSignals.get(id)?.[0];
}

/** Update a terminal's git signal and flush. */
export function setGitSignal(id: TerminalId, git: GitInfo | null): void {
  const pair = gitSignals.get(id);
  if (pair) {
    pair[1](git);
    flush();
  }
}

// ---------------------------------------------------------------------------
// Server state signal
// ---------------------------------------------------------------------------

// Initialized with a placeholder — emitServerState(getServerState()) at startup
// overwrites this before any client connects. Avoids duplicating DEFAULT_PREFERENCES.
const [serverState, setServerState] = createSignal<ServerState>(
  undefined as unknown as ServerState,
);

/** Reactive accessor for server state. */
export const serverStateSignal: Accessor<ServerState> = serverState;

/** Update the server state signal and flush. */
export function emitServerState(state: ServerState): void {
  setServerState(state);
  flush();
}

// ---------------------------------------------------------------------------
// watch — reactive expression → callback (for providers)
// ---------------------------------------------------------------------------

/**
 * Watch a reactive expression and call `cb` with each new value.
 * Returns a dispose function that tears down the reactive root.
 * The first evaluation fires synchronously after flush().
 */
export function watch<T>(fn: () => T, cb: (value: T) => void): () => void {
  return createRoot((dispose) => {
    createEffect(
      () => fn(),
      (value) => cb(value),
    );
    flush();
    return dispose;
  });
}
