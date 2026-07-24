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
  type Forward,
  type ForwardLoss,
  type ForwardManager,
  formatTarget,
  parseTarget,
} from "@kolu/port-forward";
import { Text, useApp, useInput, useWindowSize } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { forwardUrl, readPromptInput } from "./format.ts";
import { type Mode, Screen, type Status } from "./Screen.tsx";

/** How often the uptime column moves and the list is re-read. */
const TICK_MS = 1000;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function App({
  hostname,
  createForwards,
}: {
  hostname: string;
  /** How this screen gets its forward map. Required, and injected rather than
   *  built here: the map is a process-lifetime resource that spawns ssh
   *  children, and it is the seam that lets add / cancel / loss / quit be
   *  tested at all. */
  createForwards: (opts: {
    onLost: (loss: ForwardLoss) => void;
  }) => ForwardManager;
}) {
  const { exit } = useApp();
  const [rows, setRows] = useState<readonly Forward[]>([]);
  /** WHICH forward is selected, by key. An identity, not a position: the list
   *  moves under the highlight (a forward dies, another is cancelled), and a
   *  stored index would quietly come to mean a different row. */
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>({ kind: "table" });
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [quitting, setQuitting] = useState(false);
  const size = useWindowSize();

  /** The map, built exactly once for the life of this component. A ref, not a
   *  `useMemo`: a memo is a cache React is free to drop and re-run, and a
   *  second map would mean a second set of ssh children with the first set
   *  leaked. */
  const managerRef = useRef<ForwardManager | undefined>(undefined);

  /** Re-read the map. The map is the truth and `rows` is this screen's snapshot
   *  of it, so every place the map can have moved ends with this ONE call —
   *  never with an edit to the snapshot, which would be a second definition of
   *  what the map's own removal means. */
  const sync = useCallback((): void => {
    const map = managerRef.current;
    if (map === undefined) {
      throw new Error("vazhi: the forward map was read before it was built.");
    }
    setRows(map.list());
  }, []);

  managerRef.current ??= createForwards({
    // A forward can die without being cancelled — the host drops, the ssh
    // connection goes away. It leaves the table AND says why; a dead row that
    // still looks live is the one thing this screen must never show.
    onLost: ({ forward, reason }) => {
      setStatus({
        kind: "error",
        text: `lost ${formatTarget(forward.target)} — ${reason}`,
      });
      sync();
    },
  });
  const forwards = managerRef.current;

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      sync();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [sync]);

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

  /** The signal handlers are claimed once at mount (below), so they reach the
   *  CURRENT `quit` through this rather than closing over the one that existed
   *  at mount. */
  const quitRef = useRef(quit);
  quitRef.current = quit;

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
      sync();
      setSelectedKey(forward.key);
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
      sync();
    }
  };

  const cancelSelected = async (): Promise<void> => {
    // The row under the `›`, taken from the list the user is looking at — not
    // from a fresh read that may already have moved.
    const forward = rows.find((row) => row.key === selectedKey);
    if (forward === undefined) {
      setStatus({ kind: "info", text: "no forwards to cancel." });
      return;
    }
    setStatus({
      kind: "info",
      text: `cancelling ${formatTarget(forward.target)}…`,
    });
    try {
      await forwards.cancel(forward.key);
      setStatus({
        kind: "info",
        text: `cancelled ${formatTarget(forward.target)}.`,
      });
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
    }
    sync();
  };

  /** The key of the row `by` steps from the selected one, stopping at the ends.
   *  With nothing selected, `at` is -1, so either direction lands on the first
   *  row — which is what a first keypress should do. */
  const step = (by: number): string | undefined => {
    const at = rows.findIndex((row) => row.key === selectedKey);
    return rows[Math.min(Math.max(at + by, 0), rows.length - 1)]?.key;
  };

  /** The user finished typing a target — one action, however it was reached
   *  (Enter as a key event, or a pasted line bringing its own newline). */
  const submit = (value: string): void => {
    setMode({ kind: "table" });
    void add(value);
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
      // Movement is the one place a position exists at all: find where the
      // selected forward is now, step, and store the KEY of what we landed on.
      // Stopping at the ends rather than wrapping means over-scrolling cannot
      // bank presses the other direction has to spend.
      else if (input === "j" || key.downArrow) setSelectedKey(step(1));
      else if (input === "k" || key.upArrow) setSelectedKey(step(-1));
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
    // Registered ONCE at mount: everything `quit` closes over is stable, and
    // without the empty dependency list the uptime tick would tear all three
    // handlers off and put them back every second for the life of the process.
    const onSignal = (): void => {
      void quitRef.current();
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, onSignal);
    }
    return () => {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
        process.off(signal, onSignal);
      }
    };
  }, []);

  if (quitting) {
    return <Text>tearing down forwards…</Text>;
  }

  return (
    <Screen
      forwards={rows}
      hostname={hostname}
      mode={mode}
      now={now}
      selectedKey={selectedKey}
      size={size}
      status={status}
      onInputChange={(input) => {
        const read = readPromptInput(input);
        // A pasted line brings its own newline: take it as the Enter it is.
        if (read.kind === "typing") setMode({ kind: "add", input: read.value });
        else submit(read.value);
      }}
      onInputSubmit={submit}
    />
  );
}
