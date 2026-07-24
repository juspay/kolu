/**
 * vazhi's frame — one Ink component tree, filling the terminal.
 *
 * The frame, as a function of what there is to show — no state, no effects, no
 * forward map. Every layout claim about vazhi is a claim about this, which is
 * why it lives apart from `App.tsx`: rendering the screen must not drag ssh,
 * child processes and sockets into a test that only looks at text.
 *
 * Ink (React) rather than OpenTUI/SolidJS, which would have matched this repo's
 * usual grain: OpenTUI's renderer is a native Zig core reached over FFI, and it
 * refuses to start on anything below Node 26.4 with `--experimental-ffi`
 * ("OpenTUI native FFI is not available for this runtime yet" — measured on the
 * pinned toolchain's Node 24). The repo's nixpkgs pin tops out at Node 25, so
 * OpenTUI could not run here at all. Ink is node-native, needs no FFI, and owns
 * the two things this screen actually wants from a framework: flexbox layout
 * and redraw-on-resize.
 */

import { type Forward, formatTarget } from "@kolu/port-forward";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { formatUptime, forwardUrl, hyperlink, viewport } from "./format.ts";

/** The bottom line: the keybind legend, or the `host:port` prompt. */
export type Mode = { kind: "table" } | { kind: "add"; input: string };

/** The one transient message line — what just happened, or what just failed. */
export interface Status {
  kind: "info" | "error";
  text: string;
}

export function Screen({
  forwards,
  hostname,
  mode,
  now,
  onInputChange,
  onInputSubmit,
  selectedKey,
  size,
  status,
}: {
  forwards: readonly Forward[];
  hostname: string;
  mode: Mode;
  now: number;
  onInputChange: (input: string) => void;
  onInputSubmit: (input: string) => void;
  /** WHICH forward is selected, by key — never a position, so the highlight
   *  cannot land on a different row when the list moves. */
  selectedKey: string | undefined;
  size: { columns: number; rows: number };
  status: Status | undefined;
}) {
  // One column width for every target, so the arrows line up whatever the host
  // names are.
  const targetWidth = forwards.reduce(
    (widest, row) => Math.max(widest, formatTarget(row.target).length),
    0,
  );

  // Rows the table may use: the terminal, minus the header, the blank line
  // under it, the status line, the blank line above the legend, and the legend.
  // Reserved explicitly, because letting flex decide loses the legend first.
  const CHROME_ROWS = 5;
  const shown = viewport({
    rows: forwards,
    selectedKey,
    lines: Math.max(1, size.rows - CHROME_ROWS),
  });

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
          <>
            {shown.above > 0 && (
              <Text dimColor>{`  ↑ ${shown.above} more`}</Text>
            )}
            {shown.rows.map((row) => (
              <Row
                key={row.key}
                forward={row}
                hostname={hostname}
                now={now}
                selected={row.key === selectedKey}
                targetWidth={targetWidth}
              />
            ))}
            {shown.below > 0 && (
              <Text dimColor>{`  ↓ ${shown.below} more`}</Text>
            )}
          </>
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
