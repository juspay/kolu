/** padi's own account of why it is slow, as a section of the Diagnostic Info
 *  dialog — the answer of `diagnostics.read` on the active host's padi.
 *
 *  Fetched when the dialog opens and on **Refresh**, never polled. The fetch
 *  state lives in {@link createPadiDiagnosticsFetch}, owned by the dialog, so
 *  the **Copy JSON** dump carries the same answer this section shows. */

import type { PadiDiagnostics, TimingSummary } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { runAction } from "./runAction";
import { formatSize } from "./ui/memory";
import Row from "./ui/Row";
import Section from "./ui/Section";
import { activeHost, padiMap } from "./wire";

export type PadiDiagnosticsFetch =
  | { readonly kind: "loading"; readonly host: HostKey }
  | {
      readonly kind: "not-connected";
      readonly host: HostKey;
      readonly connection: string;
    }
  | { readonly kind: "error"; readonly host: HostKey; readonly message: string }
  | {
      readonly kind: "answer";
      readonly host: HostKey;
      readonly answer: PadiDiagnostics;
    };

export interface PadiDiagnosticsFetcher {
  readonly state: Accessor<PadiDiagnosticsFetch>;
  readonly refresh: () => void;
}

/** The dialog's one fetch of the active host's diagnostics: asked once now,
 *  and again on `refresh()`. A superseded answer is dropped. */
export function createPadiDiagnosticsFetch(): PadiDiagnosticsFetcher {
  const [state, setState] = createSignal<PadiDiagnosticsFetch>({
    kind: "loading",
    host: activeHost(),
  });
  let generation = 0;
  const refresh = (): void => {
    const host = activeHost();
    const entry = padiMap.entry(host);
    const connection = entry.state().kind;
    const mine = ++generation;
    if (connection !== "connected") {
      setState({ kind: "not-connected", host, connection });
      return;
    }
    setState({ kind: "loading", host });
    runAction(
      "read padi diagnostics",
      entry.procedures.diagnostics.read().pipe(
        Effect.match({
          onSuccess: (answer) => {
            if (mine === generation) setState({ kind: "answer", host, answer });
          },
          onFailure: (err) => {
            if (mine === generation) {
              setState({ kind: "error", host, message: toError(err).message });
            }
          },
        }),
      ),
    );
  };
  refresh();
  return { state, refresh };
}

/** Milliseconds, compact: one decimal under 10, whole above. */
const num = (v: number): string =>
  v < 10 ? v.toFixed(1) : String(Math.round(v));

/** A timing summary as `median · p99 · worst`, in ms — the order each caption
 *  below names once, so a row stays one line. */
const timing = (s: TimingSummary): string =>
  `${num(s.medianMs)} · ${num(s.p99Ms)} · ${num(s.maxMs)}`;

/** A measured value, or its reason — never a dash or a zero. */
function measuredText<T>(
  m: { kind: "measured"; value: T } | { kind: "unmeasured"; reason: string },
  show: (v: T) => string,
): JSX.Element {
  return m.kind === "measured" ? (
    <span class="whitespace-nowrap">{show(m.value)}</span>
  ) : (
    <span class="italic text-fg-3/70">{m.reason}</span>
  );
}

const CAPTION = "text-[10px] text-fg-3/70 mb-0.5";
const TH = "text-left font-normal text-fg-3/70 pr-2 pb-0.5 whitespace-nowrap";
const TD = "pr-2 align-top";

