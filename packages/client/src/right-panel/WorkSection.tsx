import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { shortSha } from "@odu/run-client/nodeId";
import { logHash, runHash } from "@odu/service-client/routes";
import {
  type LaneSpan,
  laneSpan,
  runElapsedMs,
  runStatus,
  scopeSuffix,
  type StatusHue,
  timelineTicks,
} from "@odu/service-client/board";
import {
  STATUS_META,
  type RunNode,
  type RunRow,
} from "@odu/service-client/surface";
import { type CheckStatus, type PrInfo, prValue } from "anyforge/schemas";
import { prUnavailableSource } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { ChecksIndicator, PrStateIcon } from "@kolu/solid-dockrow";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import { assignColors } from "../terminal/terminalDisplay";
import { getClockNow } from "../time/clock";
import Chip from "../ui/Chip";
import Disclosure from "../ui/Disclosure";
import { WorktreeIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import Row from "../ui/Row";
import Section from "../ui/Section";
import { activeHost, interpretClientError, padiMap } from "../wire";
import { useShown } from "../ui/shown";
import type { OduLinkAct, OduLinkOutlet } from "./useOduLink";

const TRIAGE: readonly CheckStatus[] = ["fail", "pending", "pass"];

const OUTCOME: Record<
  CheckStatus,
  { word: string; glyph: string; tone: "ok" | "warning" | "danger" }
> = {
  fail: { word: "failed", glyph: "✕", tone: "danger" },
  pending: { word: "running", glyph: "●", tone: "warning" },
  pass: { word: "passed", glyph: "✓", tone: "ok" },
};

const countChecks = (
  runs: PrInfo["checkRuns"],
): Record<CheckStatus, number> => {
  const counts: Record<CheckStatus, number> = { fail: 0, pending: 0, pass: 0 };
  for (const run of runs) counts[run.outcome] += 1;
  return counts;
};

const ciRollup = (
  checks: CheckStatus,
  counts: Record<CheckStatus, number>,
): { label: string; tone: "ok" | "warning" | "danger" } => {
  const { word, glyph, tone } = OUTCOME[checks];
  const n = counts[checks];
  return {
    label: n === 0 ? `${glyph} CI ${word}` : `${glyph} ${n} ${word}`,
    tone,
  };
};

const laneRank = (lane: RunNode): number => {
  const meta = STATUS_META[lane.status];
  return meta.isRed ? 0 : meta.progress === "running" ? 1 : 2;
};

const checksSummary = (counts: Record<CheckStatus, number>): string =>
  TRIAGE.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${OUTCOME[o].word}`)
    .join(" · ");

const foldPrChecks = (
  pr: PrInfo,
): PrInfo & {
  summary: string;
  rollup: { label: string; tone: "ok" | "warning" | "danger" } | null;
  hasException: boolean;
} => {
  const counts = countChecks(pr.checkRuns);
  return {
    ...pr,
    checkRuns: [...pr.checkRuns].sort(
      (a, b) => TRIAGE.indexOf(a.outcome) - TRIAGE.indexOf(b.outcome),
    ),
    summary: checksSummary(counts),
    rollup: pr.checks ? ciRollup(pr.checks, counts) : null,
    hasException: pr.checks !== null && pr.checks !== "pass",
  };
};

const laneHash = (
  run: Pick<RunRow, "runId">,
  lane: Pick<RunNode, "logKey">,
): string => (lane.logKey === "" ? runHash(run.runId) : logHash(lane.logKey));

const ODU_URL = "https://juspay.github.io/odu/";

interface HuePaint {
  tone: "neutral" | "ok" | "warning" | "danger";
  glyph: string;
  text: string;
}

const ODU_HUE: Record<StatusHue, HuePaint> = {
  grey: { tone: "neutral", glyph: "○", text: "text-fg-3" },
  amber: { tone: "warning", glyph: "●", text: "text-warning" },
  green: { tone: "ok", glyph: "✓", text: "text-ok" },
  red: { tone: "danger", glyph: "✕", text: "text-danger" },
  violet: { tone: "danger", glyph: "⚠", text: "text-alert" },
};

const oduRef = (run: RunRow): string => {
  const short = shortSha(run.sha);
  const ref = run.seq === null ? short : `${short}#${run.seq}`;
  return run.dirty ? `${ref}+dirty` : ref;
};

const SUBHEAD =
  "pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-3/60";

const ODU_TABLE = "grid gap-x-1.5 gap-y-0.5 text-[11px]";
const ODU_TABLE_COLUMNS = {
  lanes: "grid-cols-[auto_minmax(0,1.6fr)_auto_minmax(2.5rem,1fr)_auto_auto]",
  recent: "grid-cols-[minmax(0,auto)_auto_auto_minmax(0,1fr)_auto_auto]",
} as const;
const ODU_TABLE_ROW = "col-span-full grid grid-cols-subgrid items-center";
const CHIP_ROW = "inline-flex";
const ODU_TITLE = "open in odu";

