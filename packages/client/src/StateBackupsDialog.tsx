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
 *  Restore semantics differ by store, and the confirm copy says so:
 *   - padi: the snapshot's session is re-spawned host-side through the same
 *     import machinery as "Import session" — live terminals stay, the backup's
 *     terminals come back beside them. No daemon restart.
 *   - kolu-server: preferences/viewerMode apply live through their cells and
 *     the host pool converges onto the snapshot's fleet. No server restart.
 *  Both push the current state into the ring first, so a restore is itself
 *  undoable (pick the pre-restore snapshot to go back).
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
import { hostLabel } from "./host/hostChipTone";
import { runAction, runActionPromise, type UiAction } from "./runAction";
import { formatTimeAgo } from "./terminal/staleness";
import { createDisclosure } from "./ui/createDisclosure";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { client, hostKeys, padiMap } from "./wire";

/** State-backups open-state — the component owns it. Opened from the command
 *  palette's Debug group. */
export const stateBackupsDialog = createDisclosure();

const chrome = surface({ portalled: true });

/** WHICH ring is being browsed — kolu-server's own store, or one host's padi. */
type BackupStore = { kind: "kolu" } | { kind: "padi"; host: HostKey };

/** A snapshot row, normalized across the two stores' wire shapes. */
interface BackupRow {
  file: string;
  /** Reprojected onto the BROWSER clock already (a remote padi's mtime rides
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

function storeTitle(store: BackupStore): string {
  return store.kind === "kolu"
    ? "kolu-server"
    : `padi — ${hostLabel(store.host)}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fetchBackups(store: BackupStore): Promise<BackupRow[]> {
  if (store.kind === "kolu") {
    return runActionPromise(
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
    );
  }
  const entry = padiMap.entry(store.host);
  return runActionPromise(
    entry.procedures.backups.list().pipe(
      Effect.map((r) =>
        r.backups.map((b) => ({
          file: b.file,
          // The foreign-clock fence: a remote padi's mtime is ITS clock.
          savedAtMs: entry.clock.toLocal(b.savedAtMs),
          sizeBytes: b.sizeBytes,
          summary:
            b.summary.kind === "session"
              ? `${b.summary.terminals} ${b.summary.terminals === 1 ? "terminal" : "terminals"}`
              : b.summary.kind === "empty"
                ? "no session"
                : "unreadable",
          restorable: b.summary.kind === "session",
        })),
      ),
    ),
  );
}

const StateBackupsDialog: Component = () => {
  const [selected, setSelected] = createSignal<BackupStore | null>(null);
  const [pending, setPending] = createSignal<BackupRow | null>(null);
  const [inFlight, setInFlight] = createSignal(false);
  const [backups, { refetch }] = createResource(
    () => (stateBackupsDialog.open() ? selected() : null),
    fetchBackups,
  );

  const close = (open: boolean) => {
    stateBackupsDialog.onOpenChange(open);
    if (!open) {
      setSelected(null);
      setPending(null);
    }
  };

  /** The restore act — loading/success/error toast round-trip per
   *  `.claude/rules/toast-conventions.md`, re-entry-guarded like the import
   *  action (a double click must not restore twice). */
  const restore = (store: BackupStore, row: BackupRow): UiAction =>
    Effect.suspend(() => {
      if (inFlight()) return Effect.void;
      setInFlight(true);
      const id = toast.loading(
        `Restoring ${storeTitle(store)} from ${formatTimeAgo(row.savedAtMs) || row.file}…`,
      );
      const call =
        store.kind === "kolu"
          ? client.server.backups.restore({ file: row.file })
          : padiMap
              .entry(store.host)
              .procedures.backups.restore({ file: row.file });
      return call.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            toast.success(`Restored ${storeTitle(store)} (${row.summary})`, {
              id,
            });
            setPending(null);
            void refetch();
          }),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Restore failed: ${toError(err).message}`, { id });
          }),
        ),
        Effect.ensuring(Effect.sync(() => setInFlight(false))),
      );
    });

  const padiConnected = (host: HostKey) =>
    padiMap.entry(host).state().kind === "connected";

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
          <Show when={selected()}>
            <button
              type="button"
              class="text-[11px] text-accent hover:underline"
              onClick={() => {
                setSelected(null);
                setPending(null);
              }}
            >
              ← Stores
            </button>
          </Show>
        </div>

        {/* Store picker — one row per ring. */}
        <Show when={selected() === null}>
          <div class="space-y-1.5">
            <button
              type="button"
              class="w-full rounded-lg border border-edge bg-surface-1 px-3 py-2 text-left hover:border-accent/40"
              onClick={() => setSelected({ kind: "kolu" })}
            >
              <div class="font-medium text-fg">kolu-server</div>
              <div class="text-[11px] text-fg-3">
                preferences · hosts · this machine
              </div>
            </button>
            <For each={hostKeys()}>
              {(host) => (
                <button
                  type="button"
                  class="w-full rounded-lg border border-edge bg-surface-1 px-3 py-2 text-left hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!padiConnected(host)}
                  onClick={() => setSelected({ kind: "padi", host })}
                >
                  <div class="font-medium text-fg">
                    padi — {hostLabel(host)}
                  </div>
                  <div class="text-[11px] text-fg-3">
                    {padiConnected(host)
                      ? "session · terminals"
                      : // Offer only what the channel can carry out (#1793).
                        `unreachable (${padiMap.entry(host).state().kind})`}
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Snapshot list for the selected store. */}
        <Show when={selected()}>
          {(store) => (
            <div class="space-y-1.5">
              <div class="text-[11px] text-fg-3">{storeTitle(store())}</div>
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
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="font-medium text-fg">
                          {formatTimeAgo(row.savedAtMs) || "—"}
                          <span class="ml-2 text-[11px] font-normal text-fg-3">
                            {row.summary} · {formatSize(row.sizeBytes)}
                          </span>
                        </div>
                        <div class="truncate font-mono text-[10px] text-fg-3">
                          {row.file}
                        </div>
                      </div>
                      <Show when={row.restorable}>
                        <button
                          type="button"
                          class="shrink-0 rounded-md border border-edge px-2 py-1 text-[11px] text-fg hover:border-accent/40 disabled:opacity-50"
                          disabled={inFlight()}
                          onClick={() => setPending(row)}
                        >
                          Restore…
                        </button>
                      </Show>
                    </div>
                    {/* Inline confirm — states exactly what will happen. */}
                    <Show when={pending()?.file === row.file}>
                      <div class="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-[11px] text-fg-2">
                        <p>
                          {store().kind === "padi"
                            ? `Restore ${row.summary} from this snapshot? They re-spawn beside any current terminals; nothing is killed.`
                            : "Restore preferences and converge the host pool onto this snapshot? Applies live — no restart."}{" "}
                          The current state is snapshotted first, so this is
                          undoable.
                        </p>
                        <div class="mt-1.5 flex gap-2">
                          <button
                            type="button"
                            class="rounded-md border border-warning/50 bg-warning/20 px-2 py-0.5 font-medium text-fg hover:bg-warning/30 disabled:opacity-50"
                            disabled={inFlight()}
                            onClick={() =>
                              runAction(
                                "restore state backup",
                                restore(store(), row),
                              )
                            }
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            class="rounded-md border border-edge px-2 py-0.5 text-fg-2 hover:border-accent/40"
                            onClick={() => setPending(null)}
                          >
                            Cancel
                          </button>
                        </div>
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
