/** THE POP-OUT — a window that is nothing but the reader.
 *
 *  `index.tsx` reads `#/reader/<work>/<path>` BEFORE anything mounts and
 *  renders this instead of the workspace. That is the whole of the route: a
 *  second monitor is meant to hold the plan, not a second copy of the canvas,
 *  the dock and every terminal stream behind them — which is also why this is
 *  not a deep link (`deepLink.ts` routes commands onto the ONE workspace view,
 *  and this window has no workspace to command).
 *
 *  IT IS LIVE, because everything it draws is read from the modules the
 *  workspace reads: the works collection over this window's own websocket, the
 *  member's worktree through that host's padi, and the comments store in this
 *  browser's `localStorage`. So the file updates, the question appears, and an
 *  answer given here lands on the same record the card and the chat answer —
 *  recorded as having come from the pop-out. Closing the window loses nothing:
 *  nothing it holds is its own.
 *
 *  The address is the state. Pressing another of the work's files sets this
 *  window's hash, so reload, bookmark and the browser's own Back all do what
 *  they say. */

import { Title } from "@solidjs/meta";
import { makeEventListener } from "@solid-primitives/event-listener";
import { type Component, createSignal, Show } from "solid-js";
import { Toaster } from "solid-sonner";
import { useColorScheme } from "../../settings/useColorScheme";
import { Shown } from "../../ui/shown";
import { workFileName } from "../workFile";
import { parseReaderHash, readerHash } from "./useReader";
import WorkReader from "./WorkReader";

const ReaderWindow: Component = () => {
  // The scheme the rest of the app resolves, applied to THIS document: the
  // shared root toggles `.dark` on its own `<html>`, so the pop-out is in the
  // reader's theme without a second opinion about what that is.
  const { colorScheme } = useColorScheme();

  const [target, setTarget] = createSignal(parseReaderHash(location.hash));
  makeEventListener(window, "hashchange", () =>
    setTarget(parseReaderHash(location.hash)),
  );

  // A window whose tab is in the background is still SHOWN in the sense the
  // retained panes mean: it was not swapped out for another view. The one
  // thing that is true of it and not of them is that the OS may have it
  // hidden, which is what the visibility state says.
  const [visible, setVisible] = createSignal(!document.hidden);
  makeEventListener(document, "visibilitychange", () =>
    setVisible(!document.hidden),
  );

  return (
    <Shown.Provider value={visible}>
      <div
        data-testid="reader-window"
        class="flex h-dvh w-full flex-col bg-surface-0 text-chat"
      >
        <Show
          when={target()}
          fallback={
            <p
              data-testid="reader-window-empty"
              class="m-auto px-6 text-center font-mono text-xs text-fg-3"
            >
              This window's address names no file to read.
            </p>
          }
        >
          {(one) => (
            <>
              <Title>{workFileName(one().path)} · kolu</Title>
              <WorkReader
                target={one()}
                // THIS WINDOW OWNS ITS ADDRESS: a tab press sets the hash, so
                // reload, bookmark and the browser's own Back all do what
                // they say.
                from="popout"
                onOpen={(next) => {
                  location.hash = readerHash(next);
                }}
                class="flex-1"
              />
            </>
          )}
        </Show>
        <Toaster
          position="bottom-right"
          theme={colorScheme()}
          richColors
          toastOptions={{
            style: {
              color: "var(--color-fg)",
              border: "1px solid var(--color-edge-bright)",
            },
          }}
        />
      </div>
    </Shown.Provider>
  );
};

export default ReaderWindow;
