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
import { formatSize } from "./ui/memory";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { client, hostKeys, padiMap } from "./wire";

export const stateBackupsDialog = createDisclosure();

const chrome = surface({ portalled: true });

interface BackupRow {
  file: string;
  savedAtLocalMs: number | null;
  sizeBytes: number;
  summary: string;
  restorable: boolean;
}

type RestoreOutcome =
  | { kind: "restored" }
  | { kind: "degraded"; detail: string };

interface StoreAdapter {
  key: string;
  title: string;
  subtitle: string;
  available: boolean;
  list: () => Promise<BackupRow[]>;
  restore: (file: string) => Effect.Effect<RestoreOutcome, unknown>;
  confirmCopy: (row: BackupRow) => string;
}

const UNDOABLE = "The current state is snapshotted first, so this is undoable.";

const koluStore: StoreAdapter = {
  key: "kolu",
  title: "kolu-server",
  subtitle: "preferences · hosts · the Conductor's works",
  available: true,
  list: () =>
    runActionPromise(
      client.server.backups.list().pipe(
        Effect.map((r) =>
          r.backups.map((b) => ({
            file: b.file,
            savedAtLocalMs: b.savedAtMs,
            sizeBytes: b.sizeBytes,
            summary:
              b.summary.kind === "state"
                ? `preferences · ${b.summary.hosts} ${b.summary.hosts === 1 ? "host" : "hosts"} · ${b.summary.works} ${b.summary.works === 1 ? "work" : "works"}`
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
    `Restore preferences, the host pool and the Conductor's works from this snapshot? Applies live — no restart. Not in backups: the conversation, kept files. ${UNDOABLE}`,
};

const padiStore = (host: HostKey): StoreAdapter => {
  const entry = () => padiMap.entry(host);
  return {
    key: `padi:${host}`,
    title: `padi — ${hostLabel(host)}`,
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
                savedAtLocalMs: entry().clock.toLocal(b.savedAtMs),
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

  const restore = (store: StoreAdapter, row: BackupRow): UiAction =>
    Effect.suspend(() => {
      if (view().kind === "restoring") return Effect.void;
      setView({ kind: "restoring", store, row });
      const id = toast.loading(
        `Restoring ${store.title} from ${formatTimeAgo(row.savedAtLocalMs) || row.file}…`,
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
                        {formatTimeAgo(row.savedAtLocalMs) || "—"}
                        <span class="ml-2 text-[11px] font-normal text-fg-3">
                          {row.summary} · {formatSize(row.sizeBytes)}
                        </span>
                      </div>
                      <div class="truncate font-mono text-[10px] text-fg-3">
                        {row.file}
                      </div>
                    </div>
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
