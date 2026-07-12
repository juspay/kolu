/**
 * Host-membership persistence (W10 — padi.mdx).
 *
 * The hosts a user adds through the selector strip survive a kolu restart.
 * Membership is a SERVER fact — the pool (`buildRemotePool`) is its one writer —
 * so its memory lives beside that authority, never in the browser (where
 * localStorage would fork the one list into per-device copies).
 *
 * The persisted artifact is a value replaced WHOLE, not a place edited: a
 * `{ version, hosts }` JSON beside `conf`'s `config.json` under `KOLU_STATE_DIR`
 * (the existing state root — reuse the source of truth), written ATOMICALLY
 * (tmp + rename). It holds only the encoded host keys the pool already speaks —
 * the same `encodeHostKey` strings — never connection state or metadata (live
 * facts the sessions re-derive), and never the unremovable local default (seeded
 * in code before the server listens; persisting it would mint a second authority
 * for "local always exists").
 *
 * This module is a pure load/validate/save leaf — it takes an explicit file path,
 * so it neither reads the environment nor pulls in `conf`; `index.ts` resolves the
 * path from the state root and wires the save into the pool's `persist` hook.
 * Unlike `state.ts` (whose reconstructible `conf` data safely resets to defaults),
 * a corrupt file here CRASHES the boot — a silently-emptied fleet is data loss.
 */

import { readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  encodeHostKey,
  isEncodedHostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import { z } from "zod";

/** The file basename, beside `conf`'s `config.json` under the state root. */
const HOSTS_FILE_NAME = "hosts.json";

/** The one never-persisted member: the local machine, seeded in code (`LOCAL_HOST`)
 *  before the server listens. Persisting it would mint a second authority for
 *  "local always exists". Computed once at module load — `LOCAL_HOST` is a constant,
 *  so the filter never recomputes it per element. */
const LOCAL_KEY = encodeHostKey(LOCAL_HOST);

/** The remembered-hosts file path under a given state root (`KOLU_STATE_DIR`). */
export function hostsFilePath(stateDir: string): string {
  return join(stateDir, HOSTS_FILE_NAME);
}

/** The on-disk shape. `version` pins the format for a future migration; `hosts` is
 *  the encoded-key list. A well-formed file is what {@link savePersistedHosts} writes:
 *  canonical encoded keys, no `local` (the code-seeded default is never persisted),
 *  no duplicates. Each of those is a schema-level invariant, so a hand-corrupted file
 *  fails HERE (crashing the boot with the path) rather than being silently normalized
 *  — the fail-fast stance: a file that doesn't match what we write is corruption to
 *  surface, not a set to quietly repair. */
const PersistedHostsSchema = z.object({
  version: z.literal(1),
  hosts: z
    .array(
      z.string().refine(isEncodedHostKey, {
        message: "not a canonical encoded host key",
      }),
    )
    .refine((hosts) => !hosts.includes(LOCAL_KEY), {
      message: `the local default (${JSON.stringify(LOCAL_KEY)}) must never be persisted`,
    })
    .refine((hosts) => new Set(hosts).size === hosts.length, {
      message: "duplicate host entries",
    }),
});

export type PersistedHosts = z.infer<typeof PersistedHostsSchema>;

/** Load the remembered guest hosts (encoded keys the pool speaks). SYNC on purpose:
 *  it runs ONCE at boot (module load, before the server listens), so a sync read
 *  can't block the serving loop — unlike the SAVE below, which fires on a live RPC.
 *
 *  - Absent file (`ENOENT`) → `[]` (a fresh install has no fleet yet).
 *  - A file that EXISTS but is unreadable / not JSON / fails the schema THROWS
 *    loudly, naming the path — never silently starts with an empty fleet, which
 *    would eat the user's fleet (fail-fast; `caught-error-must-not-collapse-to-empty`).
 *    Delete the file to recover. Only `ENOENT` reads as "fresh install" — a
 *    permission error (`EACCES`) or an unreadable parent must NOT collapse to `[]`,
 *    so we branch on the READ's error code rather than a prior `existsSync` (which
 *    itself returns `false` on `EACCES`, silently eating the fleet). */
export function loadPersistedHosts(path: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err; // EACCES / EISDIR / … — fail loud, never collapse to an empty fleet
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `persisted host file ${path} is not valid JSON (${(err as Error).message}). Delete it to reset.`,
    );
  }
  const result = PersistedHostsSchema.safeParse(parsed);
  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `persisted host file ${path} does not match schema (${summary}). Delete it to reset.`,
    );
  }
  return result.data.hosts;
}

