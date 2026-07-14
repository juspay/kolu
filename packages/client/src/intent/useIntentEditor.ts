/** Controller for the terminal-intent editor — singleton with a
 *  `session` signal that the root-mounted `<IntentEditorDialog>` reads.
 *
 *  Opening the editor:
 *    - `openTerminal(id)` — read current intent, allow Clear when set.
 *    - `openActive()` — convenience around `store.activeId()`.
 *
 *  Persistence is local: the singleton reads / writes through
 *  `useTerminalStore` and padi's `chrome.setIntent` directly. The
 *  previous `IntentEditorDeps` argument moved those reads / writes to
 *  the App-root call site, which was an unenforceable convention
 *  ("deps never change identity") held together by a comment. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activePadiRpc } from "../wire";

export type IntentEditorSession = {
  title: string;
  initialValue: string;
  /** Whether Clear is a MEANINGFUL action for this session (there's something to
   *  clear) — the ONE gate the dialog renders/hides the button on. `clear` below
   *  is unconditionally constructible (nuking an already-empty intent is a safe
   *  no-op RPC), so its own optionality never encoded a second "can't clear"
   *  state — it was always present at this module's one construction site. Kept
   *  required (not `clear?`) so there is exactly one place to disagree about
   *  clearability: this field. */
  allowClear: boolean;
  save: (intent: string) => void;
  clear: () => void;
};

function init() {
  const store = useTerminalStore();
  // HOST-SCOPING: host-INDEPENDENT by design — ephemeral open-editor session; a
  // host switch while open doesn't bleed silently, it fails loud (Save routes
  // through `activePadiRpc` to the now-active host, which rejects the captured
  // terminal id with a toast, never a silent wrong-host write).
  const [session, setSession] = createSignal<IntentEditorSession | null>(null);

  const close = () => setSession(null);

  const writeIntent = (id: TerminalId, intent: string) => {
    void activePadiRpc.chrome
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
    clear: () => session()?.clear(),
  } as const;
}

export const useIntentEditor = createSharedRoot(init);
