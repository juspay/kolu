/**
 * Host-membership persistence (W10 — padi.mdx).
 *
 * The hosts a user adds through the selector strip survive a kolu restart. Membership is
 * a SERVER fact — the pool (`buildRemotePool`) is its one writer — so it persists
 * server-side, in the conf state store (`state.ts`) beside every other durable server
 * fact (preferences, …), NOT in the browser (localStorage would fork the one list into
 * per-device copies).
 *
 * It is a plain `hosts` field on `PersistedStateSchema`, so it rides the SAME store,
 * schema, and migration ladder as everything else — no standalone file, no hand-rolled
 * atomic write. `conf` owns the on-disk write, and `conf` is FAIL-FAST
 * (`clearInvalidConfig` is false → a corrupt/unparseable store THROWS on read, it never
 * resets to defaults), which is exactly what lets real user data ride it: a
 * silently-emptied fleet is the data loss W10 exists to prevent, and conf already refuses
 * to do that.
 *
 * This module is a thin conf-domain accessor (the twin of `preferences.ts`) plus the
 * pool's `persist`-hook shaper. It holds only the encoded host keys the pool already
 * speaks (the same `encodeHostKey` strings) — never connection state or metadata (live
 * facts the sessions re-derive), and never the unremovable local default (seeded in code
 * before the server listens; persisting it would mint a second authority for "local
 * always exists"). `state.ts` owns the schema and the `hosts` field's validation
 * (`PersistedHostsSchema`); this module reads and writes the field through `store`.
 */

import {
  encodeHostKey,
  LOCAL_HOST,
  PersistedHostsSchema,
} from "kolu-common/hostKey";
import { store } from "./state.ts";

/** The one never-persisted member: the local machine, seeded in code (`LOCAL_HOST`) before
 *  the server listens. Computed once at module load — `LOCAL_HOST` is a constant, so the
 *  filter never recomputes it per element. */
const LOCAL_KEY = encodeHostKey(LOCAL_HOST);

/** Load the remembered guest hosts (encoded keys the pool speaks) from the conf store.
 *  Called ONCE at boot to seed the pool. A fresh install has no `hosts` key yet, so conf's
 *  `[]` default merges in and this returns `[]`.
 *
 *  Re-validates the stored value through {@link PersistedHostsSchema} — the SAME schema
 *  `PersistedStateSchema` enforces — and THROWS naming the store if it fails (a hand-edited
 *  `local`, a duplicate, a non-canonical key). It never silently normalizes a bad list and
 *  never collapses to an empty fleet (fail-loud; `caught-error-must-not-collapse-to-empty`).
 *  A genuinely-corrupt (unparseable) store already threw in conf's own read at module load;
 *  this guards the parseable-but-invalid case. */
export function getPersistedHosts(): string[] {
  const result = PersistedHostsSchema.safeParse(store.get("hosts"));
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `persisted hosts in ${store.path} do not match schema (${summary}). Fix the \`hosts\` key to recover.`,
    );
  }
  return result.data;
}

/** Persist the pool's *strip-added* membership after an add/remove: every current member
 *  EXCEPT two kinds of non-persistable host —
 *   1. the unremovable local default ({@link LOCAL_KEY} — the code-seeded `LOCAL_HOST`,
 *      always excluded, so a hand-edited `local` in the store can't mint a second authority
 *      for "local always exists"); and
 *   2. any host in `declarativeSeedKeys` — a `KOLU_PADI_HOST` seed the user has NOT also
 *      strip-added. An env seed is a DECLARATIVE knob, not a membership fact; persisting it
 *      would complect the two and make an env host permanent after any unrelated add/remove.
 *      The caller computes this set as "env seed MINUS the hosts already in the store at
 *      boot", so a host a user strip-added and later ALSO named in the env keeps its
 *      persisted claim (persisted-at-boot wins).
 *
 *  Wired as `buildRemotePool`'s `persist` hook, so the pool's OWN contract carries the
 *  transactional guarantees — the write is ordered BEFORE the in-memory commit, serialized
 *  through the pool's mutation queue, and rolled back (the just-built session torn down) if
 *  it throws. This callback only shapes WHAT is written; `conf` owns the write — a
 *  synchronous atomic write-file, exactly as `preferences.ts` persists. `async` only to
 *  satisfy the hook's `Promise<void>` type; the write itself is conf's synchronous `set`. */
export async function savePoolMembership(
  members: readonly string[],
  declarativeSeedKeys: ReadonlySet<string>,
): Promise<void> {
  store.set(
    "hosts",
    members.filter((h) => h !== LOCAL_KEY && !declarativeSeedKeys.has(h)),
  );
}
