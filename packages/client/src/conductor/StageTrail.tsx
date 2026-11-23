/** THE TRAIL — every visit a picked work made, in order, above its timeline.
 *
 *  The map says how often a work went round each loop; the trail says when.
 *  Each visit is one segment, as wide as it was long (with a least width, so
 *  a short visit can still be seen and pressed), in the colour that names
 *  its stage — the same as on the map (`STAGE_INK`). The visit the work is
 *  in now is ringed. The stretch kolu could not vouch for — a work saved
 *  before it kept hand-offs, whose build and review were not recorded — is
 *  hatched and set apart from the stages.
 *
 *  Under the segments, the labels (`./trailView.ts`): one per visit, except
 *  a run of review rounds, which is labelled once (`6 review rounds · 1h
 *  10m`). Every segment also carries its stage, its time and where it stands
 *  in its title and for a screen reader.
 *
 *  It is an INDEX INTO THE TIMELINE: pressing a segment shows that visit's
 *  events, and the visit shown is pressed.
 *
 *  `<Index>`, because a visit's POSITION is its identity — the trail only
 *  grows at its end — and the fold mints fresh objects every tick. */

import { compactPhrase, dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import type { Filed, Visit } from "kolu-work";
import { type Component, createMemo, Index } from "solid-js";
import { type TrailLabel, trailLabels, visitMs } from "./trailView";
import { STAGE_INK, STAGE_LABEL } from "./workReadings";

/** What a stretch nobody recorded is, in words — the hatch says it to the
 *  eye. */
const UNRECORDED_WORDS = "who held the work was not recorded for this stretch";

/** A visit's name as a label and a title say it: `Build 15m`, or the
 *  sentence for a stretch nobody recorded. */
const nameOf = (stage: Filed, ms: number): string =>
  stage === "unrecorded"
    ? `Not recorded ${compactPhrase(ms)}`
    : `${STAGE_LABEL[stage]} ${compactPhrase(ms)}`;

/** ONE SENTENCE PER VISIT — what a screen reader hears and the title says. */
const spokenOf = (visit: Visit, index: number): string =>
  [
    `${index + 1}. ${STAGE_LABEL[visit.stage]} ${dualPhrase(visitMs(visit))}`,
    ...(visit.stage === "unrecorded" ? [UNRECORDED_WORDS] : []),
    ...(Option.isNone(visit.until) ? ["now"] : []),
  ].join(", ");

/** A label's words under the trail. */
const labelWords = (label: TrailLabel): string => {
  const now = label.now ? " · now" : "";
  return label.kind === "rounds"
    ? `${label.rounds} review rounds · ${compactPhrase(label.ms)}${now}`
    : `${nameOf(label.stage, label.ms)}${now}`;
};

const StageTrail: Component<{
  /** The work's visits, in order — `kolu-work`'s `stages`' `trail`. */
  trail: ReadonlyArray<Visit>;
  /** The visit whose events the timeline shows, and how to show another. */
  index: {
    readonly shown: () => number | undefined;
    readonly show: (visit: number) => void;
  };
}> = (props) => {
  const labels = createMemo(() => trailLabels(props.trail));
  return (
    <section data-testid="stage-trail" class="mt-2.5">
      <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
        Trail
      </h4>
      {/* THE ROW SCROLLS SIDEWAYS, and a scrolling box clips both ways, so
          it pads every side by more than the ring (2px and a 1px gap) and
          the outline (1px off by 1px) reach past a segment. The ringed and
          the pressed segment sit above their neighbours. */}
      <ol
        aria-label="Trail"
        class="m-0 flex h-6 list-none items-stretch gap-px overflow-x-auto p-1"
      >
        <Index each={props.trail}>
          {(visit, index) => {
            const open = () => Option.isNone(visit().until);
            const shown = () => props.index.shown() === index;
            return (
              <li
                data-testid="trail-visit"
                data-stage={visit().stage}
                data-visit={index}
                data-now={open() ? "" : undefined}
                title={spokenOf(visit(), index)}
                style={{
                  flex: `${visitMs(visit())} 1 0`,
                  "min-width": "0.6rem",
                }}
                class={`flex ${visit().stage === "unrecorded" ? "mx-1" : ""} ${
                  open() || shown() ? "relative z-10" : ""
                }`}
              >
                <button
                  type="button"
                  data-testid="trail-visit-cell"
                  aria-pressed={shown()}
                  aria-label={spokenOf(visit(), index)}
                  class={`block h-full w-full cursor-pointer rounded-sm hover:brightness-125 ${
                    STAGE_INK[visit().stage].fill
                  } ${
                    open()
                      ? "ring-2 ring-fg ring-offset-1 ring-offset-surface-0"
                      : ""
                  } ${shown() ? "outline outline-1 outline-offset-1 outline-fg-2" : ""}`}
                  onClick={() => props.index.show(index)}
                />
              </li>
            );
          }}
        </Index>
      </ol>
      <ul
        aria-hidden="true"
        class="m-0 mt-1 flex list-none flex-wrap gap-x-2.5 gap-y-0.5 p-0 font-mono text-[0.58rem] text-fg-3"
      >
        <Index each={labels()}>
          {(label) => (
            <li
              data-testid="trail-label"
              data-kind={label().kind}
              data-now={label().now ? "" : undefined}
              class={`flex items-center gap-1 whitespace-nowrap ${
                label().now ? "text-fg" : ""
              }`}
            >
              <span
                class={`inline-block h-1.5 w-1.5 rounded-full ${
                  STAGE_INK[
                    (() => {
                      const it = label();
                      return it.kind === "rounds" ? "review" : it.stage;
                    })()
                  ].fill
                }`}
              />
              {labelWords(label())}
            </li>
          )}
        </Index>
      </ul>
    </section>
  );
};

export default StageTrail;