const OduTable: Component<{
  columns: keyof typeof ODU_TABLE_COLUMNS;
  testid: string;
  children: JSX.Element;
}> = (props) => (
  <ul
    data-testid={props.testid}
    class={`${ODU_TABLE} ${ODU_TABLE_COLUMNS[props.columns]}`}
  >
    {props.children}
  </ul>
);

const OduTableRow: Component<{ children: JSX.Element }> = (props) => (
  <li class={ODU_TABLE_ROW}>{props.children}</li>
);

const visibleSpan = (span: LaneSpan | null): LaneSpan | null =>
  span === null || span.left >= 1 ? null : span;

const LaneRow: Component<{
  lane: RunNode;
  span: LaneSpan | null;
}> = (props) => {
  const status = () => STATUS_META[props.lane.status];
  const hue = () => ODU_HUE[status().hue].text;
  const bar = (): LaneSpan | null => visibleSpan(props.span);
  const barTitle = (span: LaneSpan): string =>
    `started +${compactPhrase(span.startedAfterMs)} · ${
      span.kind === "running"
        ? "still running"
        : `took ${compactPhrase(span.tookMs)}`
    }`;
  return (
    <>
      <span class={`w-3 text-center ${hue()}`} title={props.lane.status}>
        {status().glyph}
      </span>
      <span
        class={`min-w-0 truncate font-mono group-hover/lane:underline ${hue()}`}
        classList={{ "font-semibold": status().isRed }}
      >
        {props.lane.id}
      </span>
      <span class="text-fg-3">
        {props.lane.attempt > 1 ? `#${props.lane.attempt}` : ""}
      </span>
      <span class="relative h-2.5 self-center overflow-hidden rounded-sm bg-fg-3/10">
        <Show when={bar()}>
          {(span) => (
            <span
              data-testid="inspector-odu-lane-bar"
              class={`absolute inset-y-0 min-w-0.5 rounded-sm opacity-60 ${hue()}`}
              classList={{
                "bg-current": span().kind === "settled",
                "bg-[repeating-linear-gradient(135deg,currentColor_0_3px,transparent_3px_6px)]":
                  span().kind === "running",
              }}
              style={{
                left: `${span().left * 100}%`,
                width: `${span().width * 100}%`,
              }}
              title={barTitle(span())}
            />
          )}
        </Show>
      </span>
      <span class="text-right tabular-nums text-fg-3">
        {props.lane.durationMs === null
          ? ""
          : compactPhrase(props.lane.durationMs)}
      </span>
      <span class="font-mono text-fg-3">{props.lane.host ?? ""}</span>
    </>
  );
};

type OduReachArm = OduLinkAct | { kind: "none" };

const OduReach: Component<{
  act: () => OduLinkAct | undefined;
  onOpen: () => void;
  testid?: string;
  class: string;
  children: JSX.Element;
}> = (props) => {
  const reach = createMemo((): OduReachArm => props.act() ?? { kind: "none" });
  const address = createMemo(() => {
    const arm = reach();
    return arm.kind === "address" ? arm.href : undefined;
  });
  return (
    <Switch fallback={<div class={props.class}>{props.children}</div>}>
      <Match when={address()}>
        {(href) => (
          <a
            href={href()}
            target="_blank"
            rel="noopener noreferrer"
            class={`${props.class} group/lane`}
            title={ODU_TITLE}
            data-testid={props.testid}
          >
            {props.children}
          </a>
        )}
      </Match>
      <Match when={reach().kind === "door"}>
        <button
          type="button"
          class={`${props.class} group/lane cursor-pointer text-left`}
          title={ODU_TITLE}
          data-testid={props.testid}
          onClick={() => props.onOpen()}
        >
          {props.children}
        </button>
      </Match>
    </Switch>
  );
};

const RepoIdentityChip: Component<{ name: string; color: string }> = (
  props,
) => (
  <span
    class="fleet-hue-chip fleet-hue-chip--with-mono"
    style={{ "--chip-hue": props.color }}
    title={props.name}
    data-testid="inspector-repo-chip"
  >
    <RepoMonogram
      group={props.name}
      color={props.color}
      size="xs"
      data-testid="inspector-repo-monogram"
    />
    <span class="truncate" data-testid="inspector-repo">
      {props.name}
    </span>
  </span>
);

const BranchIdentityChip: Component<{
  branch: string;
  isWorktree: boolean;
  color: string;
}> = (props) => (
  <span
    class="fleet-hue-chip"
    style={{ "--chip-hue": props.color }}
    title={props.isWorktree ? "worktree" : undefined}
    data-testid="inspector-branch"
  >
    <Show when={props.isWorktree}>
      <WorktreeIcon class="h-3 w-3 shrink-0 opacity-60" />
    </Show>
    <span class="truncate font-semibold">{props.branch}</span>
  </span>
);

