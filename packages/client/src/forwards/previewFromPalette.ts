/**
 * ⌘K "Preview a port…" — parse like Forward a port, ensure a door when needed,
 * then open the Preview tab. Commands stay declarative; the async work lives here.
 */

import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { parseForwardInput } from "./forwardFromPalette";
import { createForward } from "./useForwards";

export function previewFromPalette(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
  opts: {
    terminalId: TerminalId | null;
    openPreview: (
      id: TerminalId,
      port: number,
      path?: string,
    ) => Promise<unknown>;
    reveal: () => void;
  },
): void {
  if (opts.terminalId === null) {
    toast.error("Select a terminal first — Preview is per-terminal.");
    return;
  }
  const parsed = parseForwardInput(raw, hosts, activeHost);
  if (!parsed.ok) {
    toast.error(parsed.message);
    return;
  }
  const terminalId = opts.terminalId;
  opts.reveal();
  // Open a door when the target may not answer on the page host (remote, or
  // a port the scanner never attributed). Manual origin — palette-named.
  createForward({
    host: parsed.host,
    port: parsed.port,
    origin: "manual",
  })
    .then(() => opts.openPreview(terminalId, parsed.port, "/"))
    .then(
      () => undefined,
      (err: Error) =>
        toast.error(
          `Could not preview ${parsed.host.kind === "local" ? "" : `${parsed.host.target}:`}${parsed.port}: ${err.message}`,
        ),
    );
}
