import type { LogLine } from "@kolu/solid-logtail";

interface TailMark {
  readonly key: string;
  readonly line: string;
  readonly atMs: number;
}

const marks = new Map<string, TailMark>();

export function noteConnectTail(
  hostEnc: string,
  log: readonly LogLine[],
  nowMs: number,
): void {
  const last = log.at(-1);
  if (last === undefined) {
    marks.delete(hostEnc);
    return;
  }
  const key = `${log.length}\u0000${last.line}`;
  if (marks.get(hostEnc)?.key !== key)
    marks.set(hostEnc, { key, line: last.line, atMs: nowMs });
}

export interface ConnectQuiet {
  readonly lastLine: string;
  readonly silentMs: number;
}

export function connectTailQuiet(
  hostEnc: string,
  nowMs: number,
): ConnectQuiet | undefined {
  const mark = marks.get(hostEnc);
  return mark === undefined
    ? undefined
    : { lastLine: mark.line, silentMs: Math.max(0, nowMs - mark.atMs) };
}

export function pruneConnectTails(memberEncs: readonly string[]): void {
  const keep = new Set(memberEncs);
  for (const k of marks.keys()) if (!keep.has(k)) marks.delete(k);
}

export function resetConnectTails(): void {
  marks.clear();
}
