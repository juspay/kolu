/**
 * The OpenTUI/Solid view layer for arivu-tui — the P3a re-platform of the
 * terminal-side viewer onto Bun + OpenTUI. It paints the SAME awareness a
 * terminal `is in` that the plain `render.ts` text path does (agent · PR ·
 * branch · foreground · recency), only as a live, truecolour record instead of
 * a one-shot columnify dump.
 *
 * The split is deliberate: every DECISION about the data — which fields, their
 * formatted values, and the semantic `tone` each should take — lives in the pure
 * `render.ts` (`fieldRows`/`recordHeader`/`agentTone`/`prTone`), unit-tested
 * under Node. This module only maps a `tone` to a concrete colour and arranges
 * the cells. So the Bun-only renderer never holds any logic the Node test lane
 * can't reach.
 *
 * Two entry shapes over ONE record component:
 *   - `renderListTui` — a one-shot snapshot: paint every terminal's record once
 *     in main-screen mode (rows stay in scrollback like the old output), then
 *     destroy after the first frame so the process exits.
 *   - `runWatchTui` — a live view: one terminal's record in alternate-screen
 *     mode, repainting as the awareness stream pushes updates, until the stream
 *     ends, the terminal departs (the caller's AbortSignal), or Ctrl-C.
 *
 * This file is `.tsx` and only ever loaded under Bun (the Nix wrapper runs it
 * with @opentui/solid's preload registering the Solid JSX transform); `bin.ts`
 * imports it dynamically and ONLY when stdout is a TTY, so a piped `--json` /
 * non-TTY invocation never drags the native renderer in.
 */

import type { CliRenderer } from "@opentui/core";
import { render, useRenderer } from "@opentui/solid";
import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
  type FieldTone,
  fieldRows,
  LABEL_WIDTH,
  recordHeader,
} from "./render.ts";

/** The palette — the one place a semantic `tone` becomes a concrete colour. The
 *  awaiting (blocked-on-you) amber and the working cyan are the two the eye
 *  should catch; everything else stays calm. */
const TONE_COLOR: Record<FieldTone, string> = {
  working: "#56b6c2",
  awaiting: "#e6a23c",
  idle: "#5b6678",
  pass: "#7ec699",
  fail: "#e06c75",
  pending: "#c8a24c",
  muted: "#5b6678",
  plain: "#c8d0de",
};

const HEADER_ID = "#aeb7c7";
const HEADER_CWD = "#5b6678";
const LABEL = "#8b94a6";

/** One terminal's awareness as a vertical record: a `<id>  <cwd>` header then an
 *  aligned `label  value` row per field, the value coloured by its tone. The
 *  same field set + order as the text `record()`, so the two views align.
 *  Exported for the headless Bun render test (`tui.bun-test.tsx`). */
export function AwarenessRecord(props: {
  id: TerminalId;
  v: AwarenessValue;
  home: string | undefined;
  now: number;
}) {
  const head = (): { id: string; cwd: string } =>
    recordHeader(props.id, props.v, props.home);
  const rows = (): ReturnType<typeof fieldRows> =>
    fieldRows(props.v, props.now);
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <text fg={HEADER_ID}>{head().id}</text>
        <text fg={HEADER_CWD}>{`  ${head().cwd}`}</text>
      </box>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row">
            <text fg={LABEL}>{`  ${row.label.padEnd(LABEL_WIDTH)}`}</text>
            <text fg={TONE_COLOR[row.tone]}>{row.value}</text>
          </box>
        )}
      </For>
    </box>
  );
}

/** Options shared by both entry shapes. */
export interface TuiOptions {
  home: string | undefined;
  /** "Now" for the relative `active` field (defaults to wall-clock). */
  now?: number;
}

/** One-shot: paint every terminal's record once, then exit. main-screen mode
 *  leaves the rows in the scrollback (like the old text `list`); the renderer is
 *  destroyed after the first frame paints so the process can exit. */
export async function renderListTui(
  entries: Array<[TerminalId, AwarenessValue]>,
  opts: TuiOptions,
): Promise<void> {
  const now = opts.now ?? Date.now();
  function App() {
    const renderer = useRenderer();
    onMount(() => {
      // Exit once the first frame has actually painted. Destroying inside the
      // frame callback is unsafe, so defer to a microtask.
      let painted = false;
      renderer.setFrameCallback(async () => {
        if (painted) return;
        painted = true;
        queueMicrotask(() => renderer.destroy());
      });
      renderer.requestRender();
    });
    return (
      <box flexDirection="column">
        <For each={entries}>
          {([id, v]) => (
            <AwarenessRecord id={id} v={v} home={opts.home} now={now} />
          )}
        </For>
      </box>
    );
  }
  await render(() => <App />, {
    screenMode: "main-screen",
    exitOnCtrlC: true,
    // Keep the painted rows on screen after we exit — this is `list`, not a
    // live view to restore away.
    clearOnShutdown: false,
  });
}

/** Live: follow ONE terminal's awareness, repainting on every stream push, until
 *  the stream ends, `until` aborts (the terminal departed), or Ctrl-C. `stop`
 *  aborts the underlying stream — it is what Ctrl-C/exit calls so the follow
 *  loop unwinds. A stream failure that is NOT an abort is re-thrown so the caller
 *  surfaces the link error rather than collapsing to a silent exit (the
 *  caught-error-must-not-collapse-to-empty rule). */
export async function runWatchTui(args: {
  id: TerminalId;
  home: string | undefined;
  values: AsyncIterable<AwarenessValue>;
  until: AbortSignal;
  stop: () => void;
}): Promise<void> {
  const [store, setStore] = createStore<{ v?: AwarenessValue }>({});
  let renderer: CliRenderer | undefined;
  let streamErr: unknown;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });

  const teardown = (): void => {
    try {
      renderer?.destroy();
    } catch {
      // destroy() is idempotent in intent; ignore a double-teardown race.
    }
  };
  // The terminal departed (caller aborted `until`) → bring the renderer down.
  args.until.addEventListener("abort", teardown, { once: true });

  const pump = (async () => {
    try {
      for await (const v of args.values) {
        if (args.until.aborted) break;
        setStore("v", v);
      }
    } catch (err) {
      // An abort (Ctrl-C → stop() → the stream's signal, or a departure) lands
      // here too; only a pre-abort failure is a real fault to surface.
      if (!args.until.aborted) streamErr = err;
    } finally {
      // Stream ended (naturally or by abort) → exit the renderer.
      teardown();
    }
  })();

  function App() {
    renderer = useRenderer();
    return (
      <box flexDirection="column">
        <Show when={store.v}>
          {(v) => (
            <AwarenessRecord
              id={args.id}
              v={v()}
              home={args.home}
              now={Date.now()}
            />
          )}
        </Show>
      </box>
    );
  }

  await render(() => <App />, {
    screenMode: "alternate-screen",
    exitOnCtrlC: true,
    exitSignals: ["SIGINT", "SIGTERM"],
    clearOnShutdown: true,
    // Ctrl-C / a kill signal tears the renderer down here — abort the stream so
    // the pump unwinds, then release the awaiter.
    onDestroy: () => {
      args.stop();
      resolveDone();
    },
  });
  await done;
  await pump;
  if (streamErr) throw streamErr;
}