const Answer: Component<{ answer: PadiDiagnostics }> = (props) => (
  <div class="space-y-2">
    <div class="space-y-0.5">
      <Row label="Memory">
        <span class="font-mono">
          RSS {formatSize(props.answer.memory.rssBytes)} · heap{" "}
          {formatSize(props.answer.memory.heapUsedBytes)} /{" "}
          {formatSize(props.answer.memory.heapTotalBytes)} · outside heap{" "}
          {formatSize(props.answer.memory.nonHeapBytes)}
        </span>
      </Row>
      <Row label="Stalls">
        <span class="font-mono" data-testid="padi-diagnostics-stalls">
          last minute{" "}
          {measuredText(
            props.answer.stalls.lastMinute,
            (v) => `${timing(v.summary)} ms`,
          )}
          <br />
          this minute (
          {Math.round(props.answer.stalls.current.elapsedMs / 1000)} s){" "}
          {measuredText(
            props.answer.stalls.current.summary,
            (v) => `${timing(v)} ms`,
          )}
        </span>
      </Row>
      <Row label="Watches">
        <span class="font-mono">
          {measuredText(
            props.answer.kernelWatches,
            (v) =>
              `${v.total} in the kernel, ${v.perInstance.length} inotify instance${v.perInstance.length === 1 ? "" : "s"}`,
          )}
        </span>
      </Row>
    </div>

    <div>
      <div class={CAPTION}>
        child processes, last {props.answer.children.windowMs / 1000} s · ms as
        median · p99 · worst
      </div>
      <table class="text-[10px] font-mono tabular-nums w-full">
        <thead>
          <tr>
            <th class={TH}>kind</th>
            <th class={TH}>runs</th>
            <th class={TH}>start call</th>
            <th class={TH}>run</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.answer.children.rows}
            fallback={
              <tr>
                <td class="italic text-fg-3/60" colSpan={4}>
                  none started
                </td>
              </tr>
            }
          >
            {(row) => (
              <tr data-testid="padi-diagnostics-child-row">
                <td class={`${TD} text-fg whitespace-nowrap`}>
                  {row.kind}
                  <For each={row.causes}>
                    {(c) => (
                      <span class="text-fg-3/70">
                        {" "}
                        {c.cause}×{c.count}
                      </span>
                    )}
                  </For>
                </td>
                <td class={`${TD} whitespace-nowrap`}>
                  {row.started}
                  <Show when={row.running > 0}>
                    <span class="text-fg-3/70"> +{row.running} running</span>
                  </Show>
                  <Show when={row.failedToStart > 0}>
                    <span class="text-danger"> {row.failedToStart} failed</span>
                  </Show>
                </td>
                <td class={TD}>{measuredText(row.startCall, timing)}</td>
                <td class={TD}>{measuredText(row.run, timing)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>

    <div>
      <div class={CAPTION}>
        calls, last {props.answer.calls.windowMs / 1000} s · ms as median · p99
        · worst
      </div>
      <table class="text-[10px] font-mono tabular-nums w-full">
        <thead>
          <tr>
            <th class={TH}>procedure</th>
            <th class={TH}>n</th>
            <th class={TH}>total</th>
            <th class={TH}>in children</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.answer.calls.rows}
            fallback={
              <tr>
                <td class="italic text-fg-3/60" colSpan={4}>
                  no calls
                </td>
              </tr>
            }
          >
            {(row) => (
              <tr>
                <td class={`${TD} text-fg whitespace-nowrap`}>
                  {row.procedure}
                </td>
                <td class={TD}>{row.count}</td>
                <td class={`${TD} whitespace-nowrap`}>{timing(row.total)}</td>
                <td class={TD}>
                  {measuredText(row.inChildren, (v) =>
                    v.children === 0
                      ? "no children"
                      : `${timing(v.summary)} (${v.children})`,
                  )}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>

    <div>
      <div class={CAPTION}>
        file watchers ({props.answer.watchers.rows.length}), slowest install
        first
      </div>
      <div class="space-y-1 text-[10px] font-mono">
        <For
          each={props.answer.watchers.rows}
          fallback={<div class="italic text-fg-3/60">no watcher</div>}
        >
          {(row) => (
            <div data-testid="padi-diagnostics-watcher-row">
              <div class="flex items-baseline gap-2">
                <span class="text-fg whitespace-nowrap">{row.kind}</span>
                <Show when={row.state.kind !== "watching"}>
                  <span
                    class={
                      row.state.kind === "failed"
                        ? "text-danger"
                        : "text-fg-3/70"
                    }
                  >
                    {row.state.kind}
                  </span>
                </Show>
                <span class="ml-auto text-right text-fg-2">
                  {measuredText(row.lastInstallMs, (v) => `${num(v)} ms`)}
                  <Show when={row.rebuilds > 0}>
                    <span class="text-fg-3/70"> · {row.rebuilds} rebuilds</span>
                  </Show>
                </span>
              </div>
              <div class="text-fg-3 break-all">{row.root}</div>
              <div class="text-fg-3/70">asked by {row.askers.join(", ")}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  </div>
);

const PadiDiagnosticsSection: Component<{
  fetch: PadiDiagnosticsFetcher;
}> = (props) => (
  <Section
    title="padi"
    data-testid="padi-diagnostics"
    status={
      <button
        type="button"
        data-testid="padi-diagnostics-refresh"
        onClick={() => props.fetch.refresh()}
        class="text-[10px] px-1.5 py-px rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        Refresh
      </button>
    }
  >
    <div class="text-[11px]">
      <Switch>
        <Match when={props.fetch.state().kind === "loading"}>
          <span class="text-fg-3/70 italic">Asking padi…</span>
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "not-connected" ? s : undefined;
          })()}
        >
          {(s) => (
            <span class="text-fg-3">
              padi on this host is not connected ({s().connection}), so there is
              nothing to ask.
            </span>
          )}
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "error" ? s : undefined;
          })()}
        >
          {(s) => (
            <span class="text-danger" data-testid="padi-diagnostics-error">
              {s().message}
            </span>
          )}
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "answer" ? s : undefined;
          })()}
        >
          {(s) => <Answer answer={s().answer} />}
        </Match>
      </Switch>
    </div>
  </Section>
);

export default PadiDiagnosticsSection;
