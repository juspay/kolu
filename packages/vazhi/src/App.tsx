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
  type ForwardTarget,
  parseTarget,
} from "@kolu/port-forward";
import { Text, useApp, useInput, useWindowSize } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  forwardUrl,
  messageOf,
  nextUptimeChange,
  readPromptInput,
} from "./format.ts";
import { type Mode, Screen, type Status } from "./Screen.tsx";

/** The ways something outside asks this process to stop. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

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
  /** The selected ROW — the list's own answer to whether that key still names
   *  anything. A forward can leave the table without anyone pressing a key (it
   *  was lost, or a cancel took it), and a key kept as truth on its own would
   *  then have `x` report "no forwards to cancel" while other forwards sat there
   *  live. Deriving it means every removal path is covered by construction
   *  rather than each one remembering to clear the selection. */
  const selected = rows.find((row) => row.key === selectedKey);
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
    onLost: ({ forward, reason, kind }) => {
      // "gone" and "degraded" read differently on purpose: a gone forward has
      // left the table, while a degraded one is STILL THERE and may still be
      // reachable — saying "lost" about a row the user can still see would be
      // the screen contradicting itself.
      setStatus({
        kind: "error",
        text:
          kind === "gone"
            ? `lost ${formatTarget(forward.target)} — ${reason}`
            : `${formatTarget(forward.target)} is in trouble — ${reason}`,
      });
      sync();
    },
  });
  const forwards = managerRef.current;

  /** Redraw exactly when a row's uptime text changes, and never otherwise.
   *
   *  A 1s interval spent ~6-9ms of CPU per second building a frame Ink then
   *  discarded as unchanged: past a minute old, 59 of every 60 ticks rendered
   *  identical text. So the wait is the SOONEST moment any visible uptime moves,
   *  and with no rows there is no clock on screen and no timer at all. Nothing
   *  else needs the tick — every mutation calls `sync` itself. */
  useEffect(() => {
    if (rows.length === 0) return;
    // Measured from `now` — the frame on screen — because that is what this
    // wait is relative to: the next redraw is due when the oldest thing the
    // LAST one drew stops being true. Each tick re-anchors `now` to the real
    // clock, so a late timer shortens the following wait instead of drifting.
    const delay = Math.min(
      ...rows.map((row) => nextUptimeChange(now - row.createdAt)),
    );
    const timer = setTimeout(() => {
      setNow(Date.now());
      sync();
    }, delay);
    return () => clearTimeout(timer);
  }, [rows, now, sync]);

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
    let target: ForwardTarget;
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
    const forward = selected;
    if (forward === undefined) {
      // Two different situations, and saying the wrong one sends the user
      // looking for a problem that isn't there: an empty table has nothing to
      // cancel, while a full one just has nothing picked yet.
      setStatus({
        kind: "info",
        text:
          rows.length === 0
            ? "no forwards to cancel."
            : "nothing selected — j/k to pick a row.",
      });
      return;
    }
    setStatus({
      kind: "info",
      text: `cancelling ${formatTarget(forward.target)}…`,
    });
    try {
      await forwards.cancel(forward.key);
      // Move the highlight off the row that just left, so the next `x` acts on
      // the row the user can see it on rather than on nothing.
      setSelectedKey(step(1));
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

  // Esc leaves the prompt; Ctrl+C still quits from inside it. Both are needed
  // here: ink is told not to handle Ctrl+C (the app tears its forwards down
  // first), and raw mode means no SIGINT arrives either — so without this the
  // key did nothing at all while the prompt was open.
  useInput(
    (input, key) => {
      if (key.escape) setMode({ kind: "table" });
      else if (key.ctrl && input === "c") void quitRef.current();
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
    for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
    return () => {
      for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
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
      selectedKey={selected?.key}
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
