/** Per-terminal live queries — streams metadata and activity from server into the store via TanStack Query. */

import { createEffect } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type { TerminalId } from "kolu-common";
import type { SetTerminalMeta } from "./useTerminalStore";

export default function TerminalQueries(props: {
  id: TerminalId;
  setMeta: SetTerminalMeta;
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  // Live query: server pushes metadata updates, TanStack manages the stream lifecycle.
  const metadata = createQuery(() =>
    orpc.terminal.onMetadataChange.experimental_liveOptions({
      input: { id: props.id },
    }),
  );

  createEffect(() => {
    if (metadata.data) props.setMeta(props.id, "meta", metadata.data);
  });

  // Live query: server pushes activity state changes (active/sleeping).
  const activity = createQuery(() =>
    orpc.terminal.onActivityChange.experimental_liveOptions({
      input: { id: props.id },
    }),
  );

  createEffect(() => {
    const isActive = activity.data;
    if (isActive === undefined) return;
    props.setMeta(props.id, "isActive", isActive);
    props.pushActivity(props.id, isActive);
  });

  return null;
}
