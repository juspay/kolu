/** Session restore — hydration from server state, session restore handler. */

import type { SavedSession, TerminalMetadata } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { toast } from "solid-sonner";
import { deepLinkFocusIntent } from "../deepLinkFocusIntent";
import {
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../hostScope/activeWire";
import { activeScope } from "../hostScope/hostScopes";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import type { UiAction } from "../runAction";
import { activePadiRpc } from "../wire";
import { containingTileOf, descendantsByRoot } from "./terminalTree";
import { useSubPanel } from "./useSubPanel";
import type { TerminalStore } from "./useTerminalStore";

/** A terminal paired with its (already-arrived) metadata. The hydration
 *  effect builds these by gating on the composed record having arrived on padi's
 *  `terminals` collection for every listed id, so `m` is always defined. `t` is
 *  the terminal-list row — just `{ id }`, derived from the collection's keys. */
type HydrationEntry = { t: { id: TerminalId }; m: TerminalMetadata };

/** How long the view seed waits for the answered tile's collection row before
 *  seeding without it. Two orders of magnitude above the only wait the healthy
 *  path can incur (one event-loop drain of an already-in-process delta — see the
 *  deadline's argument at {@link useSessionRestore}'s hydration effect) and an
 *  order of magnitude above a fence re-subscribe's snapshot replay
 *  (`STREAM_RETRY_DELAY_MS` = 1 s + one round trip), so firing means the answer
 *  is STALE, never that the wait was merely slow. Short enough that the only
 *  state it can strand — a restored canvas with no seeded tile — is not a
 *  session-long dead end. */
export const ANSWERED_TILE_DEADLINE_MS = 10_000;

export function useSessionRestore(deps: { store: TerminalStore }) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );
  /** True from the moment `handleRestoreSession` starts until it
   *  resolves (success or failure). The restore card stays mounted
   *  while this is true so the click target doesn't detach mid-flight. */
  const [isRestoring, setIsRestoring] = createSignal(false);

  // ── The answered tile's arrival deadline ────────────────────────────────────
  // The seed below defers while the answered id is absent from the collection.
  // The deadline bounds that wait. ONE timer, owned: `armedFor` is the ANSWER BOX
  // it belongs to (a fresh object per `reportRestoredActive`), so the deltas that
  // re-run the effect find it already armed and never restart it — the wait is
  // 10 s from the answer, not 10 s from the last delta. Disarmed the moment the
  // seed proceeds (arrival or expiry) and on owner disposal, so no timer outlives
  // the hook.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineArmedFor: object | null = null;
  /** Bumped when a deadline fires. `restoredActive` is a NON-reactive gate, so
   *  consuming the box cannot re-run the hydration effect by itself; this is the
   *  reactive nudge that does, read by the effect ONLY on the runs that defer. */
  const [expirations, noteExpiration] = createSignal(0);
  function disarmDeadline() {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
    deadlineArmedFor = null;
  }
  onCleanup(disarmDeadline);

  // Hydrate from server state. ONE named `HydrationPhase` (pending → decided →
  // seeded, `hostScope/createSessionRestore`) tracks TWO once-only steps:
  //   - the empty-vs-restore DECISION (`markDecided`, drives the restore card),
  //     made once the terminal list + saved-session cell report;
  //   - the client VIEW-STATE seed (`markSeeded` — active tile + canvas viewport
  //     + sub-panel tabs + MRU), run once REAL terminals appear.
  //
  // The two are DISTINCT steps of one phase because W1.R6 deleted the client
  // respawn loop that used to seed the view inline during a restore-from-empty-
  // state: now that seeding rides THIS effect, which must fire when the restored
  // terminals arrive — even though the empty-state decision (`decided`) already
  // ran. (A browser reload re-mounts the hook, so the phase starts `pending` and
  // the initial-load path is unchanged.)
  //
  // The phase is PER HOST, owned by the host's `scopedByEntry` scope
  // (`hostScope/createSessionRestore`) — the hand-rolled `Map` keyed by
  // `encodeHostKey(activeHost())` is GONE. `activeScope()` re-keys on host switch,
  // so this effect (which reads it) also tracks the switch and picks up the NEW
  // host's latch. A never-seeded host re-runs the decision + hydration (adopting
  // ITS saved-active tile immediately — zero dock click); a switch-BACK to an
  // already-`seeded` host short-circuits, so its in-memory view (the owner's
  // per-host record) wins — savedSession seeds only the FIRST visit. (An explicit
  // in-session restore calls `reseedForRestore()` on the active host below.)
  // During the removal race `activeScope()` is briefly `undefined` and the effect
  // no-ops until `wire.ts` re-points `activeHost`.
  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSavedSession();
    const latch = activeScope()?.restore;
    if (!latch) return; // removal race — no active host to hydrate this tick
    // Gate on the subscription having yielded at least once — `sub.pending()`
    // flips false after the first yield (which may be the initial `null`
    // snapshot when no session is saved). Without this gate we'd hydrate
    // with a null before the server snapshot arrives and miss a restore prompt.
    if (existing === undefined || savedSessionSub.pending()) return;
    // Empty-vs-restore decision (once). Key it on the parked-FILTERED real
    // terminal set (`store.terminalIds()`), NOT the raw list: a reboot seeds
    // PARKED registry entries (W1.R6), which DO appear in `listSub()` (they
    // carry `info`) but are off-canvas restore-card rows, not tiles. Reading the
    // raw `existing.length` here would see those parked entries as "not empty"
    // and skip showing the card on a real reboot with active terminals — the
    // exact case the card exists for. `terminalIds()` excludes parked (and is
    // `[]` whether or not the metadata half has joined), so the empty-branch
    // fires at a parked cold boot exactly as it did pre-R6, ordering-independent
    // (the gate above already waited for BOTH the list and session cells to
    // yield). When empty, the card reads `savedSession`; the re-fetch effect
    // below keeps it current after.
    if (latch.phase === "pending") {
      latch.markDecided();
      if (store.terminalIds().length === 0) {
        setSavedSession(fromServer);
        return;
      }
    }
    if (latch.phase === "seeded") return;
    // A restore THIS client issued is still in flight — the host has not yet said
    // which tile it made active. Its terminals reach us first (they publish as they
    // spawn; the `session` cell's snapshot publishes only after a synchronous disk
    // write), so seeding now would read the blob we CONSUMED, whose
    // `activeTerminalId` names pre-restore ids that no longer exist, silently pick
    // `topIds[0]`, and `markSeeded()` the WRONG tile for the rest of the session.
    // Waiting for the call to answer is what makes the ordering structural rather
    // than a race the client happens to win on a fast box. Reactive by design: the
    // flip to false re-runs this effect, and `latch.restoredActive` (a NON-reactive
    // gate, like `phase`) is read on that run. The flag is per-HOOK, so a restore
    // on one host briefly holds another host's FIRST seed too — self-clearing, and
    // the alternative (a second in-flight fact per latch) would state one thing
    // twice.
    if (isRestoring()) return;
    // Wait for the composed record to arrive (via `store.getMetadata`) for EVERY
    // listed terminal — hydration reads `parentId` and `subPanel` off the record
    // (since #806 the list snapshot no longer carries `meta`). `getMetadata`
    // returns `undefined` for a PARKED (restore-card) record as well as a
    // not-yet-arrived one, so this loop naturally waits out the parked set (which
    // `session.restore` consumes) and can never seed the view from a parked row or
    // a partial set. The reads are reactive, so the effect re-runs as values arrive.
    const joined: HydrationEntry[] = [];
    for (const t of existing) {
      const m = store.getMetadata(t.id);
      if (m === undefined) return;
      joined.push({ t, m });
    }
    // Seed only once at least one REAL (active/sleeping) terminal exists — the
    // initial live load, or once a restore has produced them. An all-parked reboot
    // never reaches here: the empty-vs-restore decision above returns first
    // (`terminalIds()` is empty).
    if (joined.length === 0) return;
    // A restore that just answered names the active tile ITSELF — prefer it over
    // the persisted marker, which for exactly this hydration is the blob the
    // restore consumed. `restoredActive` is a BOX, so a host that answered "no
    // active terminal" (`{ id: null }`) stays distinct from "no restore answered"
    // (`null`) and does not fall back to that stale blob.
    const restored = latch.restoredActive;
    // The answer and the collection deltas ride INDEPENDENTLY SCHEDULED client
    // pipelines over the one socket, so the unary answer's continuation is
    // reachable AHEAD of a delta the server emitted before it. Seeding while the
    // answered id is absent from the list drops it in `hydrateFromTerminals` (not
    // a member of `entries`), silently falls back to `topIds[0]`, and
    // `markSeeded()` latches the WRONG tile for the rest of the session — no
    // later delta can repair it. So return WITHOUT consuming the box: `existing`
    // is a reactive read, the delta re-runs this effect, and the answered
    // terminal is guaranteed to arrive (the host spawned it, and the standing
    // collection subscription's snapshot-then-deltas discipline replays it even
    // across a retry). An answered `{ id: null }` — the host holds no active
    // terminal — names nothing to wait for and seeds immediately; so does the
    // blob-fallback path (no answer box), whose ids are legitimately stale.
    if (restored?.id != null && !existing.some((t) => t.id === restored.id)) {
      // Tracked ONLY on the runs that defer — the deadline's expiry consumes the
      // box non-reactively, so this read is what turns that into a re-run.
      expirations();
      // The wait is BOUNDED, and on an unbroken link the bound is unreachable.
      // The server emits the collection delta BEFORE the answer; the socket is
      // FIFO and the client's demuxer must read EVERY frame to route it, so by
      // the time the answer's continuation runs the delta is already in-process
      // in the collection pipeline — its application is scheduler-bounded (an
      // event-loop drain), never network-bounded. A broken link cannot extend
      // that either: the per-subscription fence re-subscribes and replays a FRESH
      // snapshot of the server's CURRENT registry, which either holds the id (it
      // arrives, the seed proceeds) or does not — and a post-reconnect snapshot
      // lacking the id is precisely a STALE answer (the daemon no longer holds
      // that terminal, e.g. a padi recycle inside the window), which no amount of
      // waiting cures. So the deadline converts the stale-answer hang — the only
      // reachable non-arrival — into a conservative seed plus a loud report, and
      // fires on nothing else.
      if (deadlineArmedFor !== restored) {
        disarmDeadline();
        deadlineArmedFor = restored;
        const answered = restored.id;
        deadlineTimer = setTimeout(() => {
          disarmDeadline();
          // Consume the box so it cannot gate a second time: the next run of this
          // effect falls through to the blob-fallback path (`fromServer
          // ?.activeTerminalId ?? null`, then `topIds[0]`).
          latch.expireRestoredActive();
          toast.error(
            `Restore reported terminal ${answered} as active, but it never appeared on this host — seeding the view without it`,
          );
          noteExpiration((n) => n + 1);
        }, ANSWERED_TILE_DEADLINE_MS);
      }
      return;
    }
    disarmDeadline();
    latch.markSeeded();
    hydrateFromTerminals(
      joined,
      restored ? restored.id : (fromServer?.activeTerminalId ?? null),
    );
  });

  function hydrateFromTerminals(
    entries: HydrationEntry[],
    serverActiveId: string | null,
  ) {
    // Canvas layouts live on metadata — no client-side seeding needed.
    // Seed sub-panel + right-panel state from server metadata.
    for (const { t, m } of entries) {
      if (m.subPanel) subPanel.seedPanel(t.id, m.subPanel);
      if (m.rightPanel) rightPanel.seedPanel(t.id, m.rightPanel);
    }

    // Parent edge over the hydration census — shared by tab seeding, topIds,
    // and deep-link intent (canvas chrome keys on the root, not one-hop).
    const byId = new Map(entries.map((e) => [e.t.id, e]));
    const parentEdge = (id: TerminalId) => {
      const e = byId.get(id);
      if (!e) return undefined;
      return e.m.parentId ?? null;
    };

    // Initialize sub-panel active tabs on ROOT tiles — flat descendants, not
    // true one-hop (a remembered grandchild is a valid tab of R, not only of M).
    // The SAME grouping the live store's pane index uses, from the module that
    // owns it: hydration must seed exactly the tabs the canvas will then paint.
    const byRoot = descendantsByRoot(
      entries.map(({ t }) => t.id),
      parentEdge,
    );
    for (const [rootId, subIds] of byRoot) {
      const activeSubTab = subPanel.peekSubPanel(rootId).activeSubTab;
      if (!activeSubTab || !subIds.includes(activeSubTab)) {
        subPanel.setActiveSubTab(rootId, subIds[0] ?? null);
      }
    }

    // Prefer the server-persisted active terminal; fall back to first in order.
    // `store.activeId()` starts as null after refresh (lost makePersisted in
    // #554), so on refresh the server snapshot is the only source of truth
    // for "which terminal was active". `entries` arrives in the server's
    // Map insertion order, which is the canonical ordering.
    // Top-level = root of own chain (includes cycle/orphan via containingTileOf).
    const topIds = entries
      .filter(({ t }) => containingTileOf(t.id, parentEdge) === t.id)
      .map(({ t }) => t.id);
    // A deep link opened on this cold boot names the terminal to focus. Honor it
    // over the server's last-active — resolved to its OWNING tile for a split —
    // so a bookmark wins the `activeId` write here instead of racing the
    // deep-link router's settle effect for it. Only when the target is a member
    // of THIS host's list (else a stale cross-host intent is ignored).
    const intent = deepLinkFocusIntent();
    // Owning tile for a nested target is the root of its parent chain, not the
    // true one-hop parent (middle ∉ topIds would drop the bookmark).
    const intentTile =
      intent !== null ? containingTileOf(intent, parentEdge) : null;
    const picked =
      intentTile && topIds.includes(intentTile as TerminalId)
        ? (intentTile as TerminalId)
        : serverActiveId && topIds.includes(serverActiveId as TerminalId)
          ? (serverActiveId as TerminalId)
          : (topIds[0] ?? null);
    // Seed/reconcile the durable visit trail BEFORE activation. writeFocus
    // noteVisit's the pick; if we seed after, a non-empty one-entry trail
    // would skip multi-id restore order (Ctrl+Tab would only see the pick).
    store.reconcileLiveIds(
      picked ? [picked, ...topIds.filter((x) => x !== picked)] : topIds,
    );

    // `setActiveSilently`: the canvas's first-mount fallback effect pans
    // the viewport to the picked active when restoring at default origin —
    // calling `activate` here would double-pan and racing the still-
    // assembling pendingLayouts.
    store.setActiveSilently(picked);
  }

  // Re-fetch saved session when all terminals are killed mid-session,
  // OR when the server pushes a fresh saved-session value while we're
  // already showing the empty state.
  //
  // IMPORTANT: read `serverSaved.savedSession()` UNCONDITIONALLY so the
  // reactive tracker subscribes to it on the effect's first run. Reading
  // it inside the `if` body would skip tracking when the gate fails on
  // the first run (initial mount before `hydrated` flips), and subsequent
  // server pushes of a new saved-session would never re-fire this effect.
  // That was the source of the chronic session-restore flake (#320, #440):
  // when initial hydration raced with the snapshot, savedSession was set
  // to null on the first effect and the reactive recovery here was dead.
  //
  // Gated on lifecycle: on a genuine server restart, the dim overlay is
  // the authoritative rescue UI and the restore button shouldn't compete.
  createEffect(() => {
    if (lifecycle().kind === "restarted") return;
    const fromServer = serverSavedSession();
    // `activeScope()` re-keys on switch, so this effect reads the ACTIVE host's
    // decision latch and re-runs on a host switch.
    if (
      store.terminalIds().length === 0 &&
      (activeScope()?.restore.phase ?? "pending") !== "pending"
    ) {
      setSavedSession(fromServer);
    }
  });

  function handleRestoreSession(
    options: { resumeAgents?: boolean; optOutIds?: readonly string[] } = {},
  ): UiAction {
    return Effect.suspend(() => {
      if (isRestoring()) return Effect.void;
      const session = savedSession();
      if (!session) return Effect.void;
      // Keep the restore card mounted until the server restore actually completes.
      // Synchronously clearing `savedSession` before the async RPC returns detaches
      // the click target mid-event — Playwright sees "element detached from the DOM"
      // retries, and a human sees an empty-state flicker between click and canvas
      // reveal. The visible card during the restore window is gated by
      // `isRestoring()`; on success we clear `savedSession` before the toast, on
      // failure we leave it set so the user can retry.
      setIsRestoring(true);
      // Re-arm the VIEW-STATE seed for THIS restore, on the ACTIVE host's latch. It
      // latches true on the first live load so a reconnect doesn't re-pan/re-seed the
      // canvas — but an in-session restore (the `recycleKaval` recycle→restore, no
      // page reload) is PRECISELY a re-seed event: it re-spawns every terminal under
      // FRESH ids whose client sub-panel state has never been seeded. Without this
      // reset the hydration effect below short-circuits on the stale latch and never
      // runs `hydrateFromTerminals` for the restored terminals, so a restored
      // parent's active sub-tab is never set and its split comes back HIDDEN. Clearing
      // it here lets the effect re-seed once the restored terminals arrive; it
      // re-latches true after seeding, so a later reconnect is still a no-op.
      const latch = activeScope()?.restore;
      // Re-arm: this runs from the restore card (already past the decision), so drop
      // back to `decided` via the NAMED transition — the next hydration effect
      // re-seeds the view. (A named `reseedForRestore()` rather than an out-of-band
      // raw phase write, which is exactly the hand-rolled-state-machine smell L18 named.)
      latch?.reseedForRestore();
      // Host stamp is required for the toast count and the card's membership —
      // require it BEFORE the RPC so a missing stamp cannot be misreported as a
      // restore failure after the host already applied the session. A DEFECT,
      // not a typed failure: padi stamping membership on every serve is an
      // invariant, so a missing stamp is a framework bug the run edge must
      // report loudly, never a state this card offers a retry for.
      if (session.resumableIds === undefined) {
        setIsRestoring(false);
        return Effect.die(
          new Error(
            "Saved session missing host-stamped resumableIds — padi must stamp membership on every serve",
          ),
        );
      }
      const id = toast.loading(
        `Restoring ${session.terminals.length} terminals…`,
      );
      // ONE writer, ONE call: padi re-spawns every terminal server-side (the
      // former client respawn loop is deleted). No `lifecycle.*` create /
      // sendInput fires from the client during restore — only this
      // `session.restore` — so restore can't half-apply across a mid-flight
      // reconnect. The client-side view-state (active tile + canvas viewport +
      // sub-panel tabs + MRU) is seeded by the HYDRATION effect below once the
      // restored terminals arrive on the `terminals` collection, exactly as a
      // browser reload hydrates.
      //
      // Intent only: host owns the resumable set (`session.resumableIds`); the
      // client may only say resume yes/no + opt-outs of that set.
      const resumeAgents = options.resumeAgents ?? true;
      const optOutIds = options.optOutIds ? [...options.optOutIds] : [];
      const hostResumable = session.resumableIds;
      return activePadiRpc.session
        .restore({
          resumeAgents,
          // SPREAD, never `optOutIds: … : undefined` (#17): the field is
          // `Schema.optionalKey` on the wire, so an ABSENT key is accepted and a
          // present-but-`undefined` one is REJECTED. "No opt-outs" — the ordinary
          // restore — is exactly the absent case.
          ...(optOutIds.length > 0 && { optOutIds }),
        })
        .pipe(
          Effect.tap((restored) =>
            Effect.sync(() => {
              // The host's answer to "which tile is active now" — pinned on the
              // latch of the host this restore ran against (captured above, so a
              // mid-flight host switch can't misfile it) BEFORE `isRestoring`
              // drops and releases the hydration effect's gate. This, not the
              // `session` cell's next snapshot, is what seeds the active tile.
              latch?.reportRestoredActive(restored.activeTerminalId);
              setSavedSession(null);
              // Faithful summary — "Restored N terminals, resumed M agents". M is
              // the host-served resumable set minus opt-outs when resume is on; 0
              // when off. Counts EVERY host-resumable terminal (including
              // parented/splits).
              const optOut = new Set(optOutIds);
              const resumed = resumeAgents
                ? hostResumable.filter((tid) => !optOut.has(tid)).length
                : 0;
              toast.success(
                resumed > 0
                  ? `Restored ${session.terminals.length} terminals, resumed ${resumed} agent${
                      resumed > 1 ? "s" : ""
                    }`
                  : "Session restored",
                { id },
              );
            }),
          ),
          // Recovered here, where the old shape re-threw into an unhandled
          // rejection nothing read: the toast IS the outcome, and `savedSession`
          // is deliberately left set so the user can retry.
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(`Restore failed: ${toError(err).message}`, { id });
            }),
          ),
          Effect.ensuring(Effect.sync(() => setIsRestoring(false))),
        );
    });
  }

  /** Explicit forfeit — the user chose "Start fresh" over the saved session.
   *  One server call discards the parked entries AND clears the saved session
   *  together (creating a terminal no longer forfeits implicitly, W1). On
   *  success the server pushes a `null` saved-session snapshot, which the
   *  re-fetch effect above folds into `savedSession` and dismisses the card;
   *  we also clear it optimistically so the card drops immediately. */
  function handleForfeitSession(): UiAction {
    return Effect.suspend(() => {
      const session = savedSession();
      if (!session) return Effect.void;
      // Optimistic dismissal: the card is gone the moment the user commits.
      setSavedSession(null);
      return activePadiRpc.session.forfeit({}).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            // Surface the failure and restore the card so the user can retry —
            // a caught error must not collapse silently to the empty state.
            setSavedSession(session);
            toast.error(`Failed to start fresh: ${toError(err).message}`);
          }),
        ),
      );
    });
  }

  return {
    // Loading is true until we can make an HONEST empty-vs-restore decision.
    // `store.terminalIds().length === 0` is NOT enough on its own — it reads 0 in
    // two very different situations, because `getMetadata` collapses "record not
    // yet arrived" and "record arrived-but-parked" into the same `undefined`:
    //   - a browser RELOAD, where the live terminals' records are merely in flight
    //     (we must keep loading — they're milliseconds away); and
    //   - a genuine REBOOT, where records arrive PARKED and the count stays 0 for
    //     good (we must show the restore card).
    // The metadata census (`recordPhases`) keeps those distinct: while any record
    // is still `awaited` we hold loading; once they've all settled (reboot → all
    // parked), `awaited` is 0 and we fall through to the saved-session cell, whose
    // ONE honest job is "is there a blob to offer?" for the genuinely-empty boot.
    // (The session cell used to double as a metadata-timing proxy here — it
    // resolves first, so it dropped the gate mid-flight and flashed the restore
    // card; the `recordPhases().awaited` term replaces that proxy.) When at least
    // one terminal's metadata has arrived (`terminalIds().length > 0`), the canvas
    // renders immediately — neither the census nor the session cell matters.
    isLoading: () =>
      store.listSub.pending() ||
      (store.terminalIds().length === 0 &&
        (store.recordPhases().awaited > 0 || savedSessionSub.pending())),
    savedSession,
    isRestoring,
    handleRestoreSession,
    handleForfeitSession,
  };
}
