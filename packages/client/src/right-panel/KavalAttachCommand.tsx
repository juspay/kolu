/** A copy-to-clipboard handle on the active terminal from the shell: the
 *  `kaval-tui attach <id>` command, shown and copied with the SHORT id — the
 *  same 8-char form `kaval-tui list` prints (kaval-tui resolves any unique
 *  prefix back to the full uuid). The full id is revealed on hover via `title`.
 *  Composes the shared `CopyCommandButton` (the canonical inline copy-then-
 *  "copied" affordance), which uses `writeTextToClipboard` so it survives the
 *  plain-HTTP / Tailscale contexts kolu is often reached over. */

import type { TerminalId } from "kolu-common/surface";
import type { Component } from "solid-js";
import CopyCommandButton from "../ui/CopyCommandButton";
import { CopyIcon } from "../ui/Icons";

/** Leading chars of the uuid we show and copy. Mirrors kaval-tui's
 *  `SHORT_ID_LEN` (packages/kaval-tui/src/render.ts) — the two live in separate
 *  deploy units (browser vs CLI) with no shared module between them, so the
 *  constant is duplicated by intent rather than coupled across the boundary. */
const SHORT_ID_LEN = 8;

const KavalAttachCommand: Component<{ terminalId: TerminalId }> = (props) => {
  return (
    <CopyCommandButton
      // The short form is what you see and copy; hovering reveals the full
      // command (with the full id) as the disambiguating fallback.
      command={`kaval-tui attach ${props.terminalId.slice(0, SHORT_ID_LEN)}`}
      title={`kaval-tui attach ${props.terminalId}`}
      testId="inspector-attach-command"
      rounded="rounded-md"
      idle={<CopyIcon class="w-3 h-3" />}
    />
  );
};

export default KavalAttachCommand;
