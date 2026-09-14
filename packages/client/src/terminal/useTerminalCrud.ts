/** Terminal CRUD — create, kill, close-all, theme, copy text.
 *
 *  Every handler is an `Effect`, not a running call: the module DESCRIBES what a
 *  create or a kill is, and the UI edge (`runAction`) is what makes it happen.
 *  That is what lets `handleKillWithSubs` sequence N kills, `useWorktreeOps`
 *  branch on a discard's typed failure, and `useSessionRestore` abort its loop on
 *  a warming daemon — all as composition, with no `await` for an interruption to
 *  fail to reach through.
 *
 *  Server signals propagate list/metadata changes via the live subscriptions —
 *  no optimistic cache needed. */

import { TOPLEVEL_PLACEMENT } from "@kolu/padi-client/surface";
import type { TranscriptHtmlMode } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Data, Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { usePendingLayouts } from "../canvas/usePendingLayouts";
import { createSharedRoot } from "../createSharedRoot";
import { exportScrollbackAsPdf } from "../exportScrollbackAsPdf";
import { exportSessionAsHtml } from "../exportSessionAsHtml";
import { refuseIfWarming } from "../kaval/useDaemonStatus";
import { useRightPanel } from "../right-panel/useRightPanel";
import { runAction, type UiAction } from "../runAction";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { writeTextToClipboard } from "../ui/clipboard";
import { activePadiRpc } from "../wire";
import {
  createEvictionDedup,
  evictTerminal,
  type TerminalEvictionPorts,
} from "./useActiveReconcile";
import { useSubPanel } from "./useSubPanel";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";

/** The create was REFUSED before it reached the wire, or the wire refused it.
 *
 *  A typed failure rather than the old bare `throw new Error("daemon warming…")`:
 *  session restore's per-terminal loop depends on a refusal ABORTING the whole
 *  restore rather than half-creating, and `useWorktreeOps` depends on not
 *  proceeding to seed a worktree terminal that does not exist. Both now branch on
 *  the CHANNEL instead of on a message string.
 *
 *  `reason: "warming"` carries no toast (the daemon-warming banner already says
 *  it, and a restore loop would stack one per terminal); `reason: "failed"` is
 *  toasted at the call that produced it, before this value is raised. */
export class TerminalCreateRefused extends Data.TaggedError(
  "TerminalCreateRefused",
)<{ readonly reason: "warming" | "failed" }> {}

/** The sleeping record was NOT discarded — the server refused, and the failure is
 *  already toasted. Raised so the worktree-removal close path (F10) can refuse to
 *  delete a worktree whose terminal still points at it; the standalone
 *  close-confirm caller ignores it (`Effect.ignore`) because the toast is all it
 *  needed. Replaces the old `Promise<boolean>` — a boolean the compiler could not
 *  make anyone check. */
export class TerminalDiscardFailed extends Data.TaggedError(
  "TerminalDiscardFailed",
)<Record<string, never>> {}

/** Terminal CRUD — singleton via `createSharedRoot`. Reads `useTerminalStore`
 *  internally (no `deps` argument), so consumers that already touch the store
 *  — `TileTitleActions`, `TerminalContent` — can call `useTerminalCrud()`
 *  directly instead of receiving crud-derived closures drilled from App.tsx.
 *  Mirrors the `useIntentEditor` de-deps: the old `{ store }` argument was an
 *  unenforceable "deps never change identity" convention held by a comment. */
