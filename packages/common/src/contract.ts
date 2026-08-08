/**
 * The app's RPC contract: the typed API shape shared by server and client, as
 * ONE flat `RpcGroup` (Effect RPC).
 *
 * The typed reactive layer lives in `./surface` (`defineSurfaceWithPolicy(...)`)
 * and appears at the wire tags `surface/<sibling>/<member>/<verb>`. The terminal
 * domain's raw procedures (lifecycle, attach, screen, git worktrees, …)
 * relocated onto `@kolu/padi`'s `padiSurface` across W1.R — the root `terminal/*`
 * / `git/*` namespaces this contract once carried were DELETED at W1.R7 (the
 * package-boundary seal). What remains are the host-level raw procedures that
 * never fit a surface primitive and stay kolu-server's own: `server/info`
 * (synchronous per-host branding), `daemon/restart`, and the four-plus-one
 * `hosts/*` membership verbs.
 *
 * ── Why a flat group, and what that changes ────────────────────────────
 *
 * oRPC's `oc.router({...})` nested namespaces; Effect RPC's namespace is FLAT —
 * one `Rpc` per tag, and a tag is the slash-joined wire path (PLAN D1). So the
 * old `server: { info }` object literal is the tag `"server/info"`, and the
 * surface siblings' tags all begin `surface/`, which is exactly what keeps a
 * hand-written root procedure from ever colliding with a surface member.
 *
 * `RpcGroup.make` / `.merge` are last-writer-wins `Map.set`s with ZERO collision
 * detection (#16), so every assembly here is followed by
 * {@link assertTagCount} — a collision fails at import, not by silently serving a
 * contract that is quietly missing a member.
 *
 * The procedure I/O schemas this contract consumes are declared in this file.
 * Schemas shared with the surface layer live in `./surface` and are imported
 * there, not here.
 */

import { composeSurfaceContracts } from "@kolu/surface/define";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { HostKeySchema } from "./hostKey.ts";
import { surfaces } from "./surface";

// ── Root procedure I/O schemas ────────────────────────────────────────

export const PwaIdentitySchema = Schema.Struct({
  hostname: Schema.String,
  name: Schema.String,
  themeColor: Schema.String,
});
export type PwaIdentity = typeof PwaIdentitySchema.Type;

// The `processId` (restart axis) and `commit` (build-identity / skew axis) that
// used to ride this probe now live on the surface, owned by @kolu/surface-app:
// `processId` is the `surface/surfaceApp/identity/info` probe (surface-app served
// as a sibling surface), and `commit` is the server-pushed `buildInfo` cell
// (`koluBuildInfo`); the kaval expected/reported identities ride padi's `status`
// cell + `daemonStatus` collection, not this probe. This raw probe keeps only the
// per-host BRANDING the shell needs synchronously at boot (document title,
// watermark, PWA theme).
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
 *  (the fleet size, this store's real user data). `summary` is a union for the
 *  same reason as padi's: "no hosts" and "did not parse" are different facts. */
export const ServerStateBackupSchema = Schema.Struct({
  /** Bare file name under the ring dir — the handle `server/backups/restore`
   *  names. */
  file: Schema.String,
  /** Snapshot mtime in epoch ms on kolu-server's clock (the browser talks to
   *  this server directly, so no cross-host reprojection is needed here). */
  savedAtMs: Schema.Number,
  sizeBytes: Schema.Int,
  summary: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("state"), hosts: Schema.Int }),
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
 *  FACT the caller renders ("restored; 1 host did not reconnect"), not a throw:
 *  squeezing it through the error channel forced the dialog to say "Restore
 *  failed:" about a restore that had already applied. `hostFailures` empty ⇒
 *  fully converged. Genuine fail-fast anomalies — a bad name, an unreadable or
 *  undecodable snapshot, a failed undo snapshot — still throw, because they
 *  happen BEFORE anything is applied. */
export const ServerBackupsRestoreResultSchema = Schema.Struct({
  hostFailures: Schema.Array(Schema.String),
});
export type ServerBackupsRestoreResult =
  typeof ServerBackupsRestoreResultSchema.Type;

// ── The root procedures ───────────────────────────────────────────────

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
   *  the strip uses. No server restart — unlike padi's session, this store is
   *  plain data served from cells. The current file is pushed into the ring
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
   *  not this return value. The user reaches it from the kaval rail dialog (a
   *  running or degraded daemon) or the DegradedCanvas (a dead one). No payload:
   *  one local host today, host-count-agnostic shapes deferred to R-2. */
  Rpc.make("daemon/restart"),
  // Runtime membership of the keyed padi host map — the selector strip's add/remove
  // actions. Root RPCs (not surface members): they mutate the POOL, not one host's
  // surface. These exist on the shared contract (not a kolu-server-local splice like
  // the `padi` sibling) because the CLIENT strip calls them.
  /** WHICH of kolu's hosts the calling browser is sitting AT, or `null` when
   *  none of them is (the ordinary case) or kolu cannot tell.
   *
   *  A ROOT rpc rather than a surface member for a structural reason: the
   *  answer is per-CALLER — it depends on the address this particular
   *  connection comes from — and a surface cell is broadcast, so it has no
   *  shape that can carry a different answer to each viewer. A procedure call
   *  is inherently per-caller; under Effect RPC the caller's address reaches
   *  the handler as a `CurrentViewer` service provided by an `RpcMiddleware`
   *  kolu-server installs at its ws/HTTP entry points (PLAN D5/W4) — the
   *  contract only DECLARES the procedure, it never names the transport.
   *
   *  Used by the Ports section: a port on a host you are physically at is
   *  reachable on your OWN loopback, so forwarding it through the kolu server
   *  and back is a pointless round trip. `null` keeps the forward, which is why
   *  every uncertain case answers `null` rather than guessing. */
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
   *  the user CLEARS the cause (kills the other kolu, sets KOLU_REMOTE_PADI_STATE_DIR,
   *  upgrades), NOTHING re-dials on its own — this re-dials via the session's
   *  `recheck()` (force-cycle the held connection through the reconnect loop). A
   *  TRANSIENT disconnect already auto-retries, so this is a harmless no-op there;
   *  it is NOT the inert-retry we forbade — it genuinely re-dials the held arm. An
   *  unknown host is a typed reject. */
  Rpc.make("hosts/reconnect", { payload: HostRefSchema }),
  /** Update & restart a host's daemon stack — the CONTRACT-SKEW recovery (SK5).
   *  The binder DRAINS that host's padi (session persisted; the reconnect loop
   *  re-dials, re-realising the CURRENT closure on the host) and the fresh
   *  padi's converge policy recycles the old kaval from its new build. The one
   *  action that changes the BINARY — offered by the `incompatible` skew card,
   *  where a plain restart provably respawns the same old kaval. Applies to
   *  BOTH local and remote hosts (D1 — the local drain rides the same seam).
   *  An unknown host rejects loudly (a plain server error the caller's
   *  toast surfaces — same shape as `hosts/reconnect`'s guard). */
  Rpc.make("hosts/renewDaemon", { payload: HostRefSchema }),
);

