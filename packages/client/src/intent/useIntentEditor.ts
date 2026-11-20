import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runAction } from "../runAction";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activePadiRpc } from "../wire";

export type IntentEditorSession = {
  title: string;
  initialValue: string;
  save: (intent: string) => void;
  clear?: () => void;
};

function init() {
  const store = useTerminalStore();
  const [session, setSession] = createSignal<IntentEditorSession | null>(null);

  const close = () => setSession(null);

  const writeIntent = (id: TerminalId, intent: string) => {
    runAction(
      "save intent",
      activePadiRpc.chrome.setIntent({ id, intent }).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to save intent: ${toError(err).message}`);
          }),
        ),
      ),
    );
  };

  function openTerminal(id: TerminalId) {
    const initialValue = store.getMetadata(id)?.intent ?? "";
    setSession({
      title: "Edit intent",
      initialValue,
      save: (intent) => writeIntent(id, intent),
      clear:
        initialValue.trim().length > 0 ? () => writeIntent(id, "") : undefined,
    });
  }

  function openActive() {
    const id = store.activeId();
    if (id !== null) openTerminal(id);
  }

  return {
    session,
    openTerminal,
    openActive,
    open: () => session() !== null,
    value: () => session()?.initialValue ?? "",
    title: () => session()?.title ?? "Edit intent",
    allowClear: () => session()?.clear !== undefined,
    onOpenChange: (open: boolean) => {
      if (!open) close();
    },
    save: (intent: string) => session()?.save(intent),
    clear: () => session()?.clear?.(),
  } as const;
}

export const useIntentEditor = createSharedRoot(init);
