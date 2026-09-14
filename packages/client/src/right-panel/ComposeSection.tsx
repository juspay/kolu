/** ComposeSection — the Inspector's "draft a prompt, then send it to the
 *  terminal" affordance. A multiline textarea over a Send button: type (or
 *  paste) a draft, hit Send (or ⌘/Ctrl+Enter), and the text is written into
 *  the active terminal's PTY — the in-app analog of `kaval-tui send`.
 *
 *  Two deliberate behaviors:
 *  - **Insert, don't submit.** Send writes the draft and stops; it never
 *    presses Enter for you (a same-breath Enter races a bracketed-paste TUI's
 *    paste debounce — see `composeSend.ts`). The draft lands in the agent's
 *    input box and you press Enter there. This mirrors `handleRunInActive
 *    Terminal`, which likewise prefills without submitting.
 *  - **Per-terminal, persisted draft.** Each terminal keeps its own draft in
 *    `localStorage`, so a half-written prompt survives tab switches and page
 *    reloads. The parent keys this component on `terminalId` (see
 *    MetadataInspector), so a fresh instance mounts per terminal and its
 *    persisted signal binds to that terminal's key — no shared-store bookkeeping.
 *
 *  Target: `props.terminalId` is the active tile's main terminal (the same
 *  target the Attach section's "Main" card names). Splits keep the CLI `send`
 *  command in that section. The parent gates this on the ACTIVE arm, so the
 *  target is always a live PTY — `sendInput` would otherwise quiet-drop. */

import { activeArm } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";
import { persistedPref } from "../persistedPref";
import { runAction, type UiAction } from "../runAction";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activePadiRpc } from "../wire";
import { planComposeSend } from "./composeSend";

/** `localStorage` key prefix for the per-terminal draft — same
 *  `kolu:<feature>-by-terminal:<id>` shape the comments store uses.
 *
 *  The key is deliberately NOT evicted on terminal close: a terminal that is
 *  slept and later restored keeps the SAME id (session restore), so its draft
 *  must survive to be there on return — the same reason `useComments` leaves
 *  its `kolu:comments-by-terminal:<id>` entry in place. Each draft is a small
 *  string bounded by the terminals opened in one session, and eager eviction
 *  would defeat the survives-restore guarantee this feature exists for; the
 *  compose box does not own the terminal lifecycle to hook a real deletion. */
const DRAFT_STORAGE_PREFIX = "kolu:compose-draft-by-terminal:";

const ComposeSection: Component<{
  terminalId: TerminalId;
}> = (props) => {
  const store = useTerminalStore();
  // Is the SEND TARGET (`props.terminalId`) still an active, PTY-holding
  // terminal? Resolved from the store BY THAT id — exactly as `Terminal.tsx`
  // gates `deliverScratchPaste` (`activeArm(terminalStore.getMetadata(props
  // .terminalId))`) — so an in-flight send re-checks the terminal it wrote to,
  // NOT whichever tile the inspector happens to show when the RPC resolves. A
  // parent closure over the inspector's current `meta()` would read the wrong
  // terminal the moment the user switches tiles mid-send.
  const isActive = () =>
    activeArm(store.getMetadata(props.terminalId)) !== undefined;
  // The draft IS a raw string, so `parse`/`serialize` are identity — there is
  // no shape to validate and an empty string is the natural never-drafted
  // fallback. `persistedPref`'s `parse` can never throw here, so the fallback
  // is reached only on a genuinely empty store, not on corruption.
  const [draft, setDraft] = persistedPref<string>({
    name: `${DRAFT_STORAGE_PREFIX}${props.terminalId}`,
    fallback: "",
    parse: (raw) => raw,
  });
  const [sending, setSending] = createSignal(false);
  // Quiet-at-rest: an empty, unfocused box is ONE line (an empty 6-row box was
  // the first thing on the panel); focus or a live draft expands it. The
  // footer (hint + Send) keys off `expanded` too — but a NON-EMPTY draft keeps
  // it mounted through blur, so the mousedown-blur that precedes a Send click
  // can never unmount the button out from under the click it started.
  const [focused, setFocused] = createSignal(false);
  const expanded = () => focused() || draft() !== "";

  // Reactive on `draft()`, so the button disables live as the box empties.
  const canSend = () => planComposeSend(draft()) !== null;

  function send(): UiAction {
    return Effect.suspend(() => {
      // Re-entry guard: ⌘/Ctrl+Enter fires on the textarea even while a send is
      // pending (the disabled BUTTON blocks the click path, not the key path),
      // so without this a fast double-chord would dispatch two writes.
      if (sending()) return Effect.void;
      const data = planComposeSend(draft());
      if (data === null) return Effect.void;
      // Capture the exact text being sent, so the success path clears ONLY this
      // draft — if the user keeps typing during the in-flight RPC, their newer
      // text must survive rather than be wiped by a stale send's completion.
      const sent = draft();
      setSending(true);
      return activePadiRpc.lifecycle
        .sendInput({ id: props.terminalId, data })
        .pipe(
          Effect.andThen(() =>
            Effect.suspend(() => {
              // `sendInput` is `getActiveTerminal(id)?.handle.write(...)`
              // server-side — the `?.` QUIET-DROPS (succeeds, no failure) if the
              // arm slept between the click and this answer, so a successful
              // call does NOT confirm delivery. Re-check liveness and FAIL into
              // the recovery below, exactly as `deliverScratchPaste` does, so an
              // unconfirmed write preserves the draft and toasts instead of
              // erasing text that never arrived.
              if (!isActive())
                return Effect.fail(
                  new Error("terminal no longer active — draft not sent"),
                );
              // Confirmed live — clear the draft, but only if it still holds
              // exactly what we sent (an edit that landed during the call keeps
              // the newer text). The sent text now lives in the agent's
              // (unsubmitted) input line, which the server-side PTY holds across
              // reloads, so nothing is lost.
              if (draft() === sent) setDraft("");
              return Effect.void;
            }),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(
                `Failed to send to terminal: ${toError(err).message}`,
              );
            }),
          ),
          Effect.ensuring(Effect.sync(() => setSending(false))),
        );
    });
  }

  return (
    <div class="space-y-1.5">
      <textarea
        data-testid="compose-input"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter submits — a plain Enter stays a newline so the box
          // can hold a multiline draft.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            runAction("send to terminal", send());
          }
        }}
        rows={expanded() ? 4 : 1}
        placeholder="Draft a prompt for the agent… ⌘⏎ to send"
        class="w-full rounded-md border border-edge bg-surface-1/30 px-2 py-1.5 text-[11px] font-mono text-fg leading-relaxed placeholder:text-fg-3/40 focus:outline-none focus:border-accent/60"
        classList={{ "resize-y": expanded(), "resize-none": !expanded() }}
      />
      <Show when={expanded()}>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] leading-snug text-fg-3/50">
            Inserts into the terminal — press Enter there to submit
          </span>
          <button
            type="button"
            data-testid="compose-send"
            disabled={!canSend() || sending()}
            onClick={() => runAction("send to terminal", send())}
            class="shrink-0 rounded-md border border-accent/30 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send&nbsp;→
          </button>
        </div>
      </Show>
    </div>
  );
};

export default ComposeSection;