export const useTerminalCrud = createSharedRoot(() => {
  const store = useTerminalStore();
  const subPanel = useSubPanel();
  const terminalSearch = useTerminalSearch();
  const rightPanel = useRightPanel();
  const pendingLayouts = usePendingLayouts();
  const { showTipOnce } = useTips();

  // --- Handlers ---

  /** Toast `${prefix}: ${message}` for whatever failed, and RECOVER — the shape
   *  every "fire it, tell the user if it broke" handler below ends in. Named once
   *  so the wording rule (`.claude/rules/toast-conventions.md`: always surface
   *  `err.message`) is one function rather than fifteen copies. */
  const toastFailure =
    (prefix: string) =>
    <A, E>(self: Effect.Effect<A, E>): Effect.Effect<A | undefined, never> =>
      Effect.catch(self, (err) =>
        Effect.sync(() => {
          toast.error(`${prefix}: ${toError(err).message}`);
          return undefined;
        }),
      );

  /** Set a terminal's theme name on the server. */
  function setThemeName(id: TerminalId, name: string): UiAction {
    return activePadiRpc.chrome
      .setTheme({ id, themeName: name })
      .pipe(toastFailure("Failed to set theme"));
  }

  // The ONE cleanup body's side-effecting seams (see useActiveReconcile).
  // Wired once here; the imperative close path and the list-driven reconcile
  // both drive `evictTerminal` through these ports, so they can't diverge.
  //
  // The eviction ports are SYNCHRONOUS by contract (`evictTerminal` is a pure
  // reordering of local state that happens to re-home sub-terminals server-side),
  // so this one runs its effect at the seam rather than pushing the Effect shape
  // through a port type whose every other member is `void`.
  const setParent = (subId: TerminalId, parentId: TerminalId | null): void => {
    runAction(
      "re-home split",
      activePadiRpc.chrome
        .setParent({ id: subId, parentId })
        .pipe(toastFailure("Failed to set parent")),
    );
  };

  const evictionPorts: TerminalEvictionPorts = {
    activeId: store.activeId,
    focusedTerminalId: store.focusedTerminalId,
    activate: store.activate,
    dropFromMru: (id) => store.forgetFromMru(id),
    promoteToTopLevel: (subId) => setParent(subId, null),
    rehomeUnder: (subId, newParentId) => setParent(subId, newParentId),
    subPanel: {
      collapse: subPanel.collapsePanel,
      collapseChrome: subPanel.collapsePanelChrome,
      activeSubTab: (parentId) => subPanel.peekSubPanel(parentId).activeSubTab,
      setActiveSubTab: subPanel.setActiveSubTab,
      selectSubTab: subPanel.selectSubTab,
      requestRefocus: subPanel.requestRefocus,
      remove: subPanel.removePanel,
    },
    removeRightPanel: rightPanel.removePanel,
    removeSearch: terminalSearch.removeTerminal,
  };

  /** Intact parent graph at the moment of eviction — live for the imperative
   *  path (metadata still present), snapshot for the list-driven path. */
  function liveRemovalGraph() {
    const ids = store.listSub()?.map((t) => t.id) ?? [];
    return {
      ids,
      parentOf: (x: TerminalId) => {
        const m = store.getMetadata(x);
        if (m === undefined) return undefined;
        return m.parentId ?? null;
      },
    };
  }

  const eviction = createEvictionDedup(
    (id, parentId, topLevelBefore, departing, removal) =>
      evictTerminal(
        evictionPorts,
        id,
        parentId,
        topLevelBefore,
        departing,
        removal,
      ),
  );

  /** Remove a terminal and auto-switch if it was active — the IMPERATIVE close
   *  path (kill, discard). Runs synchronously with metadata still present, so it
   *  reads the live parentId + top-level order. Claims the id (when a list-drop
   *  will follow) so the later list-driven reconcile skips it — see
   *  `createEvictionDedup`. */
  function removeAndAutoSwitch(id: TerminalId) {
    eviction.evictImperatively(
      id,
      store.getMetadata(id)?.parentId ?? null,
      store.terminalIds(),
      store.getMetadata(id) !== undefined,
      liveRemovalGraph(),
    );
  }

  /** Create a new terminal on the server and make it active.
   *  Returns the new terminal ID.
   *
   *  This handler seeds NOTHING: the create carries a `cwd` and nothing else.
   *  The new-terminal THEME policy (inherit/shuffle) resolves in padi's
   *  `lifecycle.create`, from the policy cell kolu-server pushes, so every face
   *  — browser, MCP, CLI — obeys the same preference (#2045); and session
   *  restore seeds its saved metadata HOST-side through `restoreSpawn`, never
   *  through this handler. The old `initial` parameter is gone with its last
   *  live leg: every caller passed a bare `cwd`, so the type can no longer
   *  advertise options that have no effect (F6). */
  function handleCreate(
    cwd?: string,
  ): Effect.Effect<TerminalId, TerminalCreateRefused> {
    return Effect.gen(function* () {
      // The one create chokepoint — keyboard (`Cmd+T`/`Cmd+Enter`), palette
      // "New terminal", the Dock `+`, worktree ops, and session restore's
      // per-terminal creates all funnel here. Block while the daemon is warming
      // (boot `connecting` or a supervised `restarting`): the App.tsx canvas
      // gate only hides the EmptyState/Dock affordances, but the shortcut and
      // palette stay live over the neutral warming surface, so without this
      // guard a `Cmd+T` or palette create races the recycle — spawning a
      // terminal into the daemon the restart is about to kill (or against a
      // momentarily-stale `current` connection). Creation must wait for
      // `connected` (F3). A typed FAILURE (not a silent return) so the restore
      // loop aborts cleanly rather than half-creating.
      if (refuseIfWarming())
        return yield* new TerminalCreateRefused({ reason: "warming" });
      if (store.activeMeta()?.git) showTipOnce(CONTEXTUAL_TIPS.worktree);

      // Inherit the active tile's size for the new terminal. Set BEFORE
      // the create RPC — the server push during the call triggers the
      // canvas placement effect, which consumes the signal. If we set
      // after, the effect has already run with no size to inherit.
      //
      // Every create through here is the cascade-placed fresh-create path (a
      // server-seeded restore create runs host-side, not here), so the slot is
      // always the placement effect's to consume — and it is set
      // UNCONDITIONALLY (size, or `null` when there's no active tile to inherit
      // from), so a fresh create always OWNS the slot value rather than leaving
      // a stale size armed by an earlier create that no new tile consumed.
      //
      // Prefer the active tile's *pending* layout over its echoed metadata:
      // a just-resized tile's visible size lives in `pendingLayouts.pending`
      // until the server metadata echo catches up (`getLayout` reads only
      // the echo). Reading the echo alone would inherit the pre-resize size
      // when a create races the echo. `active()` bundles (id, meta) from one
      // glitch-free read.
      const { id: activeId, meta } = store.active();
      // `active()` bundles (id, meta): meta is null whenever id is null, so the
      // no-active-tile branch is just `undefined` — there's no metadata to read.
      const activeLayout = activeId
        ? pendingLayouts.resolveLayout(activeId, meta?.canvasLayout)
        : undefined;
      pendingLayouts.setNextDefaultSize(
        activeLayout ? { w: activeLayout.w, h: activeLayout.h } : null,
      );
      const info = yield* activePadiRpc.lifecycle
        // SPREAD, never `{ cwd }` (#17): `cwd` is `Schema.optionalKey` on the wire,
        // so an ABSENT key is accepted and a present-but-`undefined` one is
        // REJECTED — and "no cwd" is the ordinary case (a bare Cmd+T).
        //
        // `placement` is REQUIRED and stated, never spread: this handler IS the
        // top-level path — Cmd+T, the palette's "New terminal", the Dock `+`, the
        // EmptyState. The split path is `handleCreateSubTerminal` below, and it is a
        // different function precisely because the two make different canvas claims.
        .create({
          placement: TOPLEVEL_PLACEMENT,
          ...(cwd !== undefined && { cwd }),
        })
        .pipe(
          // `tapError`, deliberately NOT a finalizer: a finalizer runs on the
          // success path too, where it would race the deferred Solid effect that
          // consumes the pending size. A failed create produces no server push,
          // so the canvas effect will never consume the size — clear it here so a
          // stale one can't leak into a later create with no active tile to
          // overwrite it.
          Effect.tapError((err) =>
            Effect.sync(() => {
              pendingLayouts.setNextDefaultSize(null);
              toast.error(`Failed to create terminal: ${toError(err).message}`);
            }),
          ),
          Effect.mapError(
            () => new TerminalCreateRefused({ reason: "failed" }),
          ),
        );
      // `setActiveSilently`: the canvas's cascade-placement effect bumps
      // the centering signal once the new tile's pending layout is set —
      // calling `activate` here would race the layout and read undefined.
      store.setActiveSilently(info.id);
      showTipOnce(CONTEXTUAL_TIPS.themeSwitch);
      return info.id;
    });
  }

  function handleCreateSubTerminal(
    parentId: TerminalId,
    cwd?: string,
  ): Effect.Effect<void, TerminalCreateRefused> {
    return Effect.gen(function* () {
      // Split creation reaches `lifecycle.create` directly (not via
      // `handleCreate`), so it needs the same warming guard — the split
      // shortcut (Ctrl+`+Shift) and TileTitleActions stay live while warming.
      if (refuseIfWarming()) return;
      const info = yield* activePadiRpc.lifecycle
        // The placement is `child-of` by construction here — this function exists
        // only to open a split, and it is handed the parent. `cwd` is spread for the
        // #17 reason above (a split with no inherited cwd is the ordinary case).
        .create({
          placement: { kind: "child-of", parentId },
          ...(cwd !== undefined && { cwd }),
        })
        .pipe(
          Effect.tapError((err) =>
            Effect.sync(() => {
              toast.error(`Failed to create terminal: ${toError(err).message}`);
            }),
          ),
          Effect.mapError(
            () => new TerminalCreateRefused({ reason: "failed" }),
          ),
        );
      subPanel.focusSubTab(parentId, info.id);
    });
  }

  /** Toggle a terminal's split: create the first sub-terminal if none exist
   *  (seeded with the parent's cwd), otherwise flip the sub-panel's
   *  visibility. Moved out of App.tsx — it complected store + crud + sub-panel,
   *  all of which crud already orchestrates. */
  function toggleSubPanel(parentId: TerminalId): UiAction {
    // Flat pane set — a nested descendant already counts as "has splits".
    if (store.getSplitPaneIds(parentId).length === 0) {
      return handleCreateSubTerminal(
        parentId,
        store.activeMeta()?.cwd ?? undefined,
        // The refusal is already surfaced (a warming banner, or the create's own
        // toast); nothing here is waiting on the split.
      ).pipe(Effect.ignore);
    }
    return Effect.sync(() => subPanel.togglePanel(parentId));
  }

  function handleKill(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle.kill({ id }).pipe(
      // The terminal may already be gone — an ordinary outcome for a close, not
      // a failure to report.
      Effect.ignore,
      Effect.andThen(() => Effect.sync(() => removeAndAutoSwitch(id))),
    );
  }

  /** Kill a terminal and all its flat descendants (instead of promoting them). */
  function handleKillWithSubs(id: TerminalId): UiAction {
    return Effect.gen(function* () {
      // Sequential, not concurrent: the descendants' evictions re-home the
      // survivors, and doing that out of order reorders the canvas.
      for (const subId of store.getSplitPaneIds(id)) yield* handleKill(subId);
      yield* handleKill(id);
    });
  }

  /** Request sleep — the shared entry the ☾ tile button and the palette both
   *  call. Surfaces the one-time discoverability tip, and when the terminal has
   *  splits, confirms via an action toast before closing them (a sleeping record
   *  is a single terminal — splits must not vanish silently, the §2
   *  non-negotiable). No splits → sleep straight away. */
  function requestSleep(id: TerminalId): UiAction {
    return Effect.suspend(() => {
      showTipOnce(CONTEXTUAL_TIPS.sleepTerminal);
      const subs = store.getSplitPaneIds(id).length;
      if (subs > 0) {
        toast.warning(`Sleeping closes ${subs} split${subs > 1 ? "s" : ""}`, {
          duration: Number.POSITIVE_INFINITY,
          action: {
            label: "Sleep & close splits",
            // The toast's button is its OWN edge — this program is long over by
            // the time the user clicks it, so the confirm forks a fresh one.
            onClick: () => runAction("sleep terminal", handleSleep(id)),
          },
        });
        return Effect.void;
      }
      return handleSleep(id);
    });
  }

  /** Sleep a terminal: close its splits first (a sleeping record is a single
   *  terminal — sub-terminals are CLOSED, not frozen), then flip it to the
   *  dormant arm on the server. The tile STAYS (now dormant) — no
   *  `removeAndAutoSwitch`; the metadata subscription re-renders it frozen with a
   *  Wake call-to-action. Reached through `requestSleep` (which confirms splits). */
  function handleSleep(id: TerminalId): UiAction {
    return Effect.gen(function* () {
      for (const subId of store.getSplitPaneIds(id)) yield* handleKill(subId);
      yield* activePadiRpc.lifecycle
        .sleep({ id })
        .pipe(toastFailure("Failed to sleep terminal"));
    });
  }

  /** Wake a sleeping terminal: the server re-spawns its PTY on the same id and
   *  resumes its agent (session-restore-of-one). The metadata subscription flips
   *  it back to active and the tile re-renders live — so the client just asks. */
  function handleWake(id: TerminalId): UiAction {
    return activePadiRpc.lifecycle
      .wake({ id })
      .pipe(toastFailure("Failed to wake terminal"));
  }

  /** Discard a sleeping terminal — remove its record (no PTY to kill, sleep
   *  released it) and auto-switch away. The close-path twin of `handleKill` for
   *  the dormant arm; reached from the reworded close-confirm dialog.
   *
   *  Surfaces a genuine discard failure (network / server error) in a toast and
   *  does NOT evict the tile locally (F4): swallowing every error and removing
   *  anyway would make a failed discard look successful and desync the UI from
   *  the still-present server record. The server's `discardSleeping` is a no-op
   *  on an already-gone id (it returns without throwing), so the common
   *  already-removed case resolves cleanly and the tile evicts as before.
   *
   *  FAILS with {@link TerminalDiscardFailed} on a surfaced failure — the
   *  worktree-removal close path (F10) must NOT delete the worktree when the
   *  sleeping record wasn't actually discarded, or the still-present terminal
   *  would point at a removed cwd, and an error channel is a fact the compiler
   *  tracks where the old `Promise<boolean>` was one a caller could forget to
   *  read. The standalone close-confirm caller `Effect.ignore`s it (the toast is
   *  all it needed). */
  function handleDiscard(
    id: TerminalId,
  ): Effect.Effect<void, TerminalDiscardFailed> {
    return activePadiRpc.lifecycle.discardSleeping({ id }).pipe(
      Effect.tapError((err) =>
        Effect.sync(() => {
          toast.error(`Failed to discard terminal: ${toError(err).message}`);
        }),
      ),
      Effect.mapError(() => new TerminalDiscardFailed({})),
      Effect.tap(() => Effect.sync(() => removeAndAutoSwitch(id))),
    );
  }

  function handleCopyTerminalText(): UiAction {
    return Effect.gen(function* () {
      const id = store.focusedId();
      if (id === null) return;
      const text = yield* activePadiRpc.screen.text({ id }).pipe(
        Effect.catch((err) =>
          Effect.sync((): string | undefined => {
            console.error("Failed to read terminal text:", err);
            toast.error(
              `Failed to read terminal text: ${toError(err).message}`,
            );
            return undefined;
          }),
        ),
      );
      // The read failed and said so — there is nothing to put on the clipboard.
      if (text === undefined) return;
      yield* writeTextToClipboard(text).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Copied terminal text to clipboard")),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            console.error("Failed to copy terminal text:", err);
            toast.error(
              `Failed to copy terminal text: ${toError(err).message}`,
            );
          }),
        ),
      );
    });
  }

  /** Copy the focused terminal's id to the clipboard — the value
   *  `kaval-tui attach <id>` takes to grab this exact PTY from a shell. Each
   *  split is its own PTY with its own id, so this copies the focused pane's,
   *  matching `handleCopyTerminalText`'s `focusedId()`. */
  function handleCopyTerminalId(): UiAction {
    return Effect.suspend(() => {
      const id = store.focusedId();
      if (id === null) return Effect.void;
      return writeTextToClipboard(id).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Copied terminal ID to clipboard")),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            console.error("Failed to copy terminal ID:", err);
            toast.error(`Failed to copy terminal ID: ${toError(err).message}`);
          }),
        ),
      );
    });
  }

  /** Write a command line into the active terminal WITHOUT pressing Enter.
   *  Used by the "Recent agents" palette entry to prefill a previously
   *  seen agent CLI — the user reviews/edits and hits Enter themselves.
   *  No-op if no terminal is active. */
  function handleRunInActiveTerminal(command: string): UiAction {
    return Effect.suspend(() => {
      const id = store.focusedId();
      if (id === null) return Effect.void;
      return activePadiRpc.lifecycle
        .sendInput({ id, data: command })
        .pipe(toastFailure("Failed to prefill command"));
    });
  }

  function handleCloseAll(): UiAction {
    return activePadiRpc.lifecycle.killAll().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          store.reset();
          // killAll bypasses removeAndAutoSwitch's per-terminal eviction, so
          // clear the find-bar map wholesale here too — otherwise stale keys
          // outlive the terminals they pointed at.
          terminalSearch.reset();
        }),
      ),
      toastFailure("Failed to close all terminals"),
    );
  }

  /** Export the active terminal's scrollback as a PDF. Resolves the active id
   *  and null-guards here so the shell doesn't thread `store.*` into the export
   *  feature — an active-terminal-keyed op like the rest of crud. */
  function exportScrollbackPdf() {
    const id = store.activeId();
    if (id === null) return;
    exportScrollbackAsPdf(id, store.getMetadata(id));
  }

  /** Export the active terminal's session as a standalone HTML page. */
  function exportSessionHtml(
    modes: [TranscriptHtmlMode, ...TranscriptHtmlMode[]],
  ): UiAction {
    return Effect.suspend(() => {
      const id = store.activeId();
      if (id === null) return Effect.void;
      return exportSessionAsHtml(id, modes);
    });
  }

  return {
    setThemeName,
    removeAndAutoSwitch,
    /** List-driven cleanup for a naturally-departed terminal (dedup-guarded).
     *  Wired into the reconcile in useTerminals. */
    evictDeparted: eviction.evictDeparted,
    handleCreate,
    handleCreateSubTerminal,
    toggleSubPanel,
    handleKill,
    handleKillWithSubs,
    requestSleep,
    handleSleep,
    handleWake,
    handleDiscard,
    handleCopyTerminalText,
    handleCopyTerminalId,
    handleRunInActiveTerminal,
    handleCloseAll,
    exportScrollbackPdf,
    exportSessionHtml,
  };
});
