/** The one-click copy of the client diagnostic snapshot (kolu#2101 J2).
 *
 *  ONE component for BOTH surfaces — the Diagnostic Info dialog (where the block
 *  is also rendered) and each host's diagnostics popover (a per-host entry point
 *  to the same tab-wide truth). The builder is shared
 *  (`./diagnosticSnapshot`), so the two can never drift into copying different
 *  things.
 *
 *  **The gesture-window discipline** (`ui/clipboard.ts`): the snapshot is built
 *  LAZILY inside `Effect.suspend`, so the whole build happens on the click's own
 *  stack with no `await` before the clipboard write. Building it first and
 *  awaiting anything would put the `execCommand` fallback — the only write that
 *  works over plain `http://`, which is how kolu is reached on a LAN or a
 *  Tailscale IP — outside the user-activation window, and it would fail with no
 *  unit test to catch it. */

import { Effect } from "effect";
import { toError } from "@kolu/surface/run-stream";
import type { Component } from "solid-js";
import { toast } from "solid-sonner";
import {
  buildDiagnosticSnapshotText,
  type DiagnosticSnapshotInputs,
} from "./diagnosticSnapshot";
import { runAction, type UiAction } from "./runAction";
import { writeTextToClipboard } from "./ui/clipboard";

/** Build-and-write, as one program run at the click edge. */
export function copyDiagnosticSnapshot(
  inputs?: DiagnosticSnapshotInputs,
): UiAction {
  return Effect.suspend(() =>
    // INSIDE the suspend: see the gesture-window note above. The build is
    // synchronous and reads only client-held state, so nothing here can push the
    // write out of the window.
    writeTextToClipboard(buildDiagnosticSnapshotText(inputs)),
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => toast.success("Diagnostic snapshot copied")),
    ),
    Effect.catch((err) =>
      Effect.sync(() => {
        console.error("Failed to copy diagnostic snapshot:", err);
        toast.error(
          `Failed to copy diagnostic snapshot: ${toError(err).message}`,
        );
      }),
    ),
  );
}

const CopyDiagnosticsButton: Component<{
  /** The server's build identity as the caller already holds it (the parent
   *  reads `useSurfaceApp().server()`; this component opens no subscription). */
  serverBuild?: DiagnosticSnapshotInputs["serverBuild"];
  class?: string;
  children?: string;
}> = (props) => (
  <button
    type="button"
    data-testid="copy-diagnostic-snapshot"
    onClick={() =>
      runAction(
        "copy diagnostic snapshot",
        copyDiagnosticSnapshot({ serverBuild: props.serverBuild }),
      )
    }
    class={
      props.class ??
      "text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    }
  >
    {props.children ?? "Copy diagnostics"}
  </button>
);

export default CopyDiagnosticsButton;
