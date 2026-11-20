export interface ProbeLog {
  readonly lastProbeAt: number | undefined;
  readonly lastProbeOk: boolean | undefined;
  readonly lastStaleAt: number | undefined;
  readonly retiredAt: number | undefined;
}

let lastProbeAt: number | undefined;
let lastProbeOk: boolean | undefined;
let lastStaleAt: number | undefined;
let retiredAt: number | undefined;

export function recordProbeSettled(ok: boolean, atMs: number): void {
  lastProbeAt = atMs;
  lastProbeOk = ok;
  if (!ok) lastStaleAt = atMs;
}

export function recordWireRetired(atMs: number = Date.now()): void {
  retiredAt ??= atMs;
}

export function probeLog(): ProbeLog {
  return { lastProbeAt, lastProbeOk, lastStaleAt, retiredAt };
}
