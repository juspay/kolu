/** Controller for the terminal-intent editor — singleton with a
 *  `session` signal that the root-mounted `<IntentEditorDialog>` reads.
 *
 *  Opening the editor:
 *    - `openTerminal(id)` — read current intent, allow Clear when set.
 *    - `openActive()` — convenience around `store.activeId()`.
 *
 *  Persistence is delegated; this module knows nothing about RPCs.
 *  Callers wire `getTerminalIntent` and `setTerminalIntent` to the
 *  client RPC layer. */

import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";

export type IntentEditorSession = {
  title: string;
  initialValue: string;
  allowClear: boolean;
  save: (intent: string) => void;
  clear?: () => void;
};

export type IntentEditorDeps = {
  getTerminalIntent: (id: TerminalId) => string | undefined;
  /** Set or clear intent. Empty string clears (the wire contract
   *  encodes that — see `terminal.setIntent` in `contract.ts`). */
  setTerminalIntent: (id: TerminalId, intent: string) => void;
  activeId: () => TerminalId | null;
};

function init(deps: IntentEditorDeps) {
  const [session, setSession] = createSignal<IntentEditorSession | null>(null);

  const close = () => setSession(null);

  function openTerminal(id: TerminalId) {
    const initialValue = deps.getTerminalIntent(id) ?? "";
    setSession({
      title: "Edit intent",
      initialValue,
      allowClear: initialValue.trim().length > 0,
      save: (intent) => deps.setTerminalIntent(id, intent),
      clear: () => deps.setTerminalIntent(id, ""),
    });
  }

  function openActive() {
    const id = deps.activeId();
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

/** Lazy singleton — deps are captured on first call. Subsequent calls
 *  with different deps are ignored (deliberate; the deps come from the
 *  app root and never change identity over the app's lifetime). */
export function useIntentEditor(deps: IntentEditorDeps) {
  if (!cached) cached = createRoot(() => init(deps));
  return cached;
}
