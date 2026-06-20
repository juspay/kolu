/**
 * The OpenTUI/Solid view for arivu-tui — the P3a re-platform onto Bun + OpenTUI.
 *
 * `arivu-tui` (no args) is a LIVE dashboard: one row per terminal, in a compact
 * truecolour table, updating in place as awareness changes, until you quit
 * (Ctrl-C or `q`). It is a live app, not a one-shot — which is OpenTUI's native
 * shape: the render loop runs until the user exits (OpenTUI's OWN teardown, not
 * a manual destroy), and a static one-shot's self-termination problems simply
 * don't arise. P3b enriches this (needs-you-first sort, multi-host).
 *
 * The split stays clean: every DECISION about the data — which columns, their
 * formatted values, the semantic `tone` each takes — lives in the pure
 * `render.ts` (`dashRow`), unit-tested under Node. This module only maps a tone
 * to a colour and lays the cells out; it holds no logic the Node lane can't
 * reach. It is `.tsx` and only ever loaded under Bun (the daemon + the rest of
 * kolu stay Node), imported dynamically by `bin.ts` ONLY when stdout is a TTY,
 * so a piped `--json` run never drags the native renderer in.
 */

import type { CliRenderer } from "@opentui/core";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { mirrorRemoteCollection } from "@kolu/surface-nix-host";
import { createMemo, For } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import type { ArivuClient } from "./connect.ts";
import { type DashRow, dashRow, type FieldTone } from "./render.ts";

/** The palette — the one place a semantic `tone` becomes a concrete colour. The
 *  awaiting (blocked-on-you) amber and working cyan are the two the eye should
 *  catch; everything else stays calm. */
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

const TITLE = "#7c8696";
const HEADER = "#8b94a6";
const ID_FG = "#aeb7c7";
const PLAIN = "#c8d0de";
const MUTED = "#5b6678";

// Column widths (chars). Sized for an ~80-col terminal; long values ellipsize.
const W_ID = 10;
const W_WHERE = 26;
const W_PR = 12;
const W_AGENT = 20;
const W_FG = 10;

/** Pad to width, or truncate with an ellipsis when too long. */
function cell(s: string, w: number): string {
  return s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w);
}

/** The live table: a title, a header row, and one row per terminal — the agent
 *  state + PR coloured by tone, the rest calm. Exported for the headless Bun
 *  render test (`tui.bun-test.tsx`). */
export function AwarenessTable(props: {
  rows: () => DashRow[];
  count: () => number;
}) {
  return (
    <box flexDirection="column" padding={1}>
      <text
        fg={TITLE}
      >{`arivu  ·  ${props.count()} terminal${props.count() === 1 ? "" : "s"}  ·  q to quit`}</text>
      <box flexDirection="row" marginTop={1}>
        <text fg={HEADER}>{cell("ID", W_ID)}</text>
        <text fg={HEADER}>{cell("REPO·BRANCH", W_WHERE)}</text>
        <text fg={HEADER}>{cell("PR", W_PR)}</text>
        <text fg={HEADER}>{cell("AGENT", W_AGENT)}</text>
        <text fg={HEADER}>{cell("FG", W_FG)}</text>
        <text fg={HEADER}>ACTIVE</text>
      </box>
      {props.count() === 0 ? (
        <text fg={MUTED}>
          no terminals — is kaval running, with arivu watching it?
        </text>
      ) : (
        <For each={props.rows()}>
          {(r) => (
            <box flexDirection="row">
              <text fg={ID_FG}>{cell(r.id, W_ID)}</text>
              <text fg={PLAIN}>{cell(r.repoBranch, W_WHERE)}</text>
              <text fg={TONE_COLOR[r.pr.tone]}>{cell(r.pr.text, W_PR)}</text>
              <text fg={TONE_COLOR[r.agent.tone]}>
                {cell(r.agent.text, W_AGENT)}
              </text>
              <text fg={PLAIN}>{cell(r.foreground, W_FG)}</text>
              <text fg={MUTED}>{r.active}</text>
            </box>
          )}
        </For>
      )}
    </box>
  );
}