const WorkSection: Component<{
  meta: TerminalMetadata;
  odu?: OduLinkOutlet;
}> = (props) => {
  const gitIdentityWithPaint = createMemo(() => {
    if (props.meta.git.kind !== "repo") return null;
    const git = props.meta.git.info;
    const { group, label } = terminalKey(props.meta);
    const colors = assignColors([group, label]);
    const repoColor = colors.get(group);
    const annotationColor = colors.get(label);
    if (!repoColor || !annotationColor) {
      throw new Error(
        `assignColors missing inspector keys for ${group}/${label}`,
      );
    }
    return { git, repoColor, annotationColor };
  });
  const work = createMemo(() => {
    const arm = activeArm(props.meta);
    if (!arm) return null;
    const unavailable = prUnavailableSource(arm.pr);
    const pr = prValue(arm.pr);
    return pr
      ? { unavailable, pr: foldPrChecks(pr) }
      : { unavailable, pr: null };
  });
  const shown = useShown();
  const checkout = padiMap.useEntry(activeHost).odu.streams.checkout.use(
    () => {
      const git = activeArm(props.meta)?.git;
      return !shown() || git === undefined || git.kind !== "repo"
        ? null
        : { repoRoot: git.info.repoRoot };
    },
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "odu CI status" },
          err,
          {
            key: activeHost(),
          },
        ),
    },
  );
  const odu = createMemo(() => {
    const frame = checkout();
    if (frame === undefined || frame.latest === null) return null;
    const { run, nodes } = frame.latest;
    const lanes = [...nodes].sort((a, b) => laneRank(a) - laneRank(b));
    const status = runStatus(run);
    const word = status.label;
    const scope = scopeSuffix(run.scope);
    let failed = 0;
    for (const lane of lanes) if (STATUS_META[lane.status].isRed) failed += 1;
    return {
      run,
      lanes,
      recent: frame.recent,
      tone: ODU_HUE[status.hue].tone,
      label: `${ODU_HUE[status.hue].glyph} ${
        word === "failed" && failed > 0 ? `${failed} ${word}` : `odu ${word}`
      } ${oduRef(run)}`,
      summary: `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"}${
        failed > 0 ? ` · ${failed} failed` : ""
      }${scope === null ? "" : ` · ${scope}`}`,
    };
  });
  const now = getClockNow();
  return (
    <Section title="Work" accent="border-accent">
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <Show when={gitIdentityWithPaint()}>
            {(id) => (
              <>
                <BranchIdentityChip
                  branch={id().git.branch}
                  isWorktree={id().git.isWorktree}
                  color={id().annotationColor}
                />
                <RepoIdentityChip
                  name={id().git.repoName}
                  color={id().repoColor}
                />
              </>
            )}
          </Show>
          <Show when={work()?.pr}>
            {(p) => (
              <>
                <a
                  href={p().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:underline"
                  data-testid="inspector-pr-link"
                >
                  <Chip tone="neutral">
                    <PrStateIcon state={p().state} class="h-3 w-3 shrink-0" />
                    <span class="text-accent">#{p().number}</span>
                  </Chip>
                </a>
                <Show when={p().rollup}>
                  {(rollup) => (
                    <Chip tone={rollup().tone} data-testid="inspector-ci">
                      {rollup().label}
                    </Chip>
                  )}
                </Show>
              </>
            )}
          </Show>
          <Show when={odu()}>
            {(ci) => (
              <OduReach
                act={() => props.odu?.act(runHash(ci().run.runId))}
                onOpen={() => props.odu?.open(runHash(ci().run.runId))}
                class={CHIP_ROW}
              >
                <Chip tone={ci().tone} data-testid="inspector-odu-chip">
                  {ci().label}
                </Chip>
              </OduReach>
            )}
          </Show>
        </div>

        <Show when={work()?.pr}>
          {(p) => (
            <div class="text-[11.5px] leading-snug text-fg">{p().title}</div>
          )}
        </Show>

        <div
          class="break-all font-mono text-[10.5px] leading-relaxed text-fg-3"
          data-testid="inspector-directory"
        >
          {props.meta.cwd}
        </div>

        <Show when={work()?.pr}>
          {(p) => (
            <Show when={p().checkRuns.length > 0}>
              <Disclosure summary={p().summary} open={p().hasException}>
                <ul
                  data-testid="inspector-pr-checks"
                  class="flex flex-col gap-0.5 text-[11px]"
                >
                  <For each={p().checkRuns}>
                    {(c) => (
                      <li class="flex min-w-0 items-center gap-1.5">
                        <ChecksIndicator status={c.outcome} />
                        <span
                          class="min-w-0 truncate font-mono"
                          classList={{
                            "text-danger font-semibold": c.outcome === "fail",
                          }}
                        >
                          {c.name}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Disclosure>
            </Show>
          )}
        </Show>

        <Show when={checkout.error()?.message}>
          {(reason) => (
            <div
              data-testid="inspector-odu-error"
              class="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-warning"
            >
              <span aria-hidden="true">⚠</span>
              <span class="min-w-0 break-words">
                odu CI unavailable — {reason()}
              </span>
            </div>
          )}
        </Show>

        <Show when={odu()}>
          {(ci) => (
            <Disclosure
              summary={
                <>
                  <a
                    href={ODU_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="odu: the CI runner for this checkout"
                    class="hover:underline"
                    data-testid="inspector-odu-link"
                  >
                    CI by odu ↗
                  </a>
                  {` · ${ci().summary}`}
                </>
              }
              open
              data-testid="inspector-odu"
            >
              <Show when={ci().lanes.length > 0}>
                <div class={SUBHEAD}>Lanes</div>
                <OduTable columns="lanes" testid="inspector-odu-lanes">
                  <li
                    data-testid="inspector-odu-lane-axis"
                    aria-hidden="true"
                    class="relative col-start-4 h-3 text-[10px] text-fg-3"
                  >
                    <For each={timelineTicks(ci().run, now())}>
                      {(tick) => (
                        <span
                          class="absolute top-0 border-l border-edge pl-0.5"
                          classList={{
                            "-translate-x-full border-l-0 border-r pr-0.5 pl-0":
                              tick.at === 1,
                          }}
                          style={{ left: `${tick.at * 100}%` }}
                        >
                          {tick.at === 0 || tick.at === 1
                            ? compactPhrase(tick.ms)
                            : ""}
                        </span>
                      )}
                    </For>
                  </li>
                  <For each={ci().lanes}>
                    {(lane) => (
                      <OduTableRow>
                        <OduReach
                          act={() => props.odu?.act(laneHash(ci().run, lane))}
                          onOpen={() =>
                            props.odu?.open(laneHash(ci().run, lane))
                          }
                          testid="inspector-odu-lane-link"
                          class={ODU_TABLE_ROW}
                        >
                          <LaneRow
                            lane={lane}
                            span={laneSpan(lane, ci().run, now())}
                          />
                        </OduReach>
                      </OduTableRow>
                    )}
                  </For>
                </OduTable>
              </Show>
              <div class={SUBHEAD}>Recent runs</div>
              <OduTable columns="recent" testid="inspector-odu-recent">
                <For each={ci().recent}>
                  {(run, index) => (
                    <OduTableRow>
                      <OduReach
                        act={() => props.odu?.act(runHash(run.runId))}
                        onOpen={() => props.odu?.open(runHash(run.runId))}
                        testid="inspector-odu-run-link"
                        class={ODU_TABLE_ROW}
                      >
                        <span class="min-w-0 truncate font-mono group-hover/lane:underline">
                          {oduRef(run)}
                        </span>
                        <span class={ODU_HUE[runStatus(run).hue].text}>
                          {runStatus(run).label}
                        </span>
                        <span
                          data-testid="inspector-odu-run-took"
                          class="text-right tabular-nums text-fg-3"
                        >
                          {compactPhrase(runElapsedMs(run, now()))}
                        </span>
                        <span
                          class="min-w-0 truncate text-fg-3"
                          title={scopeSuffix(run.scope) ?? undefined}
                        >
                          {scopeSuffix(run.scope) ?? ""}
                        </span>
                        <span class="text-fg-3">
                          {index() === 0 ? "current" : ""}
                        </span>
                        <span class="text-right text-fg-3">
                          {agoPhrase(run.createdAt, now())}
                        </span>
                      </OduReach>
                    </OduTableRow>
                  )}
                </For>
              </OduTable>
            </Disclosure>
          )}
        </Show>

        <Show when={gitIdentityWithPaint()}>
          {(id) => (
            <Disclosure summary="Repo paths">
              <Row label="Root">
                <span class="font-mono text-fg-3">{id().git.mainRepoRoot}</span>
              </Row>
              <Show when={id().git.isWorktree}>
                <Row label="Worktree">
                  <span class="font-mono text-fg-3">{id().git.repoRoot}</span>
                </Row>
              </Show>
            </Disclosure>
          )}
        </Show>

        <Show when={work()?.unavailable}>
          {(source) => (
            <div
              data-testid="inspector-pr-unavailable"
              class="space-y-2 pt-1 text-xs"
            >
              <ProviderUnavailableContent source={source()} />
            </div>
          )}
        </Show>
      </div>
    </Section>
  );
};

export default WorkSection;
