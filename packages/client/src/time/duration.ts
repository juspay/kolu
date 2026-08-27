/** The app's own compact-duration readout — the ONE that is kolu-client's and
 *  not the shared vocabulary's.
 *
 *  The LADDER and the two phrases every surface says with it (`compactDelta`,
 *  `compactPhrase`, `agoPhrase`) moved to `@kolu/terminal-vocab/duration`, so a
 *  package that renders kolu's Dock row can say the Dock's words instead of
 *  inventing a fourth spelling of them. What stayed is the one formatter with a
 *  single caller and an app-shaped rule: the connect overlay's live timer. */
import { DASH } from "kolu-common/surface";
import { compactDelta } from "@kolu/terminal-vocab/duration";

/** A compact elapsed readout for a LIVE, seconds-granularity timer — `"45s"` under a
 *  minute, `"2m 3s"` above (dual-unit so a minutes-long connect still shows its seconds
 *  ticking). Built on the {@link compactDelta} ladder so the thresholds live in ONE
 *  place — the connect overlay's elapsed timer reads this rather than hand-rolling
 *  `Math.floor(secs/60)` in a domain module. Distinct from the hours-scale single-unit
 *  `compactPhrase`/`formatUptime` (which want `2h`, not `2h 3s`) precisely because a
 *  live connect timer wants its seconds visible.
 *
 *  Seconds tick only under the MINUTE tier. Past an hour the second half comes from
 *  the ladder's own `sub` unit, because appending seconds-within-the-minute beside an
 *  hours figure reads as a duration and isn't one: a two-hour reconnect rendered
 *  "2h 47s", a number that cycles 0-59 every second and answers no question anyone
 *  has. This is the readout a connection outage sits on, so it is exactly the timer
 *  that crosses an hour. */
export function formatElapsedShort(ms: number): string {
  const d = compactDelta(ms);
  if (d.kind === "unknown") return DASH;
  if (d.unit === "s") return `${d.value}s`;
  // The minute tier has no `sub` on the ladder — its finer unit is the live
  // second, which is the whole point of this formatter.
  if (d.unit === "m") return `${d.value}m ${Math.floor(ms / 1000) % 60}s`;
  return d.sub
    ? `${d.value}${d.unit} ${d.sub.value}${d.sub.unit}`
    : `${d.value}${d.unit}`;
}
