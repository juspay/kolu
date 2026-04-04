/** TanStack DB collections — reactive client-side state synced from the server.
 *
 *  Architecture:
 *  - One oRPC stream (state.get) pushes full ServerState on every change
 *  - A shared sync manager demuxes the stream into per-collection writes
 *  - Each collection owns one slice of the state (terminals, preferences)
 *  - useLiveQuery gives Solid-native reactivity — no dual-state hack needed
 *
 *  Collections handle: terminals (list + embedded metadata), preferences.
 *  Activity sparklines and PTY output stay as direct oRPC streams (not collections). */

import { createSignal } from "solid-js";
import { createCollection } from "@tanstack/db";
import type {
  TerminalInfo,
  Preferences,
  ServerState,
  RecentRepo,
  SavedSession,
} from "kolu-common";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import { client } from "./rpc";

// --- Shared server stream ---

type StateListener = (state: ServerState) => void;
const listeners: StateListener[] = [];
let streamRunning = false;

/** Start the shared server state stream. Reconnects on failure. */
function ensureStream(): void {
  if (streamRunning) return;
  streamRunning = true;
  (async () => {
    while (true) {
      try {
        const stream = await client.state.get();
        for await (const state of stream) {
          for (const cb of listeners) cb(state);
        }
      } catch (err) {
        // Stream ended (disconnect) — PartySocket reconnects the WS,
        // then we re-subscribe. Brief delay to avoid tight loop on error.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.warn("Server state stream error, reconnecting:", err);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
}

function onServerState(cb: StateListener): () => void {
  listeners.push(cb);
  ensureStream();
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// --- Latest server state (reactive signal for non-collection fields) ---

const [latestState, setLatestState] = createSignal<ServerState | undefined>();
onServerState(setLatestState);

/** Reactive accessor for the full server state (undefined before first push). */
export function getLatestServerState(): ServerState | undefined {
  return latestState();
}

/** Reactive accessor for recent repos. */
export function getRecentRepos(): RecentRepo[] {
  return latestState()?.recentRepos ?? [];
}

/** Reactive accessor for saved session. */
export function getSavedSession(): SavedSession | null {
  return latestState()?.session ?? null;
}

// --- Terminals collection ---

/** Stub TerminalInfo for delete messages — only `id` matters (used by getKey). */
function deleteStub(id: string): TerminalInfo {
  return {
    id,
    pid: 0,
    meta: { cwd: "", git: null, pr: null, claude: null, sortOrder: 0 },
  };
}

export const terminalsCollection = createCollection<TerminalInfo>({
  id: "terminals",
  getKey: (t) => t.id,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      let knownIds = new Set<string>();
      let ready = false;

      const cleanup = onServerState((state) => {
        begin();

        const newIds = new Set<string>();
        for (const t of state.terminals) {
          newIds.add(t.id);
          write({ type: "insert", value: t });
        }

        for (const id of knownIds) {
          if (!newIds.has(id)) {
            write({ type: "delete", value: deleteStub(id) });
          }
        }

        knownIds = newIds;
        commit();
        if (!ready) {
          ready = true;
          markReady();
        }
      });

      return cleanup;
    },
  },
});

// --- Preferences collection (singleton) ---

export type PreferencesRow = Preferences & { _key: "default" };

export const preferencesCollection = createCollection<PreferencesRow>({
  id: "preferences",
  getKey: (p) => p._key,
  sync: {
    sync: ({ begin, write, commit, markReady }) => {
      let ready = false;

      const cleanup = onServerState((state) => {
        begin();
        write({
          type: "insert",
          value: { ...state.preferences, _key: "default" as const },
        });
        commit();
        if (!ready) {
          ready = true;
          markReady();
        }
      });

      return cleanup;
    },
  },
});
