/**
 * vazhi's stateful shell — the container that owns the forward map, the keys
 * and the teardown.
 *
 * The map's every visible change — a forward opened, cancelled, or LOST on its
 * own — is a state change of this component, so the map lives here. Quitting is
 * here too: `q` tears the forwards down and only then lets the process end.
 *
 * The frame it renders is `Screen.tsx`, which holds no state at all. The split
 * is the volatility line: this is the most volatile code in the package (async
 * opens, process signals, ink's exit), and the frame below it is the most
 * stable.
 */

import {
  createForwardManager,
  type Forward,
  formatTarget,
  parseTarget,
} from "@kolu/port-forward";
import { Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useMemo, useState } from "react";
import { clampSelection, forwardUrl, readPromptInput } from "./format.ts";
import { type Mode, Screen, type Status } from "./Screen.tsx";

/** How often the uptime column moves and the list is re-read. */
const TICK_MS = 1000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function App({ hostname }: { hostname: string }) {
  const { exit } = useApp();
  const [rows, setRows] = useState<readonly Forward[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "table" });
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [quitting, setQuitting] = useState(false);
  const size = useWindowSize();

  const forwards = useMemo(
    () =>
      createForwardManager({
        // A forward can die without being cancelled — the host drops, the ssh
        // master goes away. It leaves the table AND says why; a dead row that
        // still looks live is the one thing this screen must never show.
        onLost: ({ forward, reason }) => {
          setStatus({
            kind: "error",
            text: `lost ${formatTarget(forward.target)} — ${reason}`,
          });
          setRows((live) => live.filter((row) => row.key !== forward.key));
        },
      }),
    [],
  );

  /** Re-read the map. The map is the truth and `rows` is this screen's snapshot
   *  of it, so every place the map can have moved ends with this one call. */
  const refresh = (): void => setRows(forwards.list());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      setRows(forwards.list());
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [forwards]);

  /** Every forward this process opened goes down with it. A teardown that
   *  refuses is carried out through Ink's exit so the process ends non-zero —
   *  never swallowed, because a leftover listener is a door left open. */
  const quit = async (): Promise<void> => {
    setQuitting(true);
    try {
      await forwards.dispose();
      exit();
    } catch (err) {
      exit(err instanceof Error ? err : new Error(messageOf(err)));
    }
  };

  const add = async (text: string): Promise<void> => {
    let target: ReturnType<typeof parseTarget>;
    try {
      target = parseTarget(text);
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
      return;
    }
    setStatus({ kind: "info", text: `opening ${formatTarget(target)}…` });
    try {
      const forward = await forwards.create(target);
      setStatus({
        kind: "info",
        text: `${formatTarget(forward.target)} is answering on ${forwardUrl(hostname, forward.localPort)}`,
      });
      refresh();
      setSelected(forwards.list().findIndex((row) => row.key === forward.key));
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
      refresh();
    }
  };

  const cancelSelected = async (): Promise<void> => {
    const live = forwards.list();
    const forward = live[clampSelection(selected, live.length)];
    if (forward === undefined) {
      setStatus({ kind: "info", text: "no forwards to cancel." });
      return;
    }
    setStatus({ kind: "info", text: `cancelling ${forward.key}…` });
    try {
      await forwards.cancel(forward.key);
      setStatus({ kind: "info", text: `cancelled ${forward.key}.` });
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
    }
    refresh();
  };

  // Table keys. Inactive while the prompt is up, so typing a host name can
  // never also mean "quit".
  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) void quit();
      else if (input === "a") {
        setStatus(undefined);
        setMode({ kind: "add", input: "" });
      } else if (input === "x") void cancelSelected();
      // Clamped at the WRITE, so `selected` is the selection rather than an
      // unbounded counter that only looks right after rendering: over-scrolling
      // past an end used to bank presses, and the next key in the other
      // direction did nothing.
      else if (input === "j" || key.downArrow) {
        setSelected((at) => clampSelection(at + 1, rows.length));
      } else if (input === "k" || key.upArrow) {
        setSelected((at) => clampSelection(at - 1, rows.length));
      }
    },
    { isActive: mode.kind === "table" && !quitting },
  );

  // Esc leaves the prompt; the prompt itself owns every other key.
  useInput(
    (_input, key) => {
      if (key.escape) setMode({ kind: "table" });
    },
    { isActive: mode.kind === "add" && !quitting },
  );

  useEffect(() => {
    // An external stop must tear the forwards down exactly as `q` does.
    const onSignal = (): void => {
      void quit();
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, onSignal);
    }
    return () => {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.off(signal, onSignal);
      }
    };
  });

  if (quitting) {
    return <Text>tearing down forwards…</Text>;
  }

  return (
    <Screen
      forwards={rows}
      hostname={hostname}
      mode={mode}
      now={now}
      selected={selected}
      size={size}
      status={status}
      onInputChange={(input) => {
        const read = readPromptInput(input);
        if (read.kind === "typing") {
          setMode({ kind: "add", input: read.value });
          return;
        }
        // A pasted line brings its own newline: take it as the Enter it is.
        setMode({ kind: "table" });
        void add(read.value);
      }}
      onInputSubmit={(input) => {
        setMode({ kind: "table" });
        void add(input);
      }}
    />
  );
}
