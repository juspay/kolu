/** A copy-to-clipboard handle on the active terminal from the shell: the
 *  `kaval-tui attach <id>` command, shown and copied with the SHORT id — the
 *  same 8-char form `kaval-tui list` prints (kaval-tui resolves any unique
 *  prefix back to the full uuid). The full id is revealed on hover via `title`.
 *  Mirrors the inline copy-then-"copied" affordance of `PrUnavailablePopover`'s
 *  CopyCommand, and uses `writeTextToClipboard` so it survives the plain-HTTP /
 *  Tailscale contexts kolu is often reached over. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "../ui/clipboard";
import { CopyIcon } from "../ui/Icons";

/** Leading chars of the uuid we show and copy. Mirrors kaval-tui's
 *  `SHORT_ID_LEN` (packages/kaval-tui/src/render.ts) — the two live in separate
 *  deploy units (browser vs CLI) with no shared module between them, so the
 *  constant is duplicated by intent rather than coupled across the boundary. */
const SHORT_ID_LEN = 8;

const KavalAttachCommand: Component<{ terminalId: TerminalId }> = (props) => {
  const shortCommand = () =>
    `kaval-tui attach ${props.terminalId.slice(0, SHORT_ID_LEN)}`;
  const fullCommand = () => `kaval-tui attach ${props.terminalId}`;
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await writeTextToClipboard(shortCommand());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(`Couldn't copy: ${(err as Error).message}`);
    }
  };

  return (
    <button
      type="button"
      data-testid="inspector-attach-command"
      onClick={copy}
      // The short form is what you see and copy; hovering reveals the full
      // command (with the full id) as the disambiguating fallback.
      title={fullCommand()}
      class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-surface-2 hover:bg-surface-3 font-mono text-[11px] text-fg cursor-pointer transition-colors"
    >
      <span class="truncate">{shortCommand()}</span>
      <span class="shrink-0 flex items-center gap-1 text-fg-3 text-[10px]">
        {copied() ? "copied" : <CopyIcon class="w-3 h-3" />}
      </span>
    </button>
  );
};

export default KavalAttachCommand;
