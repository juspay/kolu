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
  const { colorScheme } = useColorScheme();

  const [target, setTarget] = createSignal(parseReaderHash(location.hash));
  makeEventListener(window, "hashchange", () =>
    setTarget(parseReaderHash(location.hash)),
  );

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
                from="popout"
                listing={false}
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
