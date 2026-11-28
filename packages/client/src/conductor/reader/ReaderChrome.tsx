/** THE PANE'S OWN CONTROLS ON THE READER — the way back to the cards, and
 *  the two ways to give the document more room.
 *
 *  They are the PANE'S, not the reader's: a window that is nothing but the
 *  reader has no conversation to go back to, no third to take and no second
 *  window to open, and a reader that decided for itself which of them exist
 *  would be reading a placement word to answer four different questions
 *  (#2376 review). So the owner that has them hands them in, and the reader
 *  draws whatever it is given. */

import { type Component, Show } from "solid-js";
import { layoutMode } from "../../useMobile";
import {
  closeReader,
  popOutReader,
  readerFilled,
  type ReaderTarget,
  toggleReaderFill,
} from "./useReader";

const CONTROL =
  "shrink-0 cursor-pointer rounded-md border border-edge-bright bg-surface-0 px-2 py-0.5 text-[0.7rem] text-fg-2 hover:text-fg";

const ReaderChrome: Component<{ target: ReaderTarget }> = (props) => (
  <>
    <button
      type="button"
      data-testid="reader-back"
      class="shrink-0 cursor-pointer text-[0.78rem] font-semibold text-accent hover:underline"
      onClick={() => closeReader()}
    >
      ← Work
    </button>
    {/* NEITHER IS OFFERED ON A PHONE, where the reader already has the
        screen and there is nothing beside it to take. */}
    <Show when={layoutMode() !== "phone"}>
      <button
        type="button"
        data-testid="reader-fill"
        aria-pressed={readerFilled() ? "true" : "false"}
        class={CONTROL}
        onClick={() => toggleReaderFill()}
      >
        {readerFilled() ? "Show the chat" : "Fill the screen"}
      </button>
      <button
        type="button"
        data-testid="reader-popout"
        class={CONTROL}
        onClick={() => popOutReader(props.target)}
      >
        Pop out ↗
      </button>
    </Show>
  </>
);

export default ReaderChrome;
