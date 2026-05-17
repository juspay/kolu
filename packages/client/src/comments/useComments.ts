/** Comments store — singleton, persisted to localStorage, keyed by
 *  `repoRoot`.
 *
 *  INVARIANT: keyed by git repoRoot (NOT by terminalId or worktree path).
 *  Comments survive worktree switches by design — the user's intent
 *  travels with the repo, not the directory. All terminals attached to
 *  the same repo share one comment queue.
 *
 *  Stored shape: `{v: 1, comments: Comment[]}`. The `v` bump path lets
 *  future schema changes ship a migration without breaking existing
 *  installs; today we just read/write v1.
 *
 *  No flush logic lives here. `formatMarkdown` is a separate pure
 *  function; the tray's "Copy to clipboard" calls it directly. */

import { makePersisted } from "@solid-primitives/storage";
import { createSignal } from "solid-js";
import type { Comment, PersistedShape } from "./types";

const STORAGE_PREFIX = "kolu:comments:";

type StoresByRepo = Map<
  string,
  {
    comments: () => Comment[];
    setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])) => void;
  }
>;

const storesByRepo: StoresByRepo = new Map();

/** Get or lazily create the persisted store for a given repoRoot. The
 *  per-repo store is a singleton so multiple call sites share one
 *  reactive source. */
function storeFor(repoRoot: string) {
  const existing = storesByRepo.get(repoRoot);
  if (existing) return existing;
  const [signal, setSignal] = makePersisted(
    createSignal<PersistedShape>({ v: 1, comments: [] }),
    {
      name: `${STORAGE_PREFIX}${repoRoot}`,
      serialize: (v) => JSON.stringify(v),
      deserialize: (s): PersistedShape => {
        try {
          const parsed = JSON.parse(s) as Partial<PersistedShape>;
          if (parsed && parsed.v === 1 && Array.isArray(parsed.comments)) {
            return parsed as PersistedShape;
          }
        } catch {
          // Fall through to default.
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
  storesByRepo.set(repoRoot, wrapped);
  return wrapped;
}

/** API the rest of the client uses. Pass the active repoRoot at the
 *  consumer site — there's no global ambient context (matches how
 *  `CodeTab.tsx` reads `props.meta?.git?.repoRoot`). */
export function useComments(repoRoot: string) {
  const store = storeFor(repoRoot);
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
