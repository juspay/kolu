/** NotesPanel — the right-panel Notes tab. Hosts the inline `NotesEditor`
 *  for the active terminal. A thin shell: the editor owns its draft +
 *  autosave; this component just threads the reactive `meta.notes` value
 *  and the tab-active signal through. */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import NotesEditor from "../notes/NotesEditor";

const NotesPanel: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  /** Whether the Notes tab is the currently-shown tab — drives the
   *  editor's focus-on-open behaviour. */
  active: () => boolean;
}> = (props) => (
  <Show
    when={props.terminalId}
    fallback={<div class="p-3 text-xs text-fg-3">No terminal selected.</div>}
  >
    {(id) => (
      <NotesEditor
        terminalId={id()}
        notes={() => props.meta?.notes}
        active={props.active}
      />
    )}
  </Show>
);

export default NotesPanel;
