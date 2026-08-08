/**
 * State-file backup ring (juspay/kolu#1658) — timestamped, rotated snapshots of
 * a conf-backed state file, taken at boot (and on a slow daily tick) BEFORE the
 * store is first written.
 *
 * ONE entry point: {@link openStateBackupRing} captures the state file's path
 * once and hands back the ring as an object. Every verb — snapshot, list,
 * summarized list, read, restore, tick — is a method on it, so a consumer holds
 * one binding instead of threading the same `configPath` through six free
 * functions and re-composing the same sequence at each face.
 *
 * Both persisted stores ride this one module: padi's state-root Conf
 * (`@kolu/padi`'s `session/stateStore.ts`) and kolu-server's config store
 * (`packages/server/src/state.ts`). It lives in `kolu-shared` — the generic
 * on-disk-state utility home — because it is domain-agnostic (neither terminal
 * domain nor web shell), and both consumers already sit on opposite sides of
 * the server↛padi seal.
 * The ring exists because `conf`'s atomic write protects against HALF-written
 * files, not against a bug persisting a bad-but-valid value (the #1658
 * incident: an out-of-band kaval restart emptied the registry and autosave
 * persisted the emptied session over the real one, with no history to recover
 * from).
 *
 * FAIL-SOFT — deliberately, and only on the SNAPSHOT path. The project doctrine
 * is fail-fast, but a boot snapshot is a safety net, not a gate: a failure must
 * log loudly and let the boot proceed (a padi that refuses to start because its
 * backup dir is unwritable would turn the safety net into an outage). The
 * RESTORE path ({@link StateBackupRing.restore}) is the opposite — it throws on
 * every anomaly, INCLUDING a failed pre-restore snapshot, because a restore
 * that silently proceeds from a corrupt backup, or that silently is not
 * undoable, is the very data-loss class the ring exists to prevent.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Logger } from "./log.ts";

/** How many snapshots the ring keeps — the newest N survive a prune. */
export const STATE_BACKUP_RING_SIZE = 10;

/** The in-process re-snapshot cadence — one slow tick so a long-running daemon's
 *  newest backup never ages past a day (the boot snapshot alone would). The
 *  byte-identical dedupe makes an unchanged tick a no-op. */
const STATE_BACKUP_TICK_MS = 24 * 60 * 60 * 1000;

/** The subdirectory of the state dir the ring lives in. */
const BACKUP_SUBDIR = "backups";

/** The stamp half of a ring member's name: the fs-safe UTC instant the writer
 *  mints (`:`/`.` are path-hostile on some filesystems), plus the `-N` bump a
 *  same-millisecond sibling carries. Deliberately EXACT — the old
 *  `[0-9TZ-]+` shape accepted names the writer can never produce (`config.--.json`),
 *  and this pattern is a security gate ({@link StateBackupRing.pathOf}), so
 *  reader and writer are one pair kept honest by the round-trip test rather than
 *  by memory. */
const BACKUP_STAMP_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-(\d+))?$/;

/** One snapshot in the ring, newest first in a {@link StateBackupRing.list}
 *  answer. */
export interface StateBackupEntry {
  /** Bare file name under `backups/` — the stable handle a restore names. */
  file: string;
  /** When the snapshot was taken, in epoch ms ON THE CLOCK OF THE HOST THAT
   *  TOOK IT — a consumer on another host must treat it as a foreign-clock
   *  reading (the same discipline as `PadiIdentity.startedAt`). Read off the
   *  NAME the writer minted, not the file's mtime: the two would be two
   *  representations of one instant, and anything that rewrites mtimes without
   *  rewriting names (`cp -r` of a state dir, a tarball restore, `touch`) would
   *  reorder the ring — and therefore the PRUNE — against the very stamp the
   *  user reads off the row. */
  savedAtMs: number;
  /** Snapshot size in bytes. */
  sizeBytes: number;
}

/** The outcome of one snapshot attempt — a typed answer (never a throw) so the
 *  boot call site can log it and the tests can pin each acceptance case. */
export type SnapshotOutcome =
  | { kind: "created"; file: string }
  | { kind: "unchanged" }
  | { kind: "no-state-file" }
  | { kind: "failed" };

