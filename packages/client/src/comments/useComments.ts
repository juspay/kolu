/** Comments store — singleton, persisted to localStorage, keyed by
 *  `terminalId`.
 *
 *  INVARIANT: keyed by terminalId (NOT by git repoRoot). Each terminal
 *  has its own comment queue. Two terminals in the same repo do NOT
 *  share comments — they're typically working on different feature
 *  branches with different review contexts, and merging their queues
 *  would conflate unrelated drafts.
 *
 *  Stored shape: `{v: 1, comments: Comment[]}`. The `v` bump path lets
 *  future schema changes ship a migration without breaking existing
 *  installs; today we just read/write v1.
 *
 *  No flush logic lives here. `formatMarkdown` is a separate pure
 *  function; the tray's "Copy to clipboard" calls it directly. */

import { makePersisted } from "@solid-primitives/storage";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import type { Comment, PersistedShape } from "./types";

const STORAGE_PREFIX = "kolu:comments-by-terminal:";

type StoresByKey = Map<
  string,
  {
    comments: () => Comment[];
    setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])) => void;
  }
>;

const storesByKey: StoresByKey = new Map();

/** Get or lazily create the persisted store for a given terminalId. The
 *  per-terminal store is a singleton so multiple call sites share one
 *  reactive source. */
function storeFor(terminalId: string) {
  const existing = storesByKey.get(terminalId);
  if (existing) return existing;
  const [signal, setSignal] = makePersisted(
    createSignal<PersistedShape>({ v: 1, comments: [] }),
    {
      name: `${STORAGE_PREFIX}${terminalId}`,
      serialize: (v) => JSON.stringify(v),
      deserialize: (s): PersistedShape => {
        try {
          const parsed = JSON.parse(s) as Partial<PersistedShape>;
          if (parsed && parsed.v === 1 && Array.isArray(parsed.comments)) {
            return parsed as PersistedShape;
          }
          // Shape mismatch — log + surface, then fall through to a
          // fresh init so the app doesn't brick.
          console.error(
            `[comments] Stored data for ${terminalId} has unexpected shape; resetting queue`,
            parsed,
          );
          toast.error(
            `Comments for this repo had an unexpected shape and were reset. Check the console.`,
          );
        } catch (err) {
          // JSON.parse failed — same fallback. Surface the error so the
          // user knows their queue was wiped instead of silently
          // returning {comments: []} (indistinguishable from a fresh
          // install).
          console.error(
            `[comments] Failed to parse stored data for ${terminalId}:`,
            err,
          );
          toast.error(
            `Failed to load comments: ${(err as Error).message ?? "parse error"}. Queue reset.`,
          );
        }
        return { v: 1, comments: [] };
      },
    },
  );
  const wrapped = {
    comments: () => signal().comments,
    setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])): void => {
      setSignal((prev) => ({
        v: 1,
        comments: typeof next === "function" ? next(prev.comments) : next,
      }));
    },
  };
  storesByKey.set(terminalId, wrapped);
  return wrapped;
}

/** Drop the in-memory store wrapper for a terminal whose lifecycle has
 *  ended. The `makePersisted` storage entry stays — comments survive
 *  terminal recreation as long as the terminalId is reused (e.g. session
 *  restore). Call this from the terminal-deletion path to bound the
 *  in-memory Map; without it, every `useComments(tid)` call leaves a
 *  Map entry that lives for the page session.
 *
 *  NOTE: not yet wired to terminal deletion — the comments feature
 *  doesn't own the terminal lifecycle. Filed as a follow-up because
 *  the Map entries are tiny (a few function closures each) and the
 *  realistic upper bound is the number of terminals opened in one
 *  session, which is small. The API exists so wiring it later is a
 *  one-line change in the terminal-management code. */
export function releaseTerminal(terminalId: string): void {
  storesByKey.delete(terminalId);
}

/** API the rest of the client uses. Pass the active terminalId at the
 *  consumer site — there's no global ambient context (matches how
 *  `CodeTab.tsx` already threads `props.terminalId`). */
export function useComments(terminalId: string) {
  const store = storeFor(terminalId);
  return {
    comments: store.comments,
    commentsForPath: (path: string): Comment[] =>
      store.comments().filter((c) => c.path === path),
    add: (c: Omit<Comment, "id" | "createdAt">): Comment => {
      const full: Comment = {
        ...c,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      };
      store.setComments((prev) => [...prev, full]);
      return full;
    },
    remove: (id: string): void => {
      store.setComments((prev) => prev.filter((c) => c.id !== id));
    },
    clear: (): void => {
      store.setComments([]);
    },
  };
}
