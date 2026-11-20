import {
  composeSurfaceContracts,
  mergeDisjointGroups,
} from "@kolu/surface/define";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { HostKeySchema } from "./hostKey.ts";
import { surfaces } from "./surface";

export const PwaIdentitySchema = Schema.Struct({
  hostname: Schema.String,
  name: Schema.String,
  themeColor: Schema.String,
});
export type PwaIdentity = typeof PwaIdentitySchema.Type;

export const ServerInfoSchema = Schema.Struct({
  identity: PwaIdentitySchema,
});
export type ServerInfo = typeof ServerInfoSchema.Type;

/** The payload every host-membership verb takes: WHICH host to act on. The host
 *  is re-validated as a `HostKey` at the wire (P5) — that is what this schema
 *  IS, rather than a convention a handler could forget. */
export const HostRefSchema = Schema.Struct({ host: HostKeySchema });
export type HostRef = typeof HostRefSchema.Type;

/** What `hosts/viewer` answers: the host the calling browser is sitting at, or
 *  `null`. */
export const ViewerHostSchema = Schema.Struct({
  host: Schema.NullOr(HostKeySchema),
});
export type ViewerHost = typeof ViewerHostSchema.Type;

/** One snapshot in kolu-server's state-backup ring (#1658) — the same shape
 *  discipline as padi's `PadiStateBackupSchema`, with kolu-server's own summary
 *  (the fleet size and how many pieces of work it holds — this store's real
 *  user data). `summary` is a union for the same reason as padi's: "no hosts"
 *  and "did not parse" are different facts. */
export const ServerStateBackupSchema = Schema.Struct({
  /** Bare file name under the ring dir — the handle `server/backups/restore`
   *  names. */
  file: Schema.String,
  /** Snapshot mtime in epoch ms on kolu-server's clock (the browser talks to
   *  this server directly, so no cross-host reprojection is needed here). */
  savedAtMs: Schema.Number,
  sizeBytes: Schema.Int,
  summary: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("state"),
      hosts: Schema.Int,
      works: Schema.Int,
    }),
    Schema.Struct({ kind: Schema.Literal("unreadable") }),
  ]),
});
export type ServerStateBackup = typeof ServerStateBackupSchema.Type;

/** `server/backups/list`'s answer — the ring, newest first. */
export const ServerBackupsListSchema = Schema.Struct({
  backups: Schema.Array(ServerStateBackupSchema),
});
export type ServerBackupsList = typeof ServerBackupsListSchema.Type;

/** `server/backups/restore`'s payload — WHICH ring snapshot to restore. */
export const ServerBackupsRestoreSchema = Schema.Struct({
  file: Schema.String,
});
export type ServerBackupsRestore = typeof ServerBackupsRestoreSchema.Type;

/** `server/backups/restore`'s ANSWER. The restore is not atomic — the two cells
 *  apply before the host pool converges — so a host that would not dial is a
 *  FACT the caller renders ("restored; 1 host did not reconnect"), not a throw.
 *  `hostFailures` empty ⇒ fully converged. Genuine fail-fast anomalies — a bad
 *  name, an unreadable or undecodable snapshot, a failed undo snapshot — still
 *  throw, because they happen BEFORE anything is applied. */
export const ServerBackupsRestoreResultSchema = Schema.Struct({
  hostFailures: Schema.Array(Schema.String),
});
export type ServerBackupsRestoreResult =
  typeof ServerBackupsRestoreResultSchema.Type;

/** Every ROOT wire tag this contract declares, spelled literally. The assertion
 *  below compares it against what `RpcGroup.make` actually carried, so a typo, a
 *  duplicate, or a silently-dropped member is an import-time crash rather than a
 *  404 at the first call. Also the fixture the wire-shape test reads. */
export const ROOT_RPC_TAGS = [
  "server/info",
  "server/backups/list",
  "server/backups/restore",
  "daemon/restart",
  "hosts/viewer",
  "hosts/add",
  "hosts/remove",
  "hosts/reconnect",
  "hosts/renewDaemon",
] as const;

/** The raw (non-surface) procedures kolu-server serves at the ROOT of the wire.
 *  Kept as its own group — not folded into {@link contract} only — because
 *  kolu-server serves a SUPERSET (it re-composes the surfaces WITH padi and
 *  merges the host map's group): it needs the root half without the padi-less
 *  surface half, and merging two differently-composed surface groups would
 *  collide every surface tag silently. */
