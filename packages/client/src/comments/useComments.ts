import { createComputed, untrack, type Accessor } from "solid-js";
import { toast } from "solid-sonner";
import { persistedPref } from "../persistedPref";
import { backfillSurface } from "./backfillSurface";
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

function storeFor(terminalId: string) {
  const existing = storesByKey.get(terminalId);
  if (existing) return existing;
  const [signal, setSignal] = persistedPref<PersistedShape>({
    name: `${STORAGE_PREFIX}${terminalId}`,
    fallback: { v: 1, comments: [] },
    serialize: (v) => JSON.stringify(v),
    parse: (raw): PersistedShape => {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.comments)) {
        return { v: 1, comments: backfillSurface(parsed.comments) };
      }
      throw new Error("unexpected comments shape");
    },
    onInvalid: (err) => {
      if (err instanceof SyntaxError) {
        console.error(
          `[comments] Failed to parse stored data for ${terminalId}:`,
          err,
        );
        toast.error(
          `Failed to load comments: ${err.message ?? "parse error"}. Queue reset.`,
        );
      } else {
        console.error(
          `[comments] Stored data for ${terminalId} has unexpected shape; resetting queue`,
          err,
        );
        toast.error(
          `Comments for this repo had an unexpected shape and were reset. Check the console.`,
        );
      }
    },
  });
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

export function commentsForTerminal(terminalId: Accessor<string>) {
  createComputed(() => {
    const id = terminalId();
    untrack(() => storeFor(id));
  });
  return () => useComments(terminalId());
}
