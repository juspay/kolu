/** Controller for the terminal-intent editor — singleton with a
 *  `session` signal that the root-mounted `<IntentEditorDialog>` reads.
 *
 *  Opening the editor:
 *    - `openTerminal(id)` — read current intent, allow Clear when set.
 *    - `openActive()` — convenience around `store.activeId()`.
 *
 *  Persistence is local: the singleton reads / writes through
 *  `useTerminalStore` and `client.terminal.setIntent` directly. The
 *  previous `IntentEditorDeps` argument moved those reads / writes to
 *  the App-root call site, which was an unenforceable convention
 *  ("deps never change identity") held together by a comment. */

import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { client } from "../wire";

export type IntentEditorSession = {
  title: string;
  initialValue: string;
  allowClear: boolean;
  save: (intent: string) => void;
  clear?: () => void;
};

function init() {
  const store = useTerminalStore();
  const [session, setSession] = createSignal<IntentEditorSession | null>(null);

  const close = () => setSession(null);

  const writeIntent = (id: TerminalId, intent: string) => {
    void client.terminal
      .setIntent({ id, intent })
      .catch((err: Error) =>
        toast.error(`Failed to save intent: ${err.message}`),
      );
  };

  function openTerminal(id: TerminalId) {
    const initialValue = store.getMetadata(id)?.intent ?? "";
    setSession({
      title: "Edit intent",
      initialValue,
      allowClear: initialValue.trim().length > 0,
      save: (intent) => writeIntent(id, intent),
      clear: () => writeIntent(id, ""),
    });
  }

  function openActive() {
    const id = store.activeId();
    if (id !== null) openTerminal(id);
  }

  return {
    /** Current session or null when the dialog is closed. */
    session,
    /** Open the dialog for a specific terminal. */
    openTerminal,
    /** Open the dialog for the currently-active terminal (no-op otherwise). */
    openActive,
    /** Reactive accessors the dialog binds to. */
    open: () => session() !== null,
    value: () => session()?.initialValue ?? "",
    title: () => session()?.title ?? "Edit intent",
    allowClear: () => session()?.allowClear ?? false,
    onOpenChange: (open: boolean) => {
      if (!open) close();
    },
    save: (intent: string) => session()?.save(intent),
    clear: () => session()?.clear?.(),
  } as const;
}

let cached: ReturnType<typeof init> | undefined;

/** Lazy module-scope singleton. */
export function useIntentEditor() {
  if (!cached) cached = createRoot(() => init());
  return cached;
}