/** Atomically AND durably replace the host file with `hosts` (encoded keys):
 *  tmp-write → fsync(tmp) → rename → fsync(dir).
 *
 *  tmp+rename gives atomic VISIBILITY (a reader sees the old file or the whole new
 *  one, never a half), but not durability on its own: without the fsyncs a power
 *  loss can lose the just-written bytes or the rename's directory entry — and a lost
 *  INITIAL creation reads back as an honestly-empty fleet, the silent-shrink class
 *  W10 exists to prevent. So we fsync the tmp file's contents before the rename, and
 *  the containing directory after it, so an acknowledged mutation survives a crash.
 *
 *  ASYNC on purpose: this fires from the pool's `persist` hook on a live
 *  `hosts.add`/`hosts.remove` RPC while the server serves every other terminal, so a
 *  sync write on a slow/network-mounted `KOLU_STATE_DIR` would block the single event
 *  loop (`no-sync-blocking-on-the-serving-loop`). The pool serializes its mutations
 *  through one queue, so this is never invoked concurrently with itself (a fixed
 *  `.tmp` sibling can't be clobbered by a racing write). The low-level primitive —
 *  production wiring goes through {@link savePoolMembership} (the pool's `persist`
 *  hook), which drops the local default + declarative env seeds first. */
export async function savePersistedHosts(
  path: string,
  hosts: readonly string[],
): Promise<void> {
  const payload: PersistedHosts = { version: 1, hosts: [...hosts] };
  const tmp = `${path}.tmp`;
  // mode 0600 — the file holds ssh targets (`user@host`); keep it owner-only rather
  // than inherit the ambient umask's usually-world-readable 0644. `chmod` after open
  // forces 0600 even when a stale `.tmp` from a prior crash pre-exists (the open
  // mode only applies on CREATION, so a reused 0644 tmp would otherwise leak).
  const fh = await open(tmp, "w", 0o600);
  try {
    await fh.chmod(0o600);
    await fh.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
  // fsync the DIRECTORY so the rename's dirent update is durable too — otherwise a
  // crash right after the rename can lose the new name and resurrect the old file
  // (or, on an initial creation, leave no file at all).
  const dir = await open(dirname(path), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

/** Persist the pool's *strip-added* membership after an add/remove: every current
 *  member EXCEPT two kinds of non-persistable host —
 *   1. the unremovable local default ({@link LOCAL_KEY} — the code-seeded `LOCAL_HOST`,
 *      always excluded, so a hand-edited `local` in the file can't mint a second
 *      authority for "local always exists"); and
 *   2. any host in `declarativeSeedKeys` — a `KOLU_PADI_HOST` seed the user has NOT
 *      also strip-added. An env seed is a DECLARATIVE knob, not a membership fact;
 *      persisting it would complect the two and make an env host permanent after any
 *      unrelated add/remove. The caller computes this set as "env seed MINUS the
 *      hosts already in the file at boot", so a host a user strip-added and later
 *      ALSO named in the env keeps its persisted claim (persisted-at-boot wins).
 *
 *  Wired as `buildRemotePool`'s `persist` hook, so the pool's OWN contract carries
 *  the transactional guarantees — the write is ordered BEFORE the in-memory commit,
 *  serialized through the pool's mutation queue, and rolled back (the just-built
 *  session torn down) if it throws. This callback only shapes WHAT is written. */
export function savePoolMembership(
  path: string,
  members: readonly string[],
  declarativeSeedKeys: ReadonlySet<string>,
): Promise<void> {
  return savePersistedHosts(
    path,
    members.filter((h) => h !== LOCAL_KEY && !declarativeSeedKeys.has(h)),
  );
}
