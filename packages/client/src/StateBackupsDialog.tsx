/** StateBackupsDialog — browse and restore the state-backup rings (#1658).
 *
 *  Opened from the command palette's Debug group. One row per STORE — the
 *  kolu-server config store (preferences · hosts) plus each pool host's padi
 *  store (the session) — because each store keeps its own ring on its own
 *  disk: a remote host's backups live on that box, reached through the same
 *  per-host map client every other padi call rides. Drilling into a store
 *  lists its snapshots newest-first with the summary a user actually ranks by
 *  (after a corruption incident the newest snapshots are often the corrupt
 *  ones — "14 terminals" vs "no session" is how the good one is spotted), and
 *  restoring asks an explicit inline confirm first.
 *
 *  The two stores differ in five ways — title, reachability, how a wire row
 *  becomes a `BackupRow`, which call restores, and what the confirm says — and
 *  those five differences are spelled ONCE, in a {@link StoreAdapter} per store.
 *  Everything else (the picker, the list, the confirm, the toast round-trip) is
 *  written once against the adapter, so a third ring is one more adapter rather
 *  than five more branches:
 *   - padi: the snapshot's session is re-spawned host-side through the same
 *     import machinery as "Import session" — live terminals stay, the backup's
 *     terminals come back beside them. No daemon restart.
 *   - kolu-server: preferences/viewerMode apply live through their cells and
 *     the host pool converges onto the snapshot's fleet. No server restart.
 *  Both push the current state into the ring first, so a restore is itself
 *  undoable (pick the pre-restore snapshot to go back) — and the server refuses
 *  the restore outright if that snapshot could not be taken, so the promise
 *  cannot lie.
 *
 *  A padi row is disabled while its host is not `connected` — the dialog must
 *  not offer an action the channel cannot carry out (the #1793 affordance
 *  axis, same rule as the palette's "Restart kaval"). */

