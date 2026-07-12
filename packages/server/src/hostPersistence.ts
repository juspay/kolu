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

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeHostKey } from "kolu-common/hostKey";
import { z } from "zod";

/** The file basename, beside `conf`'s `config.json` under the state root. */
const HOSTS_FILE_NAME = "hosts.json";

/** The remembered-hosts file path under a given state root (`KOLU_STATE_DIR`). */
export function hostsFilePath(stateDir: string): string {
  return join(stateDir, HOSTS_FILE_NAME);
}

/** The on-disk shape. `version` pins the format for a future migration; `hosts` is
 *  the encoded-key list. Each entry must round-trip {@link decodeHostKey}, so a
 *  hand-corrupted host string fails the schema HERE (crashing the boot with the
 *  path) rather than throwing raw later at pool construction. */
const PersistedHostsSchema = z.object({
  version: z.literal(1),
  hosts: z.array(
    z.string().refine(
      (s) => {
        try {
          decodeHostKey(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: "not a canonical encoded host key" },
    ),
  ),
});

export type PersistedHosts = z.infer<typeof PersistedHostsSchema>;

/** Load the remembered guest hosts (encoded keys the pool speaks).
 *
 *  - Absent file → `[]` (a fresh install has no fleet yet).
 *  - A file that EXISTS but is unreadable / not JSON / fails the schema THROWS
 *    loudly, naming the path — never silently starts with an empty fleet, which
 *    would eat the user's fleet (fail-fast; `caught-error-must-not-collapse-to-empty`).
 *    Delete the file to recover. */
export function loadPersistedHosts(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
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

/** Atomically replace the host file with `hosts` (encoded keys). tmp-write +
 *  rename so a crash mid-write never leaves a torn file — a reader sees either the
 *  old file or the whole new one, never a half. The pool serializes its mutations
 *  through one queue, so this is never invoked concurrently with itself (a fixed
 *  `.tmp` sibling can't be clobbered by a racing write). The low-level primitive —
 *  production wiring goes through {@link savePoolMembership} (the pool's `persist`
 *  hook), which drops the local default first. */
export function savePersistedHosts(
  path: string,
  hosts: readonly string[],
): void {
  const payload: PersistedHosts = { version: 1, hosts: [...hosts] };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Persist the pool's guest membership after an add/remove: every current member
 *  EXCEPT the unremovable local default (`defaultKey` — its `encodeHostKey`).
 *
 *  Wired as `buildRemotePool`'s `persist` hook, so the pool's OWN contract carries
 *  the durability guarantees — the write is ordered BEFORE the in-memory commit,
 *  serialized through the pool's mutation queue, and rolled back (the just-built
 *  session torn down) if it throws. This callback only shapes WHAT is written: the
 *  local default drops out because it is seeded in code, not persisted. */
export function savePoolMembership(
  path: string,
  members: readonly string[],
  defaultKey: string,
): void {
  savePersistedHosts(
    path,
    members.filter((h) => h !== defaultKey),
  );
}
