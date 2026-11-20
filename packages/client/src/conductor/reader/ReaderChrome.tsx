import { type Component, Show } from "solid-js";
import { conductorWide } from "../conductorLayout";
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
    {/* NEITHER IS OFFERED ON A NARROW WINDOW, where the reader already has
        the screen and there is nothing beside it to take. */}
    <Show when={conductorWide()}>
      <button
        type="button"
        data-testid="reader-fill"
        aria-pressed={readerFilled()}
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
