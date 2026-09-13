/** Test builders for Nix's `--log-format internal-json` stderr — ONE spelling of
 *  the wire line, so a suite that hand-builds an event cannot drift from the
 *  shape `nixLog.ts` reads. Real captured Nix lines stay raw strings in their
 *  own fixtures (see `nixLog.test.ts`). */

/** Nix's internal-json stderr line for `event` — the exact shape the real `nix`
 *  writes (verified against nix 2.34). */
export const nixJsonLine = (event: Record<string, unknown>): string =>
  `@nix ${JSON.stringify(event)}`;

/** Nix's root-error `msg` event line (verbosity level 0) carrying `msg`. */
export const nixErrorLine = (msg: string): string =>
  nixJsonLine({ action: "msg", level: 0, msg });