import Dialog from "@corvu/dialog";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import {
  type Component,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { hostLabel } from "./host/hostChipTone";
import { runAction, runActionPromise, type UiAction } from "./runAction";
import { formatTimeAgo } from "./terminal/staleness";
import { createDisclosure } from "./ui/createDisclosure";
import InlineConfirmButton from "./ui/InlineConfirmButton";
import { formatMB } from "./ui/memory";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { client, hostKeys, padiMap } from "./wire";

/** State-backups open-state — the component owns it. Opened from the command
 *  palette's Debug group. */
export const stateBackupsDialog = createDisclosure();

const chrome = surface({ portalled: true });

/** A snapshot row, normalized across the two stores' wire shapes. */
interface BackupRow {
  file: string;
  /** Reprojected onto the BROWSER clock already (a remote padi's stamp rides
   *  its own clock — `padiMap.entry(host).clock.toLocal` is the foreign-clock
   *  fence, applied at fetch). `null` while that entry's clock offset is not
   *  yet measured — rendered as "—", never a fabricated time. */
  savedAtMs: number | null;
  sizeBytes: number;
  summary: string;
  /** Only a snapshot with something to restore offers the verb — a `no
   *  session` / `unreadable` snapshot renders but cannot be picked. */
  restorable: boolean;
}

/** How a restore ENDED. Not every non-throw is a clean success: kolu-server's
 *  restore applies the cells and then converges the host pool, so a host that
 *  would not dial leaves the state restored and the fleet short — a degraded
 *  outcome (`toast.warning` per `.claude/rules/toast-conventions.md`), not the
 *  self-contradicting "Restore failed: state restored, but…" the error channel
 *  used to force. */
type RestoreOutcome =
  | { kind: "restored" }
  | { kind: "degraded"; detail: string };

/** The five things that differ between the two rings, spelled once per store. */
interface StoreAdapter {
  /** `For`-key and resource identity. */
  key: string;
  title: string;
  subtitle: string;
  /** Is the store reachable right now? A padi ring lives on ITS host. */
  available: boolean;
  list: () => Promise<BackupRow[]>;
  restore: (file: string) => Effect.Effect<RestoreOutcome, unknown>;
  confirmCopy: (row: BackupRow) => string;
}

const UNDOABLE = "The current state is snapshotted first, so this is undoable.";

const koluStore: StoreAdapter = {
  key: "kolu",
  title: "kolu-server",
  subtitle: "preferences · hosts · this machine",
  available: true,
  list: () =>
    runActionPromise(
      client.server.backups.list().pipe(
        Effect.map((r) =>
          r.backups.map((b) => ({
            file: b.file,
            savedAtMs: b.savedAtMs,
            sizeBytes: b.sizeBytes,
            summary:
              b.summary.kind === "state"
                ? `preferences · ${b.summary.hosts} ${b.summary.hosts === 1 ? "host" : "hosts"}`
                : "unreadable",
            restorable: b.summary.kind === "state",
          })),
        ),
      ),
    ),
  restore: (file) =>
    client.server.backups.restore({ file }).pipe(
      Effect.map(
        (r): RestoreOutcome =>
          r.hostFailures.length === 0
            ? { kind: "restored" }
            : {
                kind: "degraded",
                detail: `${r.hostFailures.length} host(s) did not reconnect: ${r.hostFailures.join("; ")}`,
              },
      ),
    ),
  confirmCopy: () =>
    `Restore preferences and converge the host pool onto this snapshot? Applies live — no restart. ${UNDOABLE}`,
};

const padiStore = (host: HostKey): StoreAdapter => {
  const entry = () => padiMap.entry(host);
  return {
    key: `padi:${host}`,
    title: `padi — ${hostLabel(host)}`,
    // Offer only what the channel can carry out (#1793).
    subtitle:
      entry().state().kind === "connected"
        ? "session · terminals"
        : `unreachable (${entry().state().kind})`,
    available: entry().state().kind === "connected",
    list: () =>
      runActionPromise(
        entry()
          .procedures.backups.list()
          .pipe(
            Effect.map((r) =>
              r.backups.map((b) => ({
                file: b.file,
                // The foreign-clock fence: a remote padi's stamp is ITS clock.
                savedAtMs: entry().clock.toLocal(b.savedAtMs),
                sizeBytes: b.sizeBytes,
                summary: match(b.summary)
                  .with(
                    { kind: "session" },
                    (s) =>
                      `${s.terminals} ${s.terminals === 1 ? "terminal" : "terminals"}`,
                  )
                  .with({ kind: "empty" }, () => "no session")
                  .with({ kind: "unreadable" }, () => "unreadable")
                  .exhaustive(),
                restorable: b.summary.kind === "session",
              })),
            ),
          ),
      ),
    restore: (file) =>
      entry()
        .procedures.backups.restore({ file })
        .pipe(Effect.map((): RestoreOutcome => ({ kind: "restored" }))),
    confirmCopy: (row) =>
      `Restore ${row.summary} from this snapshot? They re-spawn beside any current terminals; nothing is killed. ${UNDOABLE}`,
  };
};

/** The dialog's ONE state. Three states, one signal — `pending`/`inFlight`/
 *  `selected` as three independent cells admitted combinations that mean
 *  nothing (a pending row with no store, an in-flight restore with the row
 *  already cleared), and made `close` remember to clear two of three. The
 *  confirm step itself is `InlineConfirmButton`'s, per row. */
type View =
  | { kind: "stores" }
  | { kind: "list"; store: StoreAdapter }
  | { kind: "restoring"; store: StoreAdapter; row: BackupRow };

const StateBackupsDialog: Component = () => {
  const [view, setView] = createSignal<View>({ kind: "stores" });
  const stores = (): StoreAdapter[] => [
    koluStore,
    ...hostKeys().map((host) => padiStore(host)),
  ];
  const browsing = (): StoreAdapter | null => {
    const v = view();
    return v.kind === "stores" ? null : v.store;
  };
  const [backups, { refetch }] = createResource(
    () => (stateBackupsDialog.open() ? browsing() : null),
    (store: StoreAdapter) => store.list(),
  );

  const close = (open: boolean) => {
    stateBackupsDialog.onOpenChange(open);
    if (!open) setView({ kind: "stores" });
  };

  /** The restore act — loading/success/error toast round-trip per
   *  `.claude/rules/toast-conventions.md`, re-entry-guarded like the import
   *  action (a double click must not restore twice). Written once: the two
   *  stores differ only in the adapter's `restore`. */
  const restore = (store: StoreAdapter, row: BackupRow): UiAction =>
    Effect.suspend(() => {
      if (view().kind === "restoring") return Effect.void;
      setView({ kind: "restoring", store, row });
      const id = toast.loading(
        `Restoring ${store.title} from ${formatTimeAgo(row.savedAtMs) || row.file}…`,
      );
      return store.restore(row.file).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (outcome.kind === "restored") {
              toast.success(`Restored ${store.title} (${row.summary})`, { id });
            } else {
              toast.warning(`Restored ${store.title} — ${outcome.detail}`, {
                id,
              });
            }
            void refetch();
          }),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Restore failed: ${toError(err).message}`, { id });
          }),
        ),
        Effect.ensuring(Effect.sync(() => setView({ kind: "list", store }))),
      );
    });

  return (
    <ModalDialog
      open={stateBackupsDialog.open()}
      onOpenChange={close}
      refocusOnClose
      size="md"
    >
      <Dialog.Content
        class={`${chrome.class} p-5 text-sm`}
        style={chrome.style}
      >
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="font-semibold text-fg">State backups</span>
          <Show when={browsing()}>
            <button
              type="button"
              class="text-[11px] text-accent hover:underline"
              onClick={() => setView({ kind: "stores" })}
            >
              ← Stores
            </button>
          </Show>
        </div>

        {/* Store picker — one row per ring, from the one adapter list. */}
        <Show when={browsing() === null}>
          <div class="space-y-1.5">
            <For each={stores()}>
              {(store) => (
                <button
                  type="button"
                  class="w-full rounded-lg border border-edge bg-surface-1 px-3 py-2 text-left hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!store.available}
                  onClick={() => setView({ kind: "list", store })}
                >
                  <div class="font-medium text-fg">{store.title}</div>
                  <div class="text-[11px] text-fg-3">{store.subtitle}</div>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Snapshot list for the selected store. */}
        <Show when={browsing()}>
          {(store) => (
            <div class="space-y-1.5">
              <div class="text-[11px] text-fg-3">{store().title}</div>
              <Show when={backups.error}>
                <div class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
                  Failed to list backups: {toError(backups.error).message}
                </div>
              </Show>
              <Show when={backups.loading}>
                <div class="px-1 text-[11px] text-fg-3">Loading…</div>
              </Show>
              <Show
                when={
                  !backups.loading &&
                  (backups() ?? []).length === 0 &&
                  !backups.error
                }
              >
                <div class="px-1 text-[11px] text-fg-3">
                  No backups yet — a snapshot is taken at every boot (and
                  daily), once the store has content.
                </div>
              </Show>
              <For each={backups() ?? []}>
                {(row) => (
                  <div class="rounded-lg border border-edge bg-surface-1 px-3 py-2">
                    <div class="min-w-0">
                      <div class="font-medium text-fg">
                        {formatTimeAgo(row.savedAtMs) || "—"}
                        <span class="ml-2 text-[11px] font-normal text-fg-3">
                          {row.summary} · {formatMB(row.sizeBytes)}
                        </span>
                      </div>
                      <div class="truncate font-mono text-[10px] text-fg-3">
                        {row.file}
                      </div>
                    </div>
                    {/* The repo's canonical destructive-action affordance: it
                        owns the confirm step, the Cancel/confirm pair and the
                        `data-testid` triplet every other confirm exposes. */}
                    <Show when={row.restorable}>
                      <div class="mt-2">
                        <InlineConfirmButton
                          label="Restore"
                          inFlightLabel="Restoring…"
                          tone="warning"
                          confirmCopy={store().confirmCopy(row)}
                          inFlight={view().kind === "restoring"}
                          testid={`state-backup-restore-${row.file}`}
                          onConfirm={() =>
                            runAction(
                              "restore state backup",
                              restore(store(), row),
                            )
                          }
                        />
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default StateBackupsDialog;