/** One state file's backup ring — the whole concept behind one binding. */
export interface StateBackupRing {
  /** Where the ring lives: a `backups/` sibling of the state file. */
  readonly dir: string;
  /** Take one snapshot: skip when the state file is absent (fresh install) or
   *  byte-identical to the newest member (quick restarts must not churn
   *  copies), otherwise copy it to a timestamped name and prune to
   *  {@link STATE_BACKUP_RING_SIZE}. FAIL-SOFT: any error logs loudly and
   *  answers `failed` — see the module doc for why this one path may not
   *  throw. */
  snapshot(): SnapshotOutcome;
  /** Enumerate the ring, newest first. A missing ring dir is an empty ring, not
   *  an error — every store predates its first snapshot once. */
  list(): StateBackupEntry[];
  /** {@link list} with a per-store summary attached — the LIST side, where one
   *  corrupt snapshot must not hide the good ones, so an unreadable member is
   *  logged loudly and carries `unreadable` rather than collapsing the whole
   *  enumeration. Both domain faces get their `summarize` called only on a
   *  snapshot that parsed. */
  listWith<S>(
    summarize: (raw: unknown) => S,
    unreadable: S,
  ): (StateBackupEntry & { summary: S })[];
  /** Read one member's JSON — the RESTORE side, so every anomaly throws: a name
   *  that is not a ring member's (the input crossed the wire), a missing file,
   *  unparseable bytes. The caller owns validating the parsed value against its
   *  own schema. */
  read(file: string): unknown;
  /** Resolve a member's absolute path from its wire-crossing bare name — throws
   *  on any name that is not a member's shape, so path traversal is
   *  unspellable. */
  pathOf(file: string): string;
  /** Restore from one member, UNDOABLY — the ring's one restore verb. Gates the
   *  wire-crossing name, reads the snapshot, then pushes the CURRENT state file
   *  into the ring BEFORE handing the raw value to `apply`. The undo snapshot is
   *  taken by the ring, not by each caller, so "forgot to make the restore
   *  undoable" is unspellable — and a FAILED undo snapshot REFUSES the restore
   *  rather than proceeding, because the dialog, the docs and the changelog all
   *  promise the restore is reversible and none of them may be able to lie.
   *
   *  The member being restored is PROTECTED from the undo snapshot's prune: on a
   *  full ring the undo copy pushes the oldest member out, and the oldest member
   *  is exactly what a post-corruption recovery restores (the newest snapshots
   *  carry the corruption) — without the protection the restore would eat the
   *  very row the user picked. `apply` receives only the parsed value: nothing
   *  downstream may re-read the member's path, so a pruned-file race is
   *  unspellable at the consumer. */
  restore<T>(file: string, apply: (raw: unknown) => T): T;
  /** Arm the slow re-snapshot tick — `unref`'d, so a live diagnostic safety net
   *  never holds the process open. No disarm: both consumers arm exactly one at
   *  boot altitude and let process exit do the teardown. */
  startTicker(): void;
}

/** The ring member name grammar's WRITER half — `<base>.<fs-safe UTC stamp>.json`,
 *  with `bump` 1 unsuffixed and a same-millisecond sibling carrying `-N`. */
function backupFileName(base: string, at: Date, bump: number): string {
  const stamp = at.toISOString().replaceAll(":", "-").replace(".", "-");
  return bump === 1 ? `${base}.${stamp}.json` : `${base}.${stamp}-${bump}.json`;
}

/** The grammar's READER half — the instant and the collision bump a member's
 *  name encodes, or `undefined` when the name is not one this ring could have
 *  written. Pairs with {@link backupFileName}; the round-trip is pinned by
 *  test. */
function parseBackupFileName(
  base: string,
  file: string,
): { savedAtMs: number; bump: number } | undefined {
  if (basename(file) !== file) return undefined;
  const prefix = `${base}.`;
  if (!file.startsWith(prefix) || !file.endsWith(".json")) return undefined;
  const match = BACKUP_STAMP_RE.exec(
    file.slice(prefix.length, file.length - ".json".length),
  );
  if (match === null) return undefined;
  const [, date, hours, minutes, seconds, millis, bump] = match;
  const savedAtMs = Date.parse(
    `${date}T${hours}:${minutes}:${seconds}.${millis}Z`,
  );
  // A syntactically well-formed stamp naming no real instant (`…T99-99-99…`)
  // is not a name this writer could have minted.
  if (Number.isNaN(savedAtMs)) return undefined;
  return { savedAtMs, bump: bump === undefined ? 1 : Number(bump) };
}

/** The ring's file-name base, DERIVED from the state file rather than baked in:
 *  two stores under one directory (`config.json` and `session.json`) must keep
 *  two independent rings, or one's prune would delete the other's snapshots and
 *  a restore would hand the wrong store's bytes to the wrong domain. */
function ringBase(configPath: string): string {
  const base = basename(configPath, ".json").replace(/[^A-Za-z0-9_-]/g, "");
  if (base.length === 0) {
    throw new Error(`not a ringable state file: ${JSON.stringify(configPath)}`);
  }
  return base;
}

/** Open `configPath`'s backup ring. Pure: nothing is read or created until a
 *  verb is called, so opening a ring in a module body arms nothing. */