/** Run the live dashboard: mirror the awareness collection into a Solid store,
 *  render the table, and repaint as terminals come/go/change — until Ctrl-C or
 *  `q`. `stop` disposes the connection (which ends the mirror's streams). A
 *  mirror failure that is NOT the dispose-driven teardown is surfaced via `log`
 *  so the link error is visible rather than collapsing to a frozen table. */
export async function runDashboardTui(args: {
  client: ArivuClient;
  home: string | undefined;
  stop: () => void;
}): Promise<void> {
  const [store, setStore] = createStore<Record<string, AwarenessValue>>({});

  // A full-screen renderer OWNS the terminal: any stray write to the tty
  // mid-render shreds the alt-screen. Over a `--host` dial the connection layer
  // forwards the remote daemon's stderr to ours (and writes `[host:…]` progress
  // lines) — those would corrupt the live table the moment a log arrives.
  // Capture stderr for the render's lifetime into a capped ring and replay it
  // once the renderer has torn down (the `finally` below): deferred off the
  // alt-screen, never lost. Lowering the daemon's log level only thinned this
  // stream — a single forwarded line still corrupts; owning the terminal fixes
  // it at the cause.
  const STDERR_DEFER_CAP = 500;
  const deferredErr: string[] = [];
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  const captureStderr = ((chunk: unknown, ...rest: unknown[]): boolean => {
    deferredErr.push(typeof chunk === "string" ? chunk : String(chunk));
    if (deferredErr.length > STDERR_DEFER_CAP) deferredErr.shift();
    // Honour write()'s callback contract so a caller awaiting the flush resumes.
    const cb = rest.find((a) => typeof a === "function") as
      | ((err?: Error | null) => void)
      | undefined;
    cb?.();
    return true;
  }) as typeof process.stderr.write;

  let renderer: CliRenderer | undefined;
  let quitting = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });
  const quit = (): void => {
    if (quitting) return;
    quitting = true;
    try {
      renderer?.destroy();
    } catch {
      // best-effort — we're exiting anyway.
    }
    args.stop();
    resolveDone();
  };

  // Mirror the remote awareness collection into the store, live. Resolves when
  // the streams end (the dispose on quit) — a post-dispose error is the normal
  // teardown, not a fault.
  const mirror = mirrorRemoteCollection<TerminalId, AwarenessValue>({
    label: "awareness",
    log: (line) => {
      if (!quitting) process.stderr.write(`arivu-tui: ${line}\n`);
    },
    keys: args.client.surface.awareness.keys({}),
    get: (key, signal) =>
      args.client.surface.awareness.get({ key }, { signal }),
    onUpsert: (key, value) => setStore(key, reconcile(value)),
    onRemove: (key) =>
      setStore(
        produce((s) => {
          delete s[key];
        }),
      ),
  }).catch((err) => {
    if (!quitting)
      process.stderr.write(`arivu-tui: ${(err as Error).message}\n`);
  });

  function App() {
    renderer = useRenderer();
    useKeyboard((key) => {
      if (key.name === "q") quit();
    });
    const rows = createMemo(() => {
      const now = Date.now();
      return Object.entries(store)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, v]) => dashRow(id as TerminalId, v, now));
    });
    return (
      <AwarenessTable rows={rows} count={() => Object.keys(store).length} />
    );
  }

  let renderErr: unknown;
  // Take the terminal over: from here until teardown, stderr is deferred.
  process.stderr.write = captureStderr;
  try {
    render(() => <App />, {
      screenMode: "alternate-screen",
      exitOnCtrlC: true,
      exitSignals: ["SIGINT", "SIGTERM"],
      clearOnShutdown: true,
      // Read-only viewer — no pointer/keyboard input modes to leave on at exit.
      useMouse: false,
      enableMouseMovement: false,
      useKittyKeyboard: null,
      // Ctrl-C / a kill signal tear the renderer down through OpenTUI's own exit
      // path — finish the same teardown (dispose the link, release the awaiter).
      onDestroy: () => quit(),
    }).catch((err) => {
      renderErr = err;
      quit();
    });

    await done;
    await mirror;
  } finally {
    // Alt-screen is gone now — restore stderr and replay what arrived during the
    // render, so a forwarded daemon error is visible rather than swallowed.
    process.stderr.write = realStderrWrite;
    if (deferredErr.length) realStderrWrite(deferredErr.join(""));
  }
  if (renderErr) throw renderErr;
}