/** Prove an assembled group carries EXACTLY the tags it was built from.
 *  `RpcGroup.make`/`.merge` overwrite a colliding tag silently (#16), so the
 *  only way a caller learns about a collision is by counting. */
function assertTagCount(
  // Structural, not `RpcGroup<…>`: the two groups this file assembles have
  // different (precise) element unions, and `requests` is the only thing the
  // check reads — naming the shape keeps the helper free of a cast.
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

// Two sibling surfaces multiplexed over one transport (kolu#1197): kolu's OWN
// primitives under `kolu`, and surface-app's complete surface (buildInfo cell
// + identity probe) under `surfaceApp`. `composeSurfaceContracts` re-walks each
// sibling at its own tag prefix, producing tags `surface/<key>/<member>/<verb>`.
// `surfaces` is the single source shared with the server + client. (The generic
// `terminalWorkspace` sibling was retired at W1.R7 — it had zero consumers once
// the client moved onto padi's `terminals` collection; the terminal domain is
// `padiSurface` now.)
//
// `padiSurface` (the padi plan of record, PR #1649) is NOT here — it lives in
// `@kolu/padi`, which OWNS the terminal vocabulary (its `./vocab.ts` schemas);
// the arrow points `kolu-common → @kolu/padi`, so kolu-common must not depend
// BACK on `padiSurface`. kolu-server composes the padi-ful registry locally
// (`server/src/surface.ts`) and serves it; the client consumes the padi-less
// contract.
const composedSurfaces = composeSurfaceContracts(surfaces);

/** The composed padi-less surface group — every sibling's members in one flat
 *  group, tagged `surface/<key>/<member>/<verb>`. Exported beside
 *  {@link koluRootGroup} so a consumer can take either half without re-walking
 *  the specs. */
export const koluSurfaceGroup = composedSurfaces.group;

/** THE contract: the composed surface siblings PLUS the root procedures, one
 *  flat group. `merge` is safe HERE (unlike between two surfaces, which share
 *  the three reserved `system/*` tags — PLAN D1) because the two halves live in
 *  disjoint tag roots, `surface/` and `server|daemon|hosts/` — and the assertion
 *  below is what proves it rather than assuming it. */
export const contract = koluSurfaceGroup.merge(koluRootGroup);

assertTagCount(
  contract,
  koluSurfaceGroup.requests.size + koluRootGroup.requests.size,
  "the composed contract",
);
