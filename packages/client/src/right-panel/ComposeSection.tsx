import { activeArm } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";
import { persistedPref } from "../persistedPref";
import { personInput } from "../conductor/personInput";
import { runAction, type UiAction } from "../runAction";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activePadiRpc } from "../wire";
import { planComposeSend } from "./composeSend";

const DRAFT_STORAGE_PREFIX = "kolu:compose-draft-by-terminal:";

const ComposeSection: Component<{
  terminalId: TerminalId;
}> = (props) => {
  const store = useTerminalStore();
  const isActive = () =>
    activeArm(store.getMetadata(props.terminalId)) !== undefined;
  const [draft, setDraft] = persistedPref<string>({
    name: `${DRAFT_STORAGE_PREFIX}${props.terminalId}`,
    fallback: "",
    parse: (raw) => raw,
  });
  const [sending, setSending] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const expanded = () => focused() || draft() !== "";

  const canSend = () => planComposeSend(draft()) !== null;

  const confirmDeliveredOrFail = (): Effect.Effect<void, Error> =>
    Effect.suspend(() =>
      isActive()
        ? Effect.void
        : Effect.fail(new Error("terminal no longer active — draft not sent")),
    );

  function send(): UiAction {
    return Effect.suspend(() => {
      if (sending()) return Effect.void;
      if (!personInput(props.terminalId)) return Effect.void;
      const data = planComposeSend(draft());
      if (data === null) return Effect.void;
      const sent = draft();
      setSending(true);
      return activePadiRpc.lifecycle
        .sendInput({ id: props.terminalId, data })
        .pipe(
          Effect.andThen(confirmDeliveredOrFail),
          Effect.andThen(() =>
            Effect.sync(() => {
              if (draft() === sent) setDraft("");
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