export function openStateBackupRing(
  configPath: string,
  log: Logger,
): StateBackupRing {
  const base = ringBase(configPath);
  const dir = join(dirname(configPath), BACKUP_SUBDIR);

  const list = (): StateBackupEntry[] => {
    if (!existsSync(dir)) return [];
    return (
      readdirSync(dir)
        .flatMap((file) => {
          const parsed = parseBackupFileName(base, file);
          if (parsed === undefined) return [];
          // A member that vanishes between `readdir` and `stat` (a concurrent
          // prune, a hand-tidied dir) is skipped, not thrown: the LIST side is
          // where one bad member must not hide the good ones.
          let sizeBytes: number;
          try {
            sizeBytes = statSync(join(dir, file)).size;
          } catch (err) {
            log.error({ err, file }, "state backup member could not be stat'd");
            return [];
          }
          return [
            {
              file,
              savedAtMs: parsed.savedAtMs,
              bump: parsed.bump,
              sizeBytes,
            },
          ];
        })
        // Newest first, on the ring's OWN fact. The bump breaks a same-millisecond
        // tie — the exact case the `-N` suffix exists to disambiguate, which under
        // an mtime sort fell back to filesystem-arbitrary `readdir` order.
        .sort((a, b) => b.savedAtMs - a.savedAtMs || b.bump - a.bump)
        .map(({ file, savedAtMs, sizeBytes }) => ({
          file,
          savedAtMs,
          sizeBytes,
        }))
    );
  };

  const pathOf = (file: string): string => {
    if (parseBackupFileName(base, file) === undefined) {
      throw new Error(`not a state-backup file name: ${JSON.stringify(file)}`);
    }
    return join(dir, file);
  };

  const read = (file: string): unknown =>
    JSON.parse(readFileSync(pathOf(file), "utf8")) as unknown;

  // `protect` names a member the prune may not touch — the restore verb pins
  // the member being restored so its own undo snapshot cannot push it out of a
  // full ring (the ring runs one over size until the next ordinary snapshot).
  const snapshot = (protect?: string): SnapshotOutcome => {
    try {
      if (!existsSync(configPath)) return { kind: "no-state-file" };
      // Owner-only, mirroring the store this rings: kolu-server's config holds
      // ssh targets and is deliberately 0600, and a ring member is a
      // byte-identical copy of it.
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const current = readFileSync(configPath);
      const before = list();
      const newest = before[0];
      if (newest && current.equals(readFileSync(join(dir, newest.file)))) {
        return { kind: "unchanged" };
      }
      const at = new Date();
      let bump = 1;
      let file = backupFileName(base, at, bump);
      while (existsSync(join(dir, file))) {
        bump += 1;
        file = backupFileName(base, at, bump);
      }
      copyFileSync(configPath, join(dir, file));
      // `copyFileSync` happens to carry the source mode today; the explicit
      // chmod means the store's stated posture does not rest on that.
      chmodSync(join(dir, file), statSync(configPath).mode & 0o777);
      // The ring AS OF this copy — the pre-copy sweep plus the file just
      // written, so the prune reuses the enumeration the dedupe already did
      // instead of re-walking the directory.
      for (const stale of [file, ...before.map((e) => e.file)].slice(
        STATE_BACKUP_RING_SIZE,
      )) {
        if (stale === protect) continue;
        unlinkSync(join(dir, stale));
      }
      log.info({ file, dir }, "state backup snapshot taken");
      return { kind: "created", file };
    } catch (err) {
      log.error(
        { err, configPath },
        "state backup snapshot FAILED — continuing without one (the backup is a safety net, not a boot gate)",
      );
      return { kind: "failed" };
    }
  };

  return {
    dir,
    snapshot: () => snapshot(),
    list,
    pathOf,
    read,
    listWith: <S>(summarize: (raw: unknown) => S, unreadable: S) =>
      list().map((entry) => {
        // BOTH halves guarded: unreadable bytes AND a summarize that chokes on
        // parseable-but-alien JSON (`null`, a bare string — `JSON.parse` accepts
        // any literal, and the domain summarizers index into the value). Either
        // way one bad member carries `unreadable` instead of collapsing the
        // whole enumeration.
        try {
          return { ...entry, summary: summarize(read(entry.file)) };
        } catch (err) {
          log.error(
            { err, file: entry.file },
            "state backup snapshot is unreadable",
          );
          return { ...entry, summary: unreadable };
        }
      }),
    restore: <T>(file: string, apply: (raw: unknown) => T) => {
      const raw = read(file);
      // Undoability: capture the pre-restore file before `apply`'s writes
      // overwrite it, PROTECTING the member being restored from the prune (a
      // full ring would otherwise push out its oldest member — exactly the one
      // a post-corruption recovery picks). An UNCHANGED answer is the file
      // already sitting at the head of the ring; only an outright failure means
      // there is no way back.
      const undo = snapshot(file);
      if (undo.kind === "failed") {
        throw new Error(
          "refusing to restore: the pre-restore snapshot failed, so this restore would not be undoable",
        );
      }
      return apply(raw);
    },
    startTicker: () => {
      setInterval(() => snapshot(), STATE_BACKUP_TICK_MS).unref();
    },
  };
}
