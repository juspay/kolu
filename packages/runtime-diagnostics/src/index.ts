/**
 * Process-local registry for long-lived runtime resources (fs.watch
 * handles, timers, subscriptions). Owners register at creation and
 * receive a single cleanup function that both untracks the entry and
 * disposes the underlying handle — registration and teardown can't drift.
 *
 * Deliberately neutral: server and integration packages depend on this
 * package without pulling agent or server concepts. The diagnostics
 * snapshot then enumerates whatever is currently registered, no
 * categorical knowledge required.
 */

/** Kinds of runtime resource the registry tracks. Open enough to grow
 *  (subscriptions, db handles, etc.) without changing the registration
 *  surface. */
export type ResourceKind = "fs-watch" | "timer" | "subscription";

/** JSON-safe scalar carried in `context` so the snapshot serializes
 *  cleanly through oRPC and lands in the Diagnostic-info JSON dump
 *  without bespoke encoders. */
export type ContextValue = string | number | boolean | null;

export type ContextMap = Record<string, ContextValue>;

export interface ResourceMeta {
  kind: ResourceKind;
  /** Short, human-readable category — `.git/HEAD`, `transcript JSONL`,
   *  `agent WAL`. Not unique; one per fs.watch site is fine. */
  label: string;
  /** Owner package or subsystem — `kolu-git`, `kolu-claude-code`,
   *  `server:diagnostics`. The `<package>:<area>` form is for owners
   *  that run inside a single package but need finer attribution. */
  owner: string;
  /** Path or identifier the resource is anchored to (the gitDir, the
   *  WAL file, the transcript JSONL, the timer purpose). Null when the
   *  resource isn't tied to a single path. */
  target?: string | null;
  /** Per-instance context shown in the diagnostic dialog. Pass a static
   *  record for fixed-at-registration metadata; pass a thunk when the
   *  fields evolve over the resource's lifetime (e.g. listener counts
   *  on a shared singleton). */
  context?: ContextMap | (() => ContextMap);
}

export interface ResourceSnapshot {
  id: number;
  kind: ResourceKind;
  label: string;
  owner: string;
  target: string | null;
  /** Wall-clock millis the resource was registered. */
  createdAt: number;
  context: ContextMap;
}

interface Entry {
  kind: ResourceKind;
  label: string;
  owner: string;
  target: string | null;
  /** Always a thunk internally — static records get wrapped at
   *  registration, so reading is uniform. */
  context: () => ContextMap;
  createdAt: number;
}

let nextId = 1;
const resources = new Map<number, Entry>();

/** Register a resource and return a cleanup. Calling the returned
 *  cleanup runs `dispose` exactly once (idempotent) and untracks the
 *  registry entry — same call for both sides. Safe to call multiple
 *  times; the second call is a no-op. */
export function trackResource(
  meta: ResourceMeta,
  dispose: () => void,
): () => void {
  const id = nextId++;
  const context: () => ContextMap =
    typeof meta.context === "function"
      ? meta.context
      : (
          (value) => () =>
            value
        )(meta.context ?? {});
  resources.set(id, {
    kind: meta.kind,
    label: meta.label,
    owner: meta.owner,
    target: meta.target ?? null,
    context,
    createdAt: Date.now(),
  });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    try {
      dispose();
    } finally {
      resources.delete(id);
    }
  };
}

/** Snapshot of currently-tracked resources, sorted by creation time
 *  (id breaks ties for entries registered in the same millisecond).
 *  Each snapshot evaluates the entry's context thunk, so dynamic
 *  fields reflect the read instant. */
export function getResources(): ResourceSnapshot[] {
  const out: ResourceSnapshot[] = [];
  for (const [id, e] of resources) {
    out.push({
      id,
      kind: e.kind,
      label: e.label,
      owner: e.owner,
      target: e.target,
      createdAt: e.createdAt,
      context: e.context(),
    });
  }
  out.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  return out;
}
