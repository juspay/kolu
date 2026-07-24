/**
 * vazhi's screen — one Ink component tree, filling the terminal.
 *
 * Ink (React) rather than OpenTUI/SolidJS, which would have matched this repo's
 * usual grain: OpenTUI's renderer is a native Zig core reached over FFI, and it
 * refuses to start on anything below Node 26.4 with `--experimental-ffi`
 * ("OpenTUI native FFI is not available for this runtime yet" — measured on the
 * pinned toolchain's Node 24). The repo's nixpkgs pin tops out at Node 25, so
 * OpenTUI could not run here at all. Ink is node-native, needs no FFI, and owns
 * the two things this screen actually wants from a framework: flexbox layout
 * and redraw-on-resize.
 *
 * The component owns the forward map, because the map's every visible change —
 * a forward opened, cancelled, or LOST on its own — is a state change of this
 * screen. Quitting is here too: `q` tears the forwards down and only then lets
 * the process end.
 */

import {
  createForwardManager,
  type Forward,
  formatTarget,
  parseTarget,
} from "@kolu/port-forward";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useMemo, useState } from "react";
import {
  clampSelection,
  formatUptime,
  forwardUrl,
  hyperlink,
  readPromptInput,
} from "./format.ts";

/** How often the uptime column moves and the list is re-read. */
const TICK_MS = 1000;

/** The bottom line: the keybind legend, or the `host:port` prompt. */
type Mode = { kind: "table" } | { kind: "add"; input: string };

/** The one transient message line — what just happened, or what just failed. */
interface Status {
  kind: "info" | "error";
  text: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The terminal's live size. Ink re-renders on state change, so a resize is
 *  just another state change — which is the whole of "survives resize". */
function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  // A pty that reports no size (a harness, a detached terminal) still needs a
  // frame to draw; 80×24 is the terminal default.
  const read = (): { columns: number; rows: number } => ({
    columns: stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout.rows > 0 ? stdout.rows : 24,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = (): void => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  });
  return size;
}

export function App({ hostname }: { hostname: string }) {
  const { exit } = useApp();
  const [rows, setRows] = useState<readonly Forward[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "table" });
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [quitting, setQuitting] = useState(false);
  const size = useTerminalSize();

  const forwards = useMemo(
    () =>
      createForwardManager({
        // A forward can die without being cancelled — the host drops, the ssh
        // master goes away. It leaves the table AND says why; a dead row that
        // still looks live is the one thing this screen must never show.
        onLost: ({ forward, reason }) => {
          setStatus({ kind: "error", text: `lost ${forward.key} — ${reason}` });
          setRows((live) => live.filter((row) => row.key !== forward.key));
        },
      }),
    [],
  );

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
        text: `${forward.key} is answering on ${forwardUrl(hostname, forward.localPort)}`,
      });
      setRows(forwards.list());
      setSelected(forwards.list().findIndex((row) => row.key === forward.key));
    } catch (err) {
      setStatus({ kind: "error", text: messageOf(err) });
      setRows(forwards.list());
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
    setRows(forwards.list());
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
      else if (input === "j" || key.downArrow) setSelected((at) => at + 1);
      else if (input === "k" || key.upArrow) setSelected((at) => at - 1);
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

/** The frame, as a function of what there is to show — no state, no effects, no
 *  forward map. Every layout claim about vazhi is a claim about this. */
export function Screen({
  forwards,
  hostname,
  mode,
  now,
  onInputChange,
  onInputSubmit,
  selected,
  size,
  status,
}: {
  forwards: readonly Forward[];
  hostname: string;
  mode: Mode;
  now: number;
  onInputChange: (input: string) => void;
  onInputSubmit: (input: string) => void;
  selected: number;
  size: { columns: number; rows: number };
  status: Status | undefined;
}) {
  const highlighted = clampSelection(selected, forwards.length);
  // One column width for every target, so the arrows line up whatever the host
  // names are.
  const targetWidth = forwards.reduce(
    (widest, row) => Math.max(widest, formatTarget(row.target).length),
    0,
  );

  return (
    <Box flexDirection="column" width={size.columns} height={size.rows}>
      <Box>
        <Text bold>vazhi</Text>
        <Text dimColor>
          {` · ${forwards.length === 0 ? "no" : forwards.length} forward${forwards.length === 1 ? "" : "s"} · answering on ${hostname}`}
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {forwards.length === 0 ? (
          <Text dimColor>
            nothing forwarded yet — press a and type host:port (e.g.
            pu-dev:5173)
          </Text>
        ) : (
          forwards.map((row, index) => (
            <Row
              key={row.key}
              forward={row}
              hostname={hostname}
              now={now}
              selected={index === highlighted}
              targetWidth={targetWidth}
            />
          ))
        )}
      </Box>

      <Box>
        {status === undefined ? (
          <Text> </Text>
        ) : (
          <Text
            color={status.kind === "error" ? "red" : undefined}
            dimColor={status.kind !== "error"}
          >
            {status.text}
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        {mode.kind === "add" ? (
          <>
            <Text>host:port ▸ </Text>
            <TextInput
              value={mode.input}
              placeholder="pu-dev:5173"
              onChange={onInputChange}
              onSubmit={onInputSubmit}
            />
            <Text dimColor>{"  (enter to add · esc to cancel)"}</Text>
          </>
        ) : (
          <Text dimColor>a add · x cancel · ↑/↓ move · q quit</Text>
        )}
      </Box>
    </Box>
  );
}

/** One forward: what it points at, the URL it answers on (a real terminal
 *  hyperlink), and how long it has been up. */
function Row({
  forward,
  hostname,
  now,
  selected,
  targetWidth,
}: {
  forward: Forward;
  hostname: string;
  now: number;
  selected: boolean;
  targetWidth: number;
}) {
  const url = forwardUrl(hostname, forward.localPort);
  const colour = selected ? "cyan" : undefined;
  return (
    <Box>
      <Text color={colour}>{selected ? "› " : "  "}</Text>
      <Box width={targetWidth} flexShrink={0}>
        <Text color={colour}>{formatTarget(forward.target)}</Text>
      </Box>
      <Text dimColor>{"  →  "}</Text>
      <Text color={colour}>{hyperlink(url)}</Text>
      <Text dimColor>{`  up ${formatUptime(now - forward.createdAt)}`}</Text>
    </Box>
  );
}