export const koluRootGroup = RpcGroup.make(
  /** Per-host branding the shell needs synchronously at boot. */
  Rpc.make("server/info", { success: ServerInfoSchema }),
  /** Enumerate kolu-server's OWN state-backup ring (#1658) — the store holding
   *  `preferences` / `hosts` / `viewerMode`. padi's ring is a padi surface
   *  member (`backups.list` per host); this one is a root RPC for the same
   *  reason `hosts/*` are: it concerns kolu-server's own store, not one host's
   *  surface. */
  Rpc.make("server/backups/list", { success: ServerBackupsListSchema }),
  /** Restore one ring snapshot IN-PROCESS: validate it (the migration ladder
   *  runs on a scratch copy first), push `preferences`/`viewerMode` through
   *  their cells (every connected client updates reactively), and converge the
   *  host pool onto the snapshot's fleet through the SAME pool add/remove path
   *  the strip uses. No server restart. The current file is pushed into the ring
   *  first (and the restore is REFUSED if that snapshot fails), so a restore is
   *  itself undoable. Answers with the hosts that would not converge — an empty
   *  list is a clean restore. */
  Rpc.make("server/backups/restore", {
    payload: ServerBackupsRestoreSchema,
    success: ServerBackupsRestoreResultSchema,
  }),
  /** Restart the local kaval daemon, preserving the session (B3.2). Captures
   *  the session before the kill, recycles the daemon (kill → wait → spawn →
   *  connect), and leaves the empty canvas + preserved session the restore
   *  card consumes. Resolves once the fresh daemon is connected — the daemon's
   *  live state rides the `daemonStatus` surface (`restarting`→`connected`),
   *  not this return value. No payload. */
  Rpc.make("daemon/restart"),
  /** WHICH of kolu's hosts the calling browser is sitting AT, or `null` when
   *  none of them is (the ordinary case) or kolu cannot tell.
   *
   *  A ROOT rpc rather than a surface member for a structural reason: the
   *  answer is per-CALLER — it depends on the address this particular
   *  connection comes from — and a surface cell is broadcast, so it has no
   *  shape that can carry a different answer to each viewer. The caller's
   *  address reaches the handler as a `CurrentViewer` service provided by an
   *  `RpcMiddleware` kolu-server installs at its ws/HTTP entry points — the
   *  contract only DECLARES the procedure, it never names the transport.
   *
   *  `null` keeps the forward, which is why every uncertain case answers
   *  `null` rather than guessing. */
  Rpc.make("hosts/viewer", { success: ViewerHostSchema }),
  /** Add a padi host to the warm pool at runtime. Resolves once the pool has seeded
   *  the binding; the entry then warms through the map's `entries` collection
   *  (connecting → connected). Re-adding an existing
   *  member rejects loudly (`host already exists`) — never a silent no-op. */
  Rpc.make("hosts/add", { payload: HostRefSchema }),
  /** Remove a guest host — its map subs end typed, its session is destroyed, and it
   *  drops from `entries`. Removing the unremovable default (LOCAL_HOST / the first
   *  seed) is rejected loudly: the canvas must always keep a host to fall back to. */
  Rpc.make("hosts/remove", { payload: HostRefSchema }),
  /** Force a held host to RE-DIAL now — the host-down card's [Reconnect] verb. A
   *  STANDING refuse (cross-supervisor / contract-skew / unconverged) holds degraded
   *  WITHOUT auto-reconnecting by design (a persistent skew must not spin), so once
   *  the user CLEARS the cause, NOTHING re-dials on its own — this re-dials via the
   *  session's `recheck()`. A TRANSIENT disconnect already auto-retries, so this is
   *  a harmless no-op there. An unknown host is a typed reject. */
  Rpc.make("hosts/reconnect", { payload: HostRefSchema }),
  /** Update & restart a host's daemon stack — the CONTRACT-SKEW recovery (SK5).
   *  The binder DRAINS that host's padi (session persisted; the reconnect loop
   *  re-dials, re-realising the CURRENT closure on the host) and the fresh
   *  padi's converge policy recycles the old kaval from its new build. The one
   *  action that changes the BINARY. Applies to BOTH local and remote hosts.
   *  An unknown host rejects loudly (a plain server error the caller's
   *  toast surfaces — same shape as `hosts/reconnect`'s guard). */
  Rpc.make("hosts/renewDaemon", { payload: HostRefSchema }),
);

/** Prove an assembled group carries EXACTLY the tags it was built from.
 *  `RpcGroup.make`/`.merge` overwrite a colliding tag silently (#16), so the
 *  only way a caller learns about a collision is by counting. */
function assertTagCount(
  group: { readonly requests: ReadonlyMap<string, unknown> },
  expected: number,
  what: string,
): void {
  const actual = group.requests.size;
  if (actual !== expected) {
    throw new Error(
      `kolu-common/contract: ${what} carries ${actual} tag(s), expected ${expected} — ` +
        `an RpcGroup assembly dropped a colliding tag.`,
    );
  }
}

assertTagCount(koluRootGroup, ROOT_RPC_TAGS.length, "the root procedure group");
for (const tag of ROOT_RPC_TAGS) {
  if (!koluRootGroup.requests.has(tag)) {
    throw new Error(
      `kolu-common/contract: the root procedure group is missing the declared tag "${tag}".`,
    );
  }
}

const composedSurfaces = composeSurfaceContracts(surfaces);

/** The composed padi-less surface group — every sibling's members in one flat
 *  group, tagged `surface/<key>/<member>/<verb>`. Exported beside
 *  {@link koluRootGroup} so a consumer can take either half without re-walking
 *  the specs. */
export const koluSurfaceGroup = composedSurfaces.group;

/** THE contract: the composed surface siblings PLUS the root procedures, one
 *  flat group. Merging is safe HERE (unlike between two surfaces, which share
 *  the three reserved `system/*` tags) because the two halves live in
 *  disjoint tag roots, `surface/` and `server|daemon|hosts/` — and
 *  `mergeDisjointGroups` is what proves that rather than assuming it. It erases
 *  the element union; the PRECISE halves stay available as the two exports above. */
export const contract = mergeDisjointGroups({
  koluSurfaces: koluSurfaceGroup,
  root: koluRootGroup,
});
