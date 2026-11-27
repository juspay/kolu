/** Session restore — hydration from server state, session restore handler. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { createMemo } from "solid-js";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import {
  createEffect,
  createSignal,
  onCleanup,
  onSettled,
  untrack,
} from "solid-js";
import { toast } from "solid-sonner";
import { deepLinkFocusIntent } from "../deepLinkFocusIntent";
import {
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../hostScope/activeWire";
import type { HostRestoreLatch } from "../hostScope/createSessionRestore";
import { activeScope } from "../hostScope/hostScopes";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import type { UiAction } from "../runAction";
import { activePadiRpc } from "../wire";
import { foldEach } from "../wideFold";
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

  /** The restore card's one source of truth: padi's `session` cell, plus the
   *  `restarted` guard (on a genuine server restart the dim overlay is the
   *  authoritative rescue UI and the restore button must not compete).
   *
   *  A PURE projection of the cell — never a local answer that outlives the
   *  action which produced it. Such an answer hides every later host offer, and
   *  with it the only thing that can consume the parked rows. The card needs no
   *  optimistic value: through a restore the cell still holds the blob being
   *  consumed (so the card stays mounted, `isRestoring` gating its buttons), and
   *  after an action the HOST's next snapshot is what dismisses it. */
  const savedSession = createMemo(() => {
    if (lifecycle().kind === "restarted") return null;
    return serverSavedSession();
  });
  /** True from the moment `handleRestoreSession` starts until it
   *  resolves (success or failure). The restore card stays mounted
   *  while this is true so the click target doesn't detach mid-flight. */
  const [isRestoring, setIsRestoring] = createSignal(false);
  /** True from the moment `handleForfeitSession` starts until it settles — the
   *  forfeit's write is in flight and the host has not yet cleared the blob. */
  const [isForfeiting, setIsForfeiting] = createSignal(false);

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

  /** EVERY LISTED TERMINAL'S COMPOSED RECORD, one row per id. Hydration reads
   *  `parentId` and `subPanel` off the record for every terminal in the list,
   *  and a record read costs two store nodes before any field — `WIDE_SCOPE_DEPS`
   *  at about 100 panes on the effect's own compute. A row holds its id's
   *  record; the compute reads the joined list and compares its LENGTH against
   *  the list's, which is the same "every record has arrived" gate the loop was.
   *  A row reads `undefined` for a PARKED (restore-card) record as well as a
   *  not-yet-arrived one, so the join naturally waits out the parked set (which
   *  `session.restore` consumes) and can never seed the view from a parked row
   *  or a partial set. */
  const hydrationRows = foldEach(
    "sessionRestore.record",
    () => store.listSub() ?? [],
    (id): HydrationEntry | undefined => {
      const m = store.getMetadata(id);
      return m === undefined ? undefined : { t: { id }, m };
    },
    (a, b) => a.t.id === b.t.id && a.m === b.m,
  );

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
  //
  // SHAPE: every reactive read is in the COMPUTE, which decides WHAT to do and
  // returns it as a plan; the effect phase performs it (the latch's two
  // once-only marks, the deadline timer, the seed). The latch's own `phase` and
  // `restoredActive` are non-reactive gates, so reading them in the compute
  // adds no dependency, exactly as before.
  type HydrationStep =
    | { readonly kind: "none" }
    | {
        readonly kind: "await-answer";
        readonly restored: { readonly id: string | null };
      }
    | {
        readonly kind: "seed";
        /** The seeding WRITES, planned in this compute: hydration reads the
         *  tiles' chrome, the deep-link intent and the landing's own facts,
         *  and an effect callback is a strict-read window. */
        readonly seed: () => void;
      };
  interface HydrationPlan {
    readonly latch: HostRestoreLatch;
    /** The empty-vs-restore decision has not been made yet on this host. */
    readonly decide: boolean;
    readonly step: HydrationStep;
  }
  createEffect(
    (): HydrationPlan | undefined => {
      const existing = store.listSub();
      const fromServer = serverSavedSession();
      const latch = activeScope()?.restore;
      if (!latch) return undefined; // removal race — no active host this tick
      // Gate on the subscription having yielded at least once — `sub.pending()`
      // flips false after the first yield (which may be the initial `null`
      // snapshot when no session is saved). Without this gate we'd hydrate
      // with a null before the server snapshot arrives and miss a restore prompt.
      if (existing === undefined || savedSessionSub.pending()) return undefined;
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
      // yield). When empty, the card reads `savedSession`; the derived accessor
      // keeps it current.
      const decide = latch.phase === "pending";
      const idle: HydrationPlan = { latch, decide, step: { kind: "none" } };
      if (decide && store.terminalIds().length === 0) return idle;
      if (latch.phase === "seeded") return idle;
      // A restore THIS client issued is still in flight — the host has not yet said
      // which tile it made active. Its terminals reach us first (they publish as they
      // spawn; the `session` cell's snapshot publishes only after a synchronous disk
      // write), so seeding now would read the blob we CONSUMED, whose
      // `activeTerminalId` names pre-restore ids that no longer exist, silently pick
      // `topIds[0]`, and `markSeeded()` the WRONG tile for the rest of the session.
      // Waiting for the call to answer is what makes the ordering structural rather
      // than a race the client happens to win on a fast box. Reactive by design: the
      // flip to false re-runs this compute, and `latch.restoredActive` (a
      // NON-reactive gate, like `phase`) is read on that run. The flag is per-HOOK,
      // so a restore on one host briefly holds another host's FIRST seed too —
      // self-clearing, and the alternative (a second in-flight fact per latch)
      // would state one thing twice.
      if (isRestoring()) return idle;
      // Wait for the composed record to arrive for EVERY listed terminal —
      // hydration reads `parentId` and `subPanel` off the record (since #806 the
      // list snapshot no longer carries `meta`). A row short of the list is a
      // record that has not arrived, or a parked one; either way this is not the
      // set to seed from. The rows are reactive, so the compute re-runs as values
      // arrive.
      const joined = hydrationRows();
      if (joined.length !== existing.length) return idle;
      // Seed only once at least one REAL (active/sleeping) terminal exists — the
      // initial live load, or once a restore has produced them. An all-parked reboot
      // never reaches here: the empty-vs-restore decision above returns first
      // (`terminalIds()` is empty).
      if (joined.length === 0) return idle;
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
      // later delta can repair it. So wait WITHOUT consuming the box: `existing`
      // is a reactive read, the delta re-runs this compute, and the answered
      // terminal is guaranteed to arrive (the host spawned it, and the standing
      // collection subscription's snapshot-then-deltas discipline replays it even
      // across a retry). An answered `{ id: null }` — the host holds no active
      // terminal — names nothing to wait for and seeds immediately; so does the
      // blob-fallback path (no answer box), whose ids are legitimately stale.
      if (
        restored?.id != null &&
        !joined.some((one) => one.t.id === restored.id)
      ) {
        // Tracked ONLY on the runs that defer — the deadline's expiry consumes the
        // box non-reactively, so this read is what turns that into a re-run.
        expirations();
        return { latch, decide, step: { kind: "await-answer", restored } };
      }
      return {
        latch,
        decide,
        step: {
          kind: "seed",
          // SAMPLED (untracked): the seed's own reads — each root tile's
          // remembered tab, the deep-link intent, the landing's chrome — are
          // the state as it stands when hydration fires, exactly as they were
          // when they happened in the (untracked) effect phase. The list and
          // the records are what wake this; a tab or an intent moving is not a
          // reason to re-seed.
          seed: untrack(() =>
            planHydrationFromTerminals(
              joined,
              restored ? restored.id : (fromServer?.activeTerminalId ?? null),
            ),
          ),
        },
      };
    },
    (plan) => {
      if (plan === undefined) return;
      if (plan.decide) plan.latch.markDecided();
      const step = plan.step;
      if (step.kind === "none") return;
      if (step.kind === "await-answer") {
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
        if (deadlineArmedFor === step.restored) return;
        disarmDeadline();
        deadlineArmedFor = step.restored;
        const answered = step.restored.id;
        deadlineTimer = setTimeout(() => {
          disarmDeadline();
          // Consume the box so it cannot gate a second time: the next run of this
          // compute falls through to the blob-fallback path
          // (`fromServer?.activeTerminalId ?? null`, then `topIds[0]`).
          plan.latch.expireRestoredActive();
          toast.error(
            `Restore reported terminal ${answered} as active, but it never appeared on this host — seeding the view without it`,
          );
          noteExpiration((n) => n + 1);
        }, ANSWERED_TILE_DEADLINE_MS);
        return;
      }
      disarmDeadline();
      // ONCE, EVEN FOR A PLAN BUILT BEFORE THE LATCH CLOSED. The compute can
      // answer "seed" twice before either answer is applied — the census
      // arrives as several writes, and each one re-runs this compute while the
      // phase is still open — and the second plan then carries a `seed` step
      // the first application has already performed. Seeding it again re-lands
      // the pick (a second `chrome.setActive` for the same tile, a second
      // visit), so the phase the first application closed is the test: a fresh
      // compute never reaches here with the latch already seeded, because it
      // returns the idle plan.
      if (plan.latch.phase === "seeded") return;
      plan.latch.markSeeded();
      step.seed();
    },
  );

  /** READER HALF of the view seed: every fact hydration decides from — each
   *  root tile's remembered tab, the deep-link intent, the landing's own panel
   *  chrome — is read HERE, in the hydration compute, and the writes travel as
   *  the returned function for the effect to run (an effect callback is a
   *  strict-read window). Hoisting the reads changes no answer: a Solid 2 write
   *  is staged, so none of these reads could have seen an earlier one anyway. */
  function planHydrationFromTerminals(
    entries: readonly HydrationEntry[],
    serverActiveId: string | null,
  ): () => void {
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
    const tabs: { rootId: TerminalId; subId: TerminalId | null }[] = [];
    for (const [rootId, subIds] of byRoot) {
      const activeSubTab = subPanel.paneChrome(rootId).activeSubTab;
      if (!activeSubTab || !subIds.includes(activeSubTab)) {
        tabs.push({ rootId, subId: subIds[0] ?? null });
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
    // THE BOOT PICK IS DERIVED, NOT SEEDED. The per-host focus fact is the
    // user's OVERRIDE over a memo of this same census (`hostScope/createBootPick`),
    // so on a cold boot the active tile already IS `picked` in the flush this
    // hydration runs in — one frame earlier than a seed could paint it, and with
    // no effect relaying the metadata census into the signal the app shell, the
    // canvas and the command palette all read. What stays is the activation's
    // SIDE effects, which are not derivable: the unread mark, the host's
    // active-terminal report, and the VISIT — the stamp this browser comes
    // back to on the NEXT boot, which no fold over this session's census
    // carries. In session the trail is not what the view reads: this host's
    // live MRU is the trail narrowed to the census with the pick leading it
    // (`hostScope/createViewState.mruOrder`), so the stamp changes no answer
    // here — which is why it is written from `onSettled` rather than from
    // this arm (`createViewState.noteDerivedActivation`).
    //
    // A pick the derivation does NOT cover still writes through the ordinary
    // path: a restore's answered tile (parked non-reactively on the latch), a
    // tile whose landing pane is a remembered SUB pane, and a host whose
    // selection was explicitly cleared by a close-all. `setActiveSilently`, not
    // `activate`: the canvas's first-mount fallback effect pans the viewport to
    // the picked active when restoring at default origin, so centering here
    // would double-pan and race the still-assembling pendingLayouts.
    const land =
      picked !== null &&
      store.seedCovers(picked) &&
      subPanel.visiblePaneOf(picked) === picked
        ? store.planNoteSeededActivation(picked)
        : store.planSetActiveSilently(picked);
    return () => {
      // Canvas layouts live on metadata — no client-side seeding needed, and
      // since the split's saved state (collapsed + divider) moved onto the
      // record too (`splitPanelState.ts`), neither does that: a tile reads both
      // off the record, so there is no window in which it holds something else.
      // The right panel's per-terminal record is read the same way; what is
      // seeded here is only its in-memory NAVIGATION history, which no record
      // carries.
      //
      // From `onSettled`, because `seedHistory` READS the panel's own
      // per-terminal state and this runs in an effect callback, which is a
      // strict-read window (`onSettled` is not). Nothing here is ordered
      // against it: the history is the panel's private navigation stack.
      onSettled(() => {
        for (const { t, m } of entries) {
          if (m.rightPanel) rightPanel.seedHistory(t.id);
        }
      });
      for (const { rootId, subId } of tabs) {
        subPanel.setActiveSubTab(rootId, subId);
      }
      land();
    };
  }

  function handleRestoreSession(
    options: { resumeAgents?: boolean; optOutIds?: readonly string[] } = {},
  ): UiAction {
    return Effect.suspend(() => {
      if (isRestoring()) return Effect.void;
      const session = savedSession();
      if (!session) return Effect.void;
      // Keep the restore card mounted until the server restore actually completes.
      // The card reads `savedSession` — the `session` cell, which still holds the
      // blob being consumed — so it stays put for the whole RPC with no local
      // answer of our own; `isRestoring()` is what disables its buttons. On success
      // the canvas replaces the empty state as the restored terminals arrive; on
      // failure the cell is untouched and the card is still there to retry.
      setIsRestoring(true);
      // The ACTIVE host's latch, captured BEFORE anything else so a mid-flight
      // host switch cannot misfile this restore's facts onto another host.
      const latch = activeScope()?.restore;
      // Open the restore WINDOW on it: the derived boot pick answers `null` until
      // the seed for THIS restore runs. Without it the pick reads a half
      // re-spawned census and names a tile the restore is about to replace — and
      // the pick is answered once, so that tile would stay the active one.
      latch?.beginRestore();
      // Re-arm the VIEW-STATE seed for THIS restore, on the ACTIVE host's latch. It
      // latches true on the first live load so a reconnect doesn't re-pan/re-seed the
      // canvas — but an in-session restore (the `recycleKaval` recycle→restore, no
      // page reload) is PRECISELY a re-seed event: every terminal is re-spawned (the
      // restore keeps each one's OWN id, but the panes behind them are new), and the
      // client view state for the restored tree — the active tile, the MRU, a
      // parent's active sub-tab — has not been seeded from THIS set of terminals.
      // Without this reset the hydration effect below short-circuits on the stale
      // latch and never runs `hydrateFromTerminals` for the restored terminals, so a
      // restored parent's active sub-tab is never set and its split comes back
      // HIDDEN. Clearing it here lets the effect re-seed once the restored terminals
      // arrive; it re-latches true after seeding, so a later reconnect is a no-op.
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
        latch?.endRestore();
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
              setIsRestoring(false);
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
          Effect.ensuring(
            Effect.sync(() => {
              setIsRestoring(false);
              // The restore WINDOW ends here only when nothing will seed from it:
              // a failure, a defect or an interrupt leaves no answer on the latch,
              // so the pick must be allowed to answer from the census again. A
              // SUCCESS has pinned `restoredActive`, and the window it opened is
              // closed by the seed that spends that answer (`markSeeded`) or by the
              // deadline that expires it — the restored terminals have not arrived
              // yet at this point, so releasing the pick here is exactly the
              // half-re-spawned census the window exists for.
              if (latch?.restoredActive == null) latch?.endRestore();
            }),
          ),
        );
    });
  }

  /** Explicit forfeit — the user chose "Start fresh" over the saved session.
   *  One server call discards the parked entries AND clears the saved session
   *  together (creating a terminal no longer forfeits implicitly, W1). The
   *  `null` snapshot the host pushes back is what dismisses the card — there is
   *  nothing here to clear, only `isForfeiting` to gate the buttons while the
   *  write is in flight (and to make a second click a no-op). */
  function handleForfeitSession(): UiAction {
    return Effect.suspend(() => {
      if (isForfeiting()) return Effect.void;
      const session = savedSession();
      if (!session) return Effect.void;
      setIsForfeiting(true);
      return activePadiRpc.session.forfeit({}).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            // Surface the failure — a caught error must not collapse silently to
            // the empty state. The card is still there (the host never cleared
            // the session), so the user can retry.
            toast.error(`Failed to start fresh: ${toError(err).message}`);
          }),
        ),
        Effect.ensuring(Effect.sync(() => setIsForfeiting(false))),
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
    isForfeiting,
    handleRestoreSession,
    handleForfeitSession,
  };
}
