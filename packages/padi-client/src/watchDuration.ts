import { isValidTimerMs, timerRangeMessage } from "@kolu/surface/wait";

export type Parsed<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string };

const DURATION = /^(\d+)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(
  flag: string,
  raw: string,
  min: { readonly ms: number; readonly why: string },
  effect: string,
): Parsed<number> {
  const m = DURATION.exec(raw.trim());
  if (m === null) {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)} is not a duration. Write a whole number of milliseconds (60000), or add a unit: 500ms, 60s, 5m, 2h, 1d.`,
    };
  }
  const ms =
    Number(m[1]) * (m[2] === undefined ? 1 : (UNIT_MS[m[2]] as number));
  if (ms < min.ms) {
    return { kind: "error", message: `${flag} ${raw}: ${min.why}` };
  }
  if (ms > 0 && !isValidTimerMs(ms)) {
    return {
      kind: "error",
      message: timerRangeMessage(flag, effect, raw),
    };
  }
  return { kind: "ok", value: ms };
}

const NAG_MIN = {
  ms: 1,
  why: "an interval of zero is a spin, not a fast nag — it would re-report every terminal as fast as the daemon can loop. Pass a real interval (5m), or leave it off to be told once.",
} as const;

const NAG_EFFECT = "re-fires";

const COUNT = /^(\d+)$/;

/** Read an interval and its optional CAP — `30m`, or `30m/3` for "three
 *  reminders past the first report, then quiet". */
export function parseNag(
  flag: string,
  raw: string,
): Parsed<{ readonly ms: number; readonly count?: number }> {
  const parts = raw.split("/");
  if (parts.length === 1) {
    const ms = parseDuration(flag, raw, NAG_MIN, NAG_EFFECT);
    return ms.kind === "ok" ? { kind: "ok", value: { ms: ms.value } } : ms;
  }
  if (parts.length > 2) {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)}: one slash only — the count after the slash caps the repetition. Write ${flag} 30m/3.`,
    };
  }
  const [interval = "", count = ""] = parts;
  if (interval === "") {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)}: the count after the slash caps the interval BEFORE it — and that interval is empty. ${flag} 30m/3 is "every 30 minutes, three reminders, then quiet", ${flag} 30m the same without a cap.`,
    };
  }
  const ms = parseDuration(flag, interval, NAG_MIN, NAG_EFFECT);
  if (ms.kind === "error") return ms;
  const head = COUNT.exec(count);
  const n = head === null ? NaN : Number(head[1]);
  if (!Number.isSafeInteger(n) || n < 1) {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)}: the count after the slash must be a positive whole number of reminders — ${JSON.stringify(count)} is none. ${flag} 30m/3 is "every 30 minutes, three reminders, then quiet".`,
    };
  }
  return { kind: "ok", value: { ms: ms.value, count: n } };
}
