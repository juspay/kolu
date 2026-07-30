export interface ListeningScan {
  readonly trailingPartialLine: string;
  readonly ownsPort: boolean;
}

export function devSmokeJustArgs(
  ports: Readonly<{ server: number; client: number }>,
): string[] {
  return ["--no-deps", "dev", String(ports.server), String(ports.client)];
}

/** Scan complete log lines for kolu-server's own listening banner.
 *
 * The line boundary is load-bearing: `just dev` separately echoes the selected
 * port before it starts either child, so matching the banner and port anywhere
 * in one shared buffer would make the port check vacuous. */
export function scanKoluListeningOutput(
  trailingPartialLine: string,
  chunk: string,
  expectedPort: number,
): ListeningScan {
  const lines = `${trailingPartialLine}${chunk}`.split(/\r?\n/);
  let nextTrailingPartialLine = lines.pop() ?? "";
  const ownsPort = lines.some(
    (line) =>
      line.includes("kolu listening") && line.includes(`:${expectedPort}`),
  );

  if (nextTrailingPartialLine.length > 16_384) {
    nextTrailingPartialLine = nextTrailingPartialLine.slice(-4_096);
  }

  return { trailingPartialLine: nextTrailingPartialLine, ownsPort };
}
