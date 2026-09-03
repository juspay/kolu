/**
 * How a watch face spells an interval — and its optional CAP — as ONE argument.
 *
 * `--nag 30m/3` is "every thirty minutes, three reminders past the first
 * report, then quiet"; a bare `--nag 30m` is the same interval repeating
 * forever. The count cannot be named on its own — a cap on a repetition that
 * never starts is nothing — which is why it lives HERE, after the slash, and
 * not as a fourth knob: the pairing is then unparseable rather than refused
 * twice at two faces. The wire still carries the two facts as two fields
 * (`nagMs` + `nagCount`) and padi's decode refuses the orphan there — this
 * module is the SPELING the faces offer; the wire is the fact.
 *
 * Both faces read THIS parser: `kolu watch` (where `flag` prints as `--nag`)
 * and the MCP `watch_open` (where it prints as `nagMs`, and a string is
 * accepted beside the historic bare number). A refusal says which face's word
 * it is through `flag`, the same parameterization `parseDuration` already
 * carried for its own sentences before the slash existed.
 */

import { isValidTimerMs, timerRangeMessage } from "@kolu/surface/wait";

export type Parsed<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string };

/** How long, spelled the way a person writes it — and the unit is OPTIONAL,
 *  because a bare number in the `kolu` binary already means milliseconds.
 *
 *  `--timeout 10000`, `--settled 15000` and `--until idle:2000` are all bare
 *  millisecond integers, so refusing `--held-for 60000` would make one binary
 *  hold two mutually-refusing duration grammars — a user who has learned the
 *  other four flags gets an error for spelling this one the same way. One
 *  grammar, then: milliseconds, with a suffix for flags whose natural values
 *  are minutes and hours (nobody wants to read `--nag 300000`). The suffix is
 *  a convenience ON the existing spelling, not a second one. */
const DURATION = /^(\d+)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  // `d`, because `relativeTime` — the fold the feed's hold column is RENDERED
  // with — emits `2d`. A grammar you can read out of the output and not type
  // back in is half a grammar, and the ceiling is ~24.8 days, so `1d`–`24d`
  // are all values the feed can print.
  d: 86_400_000,
};

/** Read a duration for `flag`, refusing anything below `min`.
 *
 *  `min` is a PARAMETER because it is the flag's own fact and the flag's own
 *  sentence: a hold of 0 means "report it the instant it enters", an interval
 *  of 0 is a spin. */
export function parseDuration(
  flag: string,
  raw: string,
  min: { readonly ms: number; readonly why: string },
): Parsed<number> {
  const m = DURATION.exec(raw.trim());
  if (m === null) {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)} is not a duration. Write a whole number of milliseconds (60000), or add a unit: 500ms, 60s, 5m, 2h, 1d.`,
    };
  }
  // An omitted unit is `ms` — see the grammar note above.
  const ms =
    Number(m[1]) * (m[2] === undefined ? 1 : (UNIT_MS[m[2]] as number));
  if (ms < min.ms) {
    return { kind: "error", message: `${flag} ${raw}: ${min.why}` };
  }
  if (ms > 0 && !isValidTimerMs(ms)) {
    // The one ceiling sentence, from the module that owns the ceiling — so a
    // user who overshoots `--timeout` and one who overshoots `--nag` are taught
    // the same limit in the same words.
    return {
      kind: "error",
      message: timerRangeMessage(flag, "fires immediately, forever", raw),
    };
  }
  return { kind: "ok", value: ms };
}

const NAG_MIN = {
  ms: 1,
  why: "an interval of zero is a spin, not a fast nag — it would re-report every terminal as fast as the daemon can loop. Pass a real interval (5m), or leave it off to be told once.",
} as const;

const COUNT = /^(\d+)$/;

/** Read an interval and its optional CAP — `30m`, or `30m/3` for "three
 *  reminders past the first report, then quiet". The count after the slash is
 *  the ONLY place it can be spelled, so it can never be named without the
 *  interval it caps. */
export function parseNag(
  flag: string,
  raw: string,
): Parsed<{ readonly ms: number; readonly count?: number }> {
  const slash = raw.indexOf("/");
  if (slash === -1) {
    const ms = parseDuration(flag, raw, NAG_MIN);
    return ms.kind === "ok" ? { kind: "ok", value: { ms: ms.value } } : ms;
  }
  const [interval, count, stray] = raw.split("/") as [
    string,
    string,
    ...string[],
  ];
  if (stray !== undefined) {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)}: one slash only — the count after the slash caps the repetition. Write ${flag} 30m/3.`,
    };
  }
  if (interval === "") {
    return {
      kind: "error",
      message: `${flag} ${JSON.stringify(raw)}: nothing after the slash can carry an interval — the interval comes before it: ${flag} 30m/3 is "every 30 minutes, three reminders, then quiet", ${flag} 30m the same without a cap.`,
    };
  }
  const ms = parseDuration(flag, interval, NAG_MIN);
  if (ms.kind === "error") return ms;
  // The count is a bare whole number and nothing else: "0s/3" is a no-op
  // spelled loudly, and a count of zero reminders says what leaving the nag
  // off already says.
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
